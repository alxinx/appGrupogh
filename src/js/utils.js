/**
 * Formatea un número a moneda colombiana (COP)
 */
export const formatMoney = (n, decimals = 0) => {
    if (isNaN(n) || n === null) return "0";
    return Number(n).toLocaleString('es-CO', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};

/**
 * Limpia un string de moneda para obtener solo el número
 * Útil para cálculos antes de enviar al servidor
 */
export const cleanMoney = (str) => {
    if (!str) return "0";
    // Eliminamos el símbolo de peso, los espacios y TODOS los puntos
    return str.replace(/[$\s.]/g, ''); 
};

