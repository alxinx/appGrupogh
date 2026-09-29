// Cuentas bancarias de un proveedor: filas dinámicas sobre views/components/cuentasBancariasProveedor.pug.
//
// Cada cambio se vuelca como JSON al campo oculto `cuentasBancarias`, que es lo único que
// viaja con el formulario (el alta lo manda en su FormData; la edición, dentro de su JSON).
// El servidor revalida todo: esto solo ordena y avisa.

import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';

const MAX_CUENTAS = 5;
// Un banco tiene cuentas de ahorros o corriente; una billetera, depósito electrónico; Bre-B,
// una llave.
const TIPOS_POR_ENTIDAD = {
    'Banco': ['ahorros', 'corriente'],
    'Billetera Virtual': ['deposito_electronico'],
    'Bre-B': ['llave_breb']
};

function iniciar(caja) {
    const lista     = caja.querySelector('[data-cuentas-lista]');
    const plantilla = caja.querySelector('[data-plantilla-cuenta]');
    const oculto    = caja.querySelector('[data-cuentas-json]');
    const vacio     = caja.querySelector('[data-cuentas-vacio]');
    const agregar   = caja.querySelector('[data-agregar-cuenta]');
    const nombreRadio = `cuenta-principal-${Math.random().toString(36).slice(2, 8)}`;
    // Formatos del número (helpers/catalogos.js): los mismos que valida el servidor.
    let formatos = {};
    try { formatos = JSON.parse(caja.dataset.formatos || '{}'); } catch { formatos = {}; }

    const filas = () => [...lista.querySelectorAll('[data-cuenta]')];
    const q = (fila, sel) => fila.querySelector(sel);

    // El tipo de cuenta se acota al banco elegido; si queda una sola opción, se elige sola.
    const ajustarTipo = (fila) => {
        const banco = q(fila, '[data-entidad-financiera]');
        const tipo  = q(fila, '[data-tipo-cuenta]');
        const tipoEntidad = banco.selectedOptions[0]?.dataset.tipo;
        const permitidos = TIPOS_POR_ENTIDAD[tipoEntidad] || null;
        [...tipo.options].forEach(o => {
            if (!o.value) return;
            const ok = !permitidos || permitidos.includes(o.value);
            o.hidden = !ok; o.disabled = !ok;
        });
        if (tipo.selectedOptions[0]?.hidden) tipo.value = '';
        if (permitidos?.length === 1) tipo.value = permitidos[0];
        const breb = tipoEntidad === 'Bre-B';
        q(fila, '[data-bloque-tipo-cuenta]').classList.toggle('hidden', breb);
        q(fila, '[data-bloque-tipo-llave]').classList.toggle('hidden', !breb);
        if (!breb) q(fila, '[data-tipo-llave]').value = '';
        ajustarNumero(fila);
    };

    // El formato que aplica a la fila: el de la llave elegida, el del celular de una
    // billetera o el de un número de cuenta.
    const formatoDe = (fila) => {
        const tipo = q(fila, '[data-tipo-cuenta]').value;
        if (tipo === 'llave_breb') {
            const d = q(fila, '[data-tipo-llave]').selectedOptions[0]?.dataset.formato;
            return d ? JSON.parse(d) : null;
        }
        return tipo === 'deposito_electronico' ? formatos.billetera : formatos.cuenta;
    };

    // Etiqueta, teclado y tope del campo según el formato. Un campo numérico no deja escribir
    // más dígitos de los que lleva: una billetera son 10, ni uno más.
    const ajustarNumero = (fila) => {
        const f = formatoDe(fila);
        const input = q(fila, '[data-numero-cuenta]');
        q(fila, '[data-etiqueta-numero-cuenta]').textContent = f?.etiqueta || 'Llave';
        input.placeholder = f?.placeholder || 'Elige el tipo de llave';
        input.inputMode   = f?.modo || 'text';
        // Numérico: el tope real lo pone soloDigitos() tras quitar separadores; el maxlength
        // queda holgado para que pegar "300 123 4567" no se corte antes de limpiarlo.
        input.maxLength   = f?.soloDigitos ? 30 : (f?.max || 100);
        input.disabled    = !f;
        soloDigitos(input, f);
        marcarError(fila, false);
    };

    const soloDigitos = (input, f) => {
        if (f?.soloDigitos) input.value = input.value.replace(/\D/g, '').slice(0, f.max);
        else if (f?.max) input.value = input.value.slice(0, f.max);
    };

    // true si el valor cumple su formato. `mostrar` pinta el aviso bajo el campo.
    const validarNumero = (fila, mostrar) => {
        const f = formatoDe(fila);
        const valor = q(fila, '[data-numero-cuenta]').value.trim();
        const ok = !f || !valor || new RegExp(f.patron).test(f.modo === 'email' ? valor.toLowerCase() : valor);
        if (mostrar) marcarError(fila, !ok, f?.error);
        return ok;
    };

    const marcarError = (fila, hay, texto = '') => {
        const aviso = q(fila, '[data-error-numero-cuenta]');
        q(fila, '[data-numero-cuenta]').classList.toggle('field-text-error', hay);
        aviso.classList.toggle('hidden', !hay);
        // El mensaje del catálogo viene en minúscula para ir tras "Cuenta n:" en el servidor.
        aviso.textContent = hay ? texto.charAt(0).toUpperCase() + texto.slice(1) : '';
    };

    // Lo que identifica el destino del pago (mismo criterio que helpers/proveedores.js).
    const huella = (fila) => [
        q(fila, '[data-entidad-financiera]').value, q(fila, '[data-tipo-cuenta]').value,
        q(fila, '[data-tipo-llave]').value, q(fila, '[data-numero-cuenta]').value.replace(/[\s.-]/g, '').toLowerCase(),
        q(fila, '[data-otro-titular]').checked ? q(fila, '[data-doc-titular]').value.trim() : ''
    ].join('|');

    const avisoVerificacion = (fila) => {
        const aviso = q(fila, '[data-verificacion]');
        const pendiente = Boolean(fila.dataset.huellaWeb) && fila.dataset.huellaWeb === huella(fila);
        aviso.classList.toggle('hidden', !pendiente);
        aviso.classList.toggle('flex', pendiente);
    };

    async function verificar(fila) {
        const banco = q(fila, '[data-entidad-financiera]');
        const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: '<div class="gh-conf-html">' + cabeceraConfirmacion({
                icono: 'fi-rr-shield-check', badge: 'Verificar cuenta',
                monto: esc(`${banco.selectedOptions[0]?.textContent.trim() || ''} · ${q(fila, '[data-numero-cuenta]').value}`),
                contexto: 'La registró el proveedor desde la web.'
            }) + `<div class="gh-conf-aviso"><i class="fi fi-rr-info"></i><span>Márcala solo si la confirmaste con la certificación bancaria o con el proveedor por un canal que ya conocías. Queda registrado quién la verificó.</span></div></div>`,
            showCancelButton: true,
            confirmButtonText: 'Sí, la verifiqué',
            cancelButtonText: 'Todavía no',
            focusCancel: true
        }));
        if (!isConfirmed) return;
        const token = document.querySelector('input[name="_csrf"]')?.value || '';
        try {
            const r = await fetch(`/admin/provedores/${caja.dataset.idProveedor}/cuentas/${fila.dataset.idCuenta}/verificar`, {
                method: 'POST', headers: { 'CSRF-Token': token }
            });
            const data = await r.json();
            if (!data.success) throw new Error(data.mensaje);
            delete fila.dataset.huellaWeb;
            avisoVerificacion(fila);
            Swal.fire({ icon: 'success', title: data.mensaje, timer: 1800, showConfirmButton: false });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'No se pudo verificar', text: e.message || 'Inténtalo de nuevo.' });
        }
    }

    const volcar = () => {
        filas().forEach(avisoVerificacion);
        const cuentas = filas().map(fila => {
            const otro = q(fila, '[data-otro-titular]').checked;
            return {
                codigoEntidadFinanciera: q(fila, '[data-entidad-financiera]').value,
                tipoCuenta:              q(fila, '[data-tipo-cuenta]').value,
                tipoLlaveBreb:           q(fila, '[data-tipo-llave]').value,
                numeroCuenta:            q(fila, '[data-numero-cuenta]').value.trim(),
                titular:                 otro ? q(fila, '[data-titular]').value.trim() : '',
                tipoDocumentoTitular:    otro ? q(fila, '[data-tipo-doc-titular]').value : '',
                documentoTitular:        otro ? q(fila, '[data-doc-titular]').value.trim() : '',
                principal:               q(fila, '[data-principal]').checked
            };
        });
        oculto.value = JSON.stringify(cuentas);
        vacio.classList.toggle('hidden', cuentas.length > 0);
        agregar.disabled = cuentas.length >= MAX_CUENTAS;
    };

    const agregarFila = (datos = {}) => {
        const fila = plantilla.content.firstElementChild.cloneNode(true);
        const radio = q(fila, '[data-principal]');
        radio.name = nombreRadio;

        const banco = q(fila, '[data-entidad-financiera]');
        banco.value = datos.codigoEntidadFinanciera || '';
        // Buscable como departamento/ciudad: se elige de la lista o se escribe para filtrarla.
        window.enhanceSelectBuscable?.(banco, { placeholder: 'Escribe o elige el banco' });
        ajustarTipo(fila);
        if (datos.tipoCuenta) q(fila, '[data-tipo-cuenta]').value = datos.tipoCuenta;
        if (datos.tipoLlaveBreb) q(fila, '[data-tipo-llave]').value = datos.tipoLlaveBreb;
        q(fila, '[data-numero-cuenta]').value = datos.numeroCuenta || '';
        ajustarNumero(fila);
        radio.checked = Boolean(datos.principal) || filas().length === 0;

        const conTitular = Boolean(datos.titular);
        q(fila, '[data-otro-titular]').checked = conTitular;
        q(fila, '[data-bloque-titular]').classList.toggle('hidden', !conTitular);
        q(fila, '[data-titular]').value = datos.titular || '';
        if (datos.tipoDocumentoTitular) q(fila, '[data-tipo-doc-titular]').value = datos.tipoDocumentoTitular;
        q(fila, '[data-doc-titular]').value = datos.documentoTitular || '';

        banco.addEventListener('change', () => { ajustarTipo(fila); volcar(); });
        q(fila, '[data-tipo-cuenta]').addEventListener('change', () => ajustarNumero(fila));
        q(fila, '[data-tipo-llave]').addEventListener('change', () => {
            ajustarNumero(fila);
            q(fila, '[data-numero-cuenta]').focus();
        });
        const numero = q(fila, '[data-numero-cuenta]');
        numero.addEventListener('input', () => {
            soloDigitos(numero, formatoDe(fila));
            if (!numero.classList.contains('field-text-error')) return;
            validarNumero(fila, true);   // si ya estaba en rojo, se limpia apenas quede bien
        });
        numero.addEventListener('blur', () => validarNumero(fila, true));
        q(fila, '[data-otro-titular]').addEventListener('change', (e) => {
            q(fila, '[data-bloque-titular]').classList.toggle('hidden', !e.target.checked);
            volcar();
        });
        q(fila, '[data-quitar-cuenta]').addEventListener('click', () => {
            const eraPrincipal = radio.checked;
            fila.remove();
            // Si se fue la principal, la pasa a ser la primera que quede.
            if (eraPrincipal && filas()[0]) q(filas()[0], '[data-principal]').checked = true;
            volcar();
        });
        fila.addEventListener('input', volcar);
        fila.addEventListener('change', volcar);

        // Cuenta del registro web sin verificar: el aviso se ve mientras la cuenta siga
        // siendo la misma que dio el proveedor. Si alguien la cambia, la escribe él.
        if (datos.idCuentaBancaria && datos.origen === 'web' && !datos.verificada) {
            fila.dataset.huellaWeb = huella(fila);
            fila.dataset.idCuenta = datos.idCuentaBancaria;
            q(fila, '[data-verificar-cuenta]').addEventListener('click', () => verificar(fila));
        }

        lista.appendChild(fila);
        return fila;
    };

    const pintarDesdeOculto = () => {
        lista.replaceChildren();
        let guardadas = [];
        try { guardadas = JSON.parse(oculto.value || '[]'); } catch { guardadas = []; }
        guardadas.forEach(c => agregarFila(c));
        volcar();
    };

    agregar.addEventListener('click', () => {
        if (filas().length >= MAX_CUENTAS) return;
        const fila = agregarFila();
        (q(fila, '.select-buscable-input') || q(fila, '[data-entidad-financiera]')).focus();
        volcar();
    });
    // El alta hace form.reset() tras guardar: vuelve a pintar desde el valor original.
    caja.addEventListener('reiniciar', pintarDesdeOculto);

    pintarDesdeOculto();
}

document.querySelectorAll('[data-cuentas-proveedor]').forEach(iniciar);
