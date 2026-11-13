import { opcionesConfirmacion, cabeceraConfirmacion } from './modalConfirmacion.js';
import { escaparHtml as esc } from './escaparHtml.js';
import { campoCodigoEmpleado, codigoRequerido } from './codigoCajitas.js';
import { activarVerificacionCodigo } from './modalConfirmacion.js';

// Formulario de insumo: campos, validación, código DXF único y carga de foto. Antes vivía
// solo en src/js/insumos.js para el alta ("Nuevo insumo"); se separó acá al agregar la
// edición ("Editar insumo" en el perfil, admin/insumos/:id) porque son el mismo formulario
// con destino distinto — misma validación, mismo patrón de carga de foto, mismos nombres de
// campo (helpers/insumos.js ya los valida igual en los dos casos). La página que usa esto
// tiene que pintar el formulario con estos mismos ids:
// #btn-modo-base, #btn-modo-variante (selector de modo)
// #panel-codigo-base (panel modo base) → #codigoMaterial
// #panel-codigo-variante (panel modo variante) → #grupoMaterial, #subCodigoMaterial,
//     #codigoResultante (span preview)
// #error-codigoMaterial, #error-grupoMaterial, #error-subCodigoMaterial
// #helper-codigo (párrafo de ayuda contextual)
// #nombre, #label-nombre, input[name=tipo], #unidadCompra
// #imagen, #preview-imagen, #icono-imagen, #nombre-archivo-imagen
// #btn-guardar-insumo, #btn-limpiar-insumo
//
// La confirmación con código de empleado es opcional (`requiereCodigoEmpleado`): el alta no
// lo pide hoy, la edición sí. Mismo patrón que "Editar precios masivamente".
export function activarFormularioInsumo(opts) {
    const {
        formId,
        urlGuardar,
        metodoGuardar = 'POST',
        idExcluir = null,
        iconoConfirmacion = 'fi-rr-boxes',
        badgeConfirmacion,
        confirmarTexto,
        badgeExito,
        requiereCodigoEmpleado = false,
        urlValidarEmpleado = null,
        fotoOriginal = null,
        alGuardar
    } = opts;

    const form = document.getElementById(formId);
    if (!form) return;

    const CSRF = form.dataset.csrf;
    const LIM  = { nombreMax: Number(form.dataset.nombreMax) };

    // ── MODO DE CÓDIGO (base vs variante) ───────────────────────────────────────
    let modoVariante   = true;  // variante es el modo por defecto
    let grupos         = null;  // cache: null = no cargado, [] = vacío, [...] = cargado
    let codigoOcupado  = null;  // último código que el servidor confirmó como ocupado

    const btnModoBase      = document.getElementById('btn-modo-base');
    const btnModoVariante  = document.getElementById('btn-modo-variante');
    const panelBase        = document.getElementById('panel-codigo-base');
    const panelVariante    = document.getElementById('panel-codigo-variante');
    const codigoResultante = document.getElementById('codigoResultante');
    const helperCodigo     = document.getElementById('helper-codigo');

    const HELPERS = {
        base:     'Es el número principal del material en el archivo DXF (1, 2, 3…). No puede repetirse.',
        variante: 'El código se forma como [base].[variante]. El número de variante debe ser único dentro del mismo material base.'
    };

    const campos = {
        codigoMaterial:    document.getElementById('codigoMaterial'),
        grupoMaterial:     document.getElementById('grupoMaterial'),
        subCodigoMaterial: document.getElementById('subCodigoMaterial'),
        nombre:            document.getElementById('nombre'),
        unidadCompra:      document.getElementById('unidadCompra'),
        imagen:            document.getElementById('imagen')
    };
    // imagen no entra a validar(): el único error posible lo manda el servidor.
    const CAMPOS = ['codigoMaterial', 'grupoMaterial', 'subCodigoMaterial', 'nombre', 'tipo', 'unidadCompra', 'imagen'];

    // ── FOTO ────────────────────────────────────────────────────────────────────
    const previewImagen  = document.getElementById('preview-imagen');
    const iconoImagen    = document.getElementById('icono-imagen');
    const nombreArchivo  = document.getElementById('nombre-archivo-imagen');
    const NOMBRE_ARCHIVO_BASE = nombreArchivo?.textContent;
    let urlPreviewImagenLocal = null;

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

    // ── LABEL DEL NOMBRE ────────────────────────────────────────────────────────
    const tipoElegido = () => form.querySelector('input[name="tipo"]:checked');

    const etiquetaNombre     = document.getElementById('label-nombre');
    const ETIQUETA_NOMBRE_BASE = etiquetaNombre.textContent;
    const pintarEtiquetaNombre = () => {
        const tipo = tipoElegido();
        etiquetaNombre.textContent = tipo ? `Nombre ${tipo.dataset.etiquetaNombre}` : ETIQUETA_NOMBRE_BASE;
    };
    pintarEtiquetaNombre();

    // ── HELPERS DE MODO ─────────────────────────────────────────────────────────
    const activarEstiloBoton = (variante) => {
        if (!btnModoBase || !btnModoVariante) return;
        btnModoBase.classList.toggle('btn-danger',    !variante);
        btnModoBase.classList.toggle('btn-secondary',  variante);
        btnModoVariante.classList.toggle('btn-danger',    variante);
        btnModoVariante.classList.toggle('btn-secondary', !variante);
    };

    const actualizarCodigoResultante = () => {
        if (!codigoResultante) return;
        const grupo = campos.grupoMaterial?.value;
        const sub   = campos.subCodigoMaterial?.value.trim();
        if (grupo && sub && /^\d{1,10}$/.test(sub)) {
            codigoResultante.textContent = `${grupo}.${sub}`;
            codigoResultante.classList.remove('text-slate-400');
            codigoResultante.classList.add('text-slate-700', 'font-semibold');
        } else {
            codigoResultante.textContent = '—';
            codigoResultante.classList.add('text-slate-400');
            codigoResultante.classList.remove('text-slate-700', 'font-semibold');
        }
    };

    // Carga los materiales cabeza de grupo desde el servidor (una sola vez).
    const cargarGrupos = async () => {
        if (grupos !== null) return grupos;
        try {
            const r = await fetch('/admin/insumos/grupos', { headers: { Accept: 'application/json' } });
            const data = await r.json();
            grupos = data.grupos || [];
        } catch {
            grupos = [];
        }
        if (!campos.grupoMaterial) return grupos;
        campos.grupoMaterial.innerHTML = grupos.length
            ? `<option value="">— elige el material base —</option>` +
              grupos.map(g => `<option value="${esc(g.codigoMaterial)}">${esc(g.codigoMaterial)} — ${esc(g.nombre)}</option>`).join('')
            : `<option value="">No hay materiales base creados aún</option>`;
        return grupos;
    };

    const cambiarModo = async (variante) => {
        modoVariante  = variante;
        codigoOcupado = null;
        pintarTodos();
        panelBase?.classList.toggle('hidden',  variante);
        panelVariante?.classList.toggle('hidden', !variante);
        if (helperCodigo) helperCodigo.textContent = variante ? HELPERS.variante : HELPERS.base;
        activarEstiloBoton(variante);
        if (variante) await cargarGrupos();
    };

    btnModoBase?.addEventListener('click',     () => cambiarModo(false));
    btnModoVariante?.addEventListener('click', () => cambiarModo(true));

    // Inicializar desde el código existente del material (formulario de edición).
    // `data-codigo-material` lo pone insumoPerfil.pug; en el alta no existe.
    const codigoInicial = form.dataset.codigoMaterial || '';
    if (codigoInicial.includes('.')) {
        const [grupoInicial, subInicial] = codigoInicial.split('.');
        (async () => {
            await cambiarModo(true);
            if (campos.grupoMaterial) {
                campos.grupoMaterial.value = grupoInicial;
                // Si el material base ya no existe (fue eliminado), el select queda en ''.
            }
            if (campos.subCodigoMaterial) campos.subCodigoMaterial.value = subInicial;
            actualizarCodigoResultante();
        })();
    } else if (codigoInicial) {
        // edición con código base → cambiar a modo base
        cambiarModo(false);
    } else {
        // alta nueva → ya empieza en variante, cargar grupos de inmediato
        cargarGrupos();
    }

    // ── VALIDACIÓN Y LECTURA ─────────────────────────────────────────────────────
    const leerCodigo = () => {
        if (modoVariante) {
            const grupo = campos.grupoMaterial?.value;
            const sub   = campos.subCodigoMaterial?.value.trim();
            return (grupo && sub) ? `${grupo}.${sub}` : '';
        }
        return campos.codigoMaterial?.value.trim() || '';
    };

    const validar = () => {
        const e = {};
        if (modoVariante) {
            if (!campos.grupoMaterial?.value) {
                e.grupoMaterial = 'Elige el material base.';
            }
            const sub = campos.subCodigoMaterial?.value.trim() || '';
            if (!sub) {
                e.subCodigoMaterial = 'Escribe el número de variante.';
            } else if (!/^\d{1,10}$/.test(sub)) {
                e.subCodigoMaterial = 'El número de variante debe ser un número entero (ej: 1).';
            } else if (!e.grupoMaterial) {
                const assembled = leerCodigo();
                if (codigoOcupado === assembled) {
                    e.codigoMaterial = `Ya existe una variante con el código ${assembled}.`;
                }
            }
        } else {
            const codigoTxt = campos.codigoMaterial?.value.trim() || '';
            if (!codigoTxt) {
                e.codigoMaterial = 'Escribe el código del material, el número que trae el DXF.';
            } else if (!/^\d{1,10}$/.test(codigoTxt)) {
                e.codigoMaterial = 'El código base debe ser un número entero (ej: 1).';
            } else if (codigoOcupado === codigoTxt) {
                e.codigoMaterial = `Ya existe un material con el código ${codigoTxt}.`;
            }
        }

        const nombre = campos.nombre?.value.trim() || '';
        if (!nombre) e.nombre = 'Escribe el nombre del material.';
        else if (nombre.length > LIM.nombreMax) e.nombre = `El nombre no puede pasar de ${LIM.nombreMax} caracteres.`;

        if (!tipoElegido()) e.tipo = 'Elige si es materia prima o insumo.';
        return e;
    };

    const leer = () => ({
        codigoMaterial: leerCodigo(),
        nombre:         campos.nombre?.value.trim(),
        tipo:           tipoElegido()?.value,
        unidadCompra:   campos.unidadCompra?.value || null
    });

    // ── PINTADO DE ERRORES ───────────────────────────────────────────────────────
    const pintarError = (nombre, mensaje) => {
        const texto = document.getElementById(`error-${nombre}`);
        if (texto) {
            texto.textContent = mensaje || '';
            texto.classList.toggle('hidden', !mensaje);
        }
        campos[nombre]?.classList.toggle('field-text-error', Boolean(mensaje));
        campos[nombre]?.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    };

    const pintarTodos = (errores = {}) => CAMPOS.forEach(n => pintarError(n, errores[n]));

    const enfocar = (nombre) => {
        if (nombre === 'tipo') form.querySelector('input[name="tipo"]')?.focus();
        else campos[nombre]?.focus();
    };

    // ── VENTANAS ─────────────────────────────────────────────────────────────────
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
        const tipo   = tipoElegido().dataset.etiqueta;
        const unidad = datos.unidadCompra ? campos.unidadCompra.selectedOptions[0].textContent : 'Sin unidad';
        const fila   = (etiqueta, valor) => `<div class="gh-conf-fila"><dt>${etiqueta}</dt><dd>${esc(valor)}</dd></div>`;
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

    // ── GUARDADO ─────────────────────────────────────────────────────────────────
    const guardar = async (datos) => {
        const btn = document.getElementById('btn-guardar-insumo');
        const textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Guardando…';
        try {
            const body = new FormData();
            Object.entries(datos).forEach(([k, v]) => body.append(k, v ?? ''));
            if (campos.imagen.files[0]) body.append('imagen', campos.imagen.files[0]);

            const r = await fetch(urlGuardar, {
                method: metodoGuardar,
                headers: { 'CSRF-Token': CSRF },
                body
            });
            const data = await r.json().catch(() => ({}));

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

    // ── SUBMIT ───────────────────────────────────────────────────────────────────
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const errores = validar();
        pintarTodos(errores);
        const primero = CAMPOS.find(n => errores[n]);
        if (primero) { enfocar(primero); return; }

        const datos = leer();
        const { isConfirmed, value } = await confirmar(datos);
        if (!isConfirmed) return;
        await guardar(value?.codigoEmpleado ? { ...datos, codigoEmpleado: value.codigoEmpleado } : datos);
    });

    // ── VERIFICACIÓN DE CÓDIGO ÚNICO ─────────────────────────────────────────────
    const revalidar = (nombre) => pintarError(nombre, validar()[nombre]);

    const verificarCodigo = async () => {
        const codigo = leerCodigo();
        if (!codigo) return;
        // Si hay errores locales (formato), no consultar al servidor.
        const e = validar();
        if (e.codigoMaterial || e.grupoMaterial || e.subCodigoMaterial) return;
        try {
            const qs = idExcluir ? `?excluir=${encodeURIComponent(idExcluir)}` : '';
            const r = await fetch(`/admin/insumos/codigo/${encodeURIComponent(codigo)}${qs}`, { headers: { Accept: 'application/json' } });
            const data = await r.json();
            if (!data.success || leerCodigo() !== codigo) return;
            codigoOcupado = data.existe ? codigo : null;
            if (modoVariante) {
                pintarError('codigoMaterial', codigoOcupado ? `Ya existe una variante con el código ${codigoOcupado}.` : '');
                if (data.existe) campos.subCodigoMaterial?.focus();
            } else {
                revalidar('codigoMaterial');
                if (data.existe) { campos.codigoMaterial?.focus(); campos.codigoMaterial?.select(); }
            }
        } catch {
            // Sin respuesta no se bloquea el formulario: el servidor rechaza el duplicado igual (409).
        }
    };

    // ── EVENT LISTENERS ──────────────────────────────────────────────────────────
    // Modo base: campo de código simple
    campos.codigoMaterial?.addEventListener('blur', async () => {
        revalidar('codigoMaterial');
        await verificarCodigo();
    });
    campos.codigoMaterial?.addEventListener('input', () => {
        codigoOcupado = null;
        if (!document.getElementById('error-codigoMaterial')?.classList.contains('hidden')) revalidar('codigoMaterial');
    });

    // Modo variante: grupo y número de variante
    campos.grupoMaterial?.addEventListener('change', () => {
        codigoOcupado = null;
        pintarError('grupoMaterial', validar().grupoMaterial);
        actualizarCodigoResultante();
        if (campos.subCodigoMaterial?.value.trim()) verificarCodigo();
    });
    campos.subCodigoMaterial?.addEventListener('blur', async () => {
        pintarError('subCodigoMaterial', validar().subCodigoMaterial);
        await verificarCodigo();
    });
    campos.subCodigoMaterial?.addEventListener('input', () => {
        codigoOcupado = null;
        actualizarCodigoResultante();
        if (!document.getElementById('error-subCodigoMaterial')?.classList.contains('hidden')) {
            pintarError('subCodigoMaterial', validar().subCodigoMaterial);
        }
        if (!document.getElementById('error-codigoMaterial')?.classList.contains('hidden')) {
            pintarError('codigoMaterial', '');
        }
    });

    campos.nombre?.addEventListener('blur', () => revalidar('nombre'));
    campos.nombre?.addEventListener('input', () => {
        if (!document.getElementById('error-nombre')?.classList.contains('hidden')) revalidar('nombre');
    });
    campos.unidadCompra?.addEventListener('change', () => pintarError('unidadCompra', validar().unidadCompra));
    campos.imagen?.addEventListener('change', () => {
        pintarError('imagen', '');
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
        // Volver al modo base y limpiar todos los errores y el preview del código compuesto.
        modoVariante = false;
        panelBase?.classList.remove('hidden');
        panelVariante?.classList.add('hidden');
        activarEstiloBoton(false);
        actualizarCodigoResultante();
        if (helperCodigo) helperCodigo.textContent = HELPERS.base;
        pintarTodos();
        pintarEtiquetaNombre();
        limpiarPreviewImagen();
    });
}
