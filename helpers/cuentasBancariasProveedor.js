import {
    buscarEntidadFinanciera, TIPOS_CUENTA_BANCARIA, buscarTipoLlaveBreb,
    formatoNumeroCuenta, normalizarNumeroCuenta
} from './catalogos.js';
import { validarDocumento, CODIGOS_TIPO_DOCUMENTO_PROVEEDOR } from './tiposDocumento.js';
import { toPascal } from './clientes.js';

// Cuentas bancarias de un proveedor (PROVEDORES_CUENTAS_BANCARIAS): validación compartida
// por el alta (saveSupplier) y la edición (actualizarProveedor).
//
// Llegan del formulario como JSON —un arreglo— en el campo `cuentasBancarias`. Todo se
// revalida acá: el formulario filtra y avisa, pero es solo comodidad.

export const MAX_CUENTAS_PROVEEDOR = 5;

const CODIGOS_TIPO_CUENTA = TIPOS_CUENTA_BANCARIA.map(t => t.codigo);
// Un banco tiene cuentas de ahorros o corriente; una billetera, depósito electrónico; Bre-B,
// una llave.
const TIPOS_CUENTA_POR_ENTIDAD = {
    'Banco':             ['ahorros', 'corriente'],
    'Billetera Virtual': ['deposito_electronico'],
    'Bre-B':             ['llave_breb']
};

const texto = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '');

/**
 * @param entrada  el arreglo, o el JSON en texto, tal como llega del formulario
 * @returns `{ cuentas }` listas para guardar (sin idProveedor) o `{ error }` para mostrar
 */
export const validarCuentasBancarias = (entrada) => {
    let lista = entrada;
    if (typeof entrada === 'string') {
        if (!entrada.trim()) return { cuentas: [] };
        try { lista = JSON.parse(entrada); } catch { return { error: 'Las cuentas bancarias llegaron con un formato inválido.' }; }
    }
    if (lista === undefined || lista === null) return { cuentas: [] };
    if (!Array.isArray(lista)) return { error: 'Las cuentas bancarias llegaron con un formato inválido.' };
    if (lista.length > MAX_CUENTAS_PROVEEDOR) return { error: `Un proveedor puede tener hasta ${MAX_CUENTAS_PROVEEDOR} cuentas.` };

    const cuentas = [];
    const vistas = new Set();

    for (const [i, c] of lista.entries()) {
        const n = i + 1;
        const entidad = buscarEntidadFinanciera(c?.codigoEntidadFinanciera);
        if (!entidad) return { error: `Cuenta ${n}: elige el banco o la billetera de la lista.` };

        const tipoCuenta = texto(c.tipoCuenta);
        if (!CODIGOS_TIPO_CUENTA.includes(tipoCuenta)) return { error: `Cuenta ${n}: elige el tipo de cuenta.` };
        if (!TIPOS_CUENTA_POR_ENTIDAD[entidad.tipo]?.includes(tipoCuenta)) {
            return {
                error: entidad.tipo === 'Banco'
                    ? `Cuenta ${n}: una cuenta de ${entidad.nombre} es de ahorros o corriente.`
                    : entidad.tipo === 'Bre-B'
                        ? `Cuenta ${n}: un pago por Bre-B va a una llave.`
                        : `Cuenta ${n}: ${entidad.nombre} es una billetera: su cuenta es de depósito electrónico.`
            };
        }

        // Bre-B: la llave puede ser un celular, un documento, un correo… cada una con su formato.
        let tipoLlaveBreb = null;
        if (tipoCuenta === 'llave_breb') {
            tipoLlaveBreb = buscarTipoLlaveBreb(c.tipoLlaveBreb)?.codigo ?? null;
            if (!tipoLlaveBreb) return { error: `Cuenta ${n}: elige el tipo de llave Bre-B.` };
        }

        // Mismo formato que acota el formulario (helpers/catalogos.js): una billetera es un
        // celular de exactamente 10 dígitos, ni uno más ni uno menos.
        const formato = formatoNumeroCuenta(tipoCuenta, tipoLlaveBreb);
        const numeroCuenta = normalizarNumeroCuenta(formato, c.numeroCuenta);
        if (!new RegExp(formato.patron).test(numeroCuenta)) return { error: `Cuenta ${n}: ${formato.error}` };

        const clave = `${entidad.codigo}:${numeroCuenta}`;
        if (vistas.has(clave)) {
            return { error: tipoLlaveBreb ? `Cuenta ${n}: esa llave Bre-B está repetida.` : `Cuenta ${n}: esa cuenta de ${entidad.nombre} está repetida.` };
        }
        vistas.add(clave);

        // Titular distinto del proveedor: nombre y documento van juntos. Sin TI, igual que
        // el proveedor: un menor de edad no puede ser el titular.
        let titular = null, tipoDocumentoTitular = null, documentoTitular = null;
        const nombreTitular = texto(c.titular);
        if (nombreTitular || texto(c.documentoTitular)) {
            if (nombreTitular.length < 3) return { error: `Cuenta ${n}: escribe el nombre completo del titular.` };
            if (texto(c.tipoDocumentoTitular).toUpperCase() === 'TI') {
                return { error: `Cuenta ${n}: el titular no puede ser menor de edad (tarjeta de identidad).` };
            }
            const doc = validarDocumento(c.tipoDocumentoTitular, c.documentoTitular, CODIGOS_TIPO_DOCUMENTO_PROVEEDOR);
            if (doc.error) return { error: `Cuenta ${n}, titular: ${doc.error}` };
            titular = toPascal(nombreTitular).slice(0, 150);
            tipoDocumentoTitular = doc.tipoDocumento;
            documentoTitular = doc.numero;
        }

        cuentas.push({
            codigoEntidadFinanciera: entidad.codigo,
            tipoCuenta,
            tipoLlaveBreb,
            numeroCuenta,
            titular,
            tipoDocumentoTitular,
            documentoTitular,
            principal: c.principal === true || c.principal === 'true'
        });
    }

    // Exactamente una principal: si no marcaron ninguna, lo es la primera.
    const principales = cuentas.filter(c => c.principal).length;
    if (principales > 1) return { error: 'Solo una cuenta puede ser la principal.' };
    if (cuentas.length && principales === 0) cuentas[0].principal = true;

    return { cuentas };
};
