const CSRF_TOKEN = document.getElementById('csrfBatch')?.value || '';

// ─── SUPPLIER AUTOCOMPLETE ─────────────────────────────────────
const proveedorInput   = document.getElementById('proveedorInput');
const proveedorDropdown = document.getElementById('proveedorDropdown');
const idProveedorSel   = document.getElementById('idProveedorSel');
let debounceTimer;

function renderDropdown(items) {
    proveedorDropdown.innerHTML = '';

    if (items.length > 0) {
        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'px-4 py-3 text-sm cursor-pointer hover:bg-pink-50 flex flex-col border-b border-gray-50 last:border-0';
            el.innerHTML = `<span class="font-semibold text-gray-800">${item.razonSocial}</span><span class="text-xs text-gray-400">${item.taxIdSupplier || ''}</span>`;
            el.addEventListener('click', () => {
                proveedorInput.value = item.razonSocial;
                idProveedorSel.value = item.idProveedor;
                proveedorDropdown.classList.add('hidden');
            });
            proveedorDropdown.appendChild(el);
        });
    } else {
        const noResult = document.createElement('div');
        noResult.className = 'px-4 py-3 text-sm text-gray-400 italic';
        noResult.textContent = 'Sin resultados';
        proveedorDropdown.appendChild(noResult);
    }

    const crearNuevo = document.createElement('div');
    crearNuevo.className = 'px-4 py-3 text-sm cursor-pointer hover:bg-blue-50 border-t border-gray-100 flex items-center gap-2 text-blue-600 font-semibold';
    crearNuevo.innerHTML = '<i class="fi fi-rr-plus-small text-base"></i> Crear nuevo proveedor';
    crearNuevo.addEventListener('click', () => {
        proveedorDropdown.classList.add('hidden');
        abrirModal();
    });
    proveedorDropdown.appendChild(crearNuevo);

    proveedorDropdown.classList.remove('hidden');
}

async function buscarProveedores(q) {
    try {
        const resp = await fetch(`/admin/json/provedores/?busqueda=${encodeURIComponent(q)}`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.provedores || data.rows || [];
    } catch { return []; }
}

proveedorInput?.addEventListener('input', () => {
    const q = proveedorInput.value.trim();
    idProveedorSel.value = '';
    clearTimeout(debounceTimer);
    if (q.length < 2) { proveedorDropdown.classList.add('hidden'); return; }
    debounceTimer = setTimeout(async () => {
        const results = await buscarProveedores(q);
        renderDropdown(results);
    }, 300);
});

document.addEventListener('click', e => {
    if (!proveedorInput?.contains(e.target) && !proveedorDropdown?.contains(e.target)) {
        proveedorDropdown?.classList.add('hidden');
    }
});

// ─── MODAL NUEVO PROVEEDOR ─────────────────────────────────────
const modalEl = document.getElementById('modalNuevoProvedor');

function abrirModal() {
    modalEl.classList.remove('hidden');
    modalEl.classList.add('flex');
}

function cerrarModal() {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('flex');
    ['modal-razonSocial','modal-nit','modal-direccion','modal-email','modal-nombreContacto','modal-telefono']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const deptSel = document.getElementById('modal-departamento');
    if (deptSel) deptSel.value = '';
    const ciudadSel = document.getElementById('modal-ciudad');
    if (ciudadSel) ciudadSel.innerHTML = '<option value="">-- Selecciona depto primero --</option>';
    document.querySelectorAll('.cat-modal-checkbox').forEach(cb => { cb.checked = false; });
    const docsInput = document.getElementById('modal-documentos');
    if (docsInput) docsInput.value = '';
    const docsPreview = document.getElementById('modal-preview-docs');
    if (docsPreview) docsPreview.innerHTML = '';
}

document.getElementById('modal-documentos')?.addEventListener('change', function () {
    const container = document.getElementById('modal-preview-docs');
    container.innerHTML = '';
    Array.from(this.files).forEach(file => {
        const ext  = file.name.split('.').pop().toLowerCase();
        const isPdf = ext === 'pdf';
        const isImg = ['jpg','jpeg','png','webp','gif'].includes(ext);
        const chip  = document.createElement('div');
        chip.className = 'flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700';
        chip.innerHTML = `
            <i class="fi ${isPdf ? 'fi-rr-file-pdf text-red-400' : isImg ? 'fi-rr-picture text-blue-400' : 'fi-rr-file text-gray-400'} text-base"></i>
            <span class="max-w-[140px] truncate font-medium">${file.name}</span>
            <span class="text-gray-400">${(file.size / 1024).toFixed(0)} KB</span>`;
        container.appendChild(chip);
    });
});

document.getElementById('btnCerrarModal')?.addEventListener('click', cerrarModal);
document.getElementById('btnCancelarModal')?.addEventListener('click', cerrarModal);

modalEl?.addEventListener('click', e => { if (e.target === modalEl) cerrarModal(); });

document.getElementById('modal-departamento')?.addEventListener('change', async function() {
    const deptId = this.value;
    const ciudadSel = document.getElementById('modal-ciudad');
    ciudadSel.innerHTML = '<option value="">Cargando...</option>';
    if (!deptId) { ciudadSel.innerHTML = '<option value="">-- Selecciona depto primero --</option>'; return; }
    try {
        const resp = await fetch(`/admin/json/municipios/${deptId}`);
        const data = await resp.json();
        ciudadSel.innerHTML = '<option value="">-- Selecciona ciudad --</option>';
        data.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nombre;
            ciudadSel.appendChild(opt);
        });
    } catch { ciudadSel.innerHTML = '<option value="">Error cargando</option>'; }
});

