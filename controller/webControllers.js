import Categorias from '../models/Categorias.js';

const homePage = async (req, res) => {
    return res.render('./web/index', { pagina: 'Grupo GH' });
};

const productoDetalle = async (req, res) => {
    return res.render('./web/producto', { pagina: 'Producto', slug: req.params.slug });
};

const listadoProductos = async (req, res) => {
    return res.render('./web/colecciones', { pagina: 'Colecciones' });
};

const catalogoCategoria = async (req, res) => {
    const id = parseInt(req.params.idCategoria);
    if (isNaN(id)) return res.status(404).render('./web/index', { pagina: '404' });
    const categoria = await Categorias.findOne({
        where: { idCategoria: id, webActiva: true, tipo: 'CATEGORIA' }
    });
    if (!categoria) return res.status(404).render('./web/index', { pagina: '404' });
    return res.render('./web/catalogo', {
        pagina: categoria.nombreCategoria,
        categoria: categoria.toJSON()
    });
};

export { homePage, productoDetalle, listadoProductos, catalogoCategoria };
