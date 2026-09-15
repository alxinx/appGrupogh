import { escaparHtml as esc } from './escaparHtml.js';
import { montarHistorialTraslado, fmtFechaHora, chipCodigo } from './historialTraslado.js';
import { pillEstadoTraslado } from './estadoTraslado.js';

(function () {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const tc = window.tc || ((t) => t);

    // ── PESTAÑAS ─────────────────────────────────────────────────────────────
    // Mismas clases que las pestañas de /admin/bankentities.
    const ACTIVA   = 'bg-gh-primarySoft border-gh-primaryHover text-gh-primaryHover shadow-sm';
    const INACTIVA = 'bg-white border-slate-200 text-slate-500 hover:border-gh-primary/40 hover:text-gh-primaryHover';
    const BASE_TAB = 'tab-traslado flex items-center justify-center gap-2 py-4 rounded-2xl border text-sm font-semibold transition-all cursor-pointer ';

    const paneles = {
        controversias: document.getElementById('panel-controversias'),
        historial:     document.getElementById('panel-historial')
    };
    const botones = document.querySelectorAll('.tab-traslado');
    let historialCargado = false;

    const mostrar = (tab) => {
        if (!paneles[tab]) tab = 'controversias';
        Object.entries(paneles).forEach(([k, el]) => el.classList.toggle('hidden', k !== tab));
        botones.forEach((b) => {
            const activa = b.dataset.tab === tab;
            b.className = BASE_TAB + (activa ? ACTIVA : INACTIVA);
            b.setAttribute('aria-selected', String(activa));
        });
        if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
        if (tab === 'historial' && !historialCargado) { historialCargado = true; cargarHistorial(); }
    };
    botones.forEach(b => b.addEventListener('click', () => mostrar(b.dataset.tab)));

    // ── UTILIDADES ───────────────────────────────────────────────────────────
    const hace = (iso) => {
        if (!iso) return '—';
        const horas = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000);
        if (horas < 1) return 'Menos de 1 hora';
        if (horas < 24) return `${Math.floor(horas)} h`;
        const dias = Math.floor(horas / 24);
        return `${dias} día${dias === 1 ? '' : 's'}`;
    };
    const contenidoTexto = (packs, unidades) => [
        packs ? `${packs} pack${packs === 1 ? '' : 's'}` : '',
        unidades ? `${unidades} ud${unidades === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ') || '—';
    const ruta = (origen, destino) => `
        <div class="flex items-center gap-2 text-sm text-slate-700 whitespace-nowrap">
            <span>${esc(tc(origen))}</span>
            <i class="fi fi-rr-arrow-right text-[10px] text-slate-300" aria-hidden="true"></i>
            <span>${esc(tc(destino))}</span>
        </div>`;
    const celdaTraslado = (codigo, fecha) => `
        <p class="font-bold text-slate-800 text-sm font-mono leading-tight">${esc(codigo)}</p>
        <p class="text-[11px] text-slate-400">${fmtFechaHora(fecha)}</p>`;
    const botonVerMas = (id) =>
        `<button type="button" class="btn btn-secondary btn-sm text-xs whitespace-nowrap btn-ver-traslado" data-id="${esc(id)}"><i class="fi-rr-eye text-xs"></i>Ver más</button>`;
    const filaMensaje = (colspan, icono, texto) => `
        <tr><td colspan="${colspan}" class="px-4 py-10 text-center">
            <i class="fi ${icono} text-2xl"></i>
            <p class="text-sm text-slate-400 mt-2">${texto}</p>
        </td></tr>`;

    // ── EN CONTROVERSIA ──────────────────────────────────────────────────────
    const tablaControversias = document.getElementById('tabla-controversias');
    const contadorControversias = document.getElementById('contador-controversias');
    const conteoTab = document.getElementById('tab-conteo-controversias');

    const filaControversia = (c) => {
        const esperaLarga = c.fechaRecepcion && (Date.now() - new Date(c.fechaRecepcion).getTime()) > 3 * 86400000;
        const quienRecibe = c.recibeAdmin
            ? '<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap border border-gh-primary/40 text-gh-primaryHover">Administración</span>'
            : `<p class="text-xs text-slate-500 whitespace-nowrap">${esc(tc(c.origen))}</p>`;
        const acciones = c.recibeAdmin
            ? `${botonVerMas(c.idTraslado)}<button type="button" class="btn btn-danger btn-sm text-xs whitespace-nowrap btn-ver-traslado" data-id="${esc(c.idTraslado)}" data-recibir="1"><i class="fi fi-rr-undo text-xs"></i>Recibir</button>`
            : botonVerMas(c.idTraslado);
        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td class="px-4 py-4">${celdaTraslado(c.codigo, c.fechaEnvio)}</td>
                <td class="px-2 py-4">${ruta(c.origen, c.destino)}</td>
                <td class="px-2 py-4 text-center">
                    <p class="font-bold text-sm text-slate-800 whitespace-nowrap">${contenidoTexto(c.packsRechazados, c.unidadesRechazadas - c.packsRechazados)}</p>
                    <p class="text-[10px] text-slate-400">${c.itemsRechazados} ítem${c.itemsRechazados === 1 ? '' : 's'}</p>
                </td>
                <td class="px-2 py-4 text-center text-sm whitespace-nowrap ${esperaLarga ? 'font-bold text-amber-700' : 'text-slate-600'}">${hace(c.fechaRecepcion)}</td>
                <td class="px-2 py-4 text-center">${quienRecibe}</td>
                <td class="px-4 py-4"><div class="flex items-center justify-center gap-2">${acciones}</div></td>
            </tr>`;
    };

    const cargarControversias = async () => {
        try {
            const r = await fetch('/admin/api/traslados/controversias');
            const d = await r.json();
            if (!d.success) throw new Error(d.mensaje);
            const lista = d.controversias;
            tablaControversias.innerHTML = lista.length
                ? lista.map(filaControversia).join('')
                : filaMensaje(6, 'fi-rr-check-circle text-emerald-400', 'No hay traslados en controversia');
            const deAdmin = lista.filter(c => c.recibeAdmin).length;
            contadorControversias.textContent = lista.length
                ? `Mostrando ${lista.length} traslado${lista.length === 1 ? '' : 's'} en controversia${deAdmin ? ` · ${deAdmin} por recibir en administración` : ''}`
                : 'Sin traslados en controversia';
            conteoTab.textContent = lista.length;
            conteoTab.classList.toggle('hidden', !lista.length);
        } catch {
            tablaControversias.innerHTML = filaMensaje(6, 'fi-rr-exclamation text-rose-400', 'No se pudieron cargar las controversias.');
        }
    };

    // ── HISTORIAL ────────────────────────────────────────────────────────────
    const tablaHistorial = document.getElementById('tabla-historial');
    const contadorHistorial = document.getElementById('contador-historial');
    const btnMas = document.getElementById('hist-cargar-mas');
    const fCodigo = document.getElementById('hist-codigo');
    const fPunto = document.getElementById('hist-punto');
    const fEstado = document.getElementById('hist-estado');
    const btnLimpiar = document.getElementById('hist-limpiar');
    let cursorSiguiente = null;
    let filasHistorial = 0;
    let pedido = 0;

    const filaHistorial = (t) => `
        <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
            <td class="px-4 py-3">${celdaTraslado(t.codigo, t.fechaEnvio)}</td>
            <td class="px-3 py-3">${ruta(t.origen, t.destino)}</td>
            <td class="px-3 py-3 text-center text-sm text-slate-600 whitespace-nowrap">${contenidoTexto(t.packs, t.unidades)}</td>
            <td class="px-3 py-3 text-center">${pillEstadoTraslado(t.estado)}</td>
            <td class="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">${t.fechaRecepcion ? fmtFechaHora(t.fechaRecepcion) : '—'}</td>
            <td class="px-4 py-3">
                <div class="flex items-center justify-center gap-2">
                    ${botonVerMas(t.idTraslado)}
                    <a href="/admin/dosificaciones/comprobante/${esc(t.idTraslado)}" target="_blank" rel="noopener"
                       class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-gh-primaryHover transition-colors"
                       title="Comprobante PDF de ${esc(t.codigo)}" aria-label="Comprobante PDF de ${esc(t.codigo)}">
                        <i class="fi fi-rr-file-pdf text-sm"></i>
                    </a>
                </div>
            </td>
        </tr>`;

    const params = () => {
        const p = new URLSearchParams();
        if (fCodigo.value.trim()) p.set('codigo', fCodigo.value.trim());
        if (fPunto.value) p.set('punto', fPunto.value);
        if (fEstado.value) p.set('estado', fEstado.value);
        return p;
    };

    const actualizarPieHistorial = () => {
        const filtrado = fCodigo.value.trim() || fPunto.value || fEstado.value;
        btnLimpiar.classList.toggle('hidden', !filtrado);
        btnMas.classList.toggle('hidden', !cursorSiguiente);
        contadorHistorial.textContent = filasHistorial
            ? `Mostrando ${filasHistorial} traslado${filasHistorial === 1 ? '' : 's'}`
            : (filtrado ? 'Ningún traslado con esos filtros' : 'Todavía no hay traslados');
    };

    // Los filtros van al servidor: filtrar solo lo que ya está en pantalla escondería los
    // traslados que todavía no se trajeron.
    const cargarHistorial = async ({ continuar = false } = {}) => {
        const esteP = ++pedido;
        const p = params();
        if (continuar && cursorSiguiente) p.set('cursor', cursorSiguiente);
        btnMas.disabled = true;
        if (continuar) btnMas.textContent = 'Cargando...';
        try {
            const d = await (await fetch(`/admin/api/traslados/historial?${p}`)).json();
            if (esteP !== pedido) return;   // llegó tarde: ya hay un filtro más nuevo
            if (!d.success) throw new Error(d.mensaje);
            const html = d.traslados.map(filaHistorial).join('');
            if (continuar) {
                tablaHistorial.insertAdjacentHTML('beforeend', html);
                filasHistorial += d.traslados.length;
            } else {
                tablaHistorial.innerHTML = html || filaMensaje(6, 'fi-rr-inbox text-slate-300', 'Ningún traslado para mostrar');
                filasHistorial = d.traslados.length;
            }
            cursorSiguiente = d.cursorSiguiente;
            actualizarPieHistorial();
        } catch {
            if (!continuar) tablaHistorial.innerHTML = filaMensaje(6, 'fi-rr-exclamation text-rose-400', 'No se pudo cargar el historial.');
        } finally {
            btnMas.disabled = false;
            btnMas.textContent = 'Cargar más';
        }
    };

    let temporizadorCodigo = null;
    fCodigo.addEventListener('input', () => {
        clearTimeout(temporizadorCodigo);
        temporizadorCodigo = setTimeout(() => cargarHistorial(), 350);
    });
    [fPunto, fEstado].forEach(el => el.addEventListener('change', () => cargarHistorial()));
    btnLimpiar.addEventListener('click', () => {
        fCodigo.value = ''; fPunto.value = ''; fEstado.value = '';
        cargarHistorial();
    });
    btnMas.addEventListener('click', () => cargarHistorial({ continuar: true }));

    // ── MODAL DE DETALLE ─────────────────────────────────────────────────────
    const modal = document.getElementById('modal-traslado');
    const mTitulo = document.getElementById('mt-titulo');
    const mSubtitulo = document.getElementById('mt-subtitulo');
    const mResumen = document.getElementById('mt-resumen');
    const mItems = document.getElementById('mt-items');
    const mPdf = document.getElementById('mt-pdf');
    const mRecibir = document.getElementById('mt-recibir');
    const mCodigo = document.getElementById('mt-codigo');
    const mCodigoEstado = document.getElementById('mt-codigo-estado');
    const mBtnRecibir = document.getElementById('mt-btn-recibir');
    const pintarHistorial = montarHistorialTraslado(document.getElementById('mt-historial'));
    let trasladoAbierto = null;
    let codigoValido = false;
    let disparador = null;

    const ESTADO_ITEM = {
        RECIBIDO:     '<span class="text-xs font-semibold text-emerald-600">Recibido</span>',
        CONTROVERSIA: '<span class="text-xs font-semibold text-amber-700">Rechazado</span>',
        PENDIENTE:    '<span class="text-xs font-semibold text-slate-500">Pendiente</span>'
    };

    const dato = (etiqueta, valor) => `
        <div class="min-w-0">
            <dt class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${etiqueta}</dt>
            <dd class="text-sm text-slate-700 mt-0.5 truncate">${valor}</dd>
        </div>`;

    const pintarItems = (items) => {
        if (!items.length) { mItems.innerHTML = ''; return; }
        mItems.innerHTML = `
            <div class="overflow-hidden rounded-xl border border-slate-200">
                <table class="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr class="border-b border-gh-primaryHover">
                            <th class="px-3 py-2 text-xs font-semibold text-gray-600">Pack o producto</th>
                            <th class="px-3 py-2 text-xs font-semibold text-gray-600 text-center">Cantidad</th>
                            <th class="px-3 py-2 text-xs font-semibold text-gray-600 text-right">Estado</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${items.map((i) => {
                            const nombre = i.pack
                                ? chipCodigo(i.pack.codigoEtiqueta)
                                : `<span class="text-slate-700">${esc(tc(i.producto?.nombreProducto || '—'))}</span>${i.producto?.sku ? ` <span class="text-[11px] text-slate-400 font-mono">${esc(i.producto.sku)}</span>` : ''}`;
                            return `
                                <tr>
                                    <td class="px-3 py-2">${nombre}</td>
                                    <td class="px-3 py-2 text-center tabular-nums text-slate-700">${i.cantidad}</td>
                                    <td class="px-3 py-2 text-right">${ESTADO_ITEM[i.estado] || esc(i.estado)}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    };

    const reiniciarRecepcion = (visible) => {
        mRecibir.classList.toggle('hidden', !visible);
        mBtnRecibir.classList.toggle('hidden', !visible);
        mCodigo.value = '';
        mCodigoEstado.textContent = '';
        codigoValido = false;
        mBtnRecibir.disabled = true;
    };

    const cerrarModal = () => {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        trasladoAbierto = null;
        disparador?.focus();
    };

    const abrirModal = async (idTraslado, { enfocarRecepcion = false } = {}) => {
        trasladoAbierto = idTraslado;
        mTitulo.textContent = 'Cargando...';
        mSubtitulo.textContent = '—';
        mResumen.innerHTML = '';
        mItems.innerHTML = '';
        pintarHistorial([]);
        reiniciarRecepcion(false);
        mPdf.href = `/admin/dosificaciones/comprobante/${encodeURIComponent(idTraslado)}`;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        try {
            const d = await (await fetch(`/admin/api/traslados/${encodeURIComponent(idTraslado)}`)).json();
            if (trasladoAbierto !== idTraslado) return;
            if (!d.success) throw new Error(d.mensaje);
            const t = d.traslado;
            mTitulo.textContent = `Traslado ${t.codigoTraslado}`;
            mSubtitulo.innerHTML = pillEstadoTraslado(t.estado);
            mResumen.innerHTML = [
                dato('Origen', esc(tc(d.origen))),
                dato('Destino', esc(tc(d.destino))),
                dato('Enviado', fmtFechaHora(t.fechaEnvio || t.createdAt)),
                dato('Recibido', t.fechaRecepcion ? fmtFechaHora(t.fechaRecepcion) : '—'),
                dato('Despachó', esc(d.personas.despacha || '—')),
                dato('Recibió', esc(d.personas.recibe || '—')),
                t.notas ? `<div class="col-span-2">${dato('Notas', esc(t.notas))}</div>` : ''
            ].join('');
            pintarItems(t.items || []);
            pintarHistorial(d.historial || []);
            reiniciarRecepcion(d.recibeAdmin);
            if (d.recibeAdmin && enfocarRecepcion) mCodigo.focus();
        } catch (e) {
            mTitulo.textContent = 'No se pudo cargar el traslado';
            mSubtitulo.textContent = e.message || 'Intenta de nuevo.';
        }
    };

    document.addEventListener('click', (e) => {
        const boton = e.target.closest('.btn-ver-traslado');
        if (!boton) return;
        disparador = boton;
        abrirModal(boton.dataset.id, { enfocarRecepcion: boton.dataset.recibir === '1' });
    });
    modal.querySelectorAll('[data-cerrar-modal]').forEach(el => el.addEventListener('click', cerrarModal));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) cerrarModal();
    });

    // ── RECIBIR DEVOLUCIÓN ───────────────────────────────────────────────────
    // El código se comprueba antes de habilitar el botón, para no ofrecer una acción que el
    // servidor va a rechazar; el servidor lo vuelve a exigir al recibir.
    const marcarCodigo = (tono, texto) => {
        mCodigoEstado.className = `text-[11px] font-semibold mt-1 min-h-[16px] ${tono}`;
        mCodigoEstado.textContent = texto;
    };
    let temporizadorEmpleado = null;
    mCodigo.addEventListener('input', () => {
        clearTimeout(temporizadorEmpleado);
        codigoValido = false;
        mBtnRecibir.disabled = true;
        const codigo = mCodigo.value.trim();
        if (!codigo) { marcarCodigo('', ''); return; }
        marcarCodigo('text-slate-400', 'Verificando código...');
        temporizadorEmpleado = setTimeout(async () => {
            try {
                const d = await (await fetch(`/admin/api/traslados/empleado/validar/${encodeURIComponent(codigo)}`)).json();
                if (mCodigo.value.trim() !== codigo) return;
                codigoValido = !!d.success;
                mBtnRecibir.disabled = !codigoValido;
                marcarCodigo(d.success ? 'text-emerald-600' : 'text-rose-500', d.success ? `✓ ${d.nombre}` : (d.mensaje || 'Código inválido.'));
            } catch {
                marcarCodigo('text-rose-500', 'No se pudo verificar el código.');
            }
        }, 400);
    });

    mBtnRecibir.addEventListener('click', async () => {
        if (!trasladoAbierto || !codigoValido) return;
        const idTraslado = trasladoAbierto;
        mBtnRecibir.disabled = true;
        mBtnRecibir.textContent = 'Recibiendo...';
        try {
            const r = await fetch(`/admin/traslados/${encodeURIComponent(idTraslado)}/recibir-devolucion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({ codigoEmpleado: mCodigo.value.trim() })
            });
            const d = await r.json();
            if (d.logout) { window.location.href = '/'; return; }
            if (!d.success) throw new Error(d.mensaje || 'No se pudo recibir la devolución.');

            cerrarModal();
            await Swal.fire({
                icon: 'success',
                title: 'Devolución recibida',
                text: `Lo rechazado de ${d.codigo} volvió a producción y el traslado quedó cerrado.`,
                confirmButtonColor: '#EC5FA3',
                timer: 3000,
                timerProgressBar: true
            });
            cargarControversias();
            if (historialCargado) cargarHistorial();
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'No se pudo recibir', text: err.message, confirmButtonColor: '#EC5FA3' });
        } finally {
            mBtnRecibir.textContent = 'Recibir devolución';
            mBtnRecibir.disabled = !codigoValido;
        }
    });

    // ── INICIO ───────────────────────────────────────────────────────────────
    const hayControversias = Number(conteoTab?.textContent) > 0;
    cargarControversias();
    mostrar(location.hash.slice(1) || (hayControversias ? 'controversias' : 'historial'));
})();
