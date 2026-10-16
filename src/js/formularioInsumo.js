import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { activarVerificacionCodigo } from './modalConfirmacion.js';

// Formulario de insumo: campos, validación, código DXF único y carga de foto. Antes vivía
// solo en src/js/insumos.js para el alta ("Nuevo insumo"); se separó acá al agregar la
// edición ("Editar insumo" en el perfil, admin/insumos/:id) porque son el mismo formulario
// con destino distinto — misma validación, mismo patrón de carga de foto, mismos nombres de
// campo (helpers/insumos.js ya los valida igual en los dos casos). La página que usa esto
// tiene que pintar el formulario con estos mismos ids (ver views/administrador/produccion/
// insumos.pug y insumoPerfil.pug): #codigoMaterial, #nombre, input[name=tipo], #unidadCompra,
// #imagen, #preview-imagen, #icono-imagen, #nombre-archivo-imagen, #label-nombre,
// #btn-guardar-insumo, #btn-limpiar-insumo, y un #error-<campo> por cada uno.
//
// La confirmación con código de empleado es opcional (`requiereCodigoEmpleado`): el alta no
// lo pide hoy, la edición sí — "ese tipo de cambios deben tener permisos de edición y el
// código de empleado debe ser imperativo". Mismo patrón que "Editar precios masivamente"
// (src/js/preciosMasivos.js): ventana de confirmación con el código adentro, botón
// deshabilitado hasta que se verifica en vivo contra `urlValidarEmpleado`.
export function activarFormularioInsumo(opts) {
    const {
        formId,
        urlGuardar,
        metodoGuardar = 'POST',
        idExcluir = null,          // idMaterial a excluir del chequeo de código único (edición)
        iconoConfirmacion = 'fi-rr-boxes',
        badgeConfirmacion,         // "Nuevo material" / "Confirmar cambios"
        confirmarTexto,            // texto del botón de confirmar ("Guardar insumo" / "Guardar cambios")
        badgeExito,                // "Material guardado" / "Material actualizado"
        requiereCodigoEmpleado = false,
        urlValidarEmpleado = null, // (codigo) => url, para activarVerificacionCodigo
        fotoOriginal = null,       // { url, nombreArchivo } — lo que "Limpiar" restaura, en vez del ícono genérico
        alGuardar                  // (data) => void — qué hacer tras un guardado exitoso
    } = opts;

    const form = document.getElementById(formId);
    if (!form) return;

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

    // Sin foto nueva elegida, "Limpiar" vuelve a la foto que ya tenía el material (edición) o
    // al ícono genérico (alta) — nunca a un estado que no existe en ninguno de los dos lados.
    const limpiarPreviewImagen = () => {
        if (urlPreviewImagenLocal) URL.revokeObjectURL(urlPreviewImagenLocal);
        urlPreviewImagenLocal = null;
        if (fotoOriginal?.url) {
            previewImagen.src = fotoOriginal.url;
            previewImagen.classList.remove('hidden');
            iconoImagen.classList.add('hidden');
            nombreArchivo.textContent = fotoOriginal.nombreArchivo || NOMBRE_ARCHIVO_BASE;
        } else {
            previewImagen.classList.add('hidden');
            previewImagen.removeAttribute('src');
            iconoImagen.classList.remove('hidden');
            nombreArchivo.textContent = NOMBRE_ARCHIVO_BASE;
        }
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
    pintarEtiquetaNombre(); // en edición ya llega un tipo marcado; que el rótulo lo refleje desde el inicio

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

    const CODIGO_EMP_INPUT  = 'formInsumo-codigo-empleado';
    const CODIGO_EMP_ESTADO = 'formInsumo-codigo-estado';

    const confirmar = (datos) => {
        const tipo = tipoElegido().dataset.etiqueta;
        const unidad = datos.unidadCompra ? campos.unidadCompra.selectedOptions[0].textContent : 'Sin unidad';
        const fila = (etiqueta, valor) => `<div class="gh-conf-fila"><dt>${etiqueta}</dt><dd>${esc(valor)}</dd></div>`;
        return Swal.fire(opcionesConfirmacion({
            variante: 'neutro',
            html: `
                <div class="gh-conf-html">
                    ${cabeceraConfirmacion({
                        icono: iconoConfirmacion,
                        badge: badgeConfirmacion,
                        contexto: esc(`${datos.nombre} · ${tipo}`)
                    })}
                    <dl class="px-7 py-5 flex flex-col gap-3">
                        ${fila('Código DXF', datos.codigoMaterial)}
                        ${fila('Nombre', datos.nombre)}
                        ${fila('Tipo', tipo)}
                        ${fila('Unidad', unidad)}
                    </dl>
                    ${requiereCodigoEmpleado ? `
                        <p class="gh-conf-campo-label">Código de empleado que autoriza</p>
                        ${campoCodigoEmpleado(CODIGO_EMP_INPUT, '1.75rem')}
                        <p class="gh-conf-estado" id="${CODIGO_EMP_ESTADO}"></p>
                    ` : ''}
                </div>`,
            showCancelButton: true,
            confirmButtonText: confirmarTexto,
            cancelButtonText: 'Cancelar',
            focusCancel: false,
            reverseButtons: true,
            didOpen: () => {
                if (!requiereCodigoEmpleado) return;
                const boton = Swal.getConfirmButton();
                boton.disabled = true;
                activarVerificacionCodigo(CODIGO_EMP_INPUT, CODIGO_EMP_ESTADO, (emp) => { boton.disabled = !emp; }, {
                    urlValidar: urlValidarEmpleado
                });
                document.getElementById(CODIGO_EMP_INPUT)?.focus();
            },
            preConfirm: () => {
                if (!requiereCodigoEmpleado) return {};
                const codigoEmpleado = codigoRequerido(CODIGO_EMP_INPUT, CODIGO_EMP_ESTADO);
                if (!codigoEmpleado) return false;
                return { codigoEmpleado };
            }
        }));
    };

    const guardar = async (datos) => {
        const btn = document.getElementById('btn-guardar-insumo');
        const textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Guardando…';
        try {
            // FormData, no JSON: la foto viaja en el mismo envío (campo "imagen").
            const body = new FormData();
            Object.entries(datos).forEach(([k, v]) => body.append(k, v ?? ''));
            if (campos.imagen.files[0]) body.append('imagen', campos.imagen.files[0]);

            const r = await fetch(urlGuardar, {
                method: metodoGuardar,
                headers: { 'CSRF-Token': CSRF }, // sin Content-Type: el navegador pone el boundary de multipart
                body
            });
            const data = await r.json().catch(() => ({}));

            // Código bloqueado por demasiados intentos fallidos (verificarCodigoEmpleadoAdmin):
            // la sesión ya se cerró en el servidor, no hay nada más que hacer acá que sacar a
            // la persona de una pantalla que ya no puede usar.
            if (data.logout) { window.location.href = '/'; return; }

            if (data.success) {
                await aviso({
                    variante: 'ingreso',
                    icono: 'fi-rr-check',
                    badge: badgeExito,
                    contexto: `${data.material.nombre} · código ${data.material.codigoMaterial}`
                });
                alGuardar?.(data);
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
        const { isConfirmed, value } = await confirmar(datos);
        if (!isConfirmed) return; // "Cancelar": la ventana de edición sigue ahí, intacta
        await guardar(value?.codigoEmpleado ? { ...datos, codigoEmpleado: value.codigoEmpleado } : datos);
    });

    // Al salir de un campo se valida ese campo. Mientras tiene error, se revalida al escribir
    // para que el mensaje desaparezca apenas se corrige.
    const revalidar = (nombre) => pintarError(nombre, validar()[nombre]);

    // El código DXF es único: al salir del campo se pregunta al servidor. Si ya existe, el
    // mensaje aparece y el cursor vuelve al campo para corregirlo. Si el formato ya está mal,
    // no se consulta: ese error es el que se muestra. En edición, `idExcluir` deja pasar el
    // propio código del material si no se cambió.
    const verificarCodigo = async () => {
        const codigo = campos.codigoMaterial.value.trim();
        if (!codigo || validar().codigoMaterial) return;
        try {
            const qs = idExcluir ? `?excluir=${encodeURIComponent(idExcluir)}` : '';
            const r = await fetch(`/admin/insumos/codigo/${encodeURIComponent(codigo)}${qs}`, { headers: { Accept: 'application/json' } });
            const data = await r.json();
            if (!data.success || campos.codigoMaterial.value.trim() !== codigo) return;
            codigoOcupado = data.existe ? codigo : null;
            revalidar('codigoMaterial');
            if (data.existe) {
                campos.codigoMaterial.focus();
                campos.codigoMaterial.select();
            }
        } catch {
            // Sin respuesta no se bloquea el formulario: el guardado rechaza el duplicado igual (409).
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
