/**
 * Algoritmo de Kitting para Grupo GH — reparto round-robin sobre la secuencia de unidades.
 *
 * Se ponen todas las unidades en fila, producto tras producto en el orden en que se
 * cargaron, y la unidad i va a la bolsa (i mod B), donde B es la cantidad de bolsas
 * completas. Nada más. De ahí sale la garantía que importa: cada producto queda en todas
 * las bolsas con `piso` o `techo` unidades —floor(q/B) o ceil(q/B)— y nunca con dos valores
 * que difieran en más de uno. Un color de 473 unidades en 362 bolsas va 1 en todas y 2 en
 * 111; uno de 125 va 1 en 125 bolsas y 0 en el resto. No hay forma de repartirlo más parejo.
 *
 * Único lugar donde vive este cálculo: lo usan tanto la vista previa del formulario
 * (dataDose.js, "Plan de Empaque Sugerido") como la creación real de bultos
 * (dosificacionController.js) para que lo que el usuario ve antes de guardar sea
 * exactamente lo que queda persistido.
 *
 * Reemplazó a un reparto por déficit acumulado contra una curva proporcional, que se
 * acercaba pero no cumplía piso/techo: con 15 variaciones (4.344 unidades, 362 bolsas)
 * metía 2 unidades de un color que no llega ni a 1 por bolsa, dejaba a otro fuera de 14
 * bolsas, y sobre todo generaba 157 configuraciones distintas contra las 15 de acá. Cada
 * configuración es un lote que alguien tiene que armar y que se pinta como tarjeta en
 * `dosificaciones/ver` y como bloque en la guía de empaque: 157 lotes para 362 bolsas era
 * casi una instrucción por bolsa. Antes de eso hubo dos versiones que recalculaban la
 * proporción sobre el stock RESTANTE en cada bolsa (Hamilton por bolsa y "el hueco es del
 * que más stock tiene"); las dos dejaban a los productos de menor proporción fuera de las
 * bolsas tempranas, concentrados al final.
 *
 * @param {Object} productos - Mapa idProducto (o sku) -> cantidad TOTAL disponible. El
 *   llamador es responsable de sumar cantidades si el mismo producto aparece repetido en
 *   el origen (dos filas del formulario, dos entradas del payload): acá se asume que el
 *   mapa ya viene consolidado, una sola clave por producto.
 * @param {Number} capacidad - Unidades por bolsa.
 * @returns {{packs: Array<{cantidad: number, detalle: Object}>, residuo: Object}} Bolsas
 *   agrupadas por configuración idéntica, y lo que no alcanzó a llenar una bolsa.
 */
export const calcularKitting = (productos, capacidad) => {
    // Una capacidad de 0 dejaba `numPacksCompletos` en Infinity y el bucle de bolsas no
    // terminaba nunca: como Node es de un solo hilo, un POST con capacidadBolsa 0 colgaba
    // la aplicación entera, con la transacción de la dosificación abierta. Falla acá, con
    // un motivo legible, en vez de girar para siempre.
    const cap = Number(capacidad);
    if (!Number.isInteger(cap) || cap <= 0) {
        throw new Error(`La capacidad de la bolsa debe ser un entero mayor a 0 (llegó "${capacidad}").`);
    }

    const idsBase = Object.keys(productos).filter((id) => productos[id] > 0);
    const totalUnidades = idsBase.reduce((acc, id) => acc + productos[id], 0);
    const numPacksCompletos = Math.floor(totalUnidades / cap);

    // Sin unidades para una bolsa completa no hay nada que repartir: todo es residuo.
    if (numPacksCompletos === 0) {
        return { packs: [], residuo: { ...productos } };
    }

    const unidadesEmpacables = numPacksCompletos * cap;
    const aEmpacar = repartirEmpacables(productos, idsBase, totalUnidades, unidadesEmpacables);

    // Round-robin: la unidad i de la secuencia (producto tras producto, en el orden de
    // entrada) va a la bolsa i % B. Como la secuencia tiene exactamente B*capacidad
    // unidades, cada bolsa recibe justo `capacidad`, y las q unidades de un producto caen en
    // bolsas consecutivas módulo B, o sea piso/techo en todas.
    const planEmpaque = Array.from({ length: numPacksCompletos }, () => ({}));
    let i = 0;
    for (const id of idsBase) {
        for (let k = 0; k < aEmpacar[id]; k++) {
            const bolsa = planEmpaque[i % numPacksCompletos];
            bolsa[id] = (bolsa[id] || 0) + 1;
            i++;
        }
    }

    const residuo = {};
    idsBase.forEach((id) => {
        const sobra = productos[id] - aEmpacar[id];
        if (sobra > 0) residuo[id] = sobra;
    });

    return { packs: agruparConfiguraciones(planEmpaque), residuo };
};

/**
 * Cuántas unidades de cada producto entran en las bolsas completas cuando el total no es
 * múltiplo de la capacidad.
 *
 * Se reparte por restos mayores (Hamilton) UNA sola vez sobre el lote entero: cada producto
 * se lleva la parte entera de su ideal y los huecos que quedan van a los que arrastran el
 * resto más grande. Aplicado así —al lote, no bolsa por bolsa— el método no tiene el defecto
 * que lo hace inservible dentro de una bolsa, y garantiza que las unidades que quedan afuera
 * salgan de los productos que están más por encima de su proporción, no de los últimos de la
 * lista, que es lo que pasaría cortando la secuencia por donde termina.
 */
function repartirEmpacables(productos, idsBase, totalUnidades, unidadesEmpacables) {
    const aEmpacar = {};
    const resto = {};
    idsBase.forEach((id) => {
        const ideal = (productos[id] * unidadesEmpacables) / totalUnidades;
        aEmpacar[id] = Math.floor(ideal);
        resto[id] = ideal - aEmpacar[id];
    });

    let huecos = unidadesEmpacables - idsBase.reduce((acc, id) => acc + aEmpacar[id], 0);
    // Mayor resto primero; el id desempata para que dos lotes iguales den el mismo plan.
    const porResto = [...idsBase].sort((a, b) => (resto[b] - resto[a]) || String(a).localeCompare(String(b)));
    for (const id of porResto) {
        if (huecos <= 0) break;
        if (aEmpacar[id] < productos[id]) { aEmpacar[id]++; huecos--; }
    }
    return aEmpacar;
}

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
