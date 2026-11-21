import flatpickr from 'flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es.js';
// El CSS base de Flatpickr se importa en public/css/input.css (@import, igual que los
// íconos de Flaticon) — webpack no tiene loader de CSS configurado en este proyecto.

// Calendario del panel (Flatpickr) con la identidad visual de la marca — reemplaza el
// <input type="date"> nativo, cuyo selector no se puede estilizar y cambia de un sistema
// operativo a otro. La skin (clases .flatpickr-*) vive en views/components/fechaInput.pug;
// cualquier vista que use esto tiene que incluir ese partial.
//
// `altInput: true` separa lo que ve la persona (dd/mm/aaaa) de lo que de verdad viaja al
// servidor: el <input> original —mismo id, mismo name— sigue mandando "Y-m-d" tal cual lo
// esperan helpers/ordenesCompra.js y el resto del formulario, así que nada que ya lea
// `el.value` tiene que cambiar.
export const initFechaInput = (el, opts = {}) => {
    if (!el) return null;
    return flatpickr(el, {
        locale: Spanish,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: false,
        disableMobile: true,
        ...opts
    });
};
