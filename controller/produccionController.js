import { UniqueConstraintError, Op } from 'sequelize';
import { Upload } from '@aws-sdk/lib-storage';
import s3Client from '../config/r2.js';
import { Material, FichaConfeccion, Familia, Categorias, Provedores, CategoriasDeProvedores, Atributos } from '../models/index.js';
import db from '../config/bd.js';
import { TALLAS_CORTE, PIEZAS_CORTE_SUGERIDAS } from '../helpers/catalogos.js';
import { tieneInventario, existenciasDeMateriales, inventarioDelMaterial, registrarEntrada, registrarSalidaAjuste, actorDelPanel } from '../helpers/inventarioInsumos.js';
import { UNIDADES_CONSUMO, UNIDAD_CONSUMO_CORTA, cantidadValida } from '../helpers/unidadesInsumo.js';
import { TIPOS_INSUMO, UNIDADES_COMPRA, LIMITES_INSUMO, CARPETA_IMAGENES_INSUMOS, presentarMaterial, proveedoresDelInsumo, resumenComprasInsumo, validarInsumo, codigoDxfValido, datosFicticiosInsumo, historialComprasInsumo } from '../helpers/insumos.js';
import { imagenAWebpSegura } from '../helpers/imagenSegura.js';
import { borrarObjetos, urlDocumento } from '../helpers/almacenamientoDocumentos.js';
import { listarConfeccionistas, resumenConfeccionistas, keyFotoConfeccionista, ETAPAS_EN_CURSO } from '../helpers/confeccionistas.js';
import { coloresSimplesDisponibles } from '../helpers/ordenesCompra.js';
import { INCLUDES_IMAGEN_FICHA, INCLUDE_CREADOR_FICHA, keyImagenFicha, detalleBibliotecaFichas, presentarFichaBiblioteca } from '../helpers/bibliotecaFichas.js';

// Caja de recorte de la foto de un material: igual a la de una foto de producto
// (FOTO_PRODUCTO en adminControllers.js) — cuadrada, sin recortar ('inside'), porque acá
// también importa ver la pieza completa, no solo un recorte centrado.
const FOTO_INSUMO = { ancho: 1000, alto: 1000, ajuste: 'inside' };

