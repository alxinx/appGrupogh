(function () {
    'use strict';

    const fmtCOP = window.fmtCOP;

    const ESTADO_MAP = {
        pendiente_pago: { cls: 'bg-amber-100 text-amber-700', label: 'Pendiente de pago' },
        en_revision: { cls: 'bg-blue-100 text-blue-700', label: 'En revisión' },
        trasladado: { cls: 'bg-indigo-100 text-indigo-700', label: 'Trasladado a tienda' },
        facturado: { cls: 'bg-emerald-100 text-emerald-700', label: 'Facturado / Despachado' },
        cancelado: { cls: 'bg-red-100 text-red-600', label: 'Cancelado' }
    };
    const ETIQUETA_ENTREGA = { domicilio: 'Domicilio', tienda: 'Punto de venta' };
    // Lo que el cliente eligió en el checkout web (PEDIDOS_WEB.metodoPago).
    const ETIQUETA_METODO_PAGO = { contraentrega: 'Contraentrega', tarjeta: 'Tarjeta', pse: 'PSE', nequi: 'Nequi' };
    // Lo que Wompi reporta que realmente se usó (payment_method_type, en PAGOS_PEDIDO_WEB.metodoPago).
    // No siempre coincide con lo anterior: en la pasarela el cliente puede cambiar de método.
    const ETIQUETA_METODO_WOMPI = {
        CARD: 'Tarjeta', NEQUI: 'Nequi', PSE: 'PSE', BANCOLOMBIA_TRANSFER: 'Transferencia Bancolombia',
        BANCOLOMBIA_COLLECT: 'Corresponsal Bancolombia', BANCOLOMBIA_QR: 'QR Bancolombia',
        DAVIPLATA: 'Daviplata', GOOGLE_PAY: 'Google Pay', SU_PLUS: 'Su+ Pay'
    };
    const ETIQUETA_DOC = { CC: 'C.C.', CE: 'C.E.', TI: 'T.I.', PP: 'Pasaporte', NIT: 'NIT' };

    // Método realmente cobrado si Wompi ya lo reportó; si no, lo que eligió el cliente.
    const metodoPagoHtml = (pedido, ultimoPago) => {
        const real = ultimoPago?.metodoPago;
        const elegido = ETIQUETA_METODO_PAGO[pedido.metodoPago] || pedido.metodoPago || '—';
        if (!real) return elegido;
        const etiquetaReal = ETIQUETA_METODO_WOMPI[real] || real;
        // Si difieren, se muestran ambos: el operador tiene que poder cuadrar contra Wompi.
        if (etiquetaReal.toLowerCase() === elegido.toLowerCase()) return etiquetaReal;
        return `${etiquetaReal} <span class="text-xs font-normal text-slate-400">(eligió ${elegido})</span>`;
    };

    // "hace 2 h 15 min" — se recalcula cada segundo desde fechaCambioEstado.
    const tiempoTranscurrido = (desde) => {
        const ms = Date.now() - new Date(desde).getTime();
        if (!isFinite(ms) || ms < 0) return '—';
        const s = Math.floor(ms / 1000);
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d > 0) return `${d} d ${h} h`;
        if (h > 0) return `${h} h ${m} min`;
        if (m > 0) return `${m} min ${s % 60} s`;
        return `${s} s`;
    };

    const estadoBadgeHtml = (estado) => {
        const s = ESTADO_MAP[estado] || { cls: 'bg-slate-100 text-slate-500', label: estado };
        return `<span class="px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${s.cls}">${s.label}</span>`;
    };

    const fmtFechaHora = (iso) => {
        if (!iso) return { fecha: '—', hora: '' };
        const d = new Date(iso);
        return {
            fecha: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }),
            hora: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
        };
    };

    const linkWhatsapp = (tel) => {
        const digitos = (tel || '').replace(/\D/g, '');
        return digitos ? `https://api.whatsapp.com/send?phone=${digitos}` : null;
    };

    function idPedidoActual() {
        return document.getElementById('detalle-pedido-root')?.dataset.id;
    }

    function itemFila(it) {
        return `
            <tr class="border-b border-slate-100 last:border-0">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-14 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                            ${it.imagen ? `<img src="${it.imagen}" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center text-slate-300"><i class="fi fi-rr-picture"></i></div>`}
                        </div>
                        <div class="min-w-0">
                            <p class="text-sm font-semibold text-slate-700 truncate">${it.nombre}</p>
                            <p class="text-xs text-slate-400">${[it.talla ? `Talla ${it.talla}` : null, it.color].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3 text-xs text-slate-500 font-mono">${it.referencia}</td>
                <td class="px-4 py-3 text-sm text-slate-600">${fmtCOP(it.valorUnidad)}</td>
                <td class="px-4 py-3 text-sm text-slate-600 text-center">${Number(it.cantidad)}</td>
                <td class="px-4 py-3 text-sm font-bold text-slate-800 text-right">${fmtCOP(it.subTotal)}</td>
            </tr>`;
    }

    function trasladoResumenHtml(titulo, t) {
        if (!t) return '';
        return `
            <div class="bg-white rounded-xl border border-slate-100 p-4">
                <div class="flex items-center justify-between mb-2">
                    <p class="text-xs font-bold text-slate-500 uppercase tracking-wider">${titulo}</p>
                    <span class="font-mono text-xs font-bold text-gh-primaryHover">${t.codigoTraslado}</span>
                </div>
                <p class="text-sm text-slate-700 flex items-center gap-2">
                    <span>${t.origen}</span>
                    <i class="fi fi-rr-arrow-right text-slate-300 text-xs"></i>
                    <span>${t.destino}</span>
                    <span class="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">${t.estado}</span>
                </p>
                <div class="mt-2 space-y-0.5">
                    ${t.items.map(i => `<p class="text-xs text-slate-500">${i.nombre} × ${Number(i.cantidad)}</p>`).join('')}
                </div>
            </div>`;
    }

    function renderTraslado(p) {
        const cont = document.getElementById('traslado-contenido');
        if (!cont) return;

        if (p.estado === 'pendiente_pago') {
            cont.innerHTML = `
                <div class="flex items-center gap-3 text-sm text-slate-500 py-3">
                    <i class="fi fi-rr-hourglass-end text-lg"></i>
                    Esperando confirmación del pago. El traslado a la bodega web se genera automáticamente en cuanto Wompi confirme el pago.
                </div>`;
            return;
        }

        let html = '';
        if (p.trasladoEntrada) html += trasladoResumenHtml('Traslado automático a bodega web', p.trasladoEntrada);

        if (p.trasladoSalida) {
            html += trasladoResumenHtml(`Asignado a ${p.tiendaFacturacion || 'tienda'}`, p.trasladoSalida);
        } else if (p.trasladoEntrada && p.estado === 'en_revision') {
            html += `
                <div class="bg-white rounded-xl border border-slate-100 p-4">
                    <p class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Asignar pedido a</p>
                    <div class="flex flex-col sm:flex-row gap-3">
                        <select id="select-tienda-asignar" class="flex-1 px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-300/40">
                            <option value="">Selecciona una tienda</option>
                            ${p.tiendasAsignables.map(t => `<option value="${t.idPuntoDeVenta}">${t.nombreComercial}</option>`).join('')}
                        </select>
                        <button id="btn-asignar-tienda" type="button" class="btn btn-primary text-sm whitespace-nowrap">
                            <i class="fi fi-rr-truck-side"></i> Asignar y registrar traslado
                        </button>
                    </div>
                </div>`;
        } else if (!p.trasladoEntrada && ['en_revision', 'trasladado', 'facturado'].includes(p.estado)) {
            html += `<p class="text-sm text-red-500 py-3">No se encontró el traslado automático a bodega — revisa el pedido manualmente.</p>`;
        } else if (!p.trasladoEntrada && p.estado === 'cancelado') {
            html += `<p class="text-sm text-slate-400 py-3">Este pedido se canceló antes de confirmarse el pago — nunca se generó traslado.</p>`;
        }

        cont.innerHTML = html;

        document.getElementById('btn-asignar-tienda')?.addEventListener('click', async function () {
            const idTiendaFacturacion = document.getElementById('select-tienda-asignar').value;
            if (!idTiendaFacturacion) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Selecciona una tienda' });
                return;
            }
            this.disabled = true;
            try {
                const res = await fetch(`/admin/web/pedidos/${idPedidoActual()}/asignar-tienda`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idTiendaFacturacion, _csrf: document.querySelector('[name=_csrf]').value })
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof Swal !== 'undefined') await Swal.fire({ icon: 'success', title: data.mensaje, timer: 1800, showConfirmButton: false });
                    cargarPedido();
                } else {
                    this.disabled = false;
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje });
                }
            } catch {
                this.disabled = false;
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error de red' });
            }
        });
    }

    function renderSeguimiento(p) {
        const cont = document.getElementById('seguimiento-contenido');
        if (!cont) return;

        if (p.estado === 'cancelado') {
            cont.innerHTML = `
                <div class="flex items-center gap-3 text-red-600">
                    <i class="fi fi-rr-cross-circle text-2xl"></i>
                    <div>
                        <p class="font-bold text-sm">Pedido cancelado</p>
                        ${p.razonRechazo ? `<p class="text-xs text-red-400">${p.razonRechazo}</p>` : ''}
                    </div>
                </div>`;
            return;
        }

        const pasos = [
            { label: 'Pedido realizado', icon: 'fi-rr-shopping-bag', hecho: true },
            { label: 'Pago confirmado', icon: 'fi-rr-credit-card', hecho: p.estado !== 'pendiente_pago' },
            { label: 'Trasladado a tienda', icon: 'fi-rr-shop', hecho: !!p.idTiendaFacturacion },
            { label: 'Facturado / Despachado', icon: 'fi-rr-receipt', hecho: p.estado === 'facturado' }
        ];

        cont.innerHTML = `
            <div class="flex items-start justify-between">
                ${pasos.map((paso, i) => `
                    <div class="flex-1 flex flex-col items-center text-center relative">
                        ${i > 0 ? `<div class="absolute top-5 right-1/2 w-full h-0.5 ${pasos[i].hecho && pasos[i - 1].hecho ? 'bg-gh-primary' : 'bg-slate-200'}" style="left:-50%;"></div>` : ''}
                        <div class="w-10 h-10 rounded-full flex items-center justify-center relative z-10 ${paso.hecho ? 'bg-gh-primary text-white' : 'bg-slate-100 text-slate-300'}">
                            <i class="fi ${paso.icon}"></i>
                        </div>
                        <p class="text-xs font-bold mt-2 ${paso.hecho ? 'text-slate-700' : 'text-slate-400'}">${paso.label}</p>
                        <p class="text-[11px] ${paso.hecho ? 'text-emerald-500' : 'text-slate-300'}">${paso.hecho ? 'Completado' : 'Pendiente'}</p>
                    </div>`).join('')}
            </div>`;
    }

    // Cronómetro del header: cuánto lleva el pedido en su estado actual. Se reinicia en cada
    // recarga del detalle (por ejemplo al asignar tienda), porque ahí puede haber cambiado el estado.
    let timerCronometro = null;
    let pintarCronometro = null;

    function arrancarCronometro(p) {
        const caja = document.getElementById('pedido-cronometro');
        if (!caja) return;
        if (timerCronometro) clearInterval(timerCronometro);

        const desde = p.fechaCambioEstado || p.createdAt;
        if (!desde) { caja.classList.add('hidden'); return; }

        caja.classList.remove('hidden');
        caja.classList.add('flex');

        const etiquetaEstado = (ESTADO_MAP[p.estado] || {}).label || p.estado;
        const { fecha, hora } = fmtFechaHora(desde);
        document.getElementById('cronometro-desde').textContent = `en "${etiquetaEstado}" desde ${fecha}, ${hora}`;

        pintarCronometro = () => {
            const el = document.getElementById('cronometro-valor');
            if (el) el.textContent = tiempoTranscurrido(desde);
        };
        pintarCronometro();
        timerCronometro = setInterval(pintarCronometro, 1000);
    }

    // Con la pestaña en segundo plano el navegador frena los intervalos; al volver se repinta
    // de inmediato para que no se quede mostrando un valor viejo.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && pintarCronometro) pintarCronometro();
    });

    async function cargarPedido() {
        const id = idPedidoActual();
        if (!id) return;

        try {
            const res = await fetch(`/admin/web/pedidos/${id}/json`);
            const json = await res.json();
            if (!json.success) {
                document.getElementById('detalle-pedido-root').innerHTML = `<p class="text-center text-red-400 py-16 text-sm">${json.mensaje}</p>`;
                return;
            }

            const p = json.pedido;
            const { fecha, hora } = fmtFechaHora(p.createdAt);
            const wa = linkWhatsapp(p.telefono);

            document.getElementById('pedido-numero').textContent = `Pedido #${p.numeroPedido}`;
            document.getElementById('pedido-badge-estado').innerHTML = estadoBadgeHtml(p.estado);
            document.getElementById('pedido-fecha-realizado').textContent = `Realizado el ${fecha} a las ${hora}`;
            arrancarCronometro(p);

            document.getElementById('cliente-nombre').textContent = p.tipoPersona === 'J' && p.razonSocial
                ? p.razonSocial
                : p.nombreCliente;

            // Identificación: sin ella la tienda no puede facturar el pedido.
            const docEl = document.getElementById('cliente-documento');
            if (p.cedula) {
                const etiqueta = ETIQUETA_DOC[p.tipoDocumento] || p.tipoDocumento || 'Doc.';
                const dv = p.digitoVerif ? `-${p.digitoVerif}` : '';
                docEl.textContent = `${etiqueta} ${p.cedula}${dv}`;
                docEl.classList.remove('text-red-500');
            } else {
                docEl.textContent = 'Sin identificación registrada';
                docEl.classList.add('text-red-500');
            }

            document.getElementById('cliente-email').textContent = p.email;
            document.getElementById('cliente-tel-wrap').innerHTML = `
                ${p.telefono || '—'}
                ${wa ? `<a href="${wa}" target="_blank" rel="noopener" class="text-emerald-500"><i class="fi fi-brands-whatsapp"></i></a>` : ''}`;

            const entregaEl = document.getElementById('cliente-entrega');
            if (p.tipoEntrega === 'domicilio') {
                entregaEl.innerHTML = `
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-3 mb-1">Dirección de entrega</p>
                    <p class="text-sm text-slate-700">${[p.direccion, p.apto].filter(Boolean).join(', ')}</p>
                    ${p.notasEntrega ? `<p class="text-xs text-slate-400">Referencia: ${p.notasEntrega}</p>` : ''}
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-3 mb-1">Ciudad / Departamento</p>
                    <p class="text-sm text-slate-700">${[p.ciudad, p.departamento].filter(Boolean).join(', ')}</p>`;
            } else {
                entregaEl.innerHTML = `
                    <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mt-3 mb-1">Recoge en tienda</p>
                    <p class="text-sm text-slate-700">${p.puntoRecogida?.nombre || '—'}</p>
                    <p class="text-xs text-slate-400">${p.puntoRecogida?.direccion || ''}</p>`;
            }

            const ultimoPago = p.pagos[p.pagos.length - 1];
            document.getElementById('pago-metodo').innerHTML = metodoPagoHtml(p, ultimoPago);
            document.getElementById('pago-estado').innerHTML = ultimoPago
                ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${ultimoPago.estado === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : ultimoPago.estado === 'DECLINED' || ultimoPago.estado === 'ERROR' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}">${ultimoPago.estado}</span>`
                : '<span class="text-xs text-slate-400">Sin intentos de pago</span>';
            document.getElementById('pago-total').textContent = fmtCOP(p.total);
            document.getElementById('pago-referencia').textContent = ultimoPago?.referencia || '—';
            const fechaPago = ultimoPago?.fechaConfirmacion ? fmtFechaHora(ultimoPago.fechaConfirmacion) : null;
            document.getElementById('pago-fecha').textContent = fechaPago ? `${fechaPago.fecha} · ${fechaPago.hora}` : '—';

            document.getElementById('resumen-numero').textContent = p.numeroPedido;
            document.getElementById('resumen-estado').innerHTML = estadoBadgeHtml(p.estado);
            document.getElementById('resumen-productos').textContent = p.items.length;
            document.getElementById('resumen-unidades').textContent = p.items.reduce((s, it) => s + Number(it.cantidad), 0);
            document.getElementById('resumen-total').textContent = fmtCOP(p.total);

            document.getElementById('productos-tbody').innerHTML = p.items.map(itemFila).join('');

            renderTraslado(p);
            renderSeguimiento(p);

            const btnCancelar = document.getElementById('btn-cancelar-pedido');
            if (btnCancelar) btnCancelar.classList.toggle('hidden', p.estado === 'facturado' || p.estado === 'cancelado');
        } catch (e) {
            console.error(e);
        }
    }

    async function cancelarPedido() {
        const { value: razonRechazo } = await Swal.fire({
            icon: 'warning',
            title: '¿Cancelar este pedido?',
            html: `
                <p style="text-align:left; font-size:13px; color:#64748b; margin-bottom:10px;">
                    Esta acción no se puede deshacer.
                </p>
                <p style="text-align:left; font-size:13px; background:#FEF3C7; color:#92400E; padding:8px 12px; border-radius:8px;">
                    <strong>⚠️ Lo que escribas abajo lo va a leer el cliente</strong> — se lo enviamos por correo como motivo de la cancelación. Sé claro y respetuoso.
                </p>`,
            input: 'textarea',
            inputPlaceholder: 'Ej: No contamos con stock suficiente para completar tu pedido...',
            inputAttributes: { 'aria-label': 'Motivo de la cancelación' },
            inputValidator: (value) => (!value || !value.trim()) && 'Tenés que indicar el motivo de la cancelación.',
            showCancelButton: true,
            confirmButtonText: 'Cancelar pedido',
            cancelButtonText: 'Volver',
            confirmButtonColor: '#ef4444'
        });
        if (!razonRechazo) return;

        const res = await fetch(`/admin/web/pedidos/${idPedidoActual()}/cancelar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ razonRechazo, _csrf: document.querySelector('[name=_csrf]').value })
        });
        const data = await res.json();
        if (data.success) {
            await Swal.fire({ icon: 'success', title: 'Pedido cancelado', text: 'Le enviamos un correo al cliente con el motivo.', timer: 2200, showConfirmButton: false });
            cargarPedido();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('detalle-pedido-root')) return;
        document.getElementById('btn-cancelar-pedido')?.addEventListener('click', cancelarPedido);
        cargarPedido();
    });
})();
