import { UniqueConstraintError, Op } from 'sequelize';
import { Upload } from '@aws-sdk/lib-storage';
import s3Client from '../config/r2.js';
import { Material } from '../models/index.js';
import { TIPOS_INSUMO, UNIDADES_COMPRA, LIMITES_INSUMO, CARPETA_IMAGENES_INSUMOS, presentarMaterial, validarInsumo, codigoDxfValido, datosFicticiosInsumo, historialComprasInsumo } from '../helpers/insumos.js';
import { imagenAWebpSegura } from '../helpers/imagenSegura.js';
import { borrarObjetos } from '../helpers/almacenamientoDocumentos.js';

// Caja de recorte de la foto de un material: igual a la de una foto de producto
// (FOTO_PRODUCTO en adminControllers.js) — cuadrada, sin recortar ('inside'), porque acá
// también importa ver la pieza completa, no solo un recorte centrado.
const FOTO_INSUMO = { ancho: 1000, alto: 1000, ajuste: 'inside' };

// Base de los módulos de Producción (Confeccionistas, Procesos): hoy son la misma pantalla
// vacía, lista para que cada módulo agregue su propio listado más adelante sin repetir el
// render. Cuando uno de ellos gane su propia lógica, se le saca su función de acá y se deja
// de pasar por `paginaBase`. Insumos ya tiene la suya (homeInsumos, abajo).
const paginaBase = ({ folder, titulo, subtitulo, icono }) => (req, res) => {
    try {
        return res.render('./administrador/produccion/base', {
            pagina: titulo,
            subPagina: titulo,
            csrfToken: req.csrfToken(),
            currentPath: folder,
            titulo,
            subtitulo,
            icono
        });
    } catch (e) {
        console.error(`produccionController(${folder}):`, e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

const homeConfeccionistas = paginaBase({
    folder:    '/confeccionistas',
    titulo:    'Confeccionistas',
    subtitulo: 'Talleres y maquilas que confeccionan para Grupo GH',
    icono:     'fi-rr-tshirt'
});

// Procesos se abre en submenú (views/partials/leftMenu.pug): Nuevo proceso, Listado de
// procesos y Fichas de confección son tres pantallas, no una — pero las tres cuelgan del
// mismo folder de permiso ('/procesos', ver seed/migracionPermisosProduccion.js), igual que
// las sub-páginas de Insumos (homeOrdenCompra, homeHistorialCompras) mantienen
// currentPath: '/insumos' aunque su URL sea otra, para que el folder siga marcado activo.
const homeProcesosNuevo = paginaBase({
    folder:    '/procesos',
    titulo:    'Nuevo proceso',
    subtitulo: 'Da de alta una nueva etapa de producción',
    icono:     'fi-rr-plus'
});

const homeProcesosListado = paginaBase({
    folder:    '/procesos',
    titulo:    'Listado de procesos',
    subtitulo: 'Etapas de producción: corte, confección, lavandería, estampado y empaque',
    icono:     'fi-rr-interchange'
});

const homeFichasConfeccion = paginaBase({
    folder:    '/procesos',
    titulo:    'Fichas de confección',
    subtitulo: 'Ficha técnica de cada prenda: procesos, tiempos e insumos asociados',
    icono:     'fi-rr-document'
});

// GET /admin/insumos — listado del catálogo (columna izquierda) y formulario de alta (derecha).
// El catálogo es chico (un registro por material del DXF), así que se trae completo y ordenado
// por el código, que es único: el orden es total.
const homeInsumos = async (req, res) => {
    try {
        const materiales = await Material.findAll({ order: [['codigoMaterial', 'ASC']] });
        return res.render('./administrador/produccion/insumos', {
            pagina:    'Insumos',
            subPagina: 'Insumos',
            csrfToken: req.csrfToken(),
            currentPath: '/insumos',
            titulo:    'Insumos',
            subtitulo: 'Materias primas e insumos del catálogo de producción',
            icono:     'fi-rr-boxes',
            materiales: materiales.map(presentarMaterial),
            tiposInsumo: TIPOS_INSUMO,
            unidadesCompra: UNIDADES_COMPRA,
            limites: LIMITES_INSUMO
        });
    } catch (e) {
        console.error('produccionController(insumos):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// POST /admin/insumos — alta de un material. La validación del servidor es la que cuenta: el
// formulario del navegador valida lo mismo para avisar antes, pero no es la garantía (§5.3).
// El código repetido no se busca antes con un SELECT: lo rechaza la restricción UNIQUE en el
// mismo INSERT, así que no hay carrera entre dos altas con el mismo código.
//
// La foto es opcional y pasa por el mismo filtro que toda imagen subida por un usuario
// (CLAUDE.md §5.9, helpers/imagenSegura.js): tipo real por magic bytes, no por el mimetype
// del navegador, y se persiste convertida a WebP. Se sube a R2 ANTES de crear la fila —si la
// imagen es inválida, el material no se crea sin foto por error— y si el INSERT falla
// después (código duplicado), el objeto recién subido se borra: no queda huérfano en R2.
const crearInsumo = async (req, res) => {
    const { errores, datos } = validarInsumo(req.body);
    if (errores) {
        return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });
    }

    let nombreImagen = null;
    if (req.file) {
        const foto = await imagenAWebpSegura(req.file.buffer, { caja: FOTO_INSUMO });
        if (!foto.ok) {
            return res.status(400).json({ success: false, errores: { imagen: foto.mensaje }, mensaje: foto.mensaje });
        }
        nombreImagen = `insumo-${datos.codigoMaterial}-${Date.now()}.webp`;
        try {
            await new Upload({
                client: s3Client,
                params: {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: `${CARPETA_IMAGENES_INSUMOS}/${nombreImagen}`,
                    Body: foto.buffer,
                    ContentType: 'image/webp'
                }
            }).done();
        } catch (e) {
            console.error('[insumos] subida de imagen:', e);
            return res.status(500).json({ success: false, mensaje: 'No se pudo subir la imagen. Intenta de nuevo.' });
        }
    }

    try {
        const material = await Material.create(nombreImagen ? { ...datos, imagen: nombreImagen } : datos);
        return res.json({ success: true, mensaje: 'Material guardado.', material: presentarMaterial(material) });
    } catch (e) {
        if (nombreImagen) await borrarObjetos([`${CARPETA_IMAGENES_INSUMOS}/${nombreImagen}`]);

        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({
                success: false,
                errores: { codigoMaterial: `Ya existe un material con el código ${datos.codigoMaterial}.` },
                mensaje: 'Revisa los campos marcados.'
            });
        }
        if (e.name === 'SequelizeValidationError') {
            const errs = Object.fromEntries(e.errors.map(x => [x.path, x.message]));
            return res.status(400).json({ success: false, errores: errs, mensaje: 'Revisa los campos marcados.' });
        }
        console.error('[insumos] crear:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar el material. Intenta de nuevo.' });
    }
};

// GET /admin/insumos/codigo/:codigo — ¿ya existe ese código DXF? Lo consulta el formulario al
// salir del campo, para avisar antes de que la persona escriba el resto. No reemplaza la
// garantía: el alta (y la edición) vuelven a rechazar el duplicado con el UNIQUE (409) por si
// dos personas guardan el mismo código a la vez.
//
// `?excluir=idMaterial` lo manda el formulario de edición: el propio material no cuenta como
// "ocupado" si la persona no tocó el código. Gateado por READ (no CREATE/EDIT): el catálogo
// ya muestra todos los códigos a cualquiera con lectura, así que esta consulta no revela nada
// que esa pantalla no revele ya.
const codigoInsumoOcupado = async (req, res) => {
    const codigo = codigoDxfValido(req.params.codigo);
    if (codigo === null) {
        return res.status(400).json({ success: false, mensaje: 'El código debe ser un número entero entre 1 y 2147483647.' });
    }
    try {
        const where = { codigoMaterial: codigo };
        if (req.query.excluir) where.idMaterial = { [Op.ne]: req.query.excluir };
        const existentes = await Material.count({ where });
        return res.json({ success: true, existe: existentes > 0 });
    } catch (e) {
        console.error('[insumos] consulta de código:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo verificar el código.' });
    }
};

// GET /admin/insumos/:idMaterial — perfil de un material. El id es un UUID: se busca tal cual,
// sin parseInt (CLAUDE.md §3). Si no existe, vuelve al catálogo en vez de mostrar una pantalla
// vacía.
const verInsumo = async (req, res) => {
    try {
        const material = await Material.findByPk(req.params.idMaterial);
        if (!material) return res.redirect('/admin/insumos');
        const fila = presentarMaterial(material);
        // El resto de `datos` sigue siendo relleno (ver helpers/insumos.js) — solo el
        // historial de compras es real, así que se pisa acá antes de llegar a la vista.
        const datos = { ...datosFicticiosInsumo(fila), historialCompras: await historialComprasInsumo(material.idMaterial) };
        return res.render('./administrador/produccion/insumoPerfil', {
            pagina:    'Insumos',
            subPagina: fila.nombre,
            csrfToken: req.csrfToken(),
            currentPath: '/insumos',
            titulo:    fila.nombre,
            subtitulo: fila.tipoEtiqueta,
            icono:     'fi-rr-boxes',
            material:  fila,
            creado:    new Date(material.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' }),
            actualizado: new Date(material.updatedAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' }),
            // Dashboard del perfil: casi todo es relleno todavía (ver el comentario en
            // helpers/insumos.js) salvo historialCompras, que ya es real. `datos` llega
            // aparte de `material` para que sea obvio en la vista qué es real y qué hay que
            // reemplazar el día que exista la tabla.
            datos,
            // Para el modal "Editar insumo" — mismas listas que ya usa el alta (homeInsumos),
            // así el formulario de edición no vuelve a escribirlas.
            tiposInsumo: TIPOS_INSUMO,
            unidadesCompra: UNIDADES_COMPRA,
            limites: LIMITES_INSUMO
        });
    } catch (e) {
        console.error('produccionController(insumo perfil):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// PUT /admin/insumos/:idMaterial — edición de los datos básicos: código DXF, nombre, tipo,
// unidad de compra y, opcional, una foto nueva. La validación es la misma que el alta
// (helpers/insumos.js, validarInsumo) y el mismo UNIQUE de MySQL es la garantía real contra
// dos materiales con el mismo código — acá solo cambia que se excluye al propio material del
// chequeo en vivo (codigoInsumoOcupado, `?excluir=`).
//
// Llega detrás de tres candados, en este orden (CLAUDE.md §9 / §6, mismo patrón que "Editar
// precios masivamente"): el permiso de EDIT de la sesión (ruta), el código de un empleado de
// esa sesión (verificarCodigoEmpleadoAdmin) y que ESE empleado tenga permiso de EDIT sobre
// Insumos (verificarPermisoEmpleado) — req.empleadoVerificado llega armado por los dos
// últimos, aunque hoy no se registra en ninguna bitácora propia (no existe una tabla de
// cambios de insumo todavía, a diferencia de PRODUCTOS_CAMBIOS_PRECIO).
//
// La foto nueva se sube a R2 ANTES del UPDATE (mismo criterio que crearInsumo); si el UPDATE
// falla, se borra la que se acababa de subir. La foto VIEJA se borra recién después de que el
// UPDATE quedó bien — si se borrara antes y el UPDATE fallara, el material quedaría sin foto.
const editarInsumo = async (req, res) => {
    const material = await Material.findByPk(req.params.idMaterial);
    if (!material) return res.status(404).json({ success: false, mensaje: 'El material ya no existe.' });

    const { errores, datos } = validarInsumo(req.body);
    if (errores) {
        return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });
    }

    let nombreImagenNueva = null;
    if (req.file) {
        const foto = await imagenAWebpSegura(req.file.buffer, { caja: FOTO_INSUMO });
        if (!foto.ok) {
            return res.status(400).json({ success: false, errores: { imagen: foto.mensaje }, mensaje: foto.mensaje });
        }
        nombreImagenNueva = `insumo-${datos.codigoMaterial}-${Date.now()}.webp`;
        try {
            await new Upload({
                client: s3Client,
                params: {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: `${CARPETA_IMAGENES_INSUMOS}/${nombreImagenNueva}`,
                    Body: foto.buffer,
                    ContentType: 'image/webp'
                }
            }).done();
        } catch (e) {
            console.error('[insumos] subida de imagen (editar):', e);
            return res.status(500).json({ success: false, mensaje: 'No se pudo subir la imagen. Intenta de nuevo.' });
        }
    }

    const imagenAnterior = material.imagen;
    try {
        await material.update(nombreImagenNueva ? { ...datos, imagen: nombreImagenNueva } : datos);
    } catch (e) {
        if (nombreImagenNueva) await borrarObjetos([`${CARPETA_IMAGENES_INSUMOS}/${nombreImagenNueva}`]);

        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({
                success: false,
                errores: { codigoMaterial: `Ya existe un material con el código ${datos.codigoMaterial}.` },
                mensaje: 'Revisa los campos marcados.'
            });
        }
        if (e.name === 'SequelizeValidationError') {
            const errs = Object.fromEntries(e.errors.map(x => [x.path, x.message]));
            return res.status(400).json({ success: false, errores: errs, mensaje: 'Revisa los campos marcados.' });
        }
        console.error('[insumos] editar:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar el material. Intenta de nuevo.' });
    }

    if (nombreImagenNueva && imagenAnterior) await borrarObjetos([`${CARPETA_IMAGENES_INSUMOS}/${imagenAnterior}`]);

    return res.json({ success: true, mensaje: 'Material actualizado.', material: presentarMaterial(material) });
};

// POST /admin/insumos/:idMaterial/estado — suspende o reactiva un material. Nunca se borra
// (CLAUDE.md §6, mismo criterio que Empleados.estado): "eliminar" acá es dejar
// MATERIAL.activo en false, no un DELETE. Mismos tres candados que editarInsumo.
//
// Update condicional con el estado actual en el WHERE (CLAUDE.md §9) en vez de un
// findByPk + save: si dos pestañas mandan el mismo cambio a la vez, la segunda no encuentra
// fila que actualizar y responde 409 en lugar de pisar silenciosamente a la primera.
const cambiarEstadoInsumo = async (req, res) => {
    const activo = Boolean(req.body?.activo);
    try {
        const [filas] = await Material.update(
            { activo },
            { where: { idMaterial: req.params.idMaterial, activo: !activo } }
        );
        if (!filas) {
            const existe = await Material.count({ where: { idMaterial: req.params.idMaterial } });
            if (!existe) return res.status(404).json({ success: false, mensaje: 'El material ya no existe.' });
            return res.status(409).json({ success: false, mensaje: `El material ya estaba ${activo ? 'activo' : 'suspendido'}.` });
        }
        return res.json({ success: true, mensaje: activo ? 'Material reactivado.' : 'Material suspendido.', activo });
    } catch (e) {
        console.error('[insumos] cambiar estado:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cambiar el estado. Intenta de nuevo.' });
    }
};

export {
    homeConfeccionistas, homeProcesosNuevo, homeProcesosListado, homeFichasConfeccion, homeInsumos,
    crearInsumo, verInsumo, editarInsumo, cambiarEstadoInsumo, codigoInsumoOcupado
};
