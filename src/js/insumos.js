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
        unidadCompra:   document.getElementById('unidadCompra'),
        imagen:         document.getElementById('imagen')
    };
    // 'imagen' no entra a validar(): es opcional y el único error posible (formato, peso,
    // dimensiones) lo manda el servidor — acá solo hace falta poder pintarlo y limpiarlo.
    const CAMPOS = ['codigoMaterial', 'nombre', 'tipo', 'unidadCompra', 'imagen'];

    // Vista previa real de la foto elegida: mismo patrón que el modal de QR de pago
    // (bankentities/listado.pug) — la imagen de verdad reemplaza al ícono, no un simple
    // cambio de color, que es lo que no se notaba antes.
    const previewImagen  = document.getElementById('preview-imagen');
    const iconoImagen    = document.getElementById('icono-imagen');
    const nombreArchivo  = document.getElementById('nombre-archivo-imagen');
    const NOMBRE_ARCHIVO_BASE = nombreArchivo?.textContent;
    let urlPreviewImagenLocal = null;

    const limpiarPreviewImagen = () => {
        if (urlPreviewImagenLocal) URL.revokeObjectURL(urlPreviewImagenLocal);
        urlPreviewImagenLocal = null;
        previewImagen.classList.add('hidden');
        previewImagen.removeAttribute('src');
        iconoImagen.classList.remove('hidden');
        nombreArchivo.textContent = NOMBRE_ARCHIVO_BASE;
    };

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
            // FormData, no JSON: la foto viaja en el mismo POST (campo "imagen"), y es la
            // única razón de que este alta ya no mande un body JSON como antes.
            const body = new FormData();
            Object.entries(datos).forEach(([k, v]) => body.append(k, v ?? ''));
            if (campos.imagen.files[0]) body.append('imagen', campos.imagen.files[0]);

            const r = await fetch('/admin/insumos', {
                method: 'POST',
                headers: { 'CSRF-Token': CSRF }, // sin Content-Type: el navegador pone el boundary de multipart
                body
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
    campos.imagen.addEventListener('change', () => {
        pintarError('imagen', ''); // el error anterior (si lo hubo) ya no aplica a este archivo
        const file = campos.imagen.files[0];
        if (!file) { limpiarPreviewImagen(); return; }

        if (urlPreviewImagenLocal) URL.revokeObjectURL(urlPreviewImagenLocal);
        urlPreviewImagenLocal = URL.createObjectURL(file);
        previewImagen.src = urlPreviewImagenLocal;
        previewImagen.classList.remove('hidden');
        iconoImagen.classList.add('hidden');
        nombreArchivo.textContent = file.name;
    });
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
        limpiarPreviewImagen();
    });
}

// ── Catálogo: búsqueda + filtros ──────────────────────────────────────────────────
// El catálogo llega completo del servidor (es chico, ver produccionController.js): acá
// solo se muestran/ocultan las <tr> que ya están pintadas, nada de una consulta nueva.
// Los cuatro filtros (texto, tipo, unidad, estado) se combinan entre sí.
(function () {
    const filas = Array.from(document.querySelectorAll('#tabla-materiales tr[data-nombre]'));
    if (!filas.length) return;

    const busqueda      = document.getElementById('busqueda-material');
    const filtroTipo    = document.getElementById('filtro-tipo-material');
    const filtroUnidad  = document.getElementById('filtro-unidad-material');
    const filtroEstado  = document.getElementById('filtro-estado-material');
    const btnLimpiar    = document.getElementById('limpiar-filtros-material');
    const sinResultados = document.getElementById('sin-resultados-material');
    const conteo        = document.getElementById('conteo-materiales');

    const aplicarFiltros = () => {
        const texto  = busqueda.value.trim().toLowerCase();
        const tipo   = filtroTipo.value;
        const unidad = filtroUnidad.value;
        const activoBuscado = filtroEstado.value && (filtroEstado.value === 'activo' ? '1' : '0');

        let visibles = 0;
        filas.forEach(fila => {
            const coincide =
                (!texto || fila.dataset.nombre.includes(texto) || fila.dataset.codigo.includes(texto)) &&
                (!tipo || fila.dataset.tipo === tipo) &&
                (!unidad || fila.dataset.unidad === unidad) &&
                (!activoBuscado || fila.dataset.activo === activoBuscado);
            fila.classList.toggle('hidden', !coincide);
            if (coincide) visibles++;
        });

        sinResultados.classList.toggle('hidden', visibles > 0);
        conteo.textContent = visibles === filas.length
            ? (filas.length === 1 ? '1 material' : `${filas.length} materiales`)
            : `${visibles} de ${filas.length} materiales`;
        btnLimpiar.classList.toggle('hidden', !(texto || tipo || unidad || filtroEstado.value));
    };

    busqueda.addEventListener('input', aplicarFiltros);
    [filtroTipo, filtroUnidad, filtroEstado].forEach(sel => sel.addEventListener('change', aplicarFiltros));
    btnLimpiar.addEventListener('click', () => {
        busqueda.value = '';
        filtroTipo.value = '';
        filtroUnidad.value = '';
        filtroEstado.value = '';
        aplicarFiltros();
    });
})();
