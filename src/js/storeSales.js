// storeSales.js — Módulo "Mis Ventas" (ventas del mes + detalle del día)

const fmt = (n) =>
    '$ ' + Math.round(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtFecha = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

const hoyStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
})();

let detalleActualFecha = hoyStr;
let detalleActualPage  = 1;
let detalleTotalPages  = 1;

// ── Helpers DOM ──────────────────────────────────────────────────────────────

const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

function estadoBadge(estado) {
    const map = {
        abierto:   ['Abierta',   'bg-green-100 text-green-700'],
        cerrado:   ['Cerrada',   'bg-slate-100 text-slate-600'],
        auditoria: ['Auditoría', 'bg-amber-100 text-amber-700']
    };
    const [label, cls] = map[estado] || ['—', 'bg-slate-100 text-slate-500'];
    return `<span class="inline-block px-2 py-0.5 rounded-lg text-[11px] font-semibold ${cls}">${label}</span>`;
}

// ── Renderizar tabla de ventas del mes ────────────────────────────────────────

function renderTabla(ventas) {
    const tbody = document.getElementById('sv-tbody');
    if (!tbody) return;

    if (!ventas || ventas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400 text-sm">
            No hay ventas registradas en el período seleccionado.</td></tr>`;
        return;
    }

    tbody.innerHTML = ventas.map(v => {
        const esHoy = v.fecha === hoyStr;
        const fechaCell = esHoy
            ? `<span class="font-bold" style="color:#EC5FA3">${fmtFecha(v.fecha)}</span>
               <span class="ml-1 inline-block px-1.5 py-0 rounded-md text-[10px] font-bold text-white" style="background:#EC5FA3">HOY</span>`
            : `<span class="text-slate-700">${fmtFecha(v.fecha)}</span>`;

        return `<tr class="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
            <td class="px-4 py-3 text-sm whitespace-nowrap">${fechaCell}</td>
            <td class="px-4 py-3">${estadoBadge(v.estadoCaja)}</td>
            <td class="px-4 py-3 text-sm text-right font-mono text-slate-700">${fmt(v.efectivo)}</td>
            <td class="px-4 py-3 text-sm text-right font-mono text-slate-700">${fmt(v.electronico)}</td>
            <td class="px-4 py-3 text-sm text-right font-mono text-slate-700">${fmt(v.credito)}</td>
            <td class="px-4 py-3 text-sm text-right font-mono text-rose-500">${fmt(v.egresos)}</td>
            <td class="px-4 py-3 text-sm text-right font-bold text-slate-800">${fmt(v.total)}</td>
            <td class="px-4 py-3 text-center">
                <button
                    type="button"
                    class="sv-btn-ver w-8 h-8 rounded-xl flex items-center justify-center mx-auto transition-all hover:scale-110"
                    style="color:#EC5FA3"
                    data-fecha="${v.fecha}"
                    title="Ver detalle de ${fmtFecha(v.fecha)}"
                >
                    <i class="fi fi-rr-eye text-base"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    // Eventos en botones "Ver"
    tbody.querySelectorAll('.sv-btn-ver').forEach(btn => {
        btn.addEventListener('click', () => {
            const fecha = btn.dataset.fecha;
            cargarDetalle(fecha, 1);
        });
    });
}

// ── Renderizar panel derecho ──────────────────────────────────────────────────

function renderPanel(data) {
    const { fecha, esHoy, resumen, facturas, totalFacturas, page, totalPages, idCajaTienda } = data;

    detalleActualFecha = fecha;
    detalleActualPage  = page;
    detalleTotalPages  = totalPages;

    set('sv-r-efectivo',    fmt(resumen.efectivo));
    set('sv-r-electronico', fmt(resumen.electronico));
    set('sv-r-credito',     fmt(resumen.credito));
    set('sv-r-egresos',     fmt(resumen.egresos));
    set('sv-r-total',       fmt(resumen.total));

    const labelFecha = esHoy ? `Hoy [${fmtFecha(fecha)}]` : `[${fmtFecha(fecha)}]`;
    set('sv-r-fecha-tag',   `Actualizado: ${labelFecha}`);
    set('sv-r-fecha-label', labelFecha);

    // Botón imprimir cierre — solo en días pasados con caja cerrada
    const btnPrint = document.getElementById('sv-btn-imprimir');
    if (btnPrint) {
        if (!esHoy && idCajaTienda) {
            btnPrint.href = `/store/storebehivors/caja/${idCajaTienda}/pdf`;
            btnPrint.classList.remove('hidden');
        } else {
            btnPrint.classList.add('hidden');
        }
    }

    const lista = document.getElementById('sv-lista-facturas');
    if (lista) {
        if (page === 1) {
            lista.innerHTML = '';
        }

        if (facturas.length === 0 && page === 1) {
            lista.innerHTML = `<div class="flex flex-col items-center justify-center py-10 text-slate-400 text-sm gap-2">
                <i class="fi fi-rr-document text-2xl"></i>
                <span>Sin movimientos registrados</span>
            </div>`;
        } else {
            facturas.forEach(f => {
                const item = document.createElement('div');
                item.className = 'flex items-center gap-3 px-5 py-3.5';
                item.innerHTML = `
                    <div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <i class="fi fi-rr-receipt text-slate-400 text-sm"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold text-slate-800 truncate">${f.nroFactura ? '#' + f.nroFactura : '(sin número)'}</p>
                        <p class="text-xs text-slate-400 truncate">${f.cliente}</p>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <p class="text-sm font-semibold text-slate-700">${fmt(f.total)}</p>
                        <a
                            href="/store/facturas/${f.idFacturaCliente}/tirilla"
                            target="_blank"
                            class="text-[10px] font-bold uppercase tracking-wider hover:underline"
                            style="color:#EC5FA3"
                        >Ver Factura</a>
                    </div>`;
                lista.appendChild(item);
            });
        }
    }

    const btnMas = document.getElementById('sv-btn-mas');
    if (btnMas) {
        btnMas.classList.toggle('hidden', page >= totalPages);
    }
}

// ── Fetch ventas del mes ──────────────────────────────────────────────────────

async function cargarVentasMes() {
    const fechaA = document.getElementById('sv-fecha-a')?.value || '';
    const fechaB = document.getElementById('sv-fecha-b')?.value || '';

    const tbody = document.getElementById('sv-tbody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400 text-sm">
            <i class="fi fi-rr-spinner animate-spin mr-2"></i>Cargando ventas...</td></tr>`;
    }

    try {
        const params = new URLSearchParams();
        if (fechaA) params.set('fechaA', fechaA);
        if (fechaB) params.set('fechaB', fechaB);

        const resp = await fetch(`/store/storebehivors/sales/mes?${params}`);
        const data = await resp.json();

        if (data.success) {
            renderTabla(data.ventas);
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-rose-400 text-sm">Error al cargar los datos.</td></tr>`;
        }
    } catch {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-rose-400 text-sm">Error de conexión.</td></tr>`;
    }
}

