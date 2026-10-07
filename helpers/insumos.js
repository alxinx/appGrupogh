import { toPascal } from './clientes.js';

// Catálogo de Insumos y Materias Primas (admin/insumos). Una sola fuente para las opciones
// del formulario, los límites y la validación del alta: la vista recibe estas listas por
// locals y el navegador copia los límites desde los atributos del formulario, así que no
// hay una segunda lista escrita a mano en pug ni en JS (CLAUDE.md §2).
//
// Los valores de `tipo` y `unidadCompra` son los del ENUM de la tabla MATERIAL.

// `etiquetaNombre` es el rótulo del campo Nombre cuando se elige el tipo ("Nombre Insumo").
export const TIPOS_INSUMO = [
    { valor: 'materia_prima', etiqueta: 'Materia prima', etiquetaNombre: 'Materia Prima', detalle: 'Telas e hilos que se transforman en producto', icono: '/img/avatars/telita.webp' },
    { valor: 'insumo',        etiqueta: 'Insumo',        etiquetaNombre: 'Insumo',        detalle: 'Avíos y empaques que se consumen en el proceso', icono: '/img/avatars/insumos.webp' }
];

export const UNIDADES_COMPRA = [
    { valor: 'kg',     etiqueta: 'Kilogramo (kg)' },
    { valor: 'metro',  etiqueta: 'Metro' },
    { valor: 'rollo',  etiqueta: 'Rollo' },
    { valor: 'unidad', etiqueta: 'Unidad' }
];

// codigoMaterial es INT en MySQL: el tope es el máximo de un INT con signo.
export const LIMITES_INSUMO = { codigoMin: 1, codigoMax: 2147483647, nombreMax: 100 };

const ETIQUETA_TIPO = Object.fromEntries(TIPOS_INSUMO.map(t => [t.valor, t.etiqueta]));
const ICONO_TIPO = Object.fromEntries(TIPOS_INSUMO.map(t => [t.valor, t.icono]));
const ETIQUETA_UNIDAD = Object.fromEntries(UNIDADES_COMPRA.map(u => [u.valor, u.etiqueta]));

// Lo que la vista necesita de una fila: nada del modelo que no se pinte.
export const presentarMaterial = (m) => ({
    idMaterial:     m.idMaterial,
    codigoMaterial: m.codigoMaterial,
    nombre:         m.nombre,
    tipo:           m.tipo,
    tipoEtiqueta:   ETIQUETA_TIPO[m.tipo] ?? m.tipo,
    unidadCompra:   m.unidadCompra,
    unidadEtiqueta: ETIQUETA_UNIDAD[m.unidadCompra] ?? '—',
    activo:         Boolean(m.activo),
    icono:          ICONO_TIPO[m.tipo] ?? ICONO_TIPO.insumo
});

// Devuelve el código DXF como número, o null si no es un entero dentro de los límites. Lo usan
// la validación del alta y la consulta de duplicados, para que las dos digan lo mismo.
export const codigoDxfValido = (texto) => {
    const t = String(texto ?? '').trim();
    if (!/^\d{1,10}$/.test(t)) return null;
    const n = Number(t);
    return n >= LIMITES_INSUMO.codigoMin && n <= LIMITES_INSUMO.codigoMax ? n : null;
};

// Validación del alta. Devuelve `{ errores }` con un mensaje por campo, o `{ datos }` con
// solo los campos permitidos (whitelist: nada del body llega al modelo tal cual, §12).
export const validarInsumo = (body = {}) => {
    const errores = {};
    const { codigoMin, codigoMax, nombreMax } = LIMITES_INSUMO;

    const codigoTxt = String(body.codigoMaterial ?? '').trim();
    const codigoMaterial = codigoDxfValido(codigoTxt);
    if (!codigoTxt) {
        errores.codigoMaterial = 'Escribe el código del material, el número que trae el DXF.';
    } else if (codigoMaterial === null) {
        errores.codigoMaterial = `El código debe ser un número entero entre ${codigoMin} y ${codigoMax}.`;
    }

    const nombre = String(body.nombre ?? '').trim();
    if (!nombre) errores.nombre = 'Escribe el nombre del material.';
    else if (nombre.length > nombreMax) errores.nombre = `El nombre no puede pasar de ${nombreMax} caracteres.`;

    const tipo = String(body.tipo ?? '');
    if (!TIPOS_INSUMO.some(t => t.valor === tipo)) errores.tipo = 'Elige si es materia prima o insumo.';

    const unidadTxt = String(body.unidadCompra ?? '').trim();
    const unidadCompra = unidadTxt || null;
    if (unidadCompra && !UNIDADES_COMPRA.some(u => u.valor === unidadCompra)) {
        errores.unidadCompra = 'Elige una unidad de compra de la lista.';
    }

    if (Object.keys(errores).length) return { errores };
    // El nombre se guarda en formato de título (POLILICRA -> Polilicra) con el mismo helper que
    // usan clientes y proveedores, para que el catálogo no mezcle mayúsculas.
    return { datos: { codigoMaterial, nombre: toPascal(nombre), tipo, unidadCompra } };
};
