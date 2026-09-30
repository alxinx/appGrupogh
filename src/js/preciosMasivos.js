import { opcionesConfirmacion, cabeceraConfirmacion, activarVerificacionCodigo } from './modalConfirmacion.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { escaparHtml as esc } from './escaparHtml.js';

// "Editar precios masivamente" (menú "Más" del listado de inventario).
//
// Una ventana de trabajo, no un SweetAlert: se escriben los precios nuevos, se elige A QUÉ
// (familias enteras o productos sueltos) y lo elegido pasa a la columna de la derecha, con
// su papelera. Quitar algo, cambiar de familias a productos o cerrar con cambios piden
// confirmación con SweetAlert, y por eso esta ventana vive en su propia capa, por debajo de
// la de SweetAlert (.gh-conf-capa): la confirmación aparece encima y el trabajo no se pierde.
//
// Al final, "Editar precios masivamente" abre el resumen con el código de empleado. El
// servidor revisa que el código sea de la sesión y que ESE empleado pueda editar productos
// (verificarCodigoEmpleadoAdmin + verificarPermisoEmpleado); acá solo se verifica en vivo
// para no habilitar un botón que el servidor va a rechazar.

const PRECIOS = [
    { clave: 'publico',   etiqueta: 'Precio al público', corta: 'Público' },
    { clave: 'mayorista', etiqueta: 'Precio mayorista',  corta: 'Mayorista' },
    { clave: 'surtido',   etiqueta: 'Mayorista surtido', corta: 'Surtido' }
];

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`;
const digitos = (v) => String(v || '').replace(/\D/g, '');
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const productos = (n) => (n === 1 ? '1 producto' : `${Number(n).toLocaleString('es-CO')} productos`);

/**
 * @param csrfToken   token de la vista (el POST pasa por csrfProtection)
 * @param alTerminar  se llama después de aplicar, para recargar el listado
 */
export function abrirPreciosMasivos({ csrfToken, alTerminar }) {
    const estado = {
        alcance: 'familias',
        familias: null,            // se cargan una vez al abrir
        elegidos: new Map(),       // id → { id, titulo, sub, productos }
        buscados: [],              // resultados de la búsqueda de productos (primeros 50)
        totalBuscados: 0,          // cuántos coinciden en total (para "Agregar los N")
        todosAgregados: '',        // búsqueda cuyos resultados ya se agregaron completos
        pidiendo: ''               // última búsqueda enviada (descarta respuestas viejas)
    };

    // ── Marcado ──
    const capa = document.createElement('div');
    capa.className = 'gh-conf-capa';
    capa.innerHTML = `
        <div class="gh-conf-panel gh-conf--neutro gh-conf-entra" role="dialog" aria-modal="true" aria-labelledby="pm-cifra">
            ${cabeceraConfirmacion({
                icono: 'fi-rr-dollar', badge: 'Editar precios masivamente',
                monto: 'Ningún producto elegido', idMonto: 'pm-cifra',
                contexto: 'Los precios que dejes vacíos no cambian.'
            })}
            <button type="button" class="gh-conf-cerrar" data-pm-cerrar aria-label="Cerrar"><i class="fi fi-rr-cross-small"></i></button>
            <div class="gh-conf-panel-cuerpo">
                <p class="gh-conf-seccion">Precios nuevos</p>
                <div class="gh-conf-precios">
                    ${PRECIOS.map(p => `
                        <div class="gh-conf-precio">
                            <label for="pm-${p.clave}">${p.etiqueta}</label>
                            <div class="gh-conf-precio-caja"><span>$</span>
                                <input id="pm-${p.clave}" class="gh-conf-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Sin cambio" data-pm-precio="${p.clave}">
                            </div>
                            <p class="gh-conf-precio-error" data-pm-error="${p.clave}"></p>
                        </div>`).join('')}
                </div>

                <p class="gh-conf-seccion">Aplicar a</p>
                <div class="gh-conf-opciones" role="radiogroup" aria-label="Aplicar el cambio a">
                    <label class="gh-conf-opcion">
                        <input type="radio" name="pm-alcance" value="familias" checked>
                        <span class="gh-conf-opcion-titulo">Por familias</span>
                        <span class="gh-conf-opcion-sub">Todos los productos de cada familia elegida: todos sus colores y tallas.</span>
                    </label>
                    <label class="gh-conf-opcion">
                        <input type="radio" name="pm-alcance" value="productos">
                        <span class="gh-conf-opcion-titulo">Por productos</span>
                        <span class="gh-conf-opcion-sub">Solo los productos que elijas, por nombre o código.</span>
                    </label>
                </div>

                <div class="gh-conf-selector">
                    <div class="gh-conf-columna">
                        <p class="gh-conf-columna-titulo" data-pm-titulo-buscar>Buscar familias</p>
                        <div class="gh-conf-buscar"><i class="fi fi-rr-search"></i>
                            <input class="gh-conf-input" type="search" autocomplete="off" data-pm-buscar aria-label="Buscar">
                        </div>
                        <!-- Filtro por precio: solo en "Por productos" (un rango elige productos,
                             no familias enteras). -->
                        <div class="gh-conf-filtro" data-pm-filtro hidden>
                            <button type="button" class="gh-conf-enlace" data-pm-filtro-abrir aria-expanded="false">
                                <i class="fi fi-rr-filter"></i><span data-pm-filtro-resumen>Filtrar por rango de precio</span>
                            </button>
                            <div class="gh-conf-filtro-campos" data-pm-filtro-campos hidden>
                                <div>
                                    <label for="pm-rango-campo">Precio</label>
                                    <select id="pm-rango-campo" class="gh-conf-input" data-pm-rango-campo>
                                        ${PRECIOS.map(p => `<option value="${p.clave}">${p.corta}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label for="pm-rango-desde">Desde</label>
                                    <div class="gh-conf-precio-caja"><span>$</span>
                                        <input id="pm-rango-desde" class="gh-conf-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Sin mínimo" data-pm-rango="desde">
                                    </div>
                                </div>
                                <div>
                                    <label for="pm-rango-hasta">Hasta</label>
                                    <div class="gh-conf-precio-caja"><span>$</span>
                                        <input id="pm-rango-hasta" class="gh-conf-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Sin máximo" data-pm-rango="hasta">
                                    </div>
                                </div>
                                <p class="gh-conf-filtro-error" data-pm-rango-error></p>
                            </div>
                        </div>
                        <p class="gh-conf-nota" data-pm-nota-familias style="padding:.5rem 0 0">¿Buscas por rango de precio? Cámbiate a <strong>Por productos</strong>: un rango elige productos, no familias enteras.</p>
                        <div class="gh-conf-barra" data-pm-barra hidden>
                            <span data-pm-total></span>
                            <button type="button" class="gh-conf-agregar-todos" data-pm-agregar-todos><i class="fi fi-rr-add"></i><span></span></button>
                        </div>
                        <div class="gh-conf-resultados" data-pm-resultados role="listbox"></div>
                    </div>
                    <div class="gh-conf-columna">
                        <p class="gh-conf-columna-titulo">
                            <span style="font-size:.75rem;font-weight:700;color:#334155">Elegidos <span data-pm-conteo style="margin-left:.25rem">0</span></span>
                            <button type="button" class="gh-conf-enlace gh-conf-enlace--apagado" data-pm-quitar-todos hidden>Quitar todos</button>
                        </p>
                        <div class="gh-conf-elegidos" data-pm-elegidos></div>
                    </div>
                </div>
            </div>
            <div class="gh-conf-acciones">
                <button type="button" class="gh-conf-subir" data-pm-subir tabindex="-1" aria-label="Subir al inicio de la ventana">
                    <i class="fi fi-rr-arrow-small-up"></i>Subir
                </button>
                <button type="button" class="gh-conf-btn gh-conf-cancelar" data-pm-cerrar>Cancelar</button>
                <button type="button" class="gh-conf-btn gh-conf-confirmar" data-pm-aplicar disabled>Editar precios masivamente</button>
            </div>
        </div>`;

    const $ = (sel) => capa.querySelector(sel);
    const buscar = $('[data-pm-buscar]');
    const resultados = $('[data-pm-resultados]');
    const elegidos = $('[data-pm-elegidos]');
    const botonAplicar = $('[data-pm-aplicar]');
    const campoRango = $('[data-pm-rango-campo]');
    const rangoDesde = $('[data-pm-rango="desde"]');
    const rangoHasta = $('[data-pm-rango="hasta"]');
    const cuerpo = $('.gh-conf-panel-cuerpo');
    const botonSubir = $('[data-pm-subir]');

    // ── "Subir" ──
    // Visible pasada una pantalla de desplazamiento. El recorrido es una animación propia y
    // no `behavior: 'smooth'`: con cientos de elegidos el cuerpo mide decenas de miles de
    // píxeles y el suave del navegador tarda segundos. Acá la duración crece con la distancia
    // pero con techo (~300 ms para 1.000 px, nunca más de 650 ms), con salida exponencial.
    let animacionSubir = null;
    const cortarSubida = () => { if (animacionSubir) cancelAnimationFrame(animacionSubir); animacionSubir = null; };
    const mostrarSubir = () => {
        const visible = cuerpo.scrollTop > cuerpo.clientHeight * 0.8;
        botonSubir.classList.toggle('gh-conf-subir--visible', visible);
        botonSubir.tabIndex = visible ? 0 : -1;
    };
    const subir = () => {
        cortarSubida();
        const inicio = cuerpo.scrollTop;
        const alTerminar = () => { mostrarSubir(); buscar.focus({ preventScroll: true }); };
        if (!inicio) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { cuerpo.scrollTop = 0; alTerminar(); return; }
        const duracion = Math.min(650, 200 + Math.sqrt(inicio) * 3.2);
        const t0 = performance.now();
        const paso = (t) => {
            const avance = Math.min(1, (t - t0) / duracion);
            cuerpo.scrollTop = inicio * Math.pow(1 - avance, 4);   // ease-out quart: frena al llegar
            if (avance < 1) animacionSubir = requestAnimationFrame(paso);
            else { animacionSubir = null; alTerminar(); }
        };
        animacionSubir = requestAnimationFrame(paso);
    };
    cuerpo.addEventListener('scroll', mostrarSubir, { passive: true });
    // Si la persona toma el control a mitad de camino, la animación la suelta.
    ['wheel', 'touchstart', 'keydown'].forEach(ev => cuerpo.addEventListener(ev, cortarSubida, { passive: true }));
    botonSubir.addEventListener('click', subir);

    // La página de fondo queda inerte: sin esto el tabulador se escapa detrás de la capa.
    const fondo = [...document.body.children].filter(n => n !== capa && !n.classList.contains('swal2-container'));
    const abrir = () => {
        document.body.appendChild(capa);
        fondo.forEach(n => n.setAttribute('inert', ''));
        document.addEventListener('keydown', alTeclear);
        capa.querySelectorAll('[data-pm-precio], [data-pm-rango]').forEach(i => window.initMoneyInput?.(i));
        $('[data-pm-precio]').focus();
    };
    const cerrarYa = () => {
        fondo.forEach(n => n.removeAttribute('inert'));
        document.removeEventListener('keydown', alTeclear);
        capa.remove();
    };

    // ── Datos y cifras ──
    const precios = () => Object.fromEntries(PRECIOS.map(p => [p.clave, digitos($(`[data-pm-precio="${p.clave}"]`).value)]));
    const hayCambios = () => estado.elegidos.size > 0 || Object.values(precios()).some(Boolean);
    const afectados = () => (estado.alcance === 'familias'
        ? [...estado.elegidos.values()].reduce((s, e) => s + (e.productos || 0), 0)
        : estado.elegidos.size);

    const refrescarCifras = () => {
        const n = afectados();
        $('#pm-cifra').textContent = n ? productos(n) : 'Ningún producto elegido';
        $('[data-pm-conteo]').textContent = estado.alcance === 'familias'
            ? `${estado.elegidos.size} ${estado.elegidos.size === 1 ? 'familia' : 'familias'} · ${productos(n)}`
            : productos(n);
        botonAplicar.disabled = !n || !Object.values(precios()).some(Boolean);
        $('[data-pm-quitar-todos]').hidden = estado.elegidos.size < 2;
    };

    // ── Validación de precios (espejo de editarPreciosMasivos en el servidor) ──
    const validarPrecios = () => {
        const p = precios();
        const errores = {
            publico:   p.publico   !== '' && Number(p.publico)   <= 0 ? 'Tiene que ser mayor a $0.' : '',
            mayorista: p.mayorista !== '' && Number(p.mayorista) <= 0 ? 'Tiene que ser mayor a $0.' : '',
            surtido:   ''
        };
        PRECIOS.forEach(({ clave }) => {
            $(`[data-pm-error="${clave}"]`).textContent = errores[clave];
            $(`[data-pm-precio="${clave}"]`).setAttribute('aria-invalid', errores[clave] ? 'true' : 'false');
        });
        return !Object.values(errores).some(Boolean);
    };

    // ── Columna izquierda: resultados ──
    const filaResultado = (item) => {
        const ya = estado.elegidos.has(item.id);
        return `<button type="button" class="gh-conf-resultado" role="option" data-pm-agregar="${esc(item.id)}" ${ya ? 'disabled aria-selected="true"' : ''}>
            <span class="gh-conf-resultado-texto">
                <span class="gh-conf-resultado-titulo">${esc(item.titulo)}</span>
                <span class="gh-conf-resultado-sub">${esc(item.sub)}</span>
            </span>
            <span class="gh-conf-resultado-accion" aria-hidden="true"><i class="fi ${ya ? 'fi-rr-check' : 'fi-rr-plus'}"></i></span>
        </button>`;
    };
    const vacio = (icono, texto) => `<p class="gh-conf-vacio-lista"><i class="fi ${icono}"></i>${texto}</p>`;

    const itemsFamilias = () => (estado.familias || []).map(f => ({
        id: f.idFamilia, titulo: f.nombre, productos: f.productos,
        sub: `${productos(f.productos)} · ${f.minPublico === f.maxPublico ? pesos(f.minPublico) : `${pesos(f.minPublico)} – ${pesos(f.maxPublico)}`}`
    }));

    const pintarResultados = () => {
        if (estado.alcance === 'familias') {
            if (!estado.familias) { resultados.innerHTML = vacio('fi-rr-spinner', 'Cargando familias…'); return; }
            const termino = sinTildes(buscar.value.trim());
            const lista = itemsFamilias().filter(f => sinTildes(f.titulo).includes(termino));
            resultados.innerHTML = lista.length ? lista.map(filaResultado).join('') : vacio('fi-rr-search', 'Ninguna familia con ese nombre.');
            return;
        }
        const barra = $('[data-pm-barra]');
        if (!hayCriterio()) {
            barra.hidden = true;
            resultados.innerHTML = vacio('fi-rr-search', 'Escribe el nombre o el código, o filtra por un rango de precio.');
            return;
        }
        const faltan = estado.buscados.filter(b => !estado.elegidos.has(b.id)).length;
        barra.hidden = !estado.totalBuscados;
        $('[data-pm-total]').innerHTML = `<strong>${productos(estado.totalBuscados)}</strong> ${rangoActivo() ? 'en el rango' : 'coinciden'}`;
        const todos = $('[data-pm-agregar-todos]');
        // Ya están todos cuando se agregó esta misma búsqueda completa (y no se quitó ninguno de
        // los visibles), o cuando todos los que coinciden se ven y están elegidos.
        const completos = (estado.todosAgregados === parametros().toString() || estado.totalBuscados <= estado.buscados.length) && !faltan;
        todos.querySelector('span').textContent = completos ? 'Todos agregados'
            : estado.totalBuscados === 1 ? 'Agregar' : `Agregar los ${estado.totalBuscados.toLocaleString('es-CO')}`;
        todos.querySelector('i').className = `fi ${completos ? 'fi-rr-check' : 'fi-rr-add'}`;
        todos.disabled = completos;
        resultados.innerHTML = estado.buscados.length
            ? estado.buscados.map(filaResultado).join('') + (estado.totalBuscados > estado.buscados.length
                ? `<p class="gh-conf-vacio-lista" style="padding:.75rem">Se muestran los primeros ${estado.buscados.length}. “Agregar los ${estado.totalBuscados.toLocaleString('es-CO')}” los suma todos.</p>` : '')
            : vacio('fi-rr-search', rangoActivo() ? 'Ningún producto en ese rango.' : 'Ningún producto con ese nombre o código.');
    };

    // ── Columna derecha: elegidos ──
    const pintarElegidos = () => {
        elegidos.innerHTML = estado.elegidos.size
            ? [...estado.elegidos.values()].map(e => `
                <div class="gh-conf-elegido">
                    <span class="gh-conf-resultado-texto">
                        <span class="gh-conf-resultado-titulo">${esc(e.titulo)}</span>
                        <span class="gh-conf-resultado-sub">${esc(e.sub)}</span>
                    </span>
                    <button type="button" class="gh-conf-quitar" data-pm-quitar="${esc(e.id)}" aria-label="Quitar ${esc(e.titulo)}"><i class="fi fi-rr-trash"></i></button>
                </div>`).join('')
            : vacio(estado.alcance === 'familias' ? 'fi-rr-folder' : 'fi-rr-box-open', `Toca ${estado.alcance === 'familias' ? 'una familia' : 'un producto'} de la izquierda para agregarlo aquí.`);
        refrescarCifras();
    };

    // ── Búsqueda de productos (el mismo endpoint del listado) ──
    // Rango de precio del filtro. `rangoValido` pinta el error y devuelve false si no sirve.
    const rango = () => ({ campo: campoRango.value, desde: digitos(rangoDesde.value), hasta: digitos(rangoHasta.value) });
    const rangoActivo = () => { const r = rango(); return Boolean(r.desde || r.hasta); };
    const hayCriterio = () => buscar.value.trim().length >= 2 || rangoActivo();
    const rangoValido = () => {
        const r = rango();
        const error = r.desde && r.hasta && Number(r.desde) > Number(r.hasta) ? 'El “desde” no puede ser mayor que el “hasta”.' : '';
        $('[data-pm-rango-error]').textContent = error;
        return !error;
    };
    const resumirRango = () => {
        const r = rango();
        const etiqueta = campoRango.selectedOptions[0].textContent;
        $('[data-pm-filtro-resumen]').textContent = !rangoActivo() ? 'Filtrar por rango de precio'
            : `${etiqueta}: ${r.desde ? pesos(r.desde) : 'sin mínimo'} – ${r.hasta ? pesos(r.hasta) : 'sin máximo'}`;
    };
    const aItem = (p) => ({
        id: p.idProducto, titulo: p.nombre, productos: 1,
        sub: `${p.sku} · ${pesos(p.publico)} · may. ${pesos(p.mayorista)} · surt. ${pesos(p.surtido)}`
    });
    const parametros = (extra = {}) => {
        const r = rango();
        return new URLSearchParams({ busqueda: buscar.value.trim(), campo: r.campo, desde: r.desde, hasta: r.hasta, ...extra });
    };

    let temporizador;
    const buscarProductos = () => {
        clearTimeout(temporizador);
        resumirRango();
        if (!rangoValido() || !hayCriterio()) { estado.buscados = []; estado.totalBuscados = 0; pintarResultados(); return; }
        resultados.innerHTML = vacio('fi-rr-spinner', 'Buscando…');
        temporizador = setTimeout(async () => {
            const clave = parametros().toString();
            estado.pidiendo = clave;
            try {
                const r = await fetch(`/admin/json/precios-masivos/productos?${clave}`);
                const d = await r.json();
                if (estado.pidiendo !== clave) return;
                if (!d.success) throw new Error(d.mensaje);
                estado.buscados = d.productos.map(aItem);
                estado.totalBuscados = d.total;
            } catch (e) {
                estado.buscados = []; estado.totalBuscados = 0;
                $('[data-pm-rango-error]').textContent = e.message || '';
            }
            pintarResultados();
        }, 300);
    };

    // "Agregar los N": todos los que coinciden, no solo los 50 que se ven.
    const agregarTodos = async () => {
        const boton = $('[data-pm-agregar-todos]');
        boton.disabled = true;
        try {
            const r = await fetch(`/admin/json/precios-masivos/productos?${parametros({ todos: '1' })}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.mensaje);
            d.productos.map(aItem).forEach(i => estado.elegidos.set(i.id, i));
            estado.todosAgregados = parametros().toString();
            pintarElegidos();
            pintarResultados();
        } catch (e) {
            Swal.fire(opcionesConfirmacion({ variante: 'neutro', html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono: 'fi-rr-exclamation', badge: 'No se pudo agregar', monto: 'Demasiados productos', contexto: esc(e.message || 'Inténtalo de nuevo.') })}</div>`, confirmButtonText: 'Entendido' }));
            boton.disabled = false;
        }
    };

    const quitarTodos = async () => {
        const n = estado.elegidos.size;
        const ok = await confirmar({
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                icono: 'fi-rr-trash', badge: 'Quitar todos', monto: `${n.toLocaleString('es-CO')} ${estado.alcance === 'familias' ? (n === 1 ? 'familia' : 'familias') : (n === 1 ? 'producto' : 'productos')}`,
                contexto: 'Ninguno cambiará de precio. Lo que escribiste en los precios se conserva.'
            })}</div>`,
            confirmButtonText: 'Sí, quitar todos', cancelButtonText: 'Dejarlos'
        });
        if (!ok) return;
        estado.elegidos.clear();
        estado.todosAgregados = '';
        pintarElegidos();
        pintarResultados();
    };

    // ── Confirmaciones con SweetAlert (aparecen encima de la capa) ──
    const confirmar = (opciones) => Swal.fire(opcionesConfirmacion({
        variante: 'neutro', showCancelButton: true, focusCancel: true, ...opciones
    })).then(r => r.isConfirmed);

    const quitar = async (id) => {
        const e = estado.elegidos.get(id);
        if (!e) return;
        const ok = await confirmar({
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                icono: 'fi-rr-trash', badge: estado.alcance === 'familias' ? 'Quitar familia' : 'Quitar producto',
                monto: esc(e.titulo),
                contexto: estado.alcance === 'familias' ? `Sus ${productos(e.productos)} conservarán el precio actual.` : 'Conservará su precio actual.'
            })}</div>`,
            confirmButtonText: 'Sí, quitar', cancelButtonText: 'Dejarlo'
        });
        if (!ok) return;
        estado.elegidos.delete(id);
        pintarElegidos();
        pintarResultados();
    };

    const cambiarAlcance = async (nuevo, radio) => {
        if (nuevo === estado.alcance) return;
        if (estado.elegidos.size) {
            const ok = await confirmar({
                html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                    icono: 'fi-rr-exchange', badge: 'Cambiar a ' + (nuevo === 'familias' ? 'familias' : 'productos'),
                    monto: `Se quita lo elegido (${estado.elegidos.size})`,
                    contexto: 'Familias y productos no se mezclan en un mismo cambio.'
                })}</div>`,
                confirmButtonText: 'Cambiar', cancelButtonText: 'Quedarme'
            });
            if (!ok) { capa.querySelector(`input[name="pm-alcance"][value="${estado.alcance}"]`).checked = true; return; }
        }
        estado.alcance = nuevo;
        estado.elegidos.clear();
        estado.buscados = [];
        estado.totalBuscados = 0;
        buscar.value = '';
        rangoDesde.value = ''; rangoHasta.value = '';
        $('[data-pm-rango-error]').textContent = '';
        resumirRango();
        $('[data-pm-filtro]').hidden = nuevo !== 'productos';
        $('[data-pm-nota-familias]').hidden = nuevo !== 'familias';
        $('[data-pm-barra]').hidden = true;
        buscar.placeholder = nuevo === 'familias' ? 'Nombre de la familia' : 'Nombre o código (SKU, EAN)';
        $('[data-pm-titulo-buscar]').textContent = nuevo === 'familias' ? 'Buscar familias' : 'Buscar productos';
        pintarResultados();
        pintarElegidos();
        buscar.focus();
    };

    const intentarCerrar = async () => {
        if (hayCambios() && !(await confirmar({
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({
                icono: 'fi-rr-cross-circle', badge: 'Descartar', monto: '¿Cerrar sin aplicar?',
                contexto: 'Lo que escribiste y elegiste se pierde. Ningún precio cambió.'
            })}</div>`,
            confirmButtonText: 'Sí, cerrar', cancelButtonText: 'Seguir editando'
        }))) return;
        cerrarYa();
    };

    function alTeclear(e) {
        // Esc cierra la capa solo si no hay un SweetAlert encima (ese se cierra solo).
        if (e.key === 'Escape' && !Swal.isVisible()) { e.preventDefault(); intentarCerrar(); }
    }

    // ── Aplicar: resumen + código de empleado ──
    const aplicar = async () => {
        if (!validarPrecios()) return;
        const p = precios();
        const n = afectados();
        const fila = (etiqueta, v) => `<div class="gh-conf-fila"><dt>${etiqueta}</dt>
            <dd class="${v ? '' : 'gh-conf-vacio'}">${v ? pesos(v) : 'Sin cambio'}</dd></div>`;
        const lista = [...estado.elegidos.values()];
        const nombres = lista.slice(0, 3).map(e => esc(e.titulo)).join(', ') + (lista.length > 3 ? ` y ${lista.length - 3} más` : '');

        const { isConfirmed, value } = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `<div class="gh-conf-html">
                ${cabeceraConfirmacion({
                    icono: 'fi-rr-dollar', badge: 'Confirmar cambio de precios', monto: productos(n),
                    contexto: `${estado.alcance === 'familias' ? (lista.length === 1 ? 'Familia' : 'Familias') : (lista.length === 1 ? 'Producto' : 'Productos')}: ${nombres}`
                })}
                <dl class="gh-conf-detalle">
                    ${fila('Público', p.publico)}${fila('Mayorista', p.mayorista)}${fila('Surtido', p.surtido)}
                </dl>
                <div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
                    <span>Reemplaza el precio actual de ${n === 1 ? 'ese producto' : `los ${Number(n).toLocaleString('es-CO')} productos`}. Queda registrado el precio anterior y quién lo autorizó.</span></div>
                <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                ${campoCodigoEmpleado('pm-codigo', '1.75rem')}
                <p class="gh-conf-estado" id="pm-codigo-estado"></p>
            </div>`,
            showCancelButton: true,
            confirmButtonText: `Aplicar a ${productos(n)}`,
            cancelButtonText: 'Volver',
            didOpen: () => {
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo('pm-codigo', 'pm-codigo-estado', (emp) => { boton.disabled = !emp; }, {
                    urlValidar: (codigo) => `/admin/api/inventario/empleado/validar/${encodeURIComponent(codigo)}`
                });
                document.getElementById('pm-codigo')?.focus();
            },
            preConfirm: async () => {
                const codigoEmpleado = codigoRequerido('pm-codigo', 'pm-codigo-estado');
                if (!codigoEmpleado) return false;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                boton.textContent = 'Aplicando…';
                try {
                    const r = await fetch('/admin/inventario/precios-masivos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrfToken },
                        body: JSON.stringify({
                            alcance: estado.alcance, ids: lista.map(e => e.id), codigoEmpleado,
                            precios: { publico: p.publico, mayorista: p.mayorista, surtido: p.surtido }
                        })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d.logout) { window.location.href = '/'; return false; }
                    if (!r.ok || !d.success) throw new Error(d.mensaje || 'No se pudieron actualizar los precios.');
                    return d;
                } catch (e) {
                    boton.disabled = false;
                    boton.textContent = `Aplicar a ${productos(n)}`;
                    Swal.showValidationMessage(e.message);
                    return false;
                }
            }
        }));
        if (!isConfirmed) return;   // "Volver": la ventana de edición sigue ahí, intacta
        cerrarYa();
        Swal.fire({ toast: true, position: 'bottom-end', icon: 'success', title: value.mensaje, showConfirmButton: false, timer: 3200 });
        alTerminar?.();
    };

    // ── Eventos ──
    capa.addEventListener('click', (e) => {
        if (e.target === capa || e.target.closest('[data-pm-cerrar]')) return intentarCerrar();
        const agregar = e.target.closest('[data-pm-agregar]');
        if (agregar) {
            const lista = estado.alcance === 'familias' ? itemsFamilias() : estado.buscados;
            const item = lista.find(i => String(i.id) === agregar.dataset.pmAgregar);
            if (item) { estado.elegidos.set(item.id, item); pintarElegidos(); pintarResultados(); }
            return;
        }
        const quitarBtn = e.target.closest('[data-pm-quitar]');
        if (quitarBtn) return quitar(quitarBtn.dataset.pmQuitar);
        if (e.target.closest('[data-pm-agregar-todos]')) return agregarTodos();
        if (e.target.closest('[data-pm-quitar-todos]')) return quitarTodos();
        const abrirFiltro = e.target.closest('[data-pm-filtro-abrir]');
        if (abrirFiltro) {
            const campos = $('[data-pm-filtro-campos]');
            campos.hidden = !campos.hidden;
            abrirFiltro.setAttribute('aria-expanded', String(!campos.hidden));
            if (!campos.hidden) rangoDesde.focus();
        }
    });
    capa.addEventListener('change', (e) => {
        if (e.target.name === 'pm-alcance') cambiarAlcance(e.target.value, e.target);
        if (e.target === campoRango && rangoActivo()) buscarProductos();
    });
    capa.addEventListener('input', (e) => {
        if (e.target.matches('[data-pm-precio]')) { validarPrecios(); refrescarCifras(); }
        if (e.target === buscar) (estado.alcance === 'familias' ? pintarResultados : buscarProductos)();
        if (e.target.matches('[data-pm-rango]')) buscarProductos();
    });
    botonAplicar.addEventListener('click', aplicar);

    // ── Arranque ──
    buscar.placeholder = 'Nombre de la familia';
    abrir();
    pintarResultados();
    pintarElegidos();
    fetch('/admin/json/precios-masivos/familias')
        .then(r => r.json())
        .then(d => { estado.familias = d.success ? d.familias : []; pintarResultados(); })
        .catch(() => { estado.familias = []; resultados.innerHTML = vacio('fi-rr-exclamation', 'No se pudieron cargar las familias. Cierra y vuelve a abrir.'); });
}
