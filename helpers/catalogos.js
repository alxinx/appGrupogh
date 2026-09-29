// Catálogos fijos del proyecto: el único punto de acceso del servidor a los de src/json/ que
// no tienen lógica propia. Los que sí la tienen viven en su helper —tipos de documento en
// helpers/tiposDocumento.js, CIIU en helpers/ciiu.js— y leen el JSON desde ahí.
//
// Nadie importa src/json/ directo (salvo src/js/pos.js, que corre en el navegador y webpack
// empaqueta el JSON en su bundle): así un filtro o un orden que se agregue acá llega a todos.
import responsabilidadFiscal from '../src/json/responsabilidadFiscal.json' with { type: 'json' };
import contratosLaborales from '../src/json/contratosLaborales.json' with { type: 'json' };
import tipoFacturas from '../src/json/tipoFacturas.json' with { type: 'json' };
import tipoPersonaJuridica from '../src/json/tipoPersonaJuridica.json' with { type: 'json' };
import entidadesFinancieras from '../src/json/entidadesFinancieras.json' with { type: 'json' };

/** Responsabilidades fiscales DIAN ({ codigo, descripcion }): tienda, clientes y POS. */
export const RESPONSABILIDADES_FISCALES = responsabilidadFiscal;

/** Tipos de contrato laboral ({ codigo, descripcion }): formulario de empleados. */
export const CONTRATOS_LABORALES = contratosLaborales;

/** Tipos de factura DIAN ({ codigo, descripcion }): configuración de facturación de la tienda. */
export const TIPOS_FACTURA = tipoFacturas;

/** Persona jurídica / natural ({ codigo, descripcion }): configuración de la tienda. */
export const TIPOS_PERSONA_JURIDICA = tipoPersonaJuridica;

// ── Bancos y billeteras ──────────────────────────────────────────────────────
// src/json/entidadesFinancieras.json: de dónde se elige el banco al crear una entidad de
// pago (ENTIDADES), una cuenta propia (CAJAS_Y_BANCOS) o la cuenta de un proveedor. `codigo`
// es un identificador interno estable —no el código ACH— y `tipo` usa los mismos valores
// de ENTIDADES.tipoEntidad, para copiarse tal cual.

export const ENTIDADES_FINANCIERAS = entidadesFinancieras;

const POR_CODIGO = new Map(entidadesFinancieras.map(e => [e.codigo, e]));

/** La entidad del catálogo con ese código, o null. */
export const buscarEntidadFinanciera = (codigo) => POR_CODIGO.get(String(codigo ?? '').trim()) ?? null;

/** La entidad del catálogo con ese nombre exacto (y ese tipo, si se da), o null. */
export const entidadFinancieraPorNombre = (nombre, tipo = null) =>
    entidadesFinancieras.find(e => e.nombre === String(nombre ?? '').trim() && (!tipo || e.tipo === tipo)) ?? null;

// Tipo del catálogo ↔ tipo de CAJAS_Y_BANCOS.
// Bre-B no está: no es un banco donde Grupo GH tenga una cuenta propia ni una entidad de
// pago del POS, solo un destino al que se le paga a un proveedor.
export const TIPO_CUENTA_POR_TIPO_ENTIDAD = { 'Banco': 'banco', 'Billetera Virtual': 'billetera' };

/** Tipos de cuenta bancaria de un proveedor. `deposito_electronico` es la de las billeteras
 *  y `llave_breb` la de Bre-B (el pago va a una llave, no a un número de cuenta). */
export const TIPOS_CUENTA_BANCARIA = [
    { codigo: 'ahorros',              descripcion: 'Ahorros' },
    { codigo: 'corriente',            descripcion: 'Corriente' },
    { codigo: 'deposito_electronico', descripcion: 'Depósito electrónico (billetera)' },
    { codigo: 'llave_breb',           descripcion: 'Llave Bre-B' },
];