document.getElementById('btnGuardarProveedor')?.addEventListener('click', async () => {
    const razonSocial = document.getElementById('modal-razonSocial').value.trim();
    const nit         = document.getElementById('modal-nit').value.trim();
    const depto       = document.getElementById('modal-departamento').value;
    const ciudad      = document.getElementById('modal-ciudad').value;
    const direccion   = document.getElementById('modal-direccion').value.trim();
    const email       = document.getElementById('modal-email').value.trim();
    const contacto    = document.getElementById('modal-nombreContacto').value.trim();
    const telefono    = document.getElementById('modal-telefono').value.trim();
    const categorias  = [...document.querySelectorAll('.cat-modal-checkbox:checked')].map(cb => cb.value);

    if (!razonSocial || !nit) {
        Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Razón Social y NIT son obligatorios.' });
        return;
    }
    if (categorias.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Categoría requerida', text: 'Selecciona al menos una categoría.' });
        return;
    }

    const docsInput   = document.getElementById('modal-documentos');
    const docsArchivos = Array.from(docsInput?.files || []);
    const extsOkDocs  = ['pdf','jpg','jpeg','png','webp','gif','xls','xlsx','doc','docx'];
    for (const file of docsArchivos) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!extsOkDocs.includes(ext)) {
            Swal.fire({ icon: 'warning', title: 'Archivo no permitido', text: `"${file.name}" no es válido. Solo: PDF, JPG, PNG, GIF, XLS, DOC.` });
            return;
        }
    }

    const fd = new FormData();
    fd.append('_csrf', CSRF_TOKEN);
    fd.append('razonSocial', razonSocial);
    fd.append('nit', nit);
    fd.append('departamentoSelect', depto);
    fd.append('ciudadSelect', ciudad);
    fd.append('direccionProvedor', direccion);
    fd.append('emailProvedor', email);
    fd.append('nombreContacto', contacto);
    fd.append('telefonoContacto', telefono);
    categorias.forEach(c => fd.append('categorias', c));
    docsArchivos.forEach(file => fd.append('documentos', file));

    const btn = document.getElementById('btnGuardarProveedor');
    btn.disabled = true;
    btn.innerHTML = '<i class="fi fi-rr-spinner"></i> Guardando...';

    try {
        const resp = await fetch('/admin/provedores/new', { method: 'POST', body: fd });
        const data = await resp.json();
        if (data.success) {
            proveedorInput.value = data.razonSocial || razonSocial;
            idProveedorSel.value = data.idProveedor || '';
            cerrarModal();
            Swal.fire({ icon: 'success', title: 'Proveedor guardado', timer: 1500, showConfirmButton: false });
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje });
        }
    } catch {
        Swal.fire({ icon: 'error', title: 'Error de red', text: 'No se pudo guardar el proveedor.' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fi fi-rr-disk"></i>  Guardar Proveedor';
    }
});

