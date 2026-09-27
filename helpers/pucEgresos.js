import { PucEgresos } from '../models/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// PUC de egresos: lo que comparten el formulario de egresos de la tienda y el de
// movimientos de una caja o banco del admin.
//
// Un gasto se clasifica en una SUBCUENTA (6 dígitos, ej. 510506 Sueldos), nunca en una
// cuenta (4 dígitos): es el nivel en que se asienta un gasto en el PUC. Solo se ofrecen
// y se aceptan las activas, y una subcuenta cuya cuenta está desactivada tampoco: al
// desactivar la cuenta se retira todo lo que cuelga de ella.
// ─────────────────────────────────────────────────────────────────────────────

// Subcuentas activas agrupadas bajo su cuenta, en orden de código, para el <select>
// (views/components/selectPucEgreso.pug). Dos consultas fijas, sin importar cuántas
// cuentas haya.
export const listarSubcuentasPuc = async () => {
    const [cuentas, subcuentas] = await Promise.all([
        PucEgresos.findAll({
            where: { tipo: 'cuenta', activo: true },
            attributes: ['id', 'codigo', 'nombre'],
            order: [['codigo', 'ASC']],
            raw: true
        }),
        PucEgresos.findAll({
            where: { tipo: 'subcuenta', activo: true },
            attributes: ['id', 'codigo', 'nombre', 'padre'],
            order: [['codigo', 'ASC']],
            raw: true
        })
    ]);

    const porCuenta = new Map(cuentas.map((c) => [c.id, { ...c, subcuentas: [] }]));
    subcuentas.forEach((s) => porCuenta.get(s.padre)?.subcuentas.push(s));
    // Una cuenta sin subcuentas activas no aporta nada que elegir.
    return [...porCuenta.values()].filter((c) => c.subcuentas.length);
};

// La validación del servidor: devuelve la subcuenta si `id` es una subcuenta activa de
// una cuenta activa, o null. Lo que venga del navegador no se da por bueno — el <select>
// solo muestra las válidas, pero la petición puede armarse a mano o la subcuenta pudo
// desactivarse con el formulario abierto.
//
// El id es INTEGER, así que acá sí corresponde parseInt (a diferencia de un UUID).
export const subcuentaPucValida = async (id, transaction = undefined) => {
    const n = Number.parseInt(id, 10);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== String(id).trim()) return null;
    return PucEgresos.findOne({
        where: { id: n, tipo: 'subcuenta', activo: true },
        attributes: ['id', 'codigo', 'nombre'],
        include: [{
            model: PucEgresos, as: 'cuentaPadre',
            where: { activo: true }, required: true,
            attributes: ['codigo', 'nombre']
        }],
        transaction
    });
};

export const MENSAJE_PUC_REQUERIDA = 'Elegí la cuenta PUC en la que se clasifica el egreso.';

// Para los listados: el include que trae la subcuenta de un egreso o de un movimiento
// (los dos modelos la asocian como `pucEgreso`) y cómo se muestra. `required: false`
// porque lo registrado antes de la clasificación, las transferencias y los ingresos no
// tienen cuenta, y un INNER JOIN los sacaría del listado.
export const INCLUDE_PUC = { model: PucEgresos, as: 'pucEgreso', attributes: ['codigo', 'nombre'], required: false };
export const etiquetaPuc = (puc) => (puc ? `${puc.codigo} · ${puc.nombre}` : null);
