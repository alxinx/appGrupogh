// Estado de un traslado en el panel admin, con la pastilla de /admin/bankentities (punto +
// texto). Un solo mapa para el listado de /admin/traslados y la pestaña de traslados de una
// tienda, que antes tenían cada uno sus colores.
const ESTADOS = {
    PENDIENTE:       { texto: 'Pendiente',       pill: 'bg-slate-100 text-slate-600',     punto: 'bg-slate-400' },
    EN_TRANSITO:     { texto: 'En tránsito',     pill: 'bg-blue-100 text-blue-700',       punto: 'bg-blue-500' },
    EN_CONTROVERSIA: { texto: 'En controversia', pill: 'bg-amber-100 text-amber-700',     punto: 'bg-amber-500' },
    RECIBIDO:        { texto: 'Recibido',        pill: 'bg-emerald-100 text-emerald-600', punto: 'bg-emerald-500' },
    DEVUELTO:        { texto: 'Devuelto',        pill: 'bg-slate-100 text-slate-600',     punto: 'bg-slate-400' },
    ANULADO:         { texto: 'Anulado',         pill: 'bg-pink-100 text-pink-700',       punto: 'bg-pink-500' }
};

export const pillEstadoTraslado = (estado) => {
    const e = ESTADOS[estado] || { texto: estado || '—', pill: 'bg-slate-100 text-slate-500', punto: 'bg-slate-400' };
    return `<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${e.pill}"><span class="w-1.5 h-1.5 rounded-full ${e.punto} mr-2"></span>${e.texto}</span>`;
};
