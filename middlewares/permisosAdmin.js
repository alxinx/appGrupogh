import { Op } from 'sequelize';
import { UserPermisos, PermisosRecursos, PermisosAcciones } from '../models/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Permisos del panel de administrador.
//
// Hasta acá `/admin` estaba protegido solo por `verificarRol('ADMIN')`: quien entraba,
// entraba a todo. Los permisos finos existían en USER_PERMISOS y se podían asignar desde
// la ficha del empleado, pero ninguna ruta los leía — a un usuario se le daba "solo
// productos" y podía mover plata entre bancos igual.
//
// Es la misma mecánica que ya usa el panel de tienda (`storeMiddleware`), sobre los
// recursos de tipo 'administrativo' en vez de 'vendedor'.
//
// Solo gobierna PÁGINAS. Las rutas de API y las acciones que escriben se protegen una por
// una con `verificarPermisoSesion`, porque ahí no alcanza con "puede entrar a la carpeta":
// importa si puede crear, editar o borrar.
// ─────────────────────────────────────────────────────────────────────────────

// Peticiones que no son pantallas: JSON, API, el canal SSE y los archivos que se descargan.
// Se dejan pasar acá y las cuida el guard de cada ruta.
const NO_ES_PAGINA = /^\/(json|api|sse)(\/|$)/;

const esPagina = (req) => req.method === 'GET' && !NO_ES_PAGINA.test(req.path);

// `/inventario/ver/123` pertenece a la carpeta `/inventario`. La comparación exige que el
// siguiente carácter sea una barra: sin eso `/tiendas` habilitaría `/tiendasfalsas`.
const dentroDe = (ruta, carpeta) => ruta === carpeta || ruta.startsWith(carpeta + '/');

// A dónde mandar a alguien que tiene la carpeta pero pidió otra cosa. No alcanza con la
// carpeta a secas: `/admin/inventario` no existe como ruta —las que existen son
// `/inventario/listado` y `/inventario/ingreso`—, así que redirigir ahí daría un 404 y el
// usuario vería "no encontrado" cuando el problema era de permisos.
const PORTADA = {
    '/inventario':     '/inventario/listado',
    '/dosificaciones': '/dosificaciones/',
    '/bankentities':   '/bankentities/listado',
    '/web':            '/web/'
};
const portadaDe = (carpeta) => PORTADA[carpeta] || carpeta;

const permisosAdmin = async (req, res, next) => {
    res.locals.carpetasAdmin = [];
    res.locals.puedeAdmin    = () => false;

    try {
        const idUsuario = req.usuario?.idUsuario;
        if (!idUsuario) return next();

        const filas = await UserPermisos.findAll({
            where: { idUsuario },
            include: [
                { model: PermisosRecursos, as: 'recurso', where: { tipo: 'administrativo' }, attributes: ['nombreRecurso', 'folder'] },
                { model: PermisosAcciones, as: 'accion', attributes: ['nombreAccion'] }
            ],
            attributes: [],
            raw: true
        });

        // Mapa recurso → acciones. Lo usan las vistas para decidir si dibujan un botón:
        // ofrecer "Nuevo producto" a quien no puede crearlo es mandarlo a un 403.
        const porRecurso = {};
        for (const f of filas) {
            const r = f['recurso.nombreRecurso'];
            (porRecurso[r] = porRecurso[r] || new Set()).add(f['accion.nombreAccion']);
        }

        res.locals.carpetasAdmin = [...new Set(filas.map(f => f['recurso.folder']).filter(Boolean))];
        res.locals.puedeAdmin    = (recurso, accion = 'READ') => !!porRecurso[recurso]?.has(accion);
        req.permisosAdmin        = porRecurso;

        if (!esPagina(req)) return next();

        // El tablero es la portada del panel: lo ve cualquiera que tenga algo asignado. No
        // tiene recurso propio y negarlo dejaría a un usuario sin punto de entrada.
        if (req.path === '/' || req.path === '') return next();

        if (res.locals.carpetasAdmin.some(c => dentroDe(req.path, c))) return next();

        // Sin ninguna carpeta no hay panel que mostrar. No se le cierra la sesión —eso es
        // para el panel de tienda, donde no hay a dónde mandarlo— sino que se le dice qué
        // pasa, para que sepa a quién pedirle acceso.
        if (!res.locals.carpetasAdmin.length) {
            return res.status(403).render('./administrador/sinPermisos', {
                pagina: req.path, currentPath: '/', subPagina: 'Sin permisos',
                mensaje: 'Tu usuario no tiene ningún módulo asignado en el panel de administrador.'
            });
        }

        // Con carpetas pero no ésta: se lo lleva a la primera que sí puede ver, en vez de
        // dejarlo en un error sin salida.
        return res.redirect('/admin' + portadaDe(res.locals.carpetasAdmin[0]));
    } catch (e) {
        console.error('[permisosAdmin]', e.message);
        // Ante un fallo de lectura NO se abre el panel: se corta. Un error de base no
        // puede convertirse en acceso libre a bancos y nómina.
        return res.status(500).send('No se pudieron verificar los permisos.');
    }
};

export default permisosAdmin;
