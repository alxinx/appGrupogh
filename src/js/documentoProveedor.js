// Campo de tipo + número de documento de un proveedor (alta y edición).
// Marcado en views/components/documentoProveedor.pug; se activa en cada [data-documento-proveedor].
//
// - La etiqueta del número cambia según el tipo: "Nro. de NIT", "Nro. de cédula de ciudadanía"…
// - Con NIT aparece la aclaración de que va sin dígito de verificación.
// - El número se consulta en vivo contra los proveedores existentes. Si ya está, el aviso queda
//   debajo del campo (sin borrar lo escrito) y el formulario no se envía hasta corregirlo.
//
// Nada de esto es la garantía: saveSupplier y actualizarProveedor validan igual en el servidor.

const NUMERICOS = new Set(['CC', 'TI', 'NIT']);
const ESPERA_MS = 450;

const normalizar = (v) => v.replace(/[\s.-]/g, '').toUpperCase();

function inicializar(caja) {
    const tipo     = caja.querySelector('[data-tipo-documento]');
    const numero   = caja.querySelector('[data-numero-documento]');
    const etiqueta = caja.querySelector('[data-etiqueta-numero]');
    const ayudaNit = caja.querySelector('[data-ayuda-nit]');
    const aviso    = caja.querySelector('[data-aviso-documento]');
    const excluir  = caja.dataset.excluir || '';
    if (!tipo || !numero) return;

    let reloj = null;
    let consultado = '';   // último número consultado: descarta respuestas viejas

    const mostrarAviso = (texto) => {
        aviso.textContent = texto;
        aviso.classList.toggle('hidden', !texto);
        numero.setAttribute('aria-invalid', texto ? 'true' : 'false');
        numero.classList.toggle('field-text-error', Boolean(texto));
    };

    // Etiqueta según el tipo: el texto sale de la opción elegida, que viene del servidor.
    const alCambiarTipo = () => {
        const t = tipo.value;
        const nombre = tipo.selectedOptions[0]?.textContent.trim() || 'identificación';
        etiqueta.textContent = t === 'NIT'
            ? 'Nro. de NIT'
            : `Nro. de ${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}`;
        numero.inputMode = NUMERICOS.has(t) ? 'numeric' : 'text';
        ayudaNit?.classList.toggle('hidden', t !== 'NIT');
        programarConsulta();
    };

    const consultar = async () => {
        const valor = numero.value.trim();
        // Un NIT con su dígito de verificación ("900123456-7") se avisa antes de consultar.
        if (tipo.value === 'NIT' && /-\s*\d\s*$/.test(valor)) {
            caja.dataset.duplicado = '1';
            mostrarAviso('Escribe el NIT sin el dígito de verificación (sin el número después del guion).');
            return;
        }
        const n = normalizar(valor);
        if (n.length < 4) { caja.dataset.duplicado = ''; mostrarAviso(''); return; }
        consultado = n;
        try {
            const url = `/admin/api/check-nit/${encodeURIComponent(n)}${excluir ? `?excluir=${encodeURIComponent(excluir)}` : ''}`;
            const data = await fetch(url).then(r => r.json());
            if (consultado !== n) return;
            caja.dataset.duplicado = data.exists ? '1' : '';
            mostrarAviso(data.exists
                ? (data.eliminado
                    ? `Este número pertenece a un proveedor eliminado (${data.razonSocial}).`
                    : `Este número ya está registrado para el proveedor ${data.razonSocial}.`)
                : '');
        } catch {
            // Sin conexión no se bloquea: el servidor valida al guardar.
            caja.dataset.duplicado = '';
            mostrarAviso('');
        }
    };

    function programarConsulta() {
        clearTimeout(reloj);
        reloj = setTimeout(consultar, ESPERA_MS);
    }

    tipo.addEventListener('change', alCambiarTipo);
    numero.addEventListener('input', programarConsulta);
    numero.addEventListener('blur', () => { clearTimeout(reloj); consultar(); });

    // Bloquea el envío con un número repetido. En fase de captura sobre el documento, para
    // cortar ANTES de los manejadores de envío de cada formulario (dataSupplier.js, ver.pug).
    document.addEventListener('submit', (e) => {
        if (!e.target.contains(caja) || caja.dataset.duplicado !== '1') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        numero.focus();
    }, true);

    alCambiarTipo();
}

document.querySelectorAll('[data-documento-proveedor]').forEach(inicializar);
