window.formatMoney = (n, decimals = 0) => {
    return Number(n).toLocaleString('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};

// Enlaza formato de miles (es-CO) a un <input type="text"> de dinero.
// Úsalo en cualquier campo donde el usuario ingrese valores en pesos.
window.initMoneyInput = (el) => {
    if (!el) return;
    el.addEventListener('input', function (e) {
        const cursor    = e.target.selectionStart;
        const original  = e.target.value;
        const digits    = original.replace(/\D/g, '');
        const formatted = digits ? new Intl.NumberFormat('es-CO').format(digits) : '';
        const diff      = formatted.length - original.length;
        e.target.value  = formatted;
        e.target.setSelectionRange(cursor + diff, cursor + diff);
    });
};

// Convierte un valor formateado ("78.000") o numérico a entero sin decimales.
window.parseMoney = (val) => parseInt(String(val).replace(/\D/g, ''), 10) || 0;