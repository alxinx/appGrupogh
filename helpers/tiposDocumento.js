// Tipos de documento de identidad: la lógica alrededor del catálogo.
//
// El catálogo en sí vive en src/json/tipoIdentificacionPersonas.json —la única lista de tipos
// del proyecto—; de acá salen las de clientes, proveedores, empleados, el POS y el checkout
// web. Este módulo agrega cómo se valida cada número, para que un documento se valide igual
// en todos lados. Cada entidad acota la lista a lo que acepta su columna (ver
// TIPOS_DOCUMENTO_PROVEEDOR abajo y los empleados en adminControllers.js).
import catalogo from '../src/json/tipoIdentificacionPersonas.json' with { type: 'json' };

/** El JSON tal cual ({ codigo, descripcion }), para las vistas que ya lo usan así. */
export const CATALOGO_TIPOS_DOCUMENTO = catalogo;

export const TIPOS_DOCUMENTO = catalogo.map(t => ({ valor: t.codigo, etiqueta: t.descripcion }));

export const CODIGOS_TIPO_DOCUMENTO = TIPOS_DOCUMENTO.map(t => t.valor);

// Un proveedor contrata con la empresa, y un menor de edad no puede contratar: si el
// proveedor es menor, se registra a nombre de su padre, madre o tutor legal, con la cédula
// de esa persona. Por eso la tarjeta de identidad no es un documento válido para proveedores.
export const TIPOS_DOCUMENTO_PROVEEDOR = TIPOS_DOCUMENTO.filter(t => t.valor !== 'TI');
export const CODIGOS_TIPO_DOCUMENTO_PROVEEDOR = TIPOS_DOCUMENTO_PROVEEDOR.map(t => t.valor);

// Forma del número de cada tipo, ya normalizado (sin espacios, puntos ni guiones, en
// mayúsculas). El NIT va SIN dígito de verificación.
export const FORMATO_DOCUMENTO = {
    CC:  /^\d{5,10}$/,
    TI:  /^\d{8,11}$/,
    NIT: /^\d{6,10}$/,
    CE:  /^[A-Z0-9]{4,12}$/,
    PP:  /^[A-Z0-9]{5,15}$/,
    PPT: /^[A-Z0-9]{5,15}$/,
    PEP: /^[A-Z0-9]{5,15}$/
};

/** '900.123.456' → '900123456'; ' ab-12 ' → 'AB12'. */
export const normalizarNumeroDocumento = (v) =>
    (typeof v === 'string' ? v : String(v ?? '')).replace(/[\s.-]/g, '').toUpperCase();

/**
 * Valida tipo + número. Devuelve `{ tipoDocumento, numero }` normalizados o `{ error }` con
 * un mensaje listo para mostrar. `permitidos` acota los tipos (los proveedores no aceptan TI).
 */
export const validarDocumento = (tipoRaw, numeroRaw, permitidos = CODIGOS_TIPO_DOCUMENTO) => {
    const tipoDocumento = String(tipoRaw ?? '').trim().toUpperCase();
    if (tipoDocumento === 'TI' && !permitidos.includes('TI')) {
        return { error: 'Un menor de edad no puede ser proveedor: regístralo con la cédula de su padre, madre o tutor legal.' };
    }
    if (!permitidos.includes(tipoDocumento)) return { error: 'Tipo de documento inválido.' };

    // Un NIT escrito con su dígito de verificación ("900123456-7") trae el guion: se avisa
    // en vez de pegarlo, porque 9001234567 sería otro NIT.
    if (tipoDocumento === 'NIT' && /-\s*\d\s*$/.test(String(numeroRaw ?? '').trim())) {
        return { error: 'Escribe el NIT sin el dígito de verificación (sin el número después del guion).' };
    }

    const numero = normalizarNumeroDocumento(numeroRaw);
    if (!numero) return { error: 'Ingresa el número de documento.' };
    if (!FORMATO_DOCUMENTO[tipoDocumento].test(numero)) return { error: 'El número no tiene el formato de ese tipo de documento.' };
    return { tipoDocumento, numero };
};