// ── Fetch detalle del día ─────────────────────────────────────────────────────

async function cargarDetalle(fecha, page) {
    try {
        const params = new URLSearchParams({ fecha, page });
        const resp = await fetch(`/store/storebehivors/sales/dia?${params}`);
        const data = await resp.json();

        if (data.success) {
            renderPanel(data);
        }
    } catch {
        // silencioso
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Poner fechas por defecto: primer día del mes → hoy
    const hoyDate = new Date();
    const primerDia = `${hoyDate.getFullYear()}-${String(hoyDate.getMonth() + 1).padStart(2, '0')}-01`;
    const hoyISO    = hoyStr;

    const inputA = document.getElementById('sv-fecha-a');
    const inputB = document.getElementById('sv-fecha-b');
    if (inputA) inputA.value = primerDia;
    if (inputB) inputB.value = hoyISO;

    // Botón filtrar
    document.getElementById('sv-btn-filtrar')?.addEventListener('click', cargarVentasMes);

    // Botón cargar más
    document.getElementById('sv-btn-mas')?.addEventListener('click', () => {
        if (detalleActualPage < detalleTotalPages) {
            cargarDetalle(detalleActualFecha, detalleActualPage + 1);
        }
    });

    // Carga inicial
    cargarVentasMes();
    cargarDetalle(hoyStr, 1);
});
