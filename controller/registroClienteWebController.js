import { randomUUID } from 'crypto';
import { UniqueConstraintError } from 'sequelize';
import db from '../config/bd.js';
import { Clientes, Documentacion, ClientesRegistroWeb } from '../models/index.js';
import {
    crearClienteCompleto, resolverUbicacionDane, toPascal, calcularDvNit,
    normalizarResponsabilidades,
    REGIMEN_RESPONSABLE_IVA, REGIMEN_NO_RESPONSABLE_IVA
} from '../helpers/clientes.js';
import { subirComprobantes, borrarComprobantes } from '../helpers/comprobantesMovimiento.js';
import {
    texto, normalizarTexto, esVerdadero, RE_NOMBRE, RE_RAZON_SOCIAL, validarEmailWeb, validarCelularWeb,
    validarDireccionWeb, origenConstancia, cayoEnTrampa
} from '../helpers/registroWeb.js';
import { descripcionCiiu } from '../helpers/ciiu.js';
import { validarDocumento } from '../helpers/tiposDocumento.js';

// ─────────────────────────────────────────────────────────────────────────────
// Registro público de clientes — grupogh.co/formularios/registroClientes
//
// El cliente se registra solo, antes de facturar, desde internet y sin sesión. Todo lo
// que llega se trata como hostil: la ruta ya pasó por rate limit y Turnstile, pero acá
// cada campo se revalida contra lo que la base acepta, uno por uno (CLAUDE.md §12: nunca
// `req.body` entero a un create).
//
// Reglas decididas con el operador:
//   - Obligatorios para todos: documento, nombre, correo, celular, departamento, ciudad
//     y dirección, más la autorización de tratamiento de datos (Ley 1581).
//   - Una persona natural puede registrarse con NIT (RUT propio): queda como 'N'.
//   - Con NIT se exigen dígito de verificación, régimen y responsabilidades DIAN.
//   - El RUT en archivo es obligatorio solo para empresas ('J').
//   - Un documento que ya existe NO se toca: se le avisa que ya está registrado. Un
//     formulario público nunca sobrescribe los datos de un cliente existente.
// ─────────────────────────────────────────────────────────────────────────────

// Versiones del texto de autorización que publica el formulario. Si el texto cambia, se
// agrega una versión nueva acá y en el formulario: la constancia guarda cuál se aceptó.
const VERSIONES_AUTORIZACION = ['2026-09'];

// Texto, correo, celular, dirección y campo trampa: helpers/registroWeb.js, compartido con
// el registro de proveedores.
const RE_CIIU         = /^\d{4}$/;
const RE_FECHA        = /^\d{4}-\d{2}-\d{2}$/;

const MENSAJE_YA_REGISTRADO =
    'Este documento ya está registrado en Grupo GH. No necesitas registrarte de nuevo: en la tienda te facturamos con tus datos.';

// ─── CONSULTA: ¿este documento ya es cliente? ────────────────────────────────
//
// La pide el formulario al terminar el primer paso, para no hacerle llenar todo a quien ya
// está registrado. Revela si un documento es cliente, así que va detrás de Turnstile y de
// un rate limit propio: consultarlo en masa exige resolver un reto por cada documento.
export const consultarDocumentoRegistro = async (req, res) => {
    const doc = validarDocumento(texto(req.body?.tipoDocumento), texto(req.body?.numero_doc));
    if (doc.error) return res.status(400).json({ success: false, mensaje: doc.error });

    try {
        const existe = await Clientes.findOne({ where: { numero_doc: doc.numero }, attributes: ['idCliente'], raw: true });
        return res.json({
            success:    true,
            registrado: Boolean(existe),
            ...(existe && { mensaje: MENSAJE_YA_REGISTRADO })
        });
    } catch (e) {
        console.error('consultarDocumentoRegistro:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos verificar el documento. Inténtalo de nuevo.' });
    }
};

