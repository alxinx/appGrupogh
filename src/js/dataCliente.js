(function () {
    'use strict';

    const form        = document.getElementById('form-nuevo-cliente');
    const btnGuardar  = document.getElementById('btn-guardar');
    const uploadInput = document.getElementById('upload-docs');
    const previewDocs = document.getElementById('preview-docs');
    const dt          = new DataTransfer();

    const idClienteEdit = document.getElementById('input-id-cliente')?.value || null;
    const formAction    = document.getElementById('form-action')?.value || '/admin/clientes/nuevo';

    // ─── TOGGLE TIPO PERSONA ──────────────────────────────────────────────────
    const cardNatural  = document.getElementById('card-natural');
    const cardEmpresa  = document.getElementById('card-empresa');
    const secNatural   = document.getElementById('seccion-natural');
    const secEmpresa   = document.getElementById('seccion-empresa');
    const secDocs      = document.getElementById('seccion-docs');
    const resumenTipo  = document.getElementById('resumen-tipo');

    const activarTipo = (tipo) => {
        const esEmpresa = tipo === 'J';

        // Sync radio checked state (necesario al llamar programáticamente en carga de página)
        const radioN = document.getElementById('tipo-N');
        const radioJ = document.getElementById('tipo-J');
        if (radioN) radioN.checked = !esEmpresa;
        if (radioJ) radioJ.checked = esEmpresa;

        cardNatural.className = `cursor-pointer rounded-2xl border-2 p-4 flex items-center gap-3 transition-all ${!esEmpresa ? 'border-pink-400 bg-pink-50' : 'border-transparent bg-white hover:border-slate-200'}`;
        cardEmpresa.className = `cursor-pointer rounded-2xl border-2 p-4 flex items-center gap-3 transition-all ${esEmpresa  ? 'border-pink-400 bg-pink-50' : 'border-transparent bg-white hover:border-slate-200'}`;

        const iconNatural = cardNatural.querySelector('i');
        const iconEmpresa = cardEmpresa.querySelector('i');
        if (iconNatural) iconNatural.className = `fi fi-rr-user text-xl ${!esEmpresa ? 'text-pink-500' : 'text-slate-400'}`;
        if (iconEmpresa) iconEmpresa.className = `fi fi-rr-building text-xl ${esEmpresa ? 'text-pink-500' : 'text-slate-400'}`;

        secNatural.classList.toggle('hidden', esEmpresa);
        secEmpresa.classList.toggle('hidden', !esEmpresa);
        secDocs.classList.toggle('hidden', !esEmpresa);

        if (resumenTipo) resumenTipo.textContent = esEmpresa ? 'Empresa / Jurídica' : 'Persona Natural';
    };

    document.querySelectorAll('input[name="tipo_persona"]').forEach(radio => {
        radio.addEventListener('change', () => activarTipo(radio.value));
    });

    // ─── TOGGLE RÉGIMEN FISCAL ────────────────────────────────────────────────
    const lbl48 = document.getElementById('lbl-48');
    const lbl49 = document.getElementById('lbl-49');
    const resumenRegimen = document.getElementById('resumen-regimen');

    const estiloActivo   = 'flex items-center gap-2 cursor-pointer px-4 py-2.5 rounded-xl border-2 border-pink-400 bg-pink-50 text-xs font-bold text-pink-600 transition-all';
    const estiloInactivo = 'flex items-center gap-2 cursor-pointer px-4 py-2.5 rounded-xl border-2 border-slate-200 bg-white text-xs font-semibold text-slate-500 transition-all';

    const activarRegimen = (valor) => {
        const es48 = valor === '48';
        if (lbl48) lbl48.className = es48 ? estiloActivo : estiloInactivo;
        if (lbl49) lbl49.className = !es48 ? estiloActivo : estiloInactivo;
        if (lbl48) lbl48.querySelector('i').className = `fi ${es48  ? 'fi-rr-check-circle' : 'fi-rr-circle'}`;
        if (lbl49) lbl49.querySelector('i').className = `fi ${!es48 ? 'fi-rr-check-circle' : 'fi-rr-circle'}`;
        if (resumenRegimen) resumenRegimen.textContent = es48 ? 'Responsable IVA' : 'No responsable IVA';
    };

    document.querySelectorAll('input[name="regimen_fiscal"]').forEach(radio => {
        radio.addEventListener('change', () => activarRegimen(radio.value));
    });

    // ─── SWITCHES CONDICIÓN TRIBUTARIA (radio con deselect) ──────────────────
    document.querySelectorAll('.condicion-trib').forEach(radio => {
        radio.addEventListener('mousedown', function () {
            this._estabaChecked = this.checked;
        });
        radio.addEventListener('click', function () {
            if (this._estabaChecked) {
                this.checked = false;
                this._estabaChecked = false;
            }
        });
    });

    // ─── VALIDACIÓN DOCUMENTO ÚNICO ──────────────────────────────────────────
    let docDuplicado = false;

    const mostrarErrorDoc = (inputEl, msg) => {
        let err = inputEl.parentElement.querySelector('.doc-error');
        if (!err) {
            err = document.createElement('p');
            err.className = 'doc-error text-xs text-red-500 mt-1 font-semibold';
            inputEl.parentElement.appendChild(err);
        }
        err.textContent = msg;
        inputEl.classList.add('border-red-400');
        docDuplicado = true;
    };

    const limpiarErrorDoc = (inputEl) => {
        const err = inputEl.parentElement.querySelector('.doc-error');
        if (err) err.remove();
        inputEl.classList.remove('border-red-400');
        docDuplicado = false;
    };

    const checkDocUnico = async (inputEl) => {
        const val = inputEl.value.trim();
        if (!val || val.length < 3) { limpiarErrorDoc(inputEl); return; }
        try {
            let url = `/admin/api/clientes/check-doc/${encodeURIComponent(val)}`;
            if (idClienteEdit) url += `?exclude=${idClienteEdit}`;
            const d = await fetch(url).then(r => r.json());
            if (d.exists) {
                mostrarErrorDoc(inputEl, `⚠ El documento ${val} ya está registrado.`);
            } else {
                limpiarErrorDoc(inputEl);
            }
        } catch (_) {}
    };

    document.getElementById('numero_doc_natural')?.addEventListener('blur', function () { checkDocUnico(this); });
    document.getElementById('numero_doc_empresa')?.addEventListener('blur', function () { checkDocUnico(this); });

    // ─── DEPTO → MUNICIPIO ────────────────────────────────────────────────────
    const deptoSelect    = document.getElementById('departamentoSelect');
    const municipioSelect = document.getElementById('municipioSelect');

    deptoSelect?.addEventListener('change', async function () {
        const id = this.value;
        municipioSelect.innerHTML = '<option value="">Cargando...</option>';
        municipioSelect.disabled = true;
        if (!id) { municipioSelect.innerHTML = '<option value="">Selecciona el municipio</option>'; return; }
        try {
            const data = await fetch(`/admin/json/municipios/${id}`).then(r => r.json());
            municipioSelect.innerHTML = '<option value="">Selecciona el municipio</option>' +
                data.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
            municipioSelect.disabled = false;
        } catch (_) { municipioSelect.innerHTML = '<option value="">Error al cargar</option>'; }
    });

    // ─── PREVIEW DOCUMENTOS ───────────────────────────────────────────────────
    const iconosArchivo = { pdf: 'fi-rr-file-pdf', doc: 'fi-rr-file-word', docx: 'fi-rr-file-word', xls: 'fi-rr-file-spreadsheet', xlsx: 'fi-rr-file-spreadsheet' };
    const resumenDocs = document.getElementById('resumen-docs');

    const renderPreviews = () => {
        if (!previewDocs) return;
        previewDocs.innerHTML = '';
        Array.from(dt.files).forEach((file, i) => {
            const ext    = file.name.split('.').pop().toLowerCase();
            const isImg  = file.type.startsWith('image/');
            const icono  = iconosArchivo[ext] || 'fi-rr-document';
            const div    = document.createElement('div');
            div.className = 'relative w-16 h-16 rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center overflow-hidden group';
            div.innerHTML = isImg
                ? `<img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover rounded-xl"/>`
                : `<i class="fi ${icono} text-2xl text-slate-400"></i><span class="text-[9px] text-slate-400 mt-0.5">${ext.toUpperCase()}</span>`;
            div.innerHTML += `<button type="button" data-idx="${i}" class="rm-doc absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] hidden group-hover:flex items-center justify-center"><i class="fi fi-rr-cross-small"></i></button>`;
            previewDocs.appendChild(div);
        });
        if (resumenDocs) resumenDocs.textContent = `${dt.files.length} archivo${dt.files.length !== 1 ? 's' : ''}`;
    };

    uploadInput?.addEventListener('change', (e) => {
        const nuevos = Array.from(e.target.files);
        if (dt.files.length + nuevos.length > 10) {
            Swal.fire({ icon: 'warning', title: 'Límite excedido', text: 'Máximo 10 archivos.', confirmButtonColor: '#EC5FA3' });
            return;
        }
        nuevos.forEach(f => dt.items.add(f));
        uploadInput.files = dt.files;
        renderPreviews();
    });

    previewDocs?.addEventListener('click', (e) => {
        const btn = e.target.closest('.rm-doc');
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx);
        const newDt = new DataTransfer();
        Array.from(dt.files).forEach((f, i) => { if (i !== idx) newDt.items.add(f); });
        dt.items.clear();
        Array.from(newDt.files).forEach(f => dt.items.add(f));
        uploadInput.files = dt.files;
        renderPreviews();
    });

    // ─── SUBMIT ───────────────────────────────────────────────────────────────
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const tipoPersona = document.querySelector('input[name="tipo_persona"]:checked')?.value;

        if (docDuplicado) {
            return Swal.fire({ icon: 'error', title: 'Documento duplicado', text: 'El número de documento ya pertenece a otro cliente.', confirmButtonColor: '#EC5FA3' });
        }

        if (tipoPersona === 'N') {
            if (!document.getElementById('primer_nombre')?.value.trim()) return Swal.fire({ icon: 'warning', title: 'Campo requerido', text: 'Ingresa el primer nombre.', confirmButtonColor: '#EC5FA3' });
            if (!document.getElementById('primer_apellido')?.value.trim()) return Swal.fire({ icon: 'warning', title: 'Campo requerido', text: 'Ingresa el primer apellido.', confirmButtonColor: '#EC5FA3' });
            if (!document.getElementById('numero_doc_natural')?.value.trim()) return Swal.fire({ icon: 'warning', title: 'Campo requerido', text: 'Ingresa el número de documento.', confirmButtonColor: '#EC5FA3' });
        } else {
            if (!document.getElementById('razon_social')?.value.trim()) return Swal.fire({ icon: 'warning', title: 'Campo requerido', text: 'Ingresa la razón social.', confirmButtonColor: '#EC5FA3' });
            if (!document.getElementById('numero_doc_empresa')?.value.trim()) return Swal.fire({ icon: 'warning', title: 'Campo requerido', text: 'Ingresa el NIT.', confirmButtonColor: '#EC5FA3' });
        }

        const fd = new FormData(form);

        if (tipoPersona === 'J') {
            fd.set('numero_doc', document.getElementById('numero_doc_empresa')?.value.trim());
            fd.set('tipoDocumento', 'NIT');
        } else {
            fd.set('numero_doc', document.getElementById('numero_doc_natural')?.value.trim());
        }

        if (dt.files.length > 0) {
            fd.delete('documentos');
            Array.from(dt.files).forEach(f => fd.append('documentos', f));
        }

        const docActivo = tipoPersona === 'J'
            ? document.getElementById('numero_doc_empresa')
            : document.getElementById('numero_doc_natural');
        if (docActivo) {
            await checkDocUnico(docActivo);
            if (docDuplicado) {
                return Swal.fire({ icon: 'error', title: 'Documento duplicado', text: 'El número de documento ya pertenece a otro cliente.', confirmButtonColor: '#EC5FA3' });
            }
        }

        btnGuardar.disabled = true;
        btnGuardar.innerHTML = '<i class="fi fi-rr-spinner animate-spin"></i> Guardando...';

        try {
            const res  = await fetch(formAction, { method: 'POST', body: fd });
            const data = await res.json();
            if (data.success) {
                const msg = idClienteEdit ? '¡Cliente actualizado!' : '¡Cliente registrado!';
                await Swal.fire({ icon: 'success', title: msg, text: 'Los datos fueron guardados correctamente.', confirmButtonColor: '#EC5FA3' });
                window.location.href = '/admin/clientes';
            } else {
                throw new Error(data.mensaje || 'Error desconocido');
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error', text: err.message, confirmButtonColor: '#EC5FA3' });
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = idClienteEdit
                ? '<i class="fi fi-rr-disk"></i> Actualizar cliente'
                : '<i class="fi fi-rr-disk"></i> Guardar cliente';
        }
    });

    // ─── DOCUMENTOS EXISTENTES (modo edición) ────────────────────────────────
    const iconoFormato = (fmt) => {
        const f = (fmt || '').toLowerCase();
        if (f === 'pdf')  return 'fi-rr-file-pdf text-red-400';
        if (f === 'doc' || f === 'docx') return 'fi-rr-file-word text-blue-400';
        if (f === 'xls' || f === 'xlsx') return 'fi-rr-file-spreadsheet text-emerald-500';
        if (['jpg','jpeg','png','webp','gif'].includes(f)) return 'fi-rr-picture text-purple-400';
        return 'fi-rr-document text-slate-400';
    };

    const docsExistentesEl = document.getElementById('docs-existentes');

    const renderDocsExistentes = (archivos) => {
        if (!docsExistentesEl) return;
        if (!archivos.length) { docsExistentesEl.innerHTML = ''; return; }

        docsExistentesEl.innerHTML = archivos.map(a => `
            <li class="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                <i class="fi ${iconoFormato(a.formato)} text-base flex-shrink-0"></i>
                <span class="text-xs text-slate-700 font-medium truncate flex-1">${a.nombreDocumento}</span>
                <span class="text-[10px] text-slate-400 uppercase flex-shrink-0">${a.formato}</span>
                <button type="button" data-id="${a.idDocumento}" data-nombre="${a.nombreDocumento}"
                        class="btn-eliminar-doc flex-shrink-0 w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors"
                        title="Eliminar">
                    <i class="fi fi-rr-trash text-red-400 text-xs pointer-events-none"></i>
                </button>
            </li>`
        ).join('');
    };

    const cargarDocsExistentes = async () => {
        if (!idClienteEdit || !docsExistentesEl) return;
        try {
            const d = await fetch(`/admin/api/clientes/${idClienteEdit}/archivos`).then(r => r.json());
            if (d.success) renderDocsExistentes(d.archivos);
        } catch (_) {}
    };

    docsExistentesEl?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-eliminar-doc');
        if (!btn) return;

        const idDoc   = btn.dataset.id;
        const nombre  = btn.dataset.nombre;

        const { isConfirmed } = await Swal.fire({
            icon: 'warning',
            title: '¿Eliminar documento?',
            text: nombre,
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#94a3b8'
        });
        if (!isConfirmed) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fi fi-rr-spinner animate-spin text-red-400 text-xs"></i>';

        try {
            const r = await fetch(`/admin/api/clientes/archivos/${idDoc}/eliminar`, { method: 'POST' });
            const data = await r.json();
            if (data.success) {
                btn.closest('li').remove();
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje || 'No se pudo eliminar', confirmButtonColor: '#EC5FA3' });
                btn.disabled = false;
                btn.innerHTML = '<i class="fi fi-rr-trash text-red-400 text-xs"></i>';
            }
        } catch (_) {
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#EC5FA3' });
            btn.disabled = false;
            btn.innerHTML = '<i class="fi fi-rr-trash text-red-400 text-xs"></i>';
        }
    });

    // ─── INICIALIZACIÓN MODO EDICIÓN ─────────────────────────────────────────
    const tipoInicial = document.getElementById('tipo-inicial')?.value || 'N';
    activarTipo(tipoInicial);

    const regimenChecked = document.querySelector('input[name="regimen_fiscal"]:checked');
    if (regimenChecked) activarRegimen(regimenChecked.value);

    if (idClienteEdit) cargarDocsExistentes();

})();
