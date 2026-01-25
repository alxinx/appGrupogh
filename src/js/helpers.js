window.formatMoney = (n, decimals = 0) => {
    // Usamos es-CO para que coincida con el formato de Colombia del Grupo GH
    return Number(n).toLocaleString('es-CO', {
        style: 'currency', // Opcional: añade el signo $ automáticamente
        currency: 'COP',    // Opcional
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};