// ─── CRÉDITO SWITCH ────────────────────────────────────────────
document.getElementById('switchCredito')?.addEventListener('change', function() {
    const campos = document.getElementById('camposCredito');
    if (this.checked) {
        campos.classList.remove('hidden');
    } else {
        campos.classList.add('hidden');
    }
});

// ─── PRODUCT ROWS ──────────────────────────────────────────────
let rowCount = 0;
const tablaProductos = document.getElementById('tablaProductos');

function recalcularTotales() {
    let totalUnidades  = 0;
    let subtotal       = 0;
    let totalImpuestos = 0;
    document.querySelectorAll('.fila-producto').forEach(tr => {
        const cant  = parseInt(tr.querySelector('.cantidad-input').value) || 0;
        const valor = window.parseMoney(tr.querySelector('.valor-input').value);
        totalUnidades  += cant;
        subtotal       += cant * valor;
        totalImpuestos += parseFloat(tr.dataset.impCalc) || 0;
    });
    document.getElementById('totalUnidades').textContent  = totalUnidades.toLocaleString('es-CO');
    document.getElementById('totalSubtotal').textContent  = window.formatMoney(subtotal, 0);
    document.getElementById('totalImpuestos').textContent = window.formatMoney(totalImpuestos, 0);
    document.getElementById('totalFinal').textContent     = window.formatMoney(subtotal + totalImpuestos, 0);
}

function calcularImpuesto(tr) {
    const cant   = parseInt(tr.querySelector('.cantidad-input').value) || 0;
    const valor  = window.parseMoney(tr.querySelector('.valor-input').value);
    const esPct  = tr.querySelector('.impuesto-switch').checked;
    const rawImp = tr.querySelector('.impuesto-input').value;
    if (esPct) {
        const pct = Math.min(parseFloat(rawImp) || 0, 100);
        return Math.round((pct / 100) * cant * valor);
    }
    return window.parseMoney(rawImp);
}

function recalcularFila(tr) {
    const cant  = parseInt(tr.querySelector('.cantidad-input').value) || 0;
    const valor = window.parseMoney(tr.querySelector('.valor-input').value);
    const imp   = calcularImpuesto(tr);
    tr.dataset.impCalc = imp;
    tr.querySelector('.subtotal-span').textContent = window.formatMoney(cant * valor + imp, 0);
    recalcularTotales();
}