// ── Formato del número de una cuenta de proveedor ────────────────────────────
// Una sola definición para el servidor (helpers/cuentasBancariasProveedor.js, que es la
// garantía) y el formulario (src/js/cuentasProveedor.js, que la recibe por data-atributo y
// solo acota y avisa). `patron` va como texto para poder viajar al navegador.
//   soloDigitos  se le quitan espacios, puntos y guiones antes de validar
//   max          tope del campo en el formulario (ni un dígito más)
//   modo         inputmode del campo
// Correo: lo que de verdad lleva una dirección (letras, números y . _ % + -). El patrón
// laxo de antes aceptaba "<img/src=x/onerror=…>@a.co" como correo válido. Lo comparten la
// llave Bre-B de correo y el correo de los registros web (helpers/registroWeb.js).
export const PATRON_EMAIL = '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$';

const CELULAR = { patron: '^3\\d{9}$', max: 10, soloDigitos: true, modo: 'numeric', placeholder: '3001234567' };

export const FORMATOS_NUMERO_CUENTA = {
    cuenta:    { etiqueta: 'Número de cuenta', patron: '^\\d{4,20}$', max: 20, soloDigitos: true, modo: 'numeric', placeholder: 'Solo números',
                 error: 'el número de cuenta son solo dígitos (entre 4 y 20).' },
    billetera: { ...CELULAR, etiqueta: 'Celular de la billetera',
                 error: 'el celular de la billetera son exactamente 10 dígitos y empieza por 3.' },
};

/** Tipos de llave Bre-B, cada uno con su formato. */
export const TIPOS_LLAVE_BREB = [
    { codigo: 'celular',      descripcion: 'Celular',             etiqueta: 'Llave: celular', ...CELULAR,
      error: 'la llave de celular son exactamente 10 dígitos y empieza por 3.' },
    { codigo: 'documento',    descripcion: 'Número de documento', etiqueta: 'Llave: documento', patron: '^\\d{5,15}$', max: 15, soloDigitos: true, modo: 'numeric', placeholder: 'Sin puntos ni espacios',
      error: 'la llave de documento son solo dígitos (entre 5 y 15).' },
    { codigo: 'correo',       descripcion: 'Correo electrónico',  etiqueta: 'Llave: correo', patron: PATRON_EMAIL, max: 100, modo: 'email', placeholder: 'pagos@empresa.com',
      error: 'la llave de correo no es un correo válido.' },
    { codigo: 'alfanumerica', descripcion: 'Alfanumérica (@)',    etiqueta: 'Llave alfanumérica', patron: '^@[A-Za-z0-9]{3,20}$', max: 21, modo: 'text', placeholder: '@minegocio',
      error: 'la llave alfanumérica empieza por @ y lleva de 3 a 20 letras o números.' },
    { codigo: 'comercio',     descripcion: 'Código de comercio',  etiqueta: 'Llave: código de comercio', patron: '^\\d{4,20}$', max: 20, soloDigitos: true, modo: 'numeric', placeholder: 'Solo números',
      error: 'el código de comercio son solo dígitos.' },
];
export const buscarTipoLlaveBreb = (codigo) => TIPOS_LLAVE_BREB.find(t => t.codigo === String(codigo ?? '').trim()) ?? null;

/** Lo mismo que valida el servidor, para validar en el navegador sin duplicar reglas. */
export const formatoNumeroCuenta = (tipoCuenta, tipoLlaveBreb = null) =>
    tipoCuenta === 'llave_breb'           ? buscarTipoLlaveBreb(tipoLlaveBreb)
    : tipoCuenta === 'deposito_electronico' ? FORMATOS_NUMERO_CUENTA.billetera
    : FORMATOS_NUMERO_CUENTA.cuenta;

/** Normaliza el número o la llave según su formato: sin separadores si es numérico, en
 *  minúsculas si es un correo. */
export const normalizarNumeroCuenta = (formato, valor) => {
    const v = String(valor ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (formato?.soloDigitos) return v.replace(/[\s.-]/g, '');
    if (formato?.modo === 'email') return v.toLowerCase();
    return v;
};
