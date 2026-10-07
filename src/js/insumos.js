import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';

// Alta de insumos (admin/insumos). El navegador valida para avisar antes de viajar, pide
// confirmación en la ventana del panel y manda el POST. La validación del servidor
// (helpers/insumos.js) es la que cuenta: acá se repite la misma regla solo para avisar antes.
// Los límites llegan desde la vista como data-atributos, así que no hay una segunda lista.

const form = document.getElementById('form-insumo');

if (form) {
    const CSRF = form.dataset.csrf;
    const LIM = {
        codigoMin: Number(form.dataset.codigoMin),
        codigoMax: Number(form.dataset.codigoMax),
        nombreMax: Number(form.dataset.nombreMax)
    };

    const campos = {
        codigoMaterial: document.getElementById('codigoMaterial'),
        nombre:         document.getElementById('nombre'),
        unidadCompra:   document.getElementById('unidadCompra')
    };
    const CAMPOS = ['codigoMaterial', 'nombre', 'tipo', 'unidadCompra'];

    const tipoElegido = () => form.querySelector('input[name="tipo"]:checked');

    // La etiqueta del nombre sigue al tipo: "Nombre insumo / materia prima" hasta elegir, y
    // después "Nombre Materia Prima" o "Nombre Insumo" (el rótulo viene del helper).
    const etiquetaNombre = document.getElementById('label-nombre');
    const ETIQUETA_NOMBRE_BASE = etiquetaNombre.textContent;
    const pintarEtiquetaNombre = () => {
        const tipo = tipoElegido();
        etiquetaNombre.textContent = tipo ? `Nombre ${tipo.dataset.etiquetaNombre}` : ETIQUETA_NOMBRE_BASE;
    };

    // Código que el servidor respondió como ya existente. Se borra al editar el campo: solo
    // vale para el código exacto que se consultó.
    let codigoOcupado = null;

    const validar = () => {
        const e = {};
        const codigoTxt = campos.codigoMaterial.value.trim();
        if (!codigoTxt) {
            e.codigoMaterial = 'Escribe el código del material, el número que trae el DXF.';
        } else if (!/^\d{1,10}$/.test(codigoTxt) || Number(codigoTxt) < LIM.codigoMin || Number(codigoTxt) > LIM.codigoMax) {
            e.codigoMaterial = `El código debe ser un número entero entre ${LIM.codigoMin} y ${LIM.codigoMax}.`;
        } else if (codigoOcupado === codigoTxt) {
            e.codigoMaterial = `Ya existe un material con el código ${codigoTxt}.`;
        }

        const nombre = campos.nombre.value.trim();
        if (!nombre) e.nombre = 'Escribe el nombre del material.';
        else if (nombre.length > LIM.nombreMax) e.nombre = `El nombre no puede pasar de ${LIM.nombreMax} caracteres.`;

        if (!tipoElegido()) e.tipo = 'Elige si es materia prima o insumo.';
        return e;
    };

    const pintarError = (nombre, mensaje) => {
        const texto = document.getElementById(`error-${nombre}`);
        if (texto) {
            texto.textContent = mensaje || '';
            texto.classList.toggle('hidden', !mensaje);
        }
        campos[nombre]?.classList.toggle('field-text-error', Boolean(mensaje));
        campos[nombre]?.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    };

    // Pinta los cuatro campos de una vez: lo que no viene en `errores` queda limpio.
    const pintarTodos = (errores = {}) => CAMPOS.forEach(n => pintarError(n, errores[n]));

    const enfocar = (nombre) => {
        if (nombre === 'tipo') form.querySelector('input[name="tipo"]')?.focus();
        else campos[nombre]?.focus();
    };

    const leer = () => ({
        codigoMaterial: campos.codigoMaterial.value.trim(),
        nombre:         campos.nombre.value.trim(),
        tipo:           tipoElegido().value,
        unidadCompra:   campos.unidadCompra.value || null
    });

    // Ventanas del panel: la misma cabecera tintada que las confirmaciones de movimientos.
    const aviso = ({ variante, icono, badge, contexto = '' }) => Swal.fire({
        ...opcionesConfirmacion({
            variante,
            html: `<div class="gh-conf-html">${cabeceraConfirmacion({ icono, badge, contexto: esc(contexto) })}</div>`
        }),
        showCancelButton: false,
        confirmButtonText: 'Entendido'
    });

    const confirmar = (datos) => {
        const tipo = tipoElegido().dataset.etiqueta;
        const unidad = datos.unidadCompra ? campos.unidadCompra.selectedOptions[0].textContent : 'Sin unidad';
        const fila = (etiqueta, valor) => `<div class="gh-conf-fila"><dt>${etiqueta}</dt><dd>${esc(valor)}</dd></div>`;
        return Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({
                        icono: 'fi-rr-boxes',
                        badge: 'Nuevo material',
                        contexto: esc(`${datos.nombre} · ${tipo}`)
                    })}
                    <dl class="px-7 py-5 flex flex-col gap-3">
                        ${fila('Código DXF', datos.codigoMaterial)}
                        ${fila('Nombre', datos.nombre)}
                        ${fila('Tipo', tipo)}
                        ${fila('Unidad', unidad)}
                    </dl>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Guardar insumo',
            cancelButtonText: 'Cancelar',
            focusCancel: false,
            reverseButtons: true
        }));
    };

    const guardar = async (datos) => {
        const btn = document.getElementById('btn-guardar-insumo');
        const textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Guardando…';
        try {
            const r = await fetch('/admin/insumos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'CSRF-Token': CSRF },
                body: JSON.stringify(datos)
            });
            const data = await r.json().catch(() => ({}));

            if (data.success) {
                await aviso({
                    variante: 'ingreso',
                    icono: 'fi-rr-check',
                    badge: 'Material guardado',
                    contexto: `${data.material.nombre} · código ${data.material.codigoMaterial}`
                });
                location.reload();
                return;
            }

            pintarTodos(data.errores);
            const primero = CAMPOS.find(n => data.errores?.[n]);
            if (primero) enfocar(primero);
            await aviso({
                variante: 'egreso',
                icono: 'fi-rr-exclamation',
                badge: 'No se guardó',
                contexto: data.mensaje || 'No se pudo guardar el material.'
            });
        } catch {
            await aviso({
                variante: 'egreso',
                icono: 'fi-rr-exclamation',
                badge: 'Sin conexión',
                contexto: 'No hubo respuesta del servidor. Revisa la red e intenta de nuevo.'
            });
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    };

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const errores = validar();
        pintarTodos(errores);
        const primero = CAMPOS.find(n => errores[n]);
        if (primero) { enfocar(primero); return; }

        const datos = leer();
        const { isConfirmed } = await confirmar(datos);
        if (!isConfirmed) return;
        await guardar(datos);
    });

    // Al salir de un campo se valida ese campo. Mientras tiene error, se revalida al escribir
    // para que el mensaje desaparezca apenas se corrige.
    const revalidar = (nombre) => pintarError(nombre, validar()[nombre]);

    // El código DXF es único: al salir del campo se pregunta al servidor. Si ya existe, el
    // mensaje aparece y el cursor vuelve al campo para corregirlo. Si el formato ya está mal,
    // no se consulta: ese error es el que se muestra.
    const verificarCodigo = async () => {
        const codigo = campos.codigoMaterial.value.trim();
        if (!codigo || validar().codigoMaterial) return;
        try {
            const r = await fetch(`/admin/insumos/codigo/${encodeURIComponent(codigo)}`, { headers: { Accept: 'application/json' } });
            const data = await r.json();
            if (!data.success || campos.codigoMaterial.value.trim() !== codigo) return;
            codigoOcupado = data.existe ? codigo : null;
            revalidar('codigoMaterial');
            if (data.existe) {
                campos.codigoMaterial.focus();
                campos.codigoMaterial.select();
            }
        } catch {
            // Sin respuesta no se bloquea el formulario: el alta rechaza el duplicado igual (409).
        }
    };

    campos.codigoMaterial.addEventListener('blur', async () => {
        revalidar('codigoMaterial');
        await verificarCodigo();
    });
    campos.codigoMaterial.addEventListener('input', () => {
        codigoOcupado = null;
        if (!document.getElementById('error-codigoMaterial').classList.contains('hidden')) revalidar('codigoMaterial');
    });
    campos.nombre.addEventListener('blur', () => revalidar('nombre'));
    campos.nombre.addEventListener('input', () => {
        if (!document.getElementById('error-nombre').classList.contains('hidden')) revalidar('nombre');
    });
    campos.unidadCompra.addEventListener('change', () => pintarError('unidadCompra', validar().unidadCompra));
    form.querySelectorAll('input[name="tipo"]').forEach(r =>
        r.addEventListener('change', () => {
            revalidar('tipo');
            pintarEtiquetaNombre();
        }));

    document.getElementById('btn-limpiar-insumo')?.addEventListener('click', () => {
        form.reset();
        codigoOcupado = null;
        pintarTodos();
        pintarEtiquetaNombre();
    });
}
