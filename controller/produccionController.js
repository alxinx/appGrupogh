import { UniqueConstraintError } from 'sequelize';
import { Material } from '../models/index.js';
import { TIPOS_INSUMO, UNIDADES_COMPRA, LIMITES_INSUMO, presentarMaterial, validarInsumo, codigoDxfValido } from '../helpers/insumos.js';

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

const homeProcesos = paginaBase({
    folder:    '/procesos',
    titulo:    'Procesos',
    subtitulo: 'Etapas de producción: corte, confección, lavandería, estampado y empaque',
    icono:     'fi-rr-interchange'
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
const crearInsumo = async (req, res) => {
    const { errores, datos } = validarInsumo(req.body);
    if (errores) {
        return res.status(400).json({ success: false, errores, mensaje: 'Revisa los campos marcados.' });
    }
    try {
        const material = await Material.create(datos);
        return res.json({ success: true, mensaje: 'Material guardado.', material: presentarMaterial(material) });
    } catch (e) {
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
// garantía: el alta vuelve a rechazar el duplicado con el UNIQUE (409) por si dos personas
// guardan el mismo código a la vez.
const codigoInsumoOcupado = async (req, res) => {
    const codigo = codigoDxfValido(req.params.codigo);
    if (codigo === null) {
        return res.status(400).json({ success: false, mensaje: 'El código debe ser un número entero entre 1 y 2147483647.' });
    }
    try {
        const existentes = await Material.count({ where: { codigoMaterial: codigo } });
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
        return res.render('./administrador/produccion/insumoPerfil', {
            pagina:    'Insumos',
            subPagina: fila.nombre,
            csrfToken: req.csrfToken(),
            currentPath: '/insumos',
            titulo:    fila.nombre,
            subtitulo: fila.tipoEtiqueta,
            icono:     'fi-rr-boxes',
            material:  fila,
            creado:    new Date(material.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' })
        });
    } catch (e) {
        console.error('produccionController(insumo perfil):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

export { homeConfeccionistas, homeProcesos, homeInsumos, crearInsumo, verInsumo, codigoInsumoOcupado };
