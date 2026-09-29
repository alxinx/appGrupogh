import { opcionesConfirmacion, cabeceraConfirmacion, filaConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';

// Ventana de confirmación antes de guardar un proveedor: la comparten el alta
// (dataSupplier.js) y la edición (supplier/ver.pug, por window.confirmarProveedor).
//
// Lo que más importa releer es a dónde se le va a pagar: un dígito de más en una cuenta es
// plata que sale a otra persona. Por eso las cuentas van en la lista, número por número, y
// en la edición se avisa cuando cambiaron — cambiarle la cuenta a un proveedor es el
// engaño de pago más común, y se detecta confirmando por un canal distinto al que la pidió.
//
// Lee todo del formulario tal como está (no de los valores enviados): el alta y la edición
// tienen nombres de campo distintos, pero comparten los componentes y sus data-atributos.

const textoOpcion = (select) => (select && select.value ? select.selectedOptions[0]?.textContent.trim() : '');

// 3001234567 → 300 123 4567: un celular se relee mejor en tres grupos.
const agrupar = (numero) => (/^3\d{9}$/.test(numero) ? numero.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : numero);

// Lo que identifica una cuenta para saber si cambió (el orden y la principal no cuentan
// como cambio de destino del pago; el titular sí).
const huella = (lista) => (lista || [])
    .map(c => [c.codigoEntidadFinanciera, c.tipoCuenta, c.tipoLlaveBreb || '', String(c.numeroCuenta || '').replace(/[\s.-]/g, '').toLowerCase(),
               String(c.documentoTitular || '').trim()].join('|'))
    .sort().join('#');

const leerJson = (texto) => { try { return JSON.parse(texto || '[]'); } catch { return []; } };

const ICONO_POR_TIPO = { 'Banco': 'fi-rr-bank', 'Billetera Virtual': 'fi-rr-wallet', 'Bre-B': 'fi-rr-key' };

function filaCuenta(fila) {
    const banco    = fila.querySelector('[data-entidad-financiera]');
    const tipoEnt  = banco.selectedOptions[0]?.dataset.tipo;
    const esBreb   = tipoEnt === 'Bre-B';
    const tipo     = esBreb ? `Llave ${textoOpcion(fila.querySelector('[data-tipo-llave]')).toLowerCase()}`
                            : textoOpcion(fila.querySelector('[data-tipo-cuenta]'));
    const numero   = agrupar(fila.querySelector('[data-numero-cuenta]').value.trim());
    const principal = fila.querySelector('[data-principal]').checked;
    const otro     = fila.querySelector('[data-otro-titular]').checked;
    // Cuenta del registro web que sigue igual y nadie verificó (cuentasProveedor.js).
    const sinVerificar = !fila.querySelector('[data-verificacion]')?.classList.contains('hidden');
    const titular  = otro
        ? `A nombre de ${esc(fila.querySelector('[data-titular]').value.trim())} · ${esc(fila.querySelector('[data-tipo-doc-titular]').value)} ${esc(fila.querySelector('[data-doc-titular]').value.trim())}`
        : 'A nombre del proveedor';

    return filaConfirmacion({
        icono:  ICONO_POR_TIPO[tipoEnt] || 'fi-rr-bank',
        // La principal lleva el rosa de la marca: es a la que va el pago si nadie elige otra.
        fondo:  principal ? '#FDE7F2' : '#EEF2F6',
        color:  principal ? '#C43B7E' : '#475569',
        titulo: esc(textoOpcion(banco) || 'Sin banco'),
        sub:    `${esc(tipo)} · <span class="gh-conf-mono gh-conf-numero">${esc(numero) || '—'}</span><br>${titular}`
              + (sinVerificar ? '<br><strong style="color:#92400E">Sin verificar · llegó del registro web</strong>' : ''),
        derecha: principal ? '<span class="gh-conf-principal">Principal</span>' : ''
    });
}

/**
 * @param form  el formulario del proveedor
 * @param modo  'alta' | 'edicion'
 * @returns true si confirmó, false si volvió a revisar
 */
export async function confirmarProveedor(form, { modo = 'alta' } = {}) {
    const q = (sel) => form.querySelector(sel);
    const valor = (sel) => q(sel)?.value.trim() || '';

    const razonSocial = valor('[name="razonSocial"]') || 'Proveedor sin nombre';
    const tipoDoc     = q('[data-tipo-documento]')?.value || '';
    const numeroDoc   = valor('[data-numero-documento]');
    const documento   = numeroDoc ? `${tipoDoc} ${/^\d+$/.test(numeroDoc) ? Number(numeroDoc).toLocaleString('es-CO') : numeroDoc}` : '';
    const lugar       = [textoOpcion(q('#ciudadSelect')), textoOpcion(q('#departamentoSelect'))].filter(Boolean).join(', ');

    const contacto    = [valor('[name="nombreContacto"]'), valor('[name="telefonoContacto"]')].filter(Boolean).join(' · ');
    const categorias  = [...form.querySelectorAll('input[name="categorias"]:checked')]
        .map(c => c.closest('label')?.textContent.trim()).filter(Boolean);

    const caja   = q('[data-cuentas-proveedor]');
    const filas  = caja ? [...caja.querySelectorAll('[data-cuenta]')] : [];
    const oculto = caja?.querySelector('[data-cuentas-json]');
    // defaultValue es el valor con el que se pintó la página: las cuentas guardadas.
    const cambiaronCuentas = modo === 'edicion' && oculto && huella(leerJson(oculto.defaultValue)) !== huella(leerJson(oculto.value));

    const dato = (etiqueta, v) => `
        <div class="gh-conf-fila"><dt>${etiqueta}</dt>
            <dd class="${v ? '' : 'gh-conf-vacio'}">${v ? esc(v) : 'Sin registrar'}</dd></div>`;

    const cuentas = filas.length
        ? `<p class="gh-conf-seccion">A dónde se le paga <span>${filas.length} ${filas.length === 1 ? 'cuenta' : 'cuentas'}</span></p>
           <div class="gh-conf-lista">${filas.map(filaCuenta).join('')}</div>`
        : `<div class="gh-conf-aviso"><i class="fi fi-rr-info"></i>
               <span>No tiene cuentas registradas: no va a quedar anotado a dónde pagarle. Puedes agregarlas después.</span></div>`;

    const avisoCambio = cambiaronCuentas && filas.length
        ? `<div class="gh-conf-aviso gh-conf-aviso--alerta"><i class="fi fi-rr-shield-exclamation"></i>
               <span><strong>Cambió a dónde se le paga.</strong> Antes de guardar, confirma los números con el proveedor por un canal distinto al que te los pasó (una llamada al número que ya tenías).</span></div>`
        : '';

    const html = `<div class="gh-conf-html">
        ${cabeceraConfirmacion({
            icono:    modo === 'alta' ? 'fi-rr-user-add' : 'fi-rr-edit',
            badge:    modo === 'alta' ? 'Nuevo proveedor' : 'Editar proveedor',
            monto:    esc(razonSocial),
            contexto: esc([documento, lugar].filter(Boolean).join(' · '))
        })}
        <dl class="gh-conf-detalle">
            ${dato('Contacto', contacto)}
            ${dato('Correo', valor('[name="emailProvedor"]'))}
            ${dato('Dirección', valor('[name="direccionProvedor"]'))}
            ${dato('Categorías', categorias.join(', '))}
        </dl>
        ${cuentas}
        ${avisoCambio}
    </div>`;

    const { isConfirmed } = await Swal.fire(opcionesConfirmacion({
        variante: 'neutro',
        html,
        showCancelButton: true,
        confirmButtonText: modo === 'alta' ? 'Guardar proveedor' : 'Guardar cambios',
        cancelButtonText: 'Volver a revisar',
        // Con la cuenta recién cambiada, el foco arranca en "Volver": un Enter por inercia
        // no debe guardar un destino de pago que nadie verificó.
        focusCancel: Boolean(avisoCambio)
    }));
    return isConfirmed;
}

// La edición guarda desde un script en línea de la vista, que no importa módulos.
window.confirmarProveedor = confirmarProveedor;
