import { randomUUID } from 'crypto';
import { UniqueConstraintError } from 'sequelize';
import db from '../config/bd.js';
import { CategoriasDeProvedores, ProvedoresRegistroWeb } from '../models/index.js';
import { resolverUbicacionDane, toPascal } from '../helpers/clientes.js';
import { subirComprobantes, borrarComprobantes } from '../helpers/comprobantesMovimiento.js';
import { validarCuentasBancarias, MAX_CUENTAS_PROVEEDOR } from '../helpers/cuentasBancariasProveedor.js';
import {
    ENTIDADES_FINANCIERAS, TIPOS_CUENTA_BANCARIA, TIPOS_LLAVE_BREB, FORMATOS_NUMERO_CUENTA
} from '../helpers/catalogos.js';
import { TIPOS_DOCUMENTO_PROVEEDOR } from '../helpers/tiposDocumento.js';
import {
    validarDocumentoProveedor, validarCategoriasProveedor, requiereFotosLugarTrabajo,
    crearProveedorCompleto, cuentasDeLaWeb
} from '../helpers/proveedores.js';
import { mailBienvenidaProveedor } from '../helpers/mailBienvenidaProveedor.js';
import {
    texto, esVerdadero, RE_NOMBRE, RE_RAZON_SOCIAL, validarEmailWeb, validarCelularWeb,
    validarDireccionWeb, origenConstancia, cayoEnTrampa
} from '../helpers/registroWeb.js';
import { MAX_FOTOS_LUGAR_TRABAJO } from '../middlewares/uploadComprobantes.js';

// ─────────────────────────────────────────────────────────────────────────────
// Registro público de proveedores — grupogh.co/formularios/registroProvedores
//
// Mismo tratamiento que el registro de clientes (registroClienteWebController.js): llega
// de internet, ya pasó rate limit y Turnstile, y cada campo se revalida acá contra lo que
// la base acepta (CLAUDE.md §12: nunca `req.body` entero a un create).
//
// Reglas decididas con el operador:
//   - El proveedor queda ACTIVO de una vez, igual que si lo creara el panel.
//   - Sus cuentas bancarias (al menos una: es a donde se le paga) quedan SIN VERIFICAR
//     hasta que alguien del panel las confirme. Las dio él mismo por internet.
//   - Documentos: la cédula (la propia, o la del representante legal si es empresa) y, si
//     se registra con NIT, el RUT.
//   - Fotos del lugar de trabajo (máquinas, espacio): obligatorias para las categorías que
//     las piden —confeccionista—, opcionales para las demás.
//   - Un documento que ya existe NO se toca: se le avisa que ya está registrado.
// ─────────────────────────────────────────────────────────────────────────────

// Versiones del texto de autorización que publica el formulario. Si el texto cambia, se
// agrega una versión nueva acá y en el formulario (VERSION_AUTORIZACION).
const VERSIONES_AUTORIZACION = ['2026-09'];

// Mínimo de fotos para una categoría que las pide: una de las máquinas y una del espacio.
const MIN_FOTOS_LUGAR_TRABAJO = 2;

const MENSAJE_YA_REGISTRADO =
    'Este documento ya está registrado como proveedor de Grupo GH. Si necesitas actualizar tus datos o tu cuenta bancaria, escríbele a tu contacto de compras.';

// ─── CATÁLOGOS ───────────────────────────────────────────────────────────────
// Lo que el formulario necesita para pintarse: categorías (con cuáles piden fotos), bancos
// y billeteras con Bre-B, tipos de cuenta y de llave con sus formatos, tipos de documento.
// Una sola fuente con el panel: son los mismos catálogos de helpers/catalogos.js.
export const catalogosRegistroProveedor = async (req, res) => {
    try {
        const categorias = await CategoriasDeProvedores.findAll({ attributes: ['idCategoria', 'nombre'], order: [['nombre', 'ASC']], raw: true });
        res.set('Cache-Control', 'public, max-age=300');
        return res.json({
            success: true,
            categorias: categorias.map(c => ({ ...c, requiereFotos: requiereFotosLugarTrabajo(c) })),
            entidadesFinancieras: ENTIDADES_FINANCIERAS,
            tiposCuenta:          TIPOS_CUENTA_BANCARIA,
            tiposLlave:           TIPOS_LLAVE_BREB,
            formatos:             FORMATOS_NUMERO_CUENTA,
            tiposDocumento:       TIPOS_DOCUMENTO_PROVEEDOR,
            limites: { maxCuentas: MAX_CUENTAS_PROVEEDOR, maxFotos: MAX_FOTOS_LUGAR_TRABAJO, minFotos: MIN_FOTOS_LUGAR_TRABAJO }
        });
    } catch (e) {
        console.error('catalogosRegistroProveedor:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos cargar el formulario. Recarga la página.' });
    }
};

