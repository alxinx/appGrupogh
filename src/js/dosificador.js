/**
 * Algoritmo de Kitting Proporcional para Grupo GH — reparto por déficit acumulado contra
 * una curva objetivo fija (el mismo principio que usan los balanceadores de carga tipo
 * "smooth weighted round-robin"): en cada bolsa, la siguiente unidad se la lleva quien esté
 * más atrasado respecto de su proporción ideal acumulada hasta esa bolsa, no quien tenga
 * más stock ni quien tenga el mayor residuo de ESA bolsa en particular.
 *
 * Único lugar donde vive este cálculo: lo usan tanto la vista previa del formulario
 * (dataDose.js, "Plan de Empaque Sugerido") como la creación real de bultos
 * (dosificacionController.js) para que lo que el usuario ve antes de guardar sea
 * exactamente lo que queda persistido.
 *
 * Por qué esta versión y no "el hueco se lo lleva quien tiene más stock" ni "quien tiene
 * mayor residuo en esta bolsa" (dos versiones anteriores, ambas con el mismo problema de
 * fondo): las dos recalculan la proporción sobre el STOCK RESTANTE en cada bolsa. Un
 * producto con proporción chica frente al resto (ej. un color con poca cantidad) tiene una
 * proporción pequeña en TODAS las bolsas tempranas, así que nunca gana el desempate hasta
 * que los productos grandes se agotan lo suficiente — queda ausente de la mayoría de las
 * bolsas y aparece recién al final, muy concentrado. Acá la meta de cada producto se fija
 * una sola vez sobre el total ORIGINAL y se compara contra lo que ya se le asignó: apenas
 * se atrasa respecto a su propia curva, la siguiente unidad es suya. Esto reparte cada
 * producto lo más parejo posible a lo largo de TODAS las bolsas desde la primera.
 *
 * @param {Object} productos - Mapa idProducto (o sku) -> cantidad TOTAL disponible. El
 *   llamador es responsable de sumar cantidades si el mismo producto aparece repetido en
 *   el origen (dos filas del formulario, dos entradas del payload): acá se asume que el
 *   mapa ya viene consolidado, una sola clave por producto.
 * @param {Number} capacidad - Unidades por bolsa.
 */
export const calcularKitting = (productos, capacidad) => {
    const idsBase = Object.keys(productos).filter((id) => productos[id] > 0);
    const totalUnidades = idsBase.reduce((acc, id) => acc + productos[id], 0);
    const numPacksCompletos = Math.floor(totalUnidades / capacidad);

    // Meta fija por bolsa: cuántas unidades de este producto "deberían" llevar el
    // promedio de bolsas, calculada una sola vez sobre el total original — no se
    // recalcula sobre el stock restante, que es justo lo que rompía el reparto.
    const pesoPorBolsa = {};
    idsBase.forEach((id) => { pesoPorBolsa[id] = (productos[id] / totalUnidades) * capacidad; });

    const restante = { ...productos };
    const acumulado = {};
    idsBase.forEach((id) => { acumulado[id] = 0; });

    const planEmpaque = [];
    for (let bolsaIdx = 1; bolsaIdx <= numPacksCompletos; bolsaIdx++) {
        // Rota el orden de recorrido bolsa a bolsa: si dos productos empatan en déficit,
        // el que gane el desempate no es siempre el mismo.
        const offset = bolsaIdx % idsBase.length;
        const ids = [...idsBase.slice(offset), ...idsBase.slice(0, offset)];

        const bolsa = {};
        let asignados = 0;
        while (asignados < capacidad) {
            let elegido = null;
            let mejorDeficit = -Infinity;
            for (const id of ids) {
                if (restante[id] <= 0) continue;
                const metaAcumulada = pesoPorBolsa[id] * bolsaIdx;
                const deficit = metaAcumulada - acumulado[id];
                if (deficit > mejorDeficit) {
                    mejorDeficit = deficit;
                    elegido = id;
                }
            }
            // No debería pasar (numPacksCompletos garantiza stock suficiente), pero corta
            // el loop si en algún escenario no queda nada que asignar.
            if (!elegido) break;

            bolsa[elegido] = (bolsa[elegido] || 0) + 1;
            acumulado[elegido]++;
            restante[elegido]--;
            asignados++;
        }
        planEmpaque.push(bolsa);
    }

    return {
        packs: agruparConfiguraciones(planEmpaque),
        residuo: Object.fromEntries(Object.entries(restante).filter(([, v]) => v > 0))
    };
};

/**
 * Agrupa bolsas idénticas para que el operario lea: "Haga 75 bolsas de este tipo"
 */
function agruparConfiguraciones(packs) {
    const grupos = {};
    packs.forEach((p) => {
        const key = JSON.stringify(Object.fromEntries(Object.entries(p).sort()));
        grupos[key] = (grupos[key] || 0) + 1;
    });
    return Object.entries(grupos).map(([config, cantidad]) => ({
        cantidad,
        detalle: JSON.parse(config)
    }));
}
