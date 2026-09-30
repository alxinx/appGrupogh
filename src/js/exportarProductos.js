import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';

// Ventana "Exportar productos" del listado de inventario (admin/inventario/listado).
//
// Dos decisiones y un botón: QUÉ productos (los filtrados en pantalla o todo el catálogo,
// cada uno con su cifra) y QUÉ columnas (interruptores). La cifra grande de la cabecera es
// la del alcance elegido y el botón la repite: "Exportar 128 productos". El archivo lo arma
// el servidor en streaming (exportarProductos en adminControllers.js), con el mismo filtro
// del listado, así que "los filtrados" son exactamente las filas que se ven.
//
// La lista de campos llega de la vista (CAMPOS_EXPORTAR_PRODUCTOS del controlador): una sola
// definición para la ventana y para el archivo.

const CLAVE_CAMPOS = 'gh-exportar-productos-campos';   // la última elección, por navegador

const numero = (n) => Number(n || 0).toLocaleString('es-CO');
const productos = (n) => (n === 1 ? '1 producto' : `${numero(n)} productos`);

async function contar(filtros) {
    try {
        const r = await fetch(`/admin/json/productos/?${new URLSearchParams({ ...filtros, pagina: 1 })}`);
        const d = await r.json();
        return d.success ? d.totalRegistros : null;
    } catch { return null; }
}

function camposGuardados() {
    try { return JSON.parse(localStorage.getItem(CLAVE_CAMPOS) || 'null'); } catch { return null; }
}
function guardarCampos(claves) {
    try { localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(claves)); } catch { /* sin almacenamiento: no pasa nada */ }
}

/**
 * @param filtros          los del listado ({ busqueda, categoria, familia, estado, web })
 * @param resumenFiltros   los filtros activos dichos en palabras, para la tarjeta "Los filtrados"
 * @param campos           CAMPOS_EXPORTAR_PRODUCTOS
 */
export async function abrirExportarProductos({ filtros, resumenFiltros, campos }) {
    const [nFiltrados, nTodos] = await Promise.all([contar(filtros), contar({})]);
    const guardados = camposGuardados();
    const prendido = (c) => (Array.isArray(guardados) ? guardados.includes(c.clave) : c.porDefecto);

    const tarjeta = (valor, titulo, cifra, sub, marcada) => `
        <label class="gh-conf-opcion">
            <input type="radio" name="exp-alcance" value="${valor}" ${marcada ? 'checked' : ''}>
            <span class="gh-conf-opcion-titulo">${titulo}</span>
            <span class="gh-conf-opcion-cifra">${cifra === null ? '—' : numero(cifra)}</span>
            <span class="gh-conf-opcion-sub">${esc(sub)}</span>
        </label>`;

    let grupoActual = '';
    const interruptores = campos.map(c => {
        const rotulo = c.grupo !== grupoActual ? `<p class="gh-conf-grupo">${esc(c.grupo)}</p>` : '';
        grupoActual = c.grupo;
        return `${rotulo}
            <label class="gh-conf-switch">
                <span class="gh-conf-switch-texto">
                    <span class="gh-conf-switch-titulo">${esc(c.etiqueta)}</span>
                    ${c.detalle ? `<span class="gh-conf-switch-detalle">${esc(c.detalle)}</span>` : ''}
                </span>
                <input type="checkbox" name="exp-campo" value="${esc(c.clave)}" ${prendido(c) ? 'checked' : ''}>
                <span class="gh-conf-switch-pista" aria-hidden="true"></span>
            </label>`;
    }).join('');

    const html = `<div class="gh-conf-html">
        ${cabeceraConfirmacion({
            icono: 'fi-rr-file-excel',
            badge: 'Exportar a Excel',
            monto: productos(nFiltrados ?? 0),
            idMonto: 'exp-cifra',
            contexto: 'Un archivo .xlsx con una fila por producto.'
        })}
        <p class="gh-conf-seccion">Qué productos</p>
        <div class="gh-conf-opciones" role="radiogroup" aria-label="Qué productos exportar">
            ${tarjeta('filtrados', 'Los filtrados', nFiltrados, resumenFiltros || 'Los que ves en el listado', true)}
            ${tarjeta('todos', 'Todos los productos', nTodos, 'Todo el catálogo, sin filtros', false)}
        </div>
        <p class="gh-conf-seccion">Qué columnas <span id="exp-columnas"></span></p>
        <div class="gh-conf-interruptores">
            <div class="gh-conf-switch gh-conf-switch--fijo">
                <span class="gh-conf-switch-texto">
                    <span class="gh-conf-switch-titulo">SKU y nombre</span>
                    <span class="gh-conf-switch-detalle">Sin ellos una fila no dice de qué producto es</span>
                </span>
                <span class="gh-conf-fijo"><i class="fi fi-rr-lock"></i> Siempre</span>
            </div>
            ${interruptores}
        </div>
    </div>`;

    const popup = () => Swal.getPopup();
    const alcance = () => popup().querySelector('input[name="exp-alcance"]:checked')?.value || 'filtrados';
    const elegidos = () => [...popup().querySelectorAll('input[name="exp-campo"]:checked')].map(i => i.value);
    const cantidad = () => (alcance() === 'todos' ? nTodos : nFiltrados) ?? 0;

    // Cabecera, botón y conteo de columnas siguen a lo elegido.
    const refrescar = () => {
        const n = cantidad();
        popup().querySelector('#exp-cifra').textContent = productos(n);
        const boton = Swal.getConfirmButton();
        boton.textContent = n ? `Exportar ${productos(n)}` : 'No hay productos para exportar';
        boton.disabled = !n;
        popup().querySelector('#exp-columnas').textContent = `${elegidos().length} de ${campos.length} campos`;
    };

    await Swal.fire(opcionesConfirmacion({
        variante: 'neutro',
        html,
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Exportar',
        didOpen: () => {
            popup().addEventListener('change', refrescar);
            refrescar();
        },
        preConfirm: async () => {
            const boton = Swal.getConfirmButton();
            boton.disabled = true;
            boton.textContent = 'Preparando archivo…';
            guardarCampos(elegidos());
            const todos = alcance() === 'todos';
            const params = new URLSearchParams({ ...(todos ? {} : filtros), alcance: alcance(), campos: elegidos().join(',') });
            try {
                const r = await fetch(`/admin/inventario/exportar?${params}`);
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensaje || 'No se pudo generar el archivo.');
                const blob = await r.blob();
                const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || 'productos.xlsx';
                const enlace = document.createElement('a');
                enlace.href = URL.createObjectURL(blob);
                enlace.download = nombre;
                enlace.click();
                setTimeout(() => URL.revokeObjectURL(enlace.href), 5000);
                return nombre;
            } catch (e) {
                refrescar();
                Swal.showValidationMessage(e.message || 'No se pudo generar el archivo. Inténtalo de nuevo.');
                return false;
            }
        }
    })).then(({ isConfirmed, value }) => {
        if (!isConfirmed) return;
        Swal.fire({ toast: true, position: 'bottom-end', icon: 'success', title: `Descargado: ${value}`, showConfirmButton: false, timer: 2600 });
    });
}