async function validarSKU(tr) {
    const skuInput    = tr.querySelector('.sku-input');
    const nombreInput = tr.querySelector('.nombre-input');
    const idInput     = tr.querySelector('.id-producto-input');
    const statusEl    = tr.querySelector('.sku-status');
    const addLink     = tr.querySelector('.sku-add-link');
    const sku = skuInput.value.trim().toUpperCase();
    if (!sku) return;

    statusEl.textContent = '⟳';
    statusEl.className = 'sku-status absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400';
    addLink.classList.add('hidden');

    try {
        const resp = await fetch(`/admin/json/sku/${encodeURIComponent(sku)}`);
        if (resp.status === 404) {
            statusEl.textContent = '✗';
            statusEl.className = 'sku-status absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500 font-bold';
            nombreInput.value = '';
            idInput.value = '';
            skuInput.classList.add('border-red-400');
            addLink.classList.remove('hidden');
            return;
        }
        const data = await resp.json();
        nombreInput.value = data.nombreProducto || '';
        idInput.value     = data.idProducto     || '';
        skuInput.value    = data.sku || sku;
        skuInput.classList.remove('border-red-400');
        statusEl.textContent = '✓';
        statusEl.className = 'sku-status absolute right-2 top-1/2 -translate-y-1/2 text-xs text-green-500 font-bold';
        addLink.classList.add('hidden');
        tr.querySelector('.cantidad-input').focus();
    } catch {
        statusEl.textContent = '✗';
        statusEl.className = 'sku-status absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500 font-bold';
        addLink.classList.remove('hidden');
    }
}

function crearFila() {
    const idx = rowCount++;
    const tr  = document.createElement('tr');
    tr.className    = 'fila-producto border-b border-gray-100 hover:bg-gray-50/50 transition-colors';
    tr.dataset.idx  = idx;
    tr.dataset.impCalc = 0;
    tr.innerHTML = `
        <td class="py-2 px-3">
            <div class="relative">
                <input type="text" class="field-text sku-input text-sm uppercase" placeholder="SKU001" data-idx="${idx}">
                <span class="sku-status absolute right-2 top-1/2 -translate-y-1/2 text-xs"></span>
            </div>
            <a class="sku-add-link hidden mt-1 text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1 cursor-pointer" href="/admin/inventario/ingreso" target="_blank">
                <i class="fi fi-rr-plus-small"></i> Agregar producto
            </a>
        </td>
        <td class="py-2 px-3">
            <input type="text" class="field-text nombre-input text-sm bg-gray-50" readonly placeholder="—" data-idx="${idx}">
            <input type="hidden" class="id-producto-input" data-idx="${idx}">
        </td>
        <td class="py-2 px-3">
            <input type="number" class="field-text cantidad-input text-sm text-center" value="1" min="1" data-idx="${idx}">
        </td>
        <td class="py-2 px-3">
            <input type="text" class="field-text valor-input text-sm text-right" value="0" placeholder="0" data-idx="${idx}">
        </td>
        <td class="py-2 px-3">
            <div class="imp-container flex items-center rounded-lg border border-gray-300 bg-white transition-all overflow-hidden">
                <input type="text" class="impuesto-input flex-1 min-w-0 px-2 py-2 text-sm text-right bg-transparent outline-none" value="0" placeholder="0" data-idx="${idx}">
                <div class="w-px self-stretch bg-gray-200 my-1.5 flex-shrink-0"></div>
                <label class="flex items-center gap-1 pl-1.5 pr-2 cursor-pointer select-none flex-shrink-0" title="Activar cálculo por porcentaje">
                    <span class="text-xs font-bold text-gray-400 leading-none">%</span>
                    <input type="checkbox" class="impuesto-switch sr-only" data-idx="${idx}">
                    <span class="imp-track relative inline-flex w-7 h-3.5 rounded-full flex-shrink-0 transition-colors" style="background:#d1d5db">
                        <span class="imp-thumb absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform"></span>
                    </span>
                </label>
            </div>
        </td>
        <td class="py-2 px-3 text-right">
            <span class="subtotal-span text-sm font-semibold text-gray-700">$0</span>
        </td>
        <td class="py-2 px-2 text-center">
            <button type="button" class="btn-eliminar-fila text-gray-300 hover:text-red-500 transition-colors text-lg leading-none" data-idx="${idx}">
                <i class="fi fi-rr-trash"></i>
            </button>
        </td>
    `;

    tablaProductos.appendChild(tr);

    const skuInput      = tr.querySelector('.sku-input');
    const cantidadInput = tr.querySelector('.cantidad-input');
    const valorInput    = tr.querySelector('.valor-input');
    const impuestoInput = tr.querySelector('.impuesto-input');
    const impSwitch     = tr.querySelector('.impuesto-switch');
    const impContainer  = tr.querySelector('.imp-container');

    impuestoInput.addEventListener('focus', () => {
        impContainer.style.borderColor = '#EC5FA3';
        impContainer.style.boxShadow   = '0 0 0 2px rgba(236,95,163,0.25)';
    });
    impuestoInput.addEventListener('blur', () => {
        impContainer.style.borderColor = '';
        impContainer.style.boxShadow   = '';
    });

    skuInput.addEventListener('input',   () => { tr.querySelector('.sku-add-link').classList.add('hidden'); });
    skuInput.addEventListener('blur',    () => validarSKU(tr));
    skuInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); validarSKU(tr); } });

    window.initMoneyInput(valorInput);

    // Impuesto: mode-aware handler ($ = miles format, % = integer 0-100)
    impuestoInput.addEventListener('input', function () {
        if (impSwitch.checked) {
            let val = parseInt(this.value.replace(/\D/g, ''), 10);
            if (isNaN(val)) val = 0;
            if (val > 100) val = 100;
            this.value = val === 0 ? '' : String(val);
        } else {
            const cursor    = this.selectionStart;
            const original  = this.value;
            const digits    = original.replace(/\D/g, '');
            const formatted = digits ? new Intl.NumberFormat('es-CO').format(digits) : '';
            const diff      = formatted.length - original.length;
            this.value      = formatted;
            this.setSelectionRange(cursor + diff, cursor + diff);
        }
        recalcularFila(tr);
    });

    impSwitch.addEventListener('change', function () {
        const track = this.nextElementSibling;
        const thumb = track.querySelector('.imp-thumb');
        if (this.checked) {
            track.style.background = '#EC5FA3';
            thumb.style.transform  = 'translateX(14px)';
        } else {
            track.style.background = '#d1d5db';
            thumb.style.transform  = 'translateX(0)';
        }
        impuestoInput.value       = '0';
        impuestoInput.placeholder = this.checked ? '0 – 100' : '0';
        recalcularFila(tr);
    });

    cantidadInput.addEventListener('input', () => recalcularFila(tr));
    valorInput.addEventListener('input',    () => recalcularFila(tr));

    tr.querySelector('.btn-eliminar-fila').addEventListener('click', () => {
        tr.remove();
        recalcularTotales();
    });

    skuInput.focus();
}

