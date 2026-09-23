// Ventana de confirmación del proyecto — la hoja de estilos vive en
// views/components/modalConfirmacion.pug y hay que incluirla en la vista que la use.
//
// Acá está lo que hasta ahora cada pantalla volvía a escribir a mano: los seis nombres de
// clase que SweetAlert2 necesita para que la ventana tome esa forma, la animación de
// entrada, y la verificación en vivo del código de empleado. Estaban copiados en
// adminClienteCredito, adminClientes, storeEgresos y storeClienteDetalle; un nombre de clase
// mal tipeado no rompe nada visible al escribirlo, simplemente deja esa ventana con el
// aspecto por defecto de la librería.

export const CONFIRMACION_BASE = {
    buttonsStyling: false,
    // Cancelar a la izquierda, la acción al final: el mismo orden que la fila de botones
    // del panel (views/components/accionesAdmin.pug).
    reverseButtons: true,
    width: '32rem',
    customClass: {
        popup:         'gh-conf-popup',
        htmlContainer: 'gh-conf-html-container',
        actions:       'gh-conf-acciones',
        confirmButton: 'gh-conf-btn gh-conf-confirmar',
        cancelButton:  'gh-conf-btn gh-conf-cancelar'
    },
    showClass: { popup: 'gh-conf-entra', backdrop: 'swal2-backdrop-show' }
};

/**
 * Opciones de Swal.fire con la ventana ya vestida.
 *
 * @param variante  sufijo de la clase de color: 'ingreso' | 'egreso' | 'neutro' | 'traslado' | 'pack'
 * @param resto     cualquier opción de SweetAlert2 (html, didOpen, preConfirm, textos…)
 */
export const opcionesConfirmacion = ({ variante = 'neutro', ...resto } = {}) => ({
    ...CONFIRMACION_BASE,
    ...resto,
    customClass: {
        ...CONFIRMACION_BASE.customClass,
        popup: `gh-conf-popup gh-conf--${variante}`,
        ...(resto.customClass || {})
    }
});

/**
 * Cabecera tintada: el distintivo con el tipo de movimiento y una línea de contexto.
 * El color lo pone la variante, no el llamador — para eso están las clases.
 */
export const cabeceraConfirmacion = ({ icono, badge, contexto }) => `
    <div class="gh-conf-cabecera">
        <span class="gh-conf-badge">${icono ? `<i class="fi ${icono}"></i>` : ''}${badge}</span>
        ${contexto ? `<p class="gh-conf-cuenta">${contexto}</p>` : ''}
    </div>`;

/**
 * Fila de la lista del cuerpo: cuadro de ícono + título + subtítulo, y a la derecha lo que
 * el llamador quiera (un monto, un conteo). Es la fila de los métodos de pago del abono,
 * que es lo que le da su aspecto a esta ventana.
 */
export const filaConfirmacion = ({ icono, fondo, color, titulo, sub, derecha = '' }) => `
    <div class="gh-conf-item">
        <div class="gh-conf-item-icono" style="background:${fondo};color:${color};">
            <i class="fi ${icono}"></i>
        </div>
        <div class="gh-conf-item-texto">
            <p class="gh-conf-item-titulo">${titulo}</p>
            ${sub ? `<p class="gh-conf-item-sub">${sub}</p>` : ''}
        </div>
        ${derecha ? `<span class="gh-conf-item-derecha">${derecha}</span>` : ''}
    </div>`;

/**
 * Verificación en vivo del código de empleado dentro de la ventana: escribe el nombre del
 * responsable debajo del campo apenas el código es válido, y avisa el motivo cuando no.
 *
 * Solo confirma o invalida el código — habilitar el botón es decisión del que llama, porque
 * casi siempre hace falta algo más (un monto, una selección). `onVerificado` recibe el
 * empleado o `null` en cada tecla.
 *
 * El permiso fino de la acción NO se comprueba acá: eso lo hace el endpoint al recibir el
 * POST. Esto es comodidad para el cajero, no el control.
 */
export function activarVerificacionCodigo(inputId, estadoId, onVerificado, { accion = null } = {}) {
    const input = document.getElementById(inputId);
    const estado = document.getElementById(estadoId);
    if (!input || !estado) return;

    const setEstado = (tipo, texto) => {
        estado.style.color = tipo === 'ok' ? '#10b981' : tipo === 'error' ? '#f43f5e' : '#94a3b8';
        estado.textContent = texto;
    };

    let timer = null;
    input.addEventListener('input', () => {
        onVerificado(null);
        clearTimeout(timer);
        const codigo = input.value.trim();
        if (!codigo) { setEstado('info', ''); return; }
        setEstado('info', 'Verificando código...');
        timer = setTimeout(async () => {
            try {
                const url = `/store/json/personal/validar/${encodeURIComponent(codigo)}`;
                const r = await fetch(accion ? `${url}?accion=${encodeURIComponent(accion)}` : url);
                const data = await r.json();
                if (!data.success) { setEstado('error', data.mensaje || 'Código inválido.'); return; }
                setEstado('ok', `✓ ${data.nombre || 'Empleado verificado'}`);
                onVerificado({ idEmpleado: data.idEmpleado, nombre: data.nombre, codigoEmpleado: codigo.toUpperCase() });
            } catch (_) {
                setEstado('error', 'No se pudo verificar el código.');
            }
        }, 400);
    });
}