// ─── CONSULTA: ¿este documento ya es proveedor? ──────────────────────────────
// Detrás de Turnstile y de su propio rate limit, igual que la de clientes: revela si un
// documento es proveedor.
export const consultarDocumentoProveedorWeb = async (req, res) => {
    try {
        const doc = await validarDocumentoProveedor(texto(req.body?.tipoDocumento), texto(req.body?.numero_doc));
        if (doc.existente) return res.json({ success: true, registrado: true, mensaje: MENSAJE_YA_REGISTRADO });
        if (doc.error) return res.status(400).json({ success: false, mensaje: doc.error });
        return res.json({ success: true, registrado: false });
    } catch (e) {
        console.error('consultarDocumentoProveedorWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos verificar el documento. Inténtalo de nuevo.' });
    }
};

// ─── REGISTRO ────────────────────────────────────────────────────────────────
export const registrarProveedorWeb = async (req, res) => {
    const b = req.body ?? {};
    const archivos = req.files ?? {};
    const fallo = (mensaje, campo) => res.status(400).json({ success: false, mensaje, ...(campo && { campo }) });

    if (cayoEnTrampa(req, 'registro-proveedor')) return fallo('No pudimos procesar el registro.');

    // ── Autorización ──
    if (!esVerdadero(b.acepta_datos)) return fallo('Debes autorizar el tratamiento de tus datos para registrarte.', 'acepta_datos');
    const versionAutorizacion = texto(b.version_autorizacion);
    if (!VERSIONES_AUTORIZACION.includes(versionAutorizacion)) return fallo('La autorización no es válida. Recarga la página.');

    // ── Tipo de persona ──
    const tipoPersona = texto(b.tipo_persona).toUpperCase();
    if (!['N', 'J'].includes(tipoPersona)) return fallo('Tipo de persona inválido.');
    const esEmpresa = tipoPersona === 'J';

    // ── Nombre y contacto ──
    // En PROVEDORES el nombre es uno solo (razonSocial). Una persona natural da su nombre
    // completo y es su propio contacto; una empresa da su razón social y quién la atiende.
    let razonSocial, nombreContacto;
    if (esEmpresa) {
        const razon = texto(b.razon_social);
        if (!RE_RAZON_SOCIAL.test(razon)) return fallo('Ingresa la razón social tal como aparece en el RUT.', 'razon_social');
        const contacto = texto(b.nombre_contacto);
        if (contacto.length < 3 || !RE_NOMBRE.test(contacto)) return fallo('Ingresa el nombre de la persona de contacto.', 'nombre_contacto');
        razonSocial = toPascal(razon);
        nombreContacto = toPascal(contacto);
    } else {
        const nombre = texto(b.nombre_completo).replace(/\s+/g, ' ');
        if (nombre.split(' ').length < 2 || !RE_NOMBRE.test(nombre)) return fallo('Ingresa tu nombre y tu apellido.', 'nombre_completo');
        razonSocial = toPascal(nombre);
        nombreContacto = razonSocial;
    }

    const correo = validarEmailWeb(b.email);
    if (correo.error) return fallo(correo.error, 'email');
    const celular = validarCelularWeb(b.indicativo, b.telefono);
    if (celular.error) return fallo(celular.error, 'telefono');
    const dir = validarDireccionWeb(b.direccion);
    if (dir.error) return fallo(dir.error, 'direccion');

    // ── Cuentas: al menos una, con las reglas del panel. Llegan sin verificar. ──
    const cuentas = validarCuentasBancarias(b.cuentasBancarias);
    if (cuentas.error) return fallo(cuentas.error, 'cuentasBancarias');
    if (!cuentas.cuentas.length) return fallo('Agrega al menos una cuenta o llave donde podamos pagarte.', 'cuentasBancarias');

    // ── Archivos (llegan ya filtrados por tipo y peso en multer) ──
    const cedula = archivos.cedula?.[0];
    const rut    = archivos.rut?.[0];
    const fotos  = archivos.fotos ?? [];
    if (!cedula) return fallo(esEmpresa ? 'Adjunta la cédula del representante legal.' : 'Adjunta una foto o PDF de tu cédula.', 'cedula');

    // ── Contra la base: documento, ubicación DANE y categorías ──
    let doc, ubicacion, categorias;
    try {
        doc = await validarDocumentoProveedor(texto(b.tipoDocumento), texto(b.numero_doc));
        if (doc.existente) return res.status(409).json({ success: false, registrado: true, mensaje: MENSAJE_YA_REGISTRADO });
        if (doc.error) return fallo(doc.error, 'numero_doc');

        ubicacion = await resolverUbicacionDane(b.idDepartamento, b.idMunicipio);
        if (!ubicacion.ok) return fallo(ubicacion.mensaje, 'idMunicipio');

        const cats = await validarCategoriasProveedor(b.categorias);
        if (cats.error) return fallo(cats.error, 'categorias');
        categorias = cats.categorias;
    } catch (e) {
        console.error('registrarProveedorWeb – validación:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos completar el registro. Inténtalo de nuevo.' });
    }

    const conNit = doc.tipoDocumento === 'NIT';
    if (esEmpresa && !conNit) return fallo('Una empresa se registra con su NIT.', 'tipoDocumento');
    if (conNit && !rut) return fallo('Adjunta tu RUT.', 'rut');
    if (!conNit && rut) return fallo('Solo se adjunta RUT cuando te registras con NIT.', 'rut');

    const pideFotos = categorias.some(requiereFotosLugarTrabajo);
    if (pideFotos && fotos.length < MIN_FOTOS_LUGAR_TRABAJO) {
        return fallo(`Como confeccionista, sube al menos ${MIN_FOTOS_LUGAR_TRABAJO} fotos: de tus máquinas y de tu espacio de trabajo.`, 'fotos');
    }

    // ── Archivos a R2, antes de la transacción (no se retienen filas mientras suben) ──
    const idProveedor = randomUUID();
    const subidos = [];
    const docs = [];
    let campoSubiendo = null;   // para llevar a la persona al archivo que falló
    const subir = async (campo, lista, prefijo, nombre, opciones = {}) => {
        campoSubiendo = campo;
        const r = await subirComprobantes({ archivos: lista, idPropietario: idProveedor, pertenece: 'provedor', prefijo, carpeta: 'provedores', ...opciones });
        subidos.push(...r.subidos);
        // El nombre original lo escribe quien sube; en el panel se muestra qué documento es.
        docs.push(...r.docs.map((d, i) => ({ ...d, nombreDocumento: typeof nombre === 'function' ? nombre(i) : nombre })));
    };
    try {
        await subir('cedula', [cedula], 'cedula', esEmpresa ? 'Cédula del representante legal' : 'Cédula');
        if (rut) await subir('rut', [rut], 'rut', 'RUT');
        if (fotos.length) {
            await subir('fotos', fotos, 'lugar-trabajo', (i) => `Lugar de trabajo · foto ${i + 1}`, { soloImagenes: true });
        }
    } catch (e) {
        await borrarComprobantes(subidos);
        if (e.publico) return fallo(e.message, campoSubiendo);
        console.error('registrarProveedorWeb – subida:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos guardar los archivos. Inténtalo de nuevo.' });
    }

    // ── Proveedor + categorías + cuentas + documentos + constancia, juntos ──
    const cuentasParaProveedor = cuentasDeLaWeb(cuentas.cuentas);
    const t = await db.transaction();
    let proveedorCreado;
    try {
        proveedorCreado = await crearProveedorCompleto({
            datos: {
                idProveedor,
                razonSocial,
                tipoDocumento:     doc.tipoDocumento,
                taxIdSupplier:     doc.numero,
                nombreContacto,
                // telefonoContacto es de 10 dígitos: un celular de otro país va al teléfono
                // del proveedor, que admite el formato internacional.
                telefonoContacto:  celular.colombiano ? celular.telefono : null,
                telefonoProvedor:  celular.colombiano ? null : celular.telefono,
                emailProvedor:     correo.email,
                direccionProvedor: toPascal(dir.direccion),
                departamento:      ubicacion.idDepartamento,
                ciudad:            ubicacion.idMunicipio,
                estado:            true
            },
            categorias,
            cuentas: cuentasParaProveedor,
            docs
        }, t);

        await ProvedoresRegistroWeb.create({
            idProveedor,
            aceptaTratamientoDatos: true,
            versionAutorizacion,
            ...origenConstancia(req)
        }, { transaction: t });

        await t.commit();
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});
        await borrarComprobantes(subidos);
        // Dos envíos simultáneos con el mismo documento: taxIdSupplier es único y el segundo
        // choca acá. Se responde igual que si ya estuviera registrado, porque lo está.
        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({ success: false, registrado: true, mensaje: MENSAJE_YA_REGISTRADO });
        }
        console.error('registrarProveedorWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos completar el registro. Inténtalo de nuevo.' });
    }

    // Después del commit y sin await: un correo caído no puede tumbar una respuesta que ya
    // está confirmada en base de datos (CLAUDE.md §9). mailBienvenidaProveedor nunca lanza
    // (enviarCorreoSes atrapa su propio error), pero el .catch es la red de seguridad por si
    // algo revienta antes de llegar ahí.
    mailBienvenidaProveedor({
        razonSocial,
        emailProveedor: correo.email,
        tipoDocumento: doc.tipoDocumento,
        taxIdSupplier: doc.numero,
        fechaRegistro: proveedorCreado.createdAt,
        categorias: categorias.map(c => c.nombre),
        cuentas: cuentasParaProveedor,
        documentos: docs
    }).catch(() => {});

    return res.status(201).json({
        success: true,
        mensaje: 'Registro completado. Nuestro equipo de compras revisará tus datos y tu cuenta bancaria antes del primer pago.'
    });
};