document.getElementById('btnAgregarFila')?.addEventListener('click', () => {
    const filas = document.querySelectorAll('.fila-producto');
    for (const tr of filas) {
        const idProducto  = tr.querySelector('.id-producto-input').value;
        const valorUnidad = window.parseMoney(tr.querySelector('.valor-input').value);
        if (!idProducto) {
            Swal.fire({ icon: 'warning', title: 'SKU inválido', text: 'Verifica que todos los SKUs estén validados antes de agregar otra fila.' });
            tr.querySelector('.sku-input').focus();
            return;
        }
        if (valorUnidad <= 0) {
            Swal.fire({ icon: 'warning', title: 'Valor unidad inválido', text: 'Todos los productos deben tener un valor unitario mayor a 0.' });
            tr.querySelector('.valor-input').focus();
            return;
        }
    }
    crearFila();
});

// ─── FILE UPLOAD PREVIEW ──────────────────────────────────────
document.getElementById('uploadFacturas')?.addEventListener('change', function() {
    const container = document.getElementById('preview-facturas');
    container.innerHTML = '';
    Array.from(this.files).forEach(file => {
        const isPdf = file.type === 'application/pdf';
        const chip = document.createElement('div');
        chip.className = 'flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700';
        chip.innerHTML = `
            <i class="fi ${isPdf ? 'fi-rr-file-pdf text-red-400' : 'fi-rr-picture text-blue-400'} text-base"></i>
            <span class="max-w-[160px] truncate font-medium">${file.name}</span>
            <span class="text-gray-400">${(file.size / 1024).toFixed(0)} KB</span>
        `;
        container.appendChild(chip);
    });
});