// ─── REGISTRO ────────────────────────────────────────────────────────────────
export const registrarClienteWeb = async (req, res) => {
    const b = req.body ?? {};
    const fallo = (mensaje, campo) => res.status(400).json({ success: false, mensaje, ...(campo && { campo }) });

    if (cayoEnTrampa(req, 'registro-web')) return fallo('No pudimos procesar el registro.');

    // ── Autorizaciones ──
    if (!esVerdadero(b.acepta_datos)) return fallo('Debes autorizar el tratamiento de tus datos para registrarte.', 'acepta_datos');
    const versionAutorizacion = texto(b.version_autorizacion);
    if (!VERSIONES_AUTORIZACION.includes(versionAutorizacion)) return fallo('La autorización no es válida. Recarga la página.');

    // ── Tipo de persona y documento ──
    const tipo_persona = texto(b.tipo_persona).toUpperCase();
    if (!['N', 'J'].includes(tipo_persona)) return fallo('Tipo de persona inválido.');
    const esEmpresa = tipo_persona === 'J';

    const doc = validarDocumento(texto(b.tipoDocumento), texto(b.numero_doc));
    if (doc.error) return fallo(doc.error, 'numero_doc');
    if (esEmpresa && doc.tipoDocumento !== 'NIT') return fallo('Una empresa se registra con su NIT.', 'tipoDocumento');
    const conNit = doc.tipoDocumento === 'NIT';

    let digito_verif = null;
    if (conNit) {
        digito_verif = texto(b.digito_verif);
        if (!/^\d$/.test(digito_verif)) return fallo('Ingresa el dígito de verificación de tu NIT.', 'digito_verif');
        if (digito_verif !== calcularDvNit(doc.numero)) {
            return fallo('El dígito de verificación no corresponde a ese NIT. Revísalo en tu RUT.', 'digito_verif');
        }
    }

    // ── Nombre ──
    let nombres = {};
    if (esEmpresa) {
        const razon = normalizarTexto(texto(b.razon_social));
        if (!RE_RAZON_SOCIAL.test(razon)) return fallo('Ingresa la razón social tal como aparece en el RUT.', 'razon_social');
        nombres = { razon_social: toPascal(razon) };
    } else {
        const campos = ['primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido'];
        for (const c of campos) {
            const v = normalizarTexto(texto(b[c]));
            const obligatorio = c === 'primer_nombre' || c === 'primer_apellido';
            if (!v && obligatorio) return fallo(c === 'primer_nombre' ? 'Ingresa tu primer nombre.' : 'Ingresa tu primer apellido.', c);
            if (v && !RE_NOMBRE.test(v)) return fallo('Los nombres solo pueden llevar letras.', c);
            nombres[c] = v ? toPascal(v) : null;
        }
    }

    // ── Contacto ──
    const correo = validarEmailWeb(b.email);
    if (correo.error) return fallo(correo.error, 'email');
    const { email } = correo;
    const celular = validarCelularWeb(b.indicativo, b.telefono);
    if (celular.error) return fallo(celular.error, 'telefono');
    const { telefono } = celular;

    let genero = null;
    if (!esEmpresa && texto(b.genero)) {
        genero = texto(b.genero).toUpperCase();
        if (!['F', 'M', 'O'].includes(genero)) return fallo('Género inválido.', 'genero');
    }

    // ── Ubicación ──
    const dir = validarDireccionWeb(b.direccion);
    if (dir.error) return fallo('Ingresa tu dirección completa.', 'direccion');
    const { direccion } = dir;

    // ── Datos tributarios (solo con NIT) ──
    let tributario = {};
    if (conNit) {
        const regimen = texto(b.regimen_fiscal);
        if (![REGIMEN_RESPONSABLE_IVA, REGIMEN_NO_RESPONSABLE_IVA].includes(regimen)) return fallo('Selecciona el régimen de IVA.', 'regimen_fiscal');

        const responsabilidades = normalizarResponsabilidades(b.responsabilidad_fiscal);
        if (!responsabilidades) return fallo('Selecciona al menos una responsabilidad fiscal (si no aplica ninguna, R-99-PN).', 'responsabilidad_fiscal');
        if (responsabilidades.includes('R-99-PN') && responsabilidades !== 'R-99-PN') {
            return fallo('R-99-PN significa que no aplica ninguna: no puede ir junto con otras.', 'responsabilidad_fiscal');
        }

        // La actividad económica sale del catálogo CIIU, nunca del formulario: en la web el
        // campo es de solo lectura y se llena solo con el código.
        const ciiu = texto(b.ciiu);
        if (ciiu && !RE_CIIU.test(ciiu)) return fallo('El código CIIU son 4 dígitos.', 'ciiu');
        const descripcion_ciiu = ciiu ? descripcionCiiu(ciiu) : null;
        if (ciiu && !descripcion_ciiu) return fallo('Ese código CIIU no existe. Revísalo en tu RUT.', 'ciiu');

        const fecha_rut = texto(b.fecha_rut);
        if (fecha_rut) {
            const f = new Date(`${fecha_rut}T00:00:00Z`);
            if (!RE_FECHA.test(fecha_rut) || Number.isNaN(f.getTime()) || f > new Date() || f.getUTCFullYear() < 1990) {
                return fallo('La fecha del RUT no es válida.', 'fecha_rut');
            }
        }

        tributario = {
            regimen_fiscal:         regimen,
            responsabilidad_fiscal: responsabilidades,
            ciiu:                   ciiu || null,
            descripcion_ciiu:       descripcion_ciiu,
            fecha_rut:              fecha_rut || null
        };
    }

    if (esEmpresa && !req.file) return fallo('Adjunta el RUT de la empresa (PDF o imagen).', 'rut');
    if (!conNit && req.file) return fallo('Solo se adjunta RUT cuando te registras con NIT.', 'rut');

    // ── Contra la base: ubicación DANE y documento ──
    let ubicacion;
    try {
        ubicacion = await resolverUbicacionDane(b.idDepartamento, b.idMunicipio);
        if (!ubicacion.ok) return fallo(ubicacion.mensaje, 'idMunicipio');

        const existe = await Clientes.findOne({ where: { numero_doc: doc.numero }, attributes: ['idCliente'], raw: true });
        if (existe) return res.status(409).json({ success: false, registrado: true, mensaje: MENSAJE_YA_REGISTRADO });
    } catch (e) {
        console.error('registrarClienteWeb – validación:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos completar el registro. Inténtalo de nuevo.' });
    }

    // ── RUT a R2, antes de la transacción (no se retienen filas mientras sube) ──
    const idCliente = randomUUID();
    let subidos = [];
    let docs = [];
    if (req.file) {
        try {
            ({ docs, subidos } = await subirComprobantes({
                archivos:      [req.file],
                idPropietario: idCliente,
                pertenece:     'cliente',
                prefijo:       'rut',
                carpeta:       'clientes'
            }));
            // El nombre original lo escribe quien sube; en el panel se muestra "RUT".
            docs = docs.map(d => ({ ...d, nombreDocumento: 'RUT' }));
        } catch (e) {
            if (e.publico) return fallo(e.message, 'rut');
            console.error('registrarClienteWeb – subida del RUT:', e);
            return res.status(500).json({ success: false, mensaje: 'No pudimos guardar el archivo. Inténtalo de nuevo.' });
        }
    }

    // ── Las tres tablas del cliente + documento + constancia, juntas ──
    const t = await db.transaction();
    try {
        await crearClienteCompleto({
            idCliente,
            tipo_persona,
            tipoDocumento: doc.tipoDocumento,
            numero_doc:    doc.numero,
            digito_verif,
            ...nombres,
            email,
            telefono,
            genero,
            ...tributario,
            ubicacion: {
                idDepartamento:     ubicacion.idDepartamento,
                nombreDepartamento: ubicacion.nombreDepartamento,
                idMunicipio:        ubicacion.idMunicipio,
                nombreMunicipio:    ubicacion.nombreMunicipio,
                direccion:          toPascal(direccion)
            }
        }, t);

        if (docs.length) await Documentacion.bulkCreate(docs, { transaction: t });

        await ClientesRegistroWeb.create({
            idCliente,
            aceptaTratamientoDatos: true,
            aceptaWhatsapp:         esVerdadero(b.acepta_whatsapp),
            aceptaEmail:            esVerdadero(b.acepta_email),
            versionAutorizacion,
            ...origenConstancia(req)
        }, { transaction: t });

        await t.commit();
    } catch (e) {
        if (!t.finished) await t.rollback().catch(() => {});
        await borrarComprobantes(subidos);
        // Dos envíos simultáneos con el mismo documento: numero_doc es único y el segundo
        // choca acá. Se responde igual que si ya estuviera registrado, porque lo está.
        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({ success: false, registrado: true, mensaje: MENSAJE_YA_REGISTRADO });
        }
        console.error('registrarClienteWeb:', e);
        return res.status(500).json({ success: false, mensaje: 'No pudimos completar el registro. Inténtalo de nuevo.' });
    }

    return res.status(201).json({
        success: true,
        mensaje: 'Registro completado. Ya puedes pedir tu factura en cualquiera de nuestras tiendas.'
    });
};
