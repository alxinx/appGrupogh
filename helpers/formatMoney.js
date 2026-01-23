export const money = (n, decimals = 0) => {
  return Number(n).toLocaleString('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};