// ─── FORM SUBMIT ───────────────────────────────────────────────
document.getElementById('formBatchOrder')?.addEventListener('submit', async e => {
    e.preventDefault();

    const fmt = v => window.formatMoney(v, 0);

    // ── 1. Campos requeridos ──────────────────────────────────
    const idProveedor         = document.getElementById('idProveedorSel').value;
    const proveedorNombre     = document.getElementById('proveedorInput').value.trim();
    const nroFactura          = document.getElementById('nroFactura').value.trim();
    const fechaFactura        = document.getElementById('fechaFactura').value;
    const destinoSel          = document.getElementById('idPuntoVentaDestino');
    const idPuntoVentaDestino = destinoSel.value;
    const destinoNombre       = destinoSel.options[destinoSel.selectedIndex]?.text || '';
    const esCredito           = document.getElementById('switchCredito').checked;
    const fechaPago           = document.getElementById('fechaPago')?.value || '';
    const valorAbono          = window.parseMoney(document.getElementById('valorAbono')?.value || '0');

    if (!idProveedor)         { Swal.fire({ icon:'warning', title:'Proveedor requerido',    text:'Selecciona o crea un proveedor.' }); return; }
    if (!nroFactura)          { Swal.fire({ icon:'warning', title:'Nro. Factura requerido', text:'Ingresa el número de la factura del proveedor.' }); return; }
    if (!fechaFactura)        { Swal.fire({ icon:'warning', title:'Fecha requerida',        text:'Ingresa la fecha de la factura.' }); return; }
    if (!idPuntoVentaDestino) { Swal.fire({ icon:'warning', title:'Destino requerido',      text:'Selecciona el punto de venta destino.' }); return; }

    // ── 2. Validación crédito ─────────────────────────────────
    const hoy = new Date().toISOString().split('T')[0];
    if (esCredito) {
        if (!fechaPago) {
            Swal.fire({ icon:'warning', title:'Fecha de pago requerida', text:'Con la opción "A crédito" debes indicar una fecha de pago.' }); return;
        }
        if (fechaPago <= hoy) {
            Swal.fire({ icon:'warning', title:'Fecha de pago inválida', text:'La fecha de pago debe ser posterior a hoy.' }); return;
        }
        if (valorAbono < 0) {
            Swal.fire({ icon:'warning', title:'Valor abono inválido', text:'El valor abonado no puede ser negativo.' }); return;
        }
    }

    // ── 3. Filas de productos ─────────────────────────────────
    const filas = document.querySelectorAll('.fila-producto');
    if (filas.length === 0) { Swal.fire({ icon:'warning', title:'Sin productos', text:'Agrega al menos un producto.' }); return; }

    const productos = [];
    for (const tr of filas) {
        const idProducto   = tr.querySelector('.id-producto-input').value;
        const sku          = tr.querySelector('.sku-input').value.trim().toUpperCase();
        const nombre       = tr.querySelector('.nombre-input').value.trim();
        const cantidad     = parseInt(tr.querySelector('.cantidad-input').value) || 0;
        const valorUnidad  = window.parseMoney(tr.querySelector('.valor-input').value);
        const impuestos    = parseFloat(tr.dataset.impCalc) || 0;
        const tipoImpuesto = tr.querySelector('.impuesto-switch').checked ? 'porcentaje' : 'valor';

        if (!idProducto) {
            Swal.fire({ icon:'warning', title:'SKU sin validar', text:`El SKU "${sku}" no fue encontrado. Valídalo o agrega el producto primero.` });
            tr.querySelector('.sku-input').focus(); return;
        }
        if (cantidad <= 0) {
            Swal.fire({ icon:'warning', title:'Cantidad inválida', text:`La cantidad del producto "${nombre}" debe ser mayor a 0.` });
            tr.querySelector('.cantidad-input').focus(); return;
        }
        if (valorUnidad <= 0) {
            Swal.fire({ icon:'warning', title:'Valor unitario inválido', text:`El valor unitario de "${nombre}" debe ser mayor a 0.` });
            tr.querySelector('.valor-input').focus(); return;
        }

        const subtotal = cantidad * valorUnidad;
        const total    = subtotal + impuestos;
        productos.push({ idProducto, sku, nombre, cantidad, valorUnidad, impuestos, tipoImpuesto, subtotal, total });
    }

    // ── 4. Totales y validación abono ─────────────────────────
    const totalUnidades  = productos.reduce((a, p) => a + p.cantidad, 0);
    const totalSubtotal  = productos.reduce((a, p) => a + p.subtotal, 0);
    const totalImpuestos = productos.reduce((a, p) => a + p.impuestos, 0);
    const totalFinal     = productos.reduce((a, p) => a + p.total, 0);

    if (esCredito && valorAbono >= totalFinal) {
        Swal.fire({ icon:'warning', title:'Valor abono inválido', text:`El abono (${fmt(valorAbono)}) debe ser menor al total de la factura (${fmt(totalFinal)}).` }); return;
    }

    // ── 5. Archivos adjuntos ──────────────────────────────────
    const fileInput  = document.getElementById('uploadFacturas');
    const archivos   = Array.from(fileInput?.files || []);
    const extsOk     = ['pdf','jpg','jpeg','png','gif','xls','xlsx'];
    for (const file of archivos) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!extsOk.includes(ext)) {
            Swal.fire({ icon:'warning', title:'Archivo no permitido', text:`"${file.name}" no es válido. Solo: PDF, JPG, PNG, GIF, XLS.` }); return;
        }
    }

    // ── 6. Modal de confirmación ──────────────────────────────
    const filasHtml = productos.map(p => `
        <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:6px 8px;font-family:monospace;font-size:11px;color:#6b7280;">${p.sku}</td>
            <td style="padding:6px 8px;font-size:12px;">${p.nombre}</td>
            <td style="padding:6px 8px;text-align:center;font-size:12px;">${p.cantidad.toLocaleString('es-CO')}</td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;">${fmt(p.valorUnidad)}</td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${fmt(p.impuestos)}<span style="font-size:10px;margin-left:2px;">${p.tipoImpuesto === 'porcentaje' ? '%' : '$'}</span></td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;">${fmt(p.subtotal)}</td>
            <td style="padding:6px 8px;text-align:right;font-size:12px;font-weight:700;">${fmt(p.total)}</td>
        </tr>`).join('');

    const creditoHtml = esCredito ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;background:#fef3c7;border-radius:8px;padding:10px;">
            <div><span style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;">Fecha de Pago</span><br><strong>${fechaPago}</strong></div>
            <div><span style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;">Abono Inicial</span><br><strong>${fmt(valorAbono)}</strong></div>
        </div>` : '';

    const archivosHtml = archivos.length > 0 ? `
        <div style="margin-top:10px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:12px;color:#166534;">
            <strong>Archivos adjuntos:</strong> ${archivos.map(f => f.name).join(', ')}
        </div>` : '';

    const htmlModal = `
        <div style="text-align:left;">
            <div style="background:#f9fafb;border-radius:12px;padding:16px;margin-bottom:14px;">
                <p style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;margin-bottom:10px;letter-spacing:.05em;">Datos de la Orden</p>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
                    <div><span style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Proveedor</span><br><strong>${proveedorNombre}</strong></div>
                    <div><span style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Destino</span><br><strong>${destinoNombre}</strong></div>
                    <div><span style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Nro. Factura</span><br><strong>${nroFactura}</strong></div>
                    <div><span style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Fecha Factura</span><br><strong>${fechaFactura}</strong></div>
                </div>
                <div style="margin-top:10px;">
                    <span style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;">Modalidad</span><br>
                    <span style="font-weight:700;color:${esCredito ? '#d97706' : '#16a34a'};">${esCredito ? 'A Crédito' : 'Pago de Contado'}</span>
                </div>
                ${creditoHtml}
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f3f4f6;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;">
                            <th style="padding:8px;text-align:left;">SKU</th>
                            <th style="padding:8px;text-align:left;">Nombre</th>
                            <th style="padding:8px;text-align:center;">Cant.</th>
                            <th style="padding:8px;text-align:right;">Valor Unit.</th>
                            <th style="padding:8px;text-align:right;">Impuesto</th>
                            <th style="padding:8px;text-align:right;">Subtotal</th>
                            <th style="padding:8px;text-align:right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>${filasHtml}</tbody>
                </table>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:24px;padding:12px 0;border-top:1px solid #e5e7eb;margin-top:8px;">
                <div style="text-align:right;"><span style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;">Unidades</span><br><strong style="font-size:16px;">${totalUnidades.toLocaleString('es-CO')}</strong></div>
                <div style="text-align:right;"><span style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;">Subtotal</span><br><strong style="font-size:16px;">${fmt(totalSubtotal)}</strong></div>
                <div style="text-align:right;"><span style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;">Impuestos</span><br><strong style="font-size:16px;">${fmt(totalImpuestos)}</strong></div>
                <div style="text-align:right;"><span style="font-size:10px;color:#EC5FA3;font-weight:700;text-transform:uppercase;">Total</span><br><strong style="font-size:22px;color:#EC5FA3;">${fmt(totalFinal)}</strong></div>
            </div>
            ${archivosHtml}
        </div>`;

    const confirmResult = await Swal.fire({
        title: 'Verifica que todos los datos estén correctos',
        html: htmlModal,
        width: '900px',
        showCancelButton: true,
        confirmButtonText: 'Confirmar y Guardar',
        cancelButtonText: 'Revisar datos',
        confirmButtonColor: '#EC5FA3',
        cancelButtonColor: '#6b7280',
    });

    if (!confirmResult.isConfirmed) return;

    // ── 7. Envío al backend ───────────────────────────────────
    const fd = new FormData();
    fd.append('_csrf',               CSRF_TOKEN);
    fd.append('idProveedor',         idProveedor);
    fd.append('nroFactura',          nroFactura);
    fd.append('fechaFactura',        fechaFactura);
    fd.append('esCredito',           String(esCredito));
    fd.append('fechaPago',           fechaPago);
    fd.append('valorAbono',          String(valorAbono));
    fd.append('idPuntoVentaDestino', idPuntoVentaDestino);
    fd.append('productos',           JSON.stringify(productos));
    archivos.forEach(file => fd.append('facturas', file));

    const btn = document.getElementById('btnGuardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fi fi-rr-spinner"></i> Guardando...';

    try {
        const resp = await fetch('/admin/inventario/batch', { method: 'POST', body: fd });
        const data = await resp.json();
        if (data.success) {
            Swal.fire({ icon:'success', title:'¡Orden guardada!', text: data.mensaje, timer:2500, showConfirmButton:false })
                .then(() => window.location.reload());
        } else {
            Swal.fire({ icon:'error', title:'Error', text: data.mensaje });
        }
    } catch {
        Swal.fire({ icon:'error', title:'Error de red', text:'No se pudo guardar la orden de compra.' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fi fi-rr-disk"></i>  Guardar Orden de Compra';
    }
});

// ─── INIT ──────────────────────────────────────────────────────
document.getElementById('fechaFactura').value = new Date().toISOString().split('T')[0];
window.initMoneyInput(document.getElementById('valorAbono'));
crearFila();
