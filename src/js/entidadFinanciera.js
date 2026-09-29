// Filtra un select de bancos y billeteras (views/components/entidadFinanciera.pug) según el
// tipo elegido en su formulario. Acepta el tipo de ENTIDADES ('Banco', 'Billetera Virtual') o
// el de CAJAS_Y_BANCOS ('banco', 'billetera'). Si la opción elegida queda oculta, se limpia:
// un Nequi no puede quedar elegido en una cuenta de tipo banco.
const TIPO_CATALOGO = {
    banco: 'Banco', billetera: 'Billetera Virtual',
    'Banco': 'Banco', 'Billetera Virtual': 'Billetera Virtual'
};

window.filtrarEntidadesFinancieras = (select, tipo) => {
    if (!select) return;
    const buscado = TIPO_CATALOGO[tipo] || null;
    [...select.options].forEach(o => {
        if (!o.value) return;
        const visible = !buscado || o.dataset.tipo === buscado;
        o.hidden = !visible;
        o.disabled = !visible;
    });
    if (select.selectedOptions[0]?.hidden) select.value = '';
    select.buscable?.refresh();   // si es buscable (helpers.js), que el texto no quede viejo
};
