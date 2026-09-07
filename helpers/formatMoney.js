export const money = (n, decimals = 0) => {
  return Number(n).toLocaleString('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

// Pesos colombianos con símbolo y sufijo: "$45.900 COP". Vivía como `fmtCOP` dentro de
// helpers/mailPedidoCancelado.js, con su propio `toLocaleString` en paralelo al de acá.
export const moneyCOP = (n) => `$${money(Math.round(Number(n) || 0))} COP`;

// Redondeo a 2 decimales para cálculos intermedios en cascada (sumar/restar abonos,
// repartir un pago entre varias facturas) — evita que el residuo de punto flotante de
// JS (0.1 + 0.2 !== 0.3) se acumule vuelta tras vuelta. Antes vivía duplicado, idéntico,
// como `_round2` en storeControllers.js y `round2` en adminControllers.js.
export const round2 = (n) => parseFloat((Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2));


