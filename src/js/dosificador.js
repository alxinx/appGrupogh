/**
 * Algoritmo de Kitting Proporcional para Grupo GH
 * @param {Object} productos - Ej: { 'A': 233, 'B': 533... }
 * @param {Number} capacidad - Ej: 12
 */
export const calcularKitting = (productos, capacidad) => {
    let stock = { ...productos };
    let totalUnidades = Object.values(stock).reduce((a, b) => a + b, 0);
    let numPacksCompletos = Math.floor(totalUnidades / capacidad);
    
    let planEmpaque = [];

    for (let i = 0; i < numPacksCompletos; i++) {
        let bolsa = {};
        let totalEnBolsa = 0;
        let stockRestanteBolsa = Object.values(stock).reduce((a, b) => a + b, 0);

        // 1. Asignación obligatoria (Piso proporcional)
        Object.keys(stock).forEach(sku => {
            let proporcion = stock[sku] / stockRestanteBolsa;
            let asignacion = Math.floor(proporcion * capacidad);
            
            // No asignar más de lo que hay en stock
            asignacion = Math.min(asignacion, stock[sku]);
            
            bolsa[sku] = asignacion;
            totalEnBolsa += asignacion;
            stock[sku] -= asignacion;
        });

        // 2. Reparto de huecos (Rounding por prioridad de stock)
        while (totalEnBolsa < capacidad) {
            // Buscamos el producto que más stock tiene actualmente para llenar el hueco
            let skuPrioridad = Object.keys(stock).reduce((a, b) => stock[a] > stock[b] ? a : b);
            
            if (stock[skuPrioridad] > 0) {
                bolsa[skuPrioridad]++;
                stock[skuPrioridad]--;
                totalEnBolsa++;
            } else {
                break; // No hay más stock para llenar la bolsa
            }
        }
        planEmpaque.push(bolsa);
    }

    // 3. El residuo es lo que quedó en el stock
    let residuo = Object.fromEntries(Object.entries(stock).filter(([_, v]) => v > 0));

    return {
        packs: agruparConfiguraciones(planEmpaque),
        residuo
    };
};

/**
 * Agrupa bolsas idénticas para que el operario lea: "Haga 75 bolsas de este tipo"
 */
function agruparConfiguraciones(packs) {
    const grupos = {};
    packs.forEach(p => {
        const key = JSON.stringify(p);
        grupos[key] = (grupos[key] || 0) + 1;
    });
    return Object.entries(grupos).map(([config, cantidad]) => ({
        cantidad,
        detalle: JSON.parse(config)
    }));
}