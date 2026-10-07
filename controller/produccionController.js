// Base de los módulos de Producción (Confeccionistas, Procesos, Insumos): hoy las tres son
// la misma pantalla vacía, lista para que cada módulo agregue su propio listado más
// adelante sin repetir el render. Cuando uno de ellos gane su propia lógica, se le saca su
// función de acá y se deja de pasar por `paginaBase`.
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

const homeInsumos = paginaBase({
    folder:    '/insumos',
    titulo:    'Insumos',
    subtitulo: 'Materias primas: telas, hilos y avíos',
    icono:     'fi-rr-boxes'
});

export { homeConfeccionistas, homeProcesos, homeInsumos };