// Base de los módulos de Producción que todavía no tienen pantalla propia: hoy son la misma pantalla
// vacía, lista para que cada módulo agregue su propio listado más adelante sin repetir el
// render. Cuando uno de ellos gane su propia lógica, se le saca su función de acá y se deja
// de pasar por `paginaBase`. Insumos ya tiene la suya (homeInsumos, abajo).
const paginaBase = ({ folder, titulo, subtitulo, icono }) => (req, res) => {
    try {
        return res.render('./administrador/produccion/base', {
            pagina: titulo,
            subPagina: titulo,
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

// GET /admin/confeccionistas — los talleres (proveedores de categoría Confeccionista) con
// lo que tienen encima ahora. Todo sale de helpers/confeccionistas.js; la lista se trae
// completa (son decenas, no miles) y se filtra en el navegador, como el catálogo de insumos.
const homeConfeccionistas = async (req, res) => {
    try {
        const confeccionistas = await listarConfeccionistas();
        const ciudades = [...new Map(confeccionistas.filter(c => c.ciudad).map(c => [c.idCiudad, c.ciudad])).entries()]
            .map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        return res.render('./administrador/produccion/confeccionistas', {
            pagina: 'Confeccionistas',
            subPagina: 'Confeccionistas',
            currentPath: '/confeccionistas',
            subtitulo: 'Talleres que confeccionan para Grupo GH y lo que tiene cada uno en la mesa',
            confeccionistas,
            resumen: resumenConfeccionistas(confeccionistas),
            ciudades,
            etapas: ETAPAS_EN_CURSO
        });
    } catch (e) {
        console.error('produccionController(confeccionistas):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// GET /admin/confeccionistas/fotos/:idDocumento — una foto del lugar de trabajo, firmada en
// el momento (bucket privado, CLAUDE.md §5.7). Solo fotos de un taller: ver keyFotoConfeccionista.
const fotoConfeccionista = async (req, res) => {
    try {
        const key = await keyFotoConfeccionista(req.params.idDocumento);
        if (!key) return res.status(404).send('Foto no encontrada.');
        res.set('Cache-Control', 'no-store');
        return res.redirect(302, await urlDocumento(key));
    } catch (e) {
        console.error('produccionController(fotoConfeccionista):', e);
        return res.status(500).send('No se pudo abrir la foto.');
    }
};

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

// GET /admin/procesos/cortes/nuevo — orden de corte + guía para el cortador (submenú
// Procesos → Corte). La guía se arma en el navegador (src/js/corteNuevo.js +
// src/js/corteCalculos.js); acá solo se cargan los catálogos de los selects. Todavía no se
// guarda nada: la persistencia y "Lista de cortes" esperan el esquema aprobado.
const CATEGORIA_PROVEEDOR_TELAS = 'Textiles y Telas';

const homeCorteNuevo = async (req, res) => {
    try {
        // Cuatro consultas fijas en paralelo, ninguna dentro de un loop (CLAUDE.md §7).
        const [telas, proveedores, familias, categorias] = await Promise.all([
            Material.findAll({
                where: { tipo: 'materia_prima', activo: true },
                attributes: ['idMaterial', 'nombre'],
                order: [['nombre', 'ASC']]
            }),
            Provedores.findAll({
                where: { estado: true },
                attributes: ['idProveedor', 'razonSocial'],
                include: [{
                    model: CategoriasDeProvedores, as: 'categorias',
                    where: { nombre: CATEGORIA_PROVEEDOR_TELAS },
                    attributes: [], through: { attributes: [] }
                }],
                order: [['razonSocial', 'ASC']]
            }),
            Familia.findAll({ attributes: ['idFamilia', 'nombreFamilia'], order: [['nombreFamilia', 'ASC']] }),
            Categorias.findAll({ attributes: ['idCategoria', 'nombreCategoria', 'tipo', 'idPadre'], order: [['nombreCategoria', 'ASC']] })
        ]);

        // Tipos de prenda = subcategorías (Body, Blusa, Top…), agrupadas bajo su categoría
        // padre (Superior, Inferior…). El nombre del padre se resuelve en memoria con la
        // misma consulta: no hay asociación padre/hijo declarada en Categorias.
        const nombrePadre = new Map(categorias.map(c => [c.idCategoria, c.nombreCategoria]));
        const tiposPrenda = categorias
            .filter(c => c.tipo === 'SUBCATEGORIA')
            .map(c => ({ id: c.idCategoria, nombre: c.nombreCategoria, grupo: nombrePadre.get(c.idPadre) || 'Otras' }));

        return res.render('./administrador/produccion/corteNuevo', {
            pagina: 'Nuevo corte',
            subPagina: 'Nuevo corte',
            currentPath: '/procesos',
            catalogosCorte: {
                telas: telas.map(t => ({ id: t.idMaterial, nombre: t.nombre })),
                proveedores: proveedores.map(p => ({ id: p.idProveedor, nombre: p.razonSocial })),
                familias: familias.map(f => ({ id: f.idFamilia, nombre: f.nombreFamilia })),
                tiposPrenda,
                tallas: TALLAS_CORTE,
                piezasSugeridas: PIEZAS_CORTE_SUGERIDAS
            }
        });
    } catch (e) {
        console.error('produccionController(corteNuevo):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// `homeProcesosListado` ya tiene su propia lógica — ganó un listado real de seguimiento por
// taller apenas una ficha tiene confeccionistas asignados, así que salió de `paginaBase`
// (ver el comentario de arriba) para controller/fichaConfeccionProcesoController.js.

// Fichas de confección ya tiene su propia pantalla (dos caminos: crear una o consultar la
// biblioteca) — salió de `paginaBase` por eso, igual que Insumos ya había salido antes.
// `currentPath` se mantiene en '/procesos' en las tres pantallas (acá, la nueva y la
// biblioteca) para que el folder del menú lateral siga marcado activo aunque la URL real
// sea otra — mismo criterio que homeOrdenCompra/homeHistorialCompras con '/insumos'.
const homeFichasConfeccion = (req, res) => {
    try {
        return res.render('./administrador/produccion/fichasConfeccion', {
            pagina: 'Fichas de confección',
            subPagina: 'Fichas de confección',
            currentPath: '/procesos'
        });
    } catch (e) {
        console.error('produccionController(fichasConfeccion):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// GET /admin/procesos/fichas-confeccion/nueva — asistente paso a paso, inspirado en la
// transición de /formularios/registroClientes (grupoghweb, src/components/registro/
// Piezas.tsx useTransicionPasos): lo que sale se desliza y encoge, lo que entra llega con
// un leve rebote y un destello marca el avance — portado a CSS/JS plano acá (sin React) y
// con los tokens gh-* en vez del rosa del sitio público (public/css/input.css,
// src/js/fichaConfeccionNueva.js). `colores` es el catálogo de ATRIBUTOS tipo='COLOR' PARA
// LA TABLA DE COLORES de la ficha, nunca con combinados — una ficha de confección corta UNA
// tela de UN color, "Blanco + Negro" no es nada que un operario pueda elegir acá (mismo
// filtro y mismo motivo que ya usa una orden de compra: helpers/ordenesCompra.js
// coloresSimplesDisponibles, CLAUDE.md DRY).
const homeFichaConfeccionNueva = async (req, res) => {
    try {
        const colores = await coloresSimplesDisponibles();
        // Familias existentes para el datalist de "Crear familia" del paso 1 — mismo
        // criterio que el datalist de familia del alta de producto (adminControllers.js
        // dashboardInventorys): escribir el nombre exacto de una que ya existe es lo que
        // hace que crearFamiliaDxf la asocie en vez de crear una nueva (CLAUDE.md DRY).
        const familias = await Familia.findAll({ attributes: ['idFamilia', 'nombreFamilia'], order: [['nombreFamilia', 'ASC']] });
        // Insumos para el picker opcional del paso 3 (botones, cierres, elástico…) — solo
        // los activos, igual criterio que materialesDisponibles() de una orden de compra
        // (helpers/ordenesCompra.js). `presentarMaterial` (ya usado en homeInsumos) es lo
        // que le agrega `imagenUrl`: la foto es importante acá, a diferencia de una línea
        // de orden de compra, para que el operario reconozca el insumo de un vistazo.
        const insumos = (await Material.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] })).map(presentarMaterial);
        return res.render('./administrador/produccion/fichaConfeccionNueva', {
            pagina: 'Fichas de confección',
            subPagina: 'Nueva ficha de confección',
            currentPath: '/procesos',
            colores,
            familias,
            insumos
        });
    } catch (e) {
        console.error('produccionController(fichaConfeccionNueva):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// GET /admin/procesos/fichas-confeccion/biblioteca — la página es solo el molde (filtros +
// tabla vacía); el listado en sí lo trae filterFichaConfeccionListJson por fetch, igual
// patrón que el listado de inventario (src/js/productList.js + controller/
// adminControllers.js filterProductListJson, CLAUDE.md DRY).
const homeFichaConfeccionBiblioteca = async (req, res) => {
    try {
        const [familias, telas] = await Promise.all([
            Familia.findAll({ attributes: ['idFamilia', 'nombreFamilia'], order: [['nombreFamilia', 'ASC']] }),
            Material.findAll({ where: { tipo: 'materia_prima' }, attributes: ['idMaterial', 'nombre'], order: [['nombre', 'ASC']] })
        ]);
        return res.render('./administrador/produccion/fichaConfeccionBiblioteca', {
            pagina: 'Fichas de confección',
            subPagina: 'Biblioteca de fichas de confección',
            currentPath: '/procesos',
            familias,
            telas
        });
    } catch (e) {
        console.error('produccionController(fichaConfeccionBiblioteca):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// Condiciones del listado de la Biblioteca — las usa solo filterFichaConfeccionListJson
// hoy, pero en un único lugar por si mañana hace falta compartirlas con una exportación
// (mismo criterio que condicionesListadoProductos, adminControllers.js). `referencia` y
// `materialNombre` son las fotos congeladas de familia/tela en la propia fila (CLAUDE.md
// §7) — filtrar contra ellas directo evita el join a FICHAS_CONFECCION_DXF que, si la ficha
// tiene dos telas, ni siquiera identificaría una sola fila de forma simple.
const condicionesListadoFichas = ({ busqueda, familia, tela } = {}) => {
    const y = [];

    // Búsqueda libre: referencia O tela, igual criterio que nombreProducto/sku/ean del
    // inventario (un solo cuadro de texto, varias columnas).
    const texto = String(busqueda || '').trim();
    if (texto) {
        const term = `%${texto}%`;
        y.push({ [Op.or]: [{ referencia: { [Op.like]: term } }, { materialNombre: { [Op.like]: term } }] });
    }

    // Familia: coincidencia EXACTA — `referencia` es siempre el nombre completo de UNA
    // familia (nunca una lista), a diferencia de `materialNombre`.
    const familiaNombre = String(familia || '').trim();
    if (familiaNombre) y.push({ referencia: familiaNombre });

    // Tela: LIKE, no exacto — `materialNombre` puede ser "Mayatext, Polilicra" cuando el
    // DXF traía más de un material (helpers/dxf.js), y elegir "Mayatext" en el filtro debe
    // encontrar esa fila igual que una de tela única.
    const telaNombre = String(tela || '').trim();
    if (telaNombre) y.push({ materialNombre: { [Op.like]: `%${telaNombre}%` } });

    return { estado: 'activa', ...(y.length ? { [Op.and]: y } : {}) };
};

// GET /admin/json/fichas-confeccion — mismo contrato que /admin/json/productos/: página +
// filtros por querystring, `findAndCountAll` con LIMIT/OFFSET y un desempate por id en el
// ORDER BY para que el orden sea total (CLAUDE.md §8 — createdAt solo no alcanza si dos
// fichas se guardan en el mismo segundo).
const filterFichaConfeccionListJson = async (req, res) => {
    try {
        const { pagina = 1 } = req.query;
        const numPagina = parseInt(pagina) || 1;
        const limite = parseInt(process.env.LIMIT_PER_PAGE) || 10;
        const offset = (numPagina - 1) * limite;

        // Los includes son belongsTo (uno por ficha): no multiplican filas ni el conteo.
        const { count, rows } = await FichaConfeccion.findAndCountAll({
            where: condicionesListadoFichas(req.query),
            attributes: ['idFicha', 'referencia', 'materialNombre', 'cantidadTotal', 'precioConfeccion', 'createdAt'],
            include: [INCLUDE_CREADOR_FICHA, ...INCLUDES_IMAGEN_FICHA],
            order: [['createdAt', 'DESC'], ['idFicha', 'ASC']],
            limit: limite,
            offset
        });
        // Colores y talleres de toda la página en dos consultas (CLAUDE.md §7).
        const detalle = await detalleBibliotecaFichas(rows.map(f => f.idFicha));

        return res.json({
            success: true,
            fichas: rows.map(f => presentarFichaBiblioteca(f, detalle)),
            totalPaginas: Math.ceil(count / limite),
            paginaActual: numPagina,
            totalRegistros: count
        });
    } catch (e) {
        console.error('produccionController(filterFichaConfeccionListJson):', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo consultar la biblioteca.' });
    }
};

// GET /admin/procesos/fichas-confeccion/:idFicha/imagen — miniatura de la prenda en la
// Biblioteca. Las imágenes viven en el bucket privado: se firma en el momento y se
// redirige, como las fotos de los confeccionistas; la ruta del objeto nunca llega a la vista.
const imagenFichaConfeccion = async (req, res) => {
    try {
        const ficha = await FichaConfeccion.findByPk(req.params.idFicha, {
            attributes: ['idFicha'],
            include: INCLUDES_IMAGEN_FICHA
        });
        const key = ficha ? keyImagenFicha(ficha) : null;
        if (!key) return res.status(404).send('Imagen no encontrada.');
        res.set('Cache-Control', 'no-store');
        return res.redirect(302, await urlDocumento(key));
    } catch (e) {
        console.error('produccionController(imagenFichaConfeccion):', e);
        return res.status(500).send('No se pudo abrir la imagen.');
    }
};

// GET /admin/insumos — listado del catálogo (columna izquierda) y formulario de alta (derecha).
// El catálogo es chico (un registro por material del DXF), así que se trae completo y ordenado
// por el código, que es único: el orden es total.
const homeInsumos = async (req, res) => {
    try {
        const materiales = await Material.findAll({ order: [['codigoMaterial', 'ASC']] });
        // Disponible real de todo el catálogo en una sola consulta (CLAUDE.md §7).
        const existencias = await existenciasDeMateriales(materiales.map(m => m.idMaterial));
        // Mapa base→nombre para resolver el padre de cada variante sin query adicional.
        const nombrePorCodigo = new Map(materiales.map(m => [m.codigoMaterial, m.nombre]));
        return res.render('./administrador/produccion/insumos', {
            pagina:    'Insumos',
            subPagina: 'Insumos',
            currentPath: '/insumos',
            titulo:    'Insumos',
            subtitulo: 'Materias primas e insumos del catálogo de producción',
            icono:     'fi-rr-boxes',
            materiales: materiales.map(m => {
                const padre = m.codigoMaterial.includes('.')
                    ? (nombrePorCodigo.get(m.codigoMaterial.split('.')[0]) ?? null)
                    : null;
                const e = existencias.get(m.idMaterial);
                const fmt = (v) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: 4 });
                const enTalleres = e ? Number(e.reservada) + Number(e.enProceso) : 0;   // solo para mostrar
                return {
                    ...presentarMaterial(m, padre),
                    existencia: fmt(e?.disponible ?? 0),
                    unidadConsumoCorta: UNIDAD_CONSUMO_CORTA[m.unidadConsumo] || '',
                    sinExistencia: !(Number(e?.disponible ?? 0) > 0),
                    enTalleres: enTalleres > 0 ? fmt(enTalleres) : null
                };
            }),
            tiposInsumo: TIPOS_INSUMO,
            unidadesCompra: UNIDADES_COMPRA,
            unidadesConsumo: UNIDADES_CONSUMO,
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
// GET /admin/insumos/grupos — lista de materiales "cabeza de grupo" (código simple, sin punto).
// Se usa para poblar el selector "Material base" del formulario de alta/edición en variante mode.
const gruposInsumo = async (req, res) => {
    try {
        const grupos = await Material.findAll({
            where: { codigoMaterial: { [Op.notLike]: '%.%' }, activo: true },
            attributes: ['idMaterial', 'codigoMaterial', 'nombre'],
            order: [['codigoMaterial', 'ASC']],
            raw: true
        });
        return res.json({ success: true, grupos });
    } catch (e) {
        console.error('[insumos] grupos:', e);
        return res.status(500).json({ success: false, grupos: [] });
    }
};

// `?excluir=idMaterial` lo manda el formulario de edición: el propio material no cuenta como
// "ocupado" si la persona no tocó el código. Gateado por READ (no CREATE/EDIT): el catálogo
// ya muestra todos los códigos a cualquiera con lectura, así que esta consulta no revela nada
// que esa pantalla no revele ya.
const codigoInsumoOcupado = async (req, res) => {
    const codigo = codigoDxfValido(req.params.codigo);
    if (codigo === null) {
        return res.status(400).json({ success: false, mensaje: 'El código debe ser un número (ej: 1) o un código compuesto (ej: 1.23).' });
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
        // Historial, proveedores y resumen de compras son reales; lo demás de `datos` es relleno
        // (descripción, composición, procesos, tiempo de entrega, dato útil).
        const [historialCompras, proveedores] = await Promise.all([
            historialComprasInsumo(material.idMaterial),
            proveedoresDelInsumo(material.idMaterial)
        ]);
        const datos = { ...datosFicticiosInsumo(fila), historialCompras, proveedores, ...resumenComprasInsumo(proveedores) };
        // Inventario REAL (helpers/inventarioInsumos.js): existencias, costo ponderado, capas
        // vivas y movimientos. Reemplaza los indicadores de relleno.
        const inventario = await inventarioDelMaterial(material, UNIDAD_CONSUMO_CORTA[material.unidadConsumo] || '');
        return res.render('./administrador/produccion/insumoPerfil', {
            pagina:    'Insumos',
            subPagina: fila.nombre,
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
            inventario,
            tieneInventario: inventario.tiene,
            // Para el modal "Editar insumo" — mismas listas que ya usa el alta (homeInsumos),
            // así el formulario de edición no vuelve a escribirlas.
            tiposInsumo: TIPOS_INSUMO,
            unidadesCompra: UNIDADES_COMPRA,
            unidadesConsumo: UNIDADES_CONSUMO,
            limites: LIMITES_INSUMO
        });
    } catch (e) {
        console.error('produccionController(insumo perfil):', e);
        return res.status(500).send('No se pudo cargar la página.');
    }
};

// POST /admin/insumos/:idMaterial/ajuste — ajuste de inventario por conteo físico: lo que
// hay en bodega no coincide con el sistema (pérdida, daño, error de carga, o insumo que ya
// estaba antes de usar el sistema). Mismos tres candados que editar el insumo (ruta): EDIT de
// la sesión, código de empleado y el permiso de ESE empleado. Motivo obligatorio: queda en el
// libro de movimientos, que es append-only.
//   entrada → capa nueva con el costo que se indique (origen 'ajuste').
//   salida  → sale de lo disponible, de la capa más vieja a la más nueva (FIFO).
const ajustarExistenciaInsumo = async (req, res) => {
    const material = await Material.findByPk(req.params.idMaterial);
    if (!material) return res.status(404).json({ success: false, mensaje: 'El material ya no existe.' });

    const b = req.body || {};
    const errores = {};
    const tipo = b.tipo === 'entrada' || b.tipo === 'salida' ? b.tipo : null;
    if (!tipo) errores.tipo = 'Elige si entra o sale.';
    const cantidad = cantidadValida(b.cantidad);
    if (!cantidad) errores.cantidad = 'Escribe una cantidad mayor a 0.';
    const costoUnitario = tipo === 'entrada' ? cantidadValida(b.costoUnitario) : null;
    if (tipo === 'entrada' && !costoUnitario) errores.costoUnitario = 'Escribe el costo por unidad (mayor a 0).';
    const motivo = String(b.motivo ?? '').trim();
    if (motivo.length < 5 || motivo.length > 300) errores.motivo = 'Explica el motivo (entre 5 y 300 caracteres).';

    // '' = sin color; un número = ese color, que tiene que ser un color simple del catálogo.
    let idAtributoColor = null;
    const colorTxt = String(b.idAtributoColor ?? '').trim();
    if (colorTxt) {
        const color = await Atributos.findOne({ where: { idAtributo: colorTxt, tipo: 'COLOR' } });
        if (!color) errores.idAtributoColor = 'Ese color no existe.';
        else idAtributoColor = color.idAtributo;
    }
    if (Object.keys(errores).length) return res.status(400).json({ success: false, errores, mensaje: Object.values(errores)[0] });

    const actor = actorDelPanel(req);
    try {
        await db.transaction((transaction) => tipo === 'entrada'
            ? registrarEntrada({ idMaterial: material.idMaterial, idAtributoColor, cantidad, costoUnitario, origen: 'ajuste', motivo, actor, transaction })
            : registrarSalidaAjuste({ idMaterial: material.idMaterial, idAtributoColor, cantidad, motivo, actor, transaction }));
        return res.json({ success: true, mensaje: tipo === 'entrada' ? 'Entrada registrada.' : 'Salida registrada.' });
    } catch (e) {
        if (e.publico) return res.status(e.status || 400).json({ success: false, mensaje: e.message });
        console.error('[insumos] ajuste de existencia:', e);
        return res.status(500).json({ success: false, mensaje: 'No se pudo registrar el ajuste. Intenta de nuevo.' });
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
    // Con inventario, cambiar la unidad de consumo dejaría las cantidades guardadas en otra
    // unidad (18.400 cm leídos como 18.400 g).
    if (datos.unidadConsumo !== material.unidadConsumo && await tieneInventario(material.idMaterial)) {
        const mensaje = 'Este material ya tiene inventario: su unidad de consumo no se puede cambiar.';
        return res.status(409).json({ success: false, errores: { unidadConsumo: mensaje }, mensaje });
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
    homeConfeccionistas, fotoConfeccionista, imagenFichaConfeccion, homeProcesosNuevo, homeCorteNuevo, homeFichasConfeccion,
    homeFichaConfeccionNueva, homeFichaConfeccionBiblioteca, filterFichaConfeccionListJson, homeInsumos,
    crearInsumo, verInsumo, editarInsumo, cambiarEstadoInsumo, codigoInsumoOcupado, gruposInsumo, ajustarExistenciaInsumo
};
