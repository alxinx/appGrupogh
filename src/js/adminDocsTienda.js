(function () {
    'use strict';

    const EXTS    = ['jpg', 'jpeg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const MAX_TAM = 5 * 1024 * 1024;

    const getCsrf = () => document.getElementById('doc-csrf')?.value || '';
    const getPdv  = () => document.getElementById('doc-pdv-id')?.value || '';

    // ─── Placeholder vacío ───────────────────────────────────────────────────
    const _vacio = () =>
        '<li class="text-xs text-slate-400 py-6 text-center">Sin documentos guardados</li>';

    // ─── Cargar lista principal ──────────────────────────────────────────────
    const cargarDocs = async () => {
        const lista = document.getElementById('doc-tienda-lista');
        if (!lista) return;
        lista.innerHTML = '<li class="flex items-center justify-center py-8 text-slate-300"><i class="fi fi-rr-spinner animate-spin text-xl mr-2"></i><span class="text-sm">Cargando...</span></li>';
        try {
            const d = await fetch(`/admin/api/tiendas/${getPdv()}/documentos`).then(r => r.json());
            lista.innerHTML = '';
            if (!d.success || !d.archivos.length) { lista.innerHTML = _vacio(); return; }
            d.archivos.forEach(a => lista.appendChild(window.crearItemDocTienda(a)));
        } catch (_) { lista.innerHTML = _vacio(); }
    };

    // ─── Subir un archivo ────────────────────────────────────────────────────
    const subirArchivo = async (file) => {
        const modalLista = document.getElementById('modal-doc-lista');
        modalLista?.classList.remove('hidden');

        const liProg = document.createElement('li');
        liProg.className = 'flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 animate-pulse';
        liProg.innerHTML = `<i class="fi fi-rr-spinner animate-spin text-blue-400 text-sm flex-shrink-0"></i><span class="text-xs text-slate-500 truncate flex-1">Subiendo ${file.name}…</span>`;
        modalLista?.prepend(liProg);

        try {
            const fd = new FormData();
            fd.append('documentos', file);
            const r    = await fetch(`/admin/api/tiendas/${getPdv()}/documentos/subir`, {
                method: 'POST', body: fd,
                headers: { 'CSRF-Token': getCsrf() }
            });
            const data = await r.json();
            liProg.remove();

            if (data.success && data.archivos?.length) {
                data.archivos.forEach(a => {
                    // Refleja en el modal (confirmación visual)
                    const liOk = document.createElement('li');
                    liOk.className = 'flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2';
                    liOk.innerHTML = `<i class="fi fi-rr-check text-emerald-500 text-sm flex-shrink-0"></i><span class="text-xs text-slate-600 truncate flex-1">${a.nombreDocumento}</span><span class="text-[10px] text-slate-400 uppercase">${a.formato}</span>`;
                    modalLista?.prepend(liOk);

                    // Añade a la lista principal
                    const lista = document.getElementById('doc-tienda-lista');
                    if (lista) {
                        lista.querySelectorAll('li:not([data-id])').forEach(li => li.remove());
                        lista.prepend(window.crearItemDocTienda(a));
                    }
                });
            } else {
                Swal.fire({ icon: 'error', title: 'Error al subir', text: data.mensaje || 'No se pudo subir el archivo.', confirmButtonColor: '#EC5FA3' });
            }
        } catch (_) {
            liProg.remove();
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#EC5FA3' });
        }
    };

    // ─── Eliminar documento ──────────────────────────────────────────────────
    const eliminarDoc = async (idDoc, nombre, liElement) => {
        const { isConfirmed } = await Swal.fire({
            icon: 'warning',
            title: '¿Eliminar documento?',
            html: `<b>${nombre}</b><br><span class="text-sm text-slate-500">Este documento se eliminará para siempre sin posibilidad de recuperarlo.</span>`,
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar para siempre',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#94a3b8'
        });
        if (!isConfirmed) return;

        const btn = liElement.querySelector('.btn-del-doc-tienda');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fi fi-rr-spinner animate-spin text-red-400 text-xs"></i>'; }

        try {
            const r    = await fetch(`/admin/api/tiendas/documentos/${idDoc}/eliminar`, {
                method: 'POST',
                headers: { 'CSRF-Token': getCsrf() }
            });
            const data = await r.json();
            if (data.success) {
                liElement.remove();
                const lista = document.getElementById('doc-tienda-lista');
                if (lista && !lista.querySelectorAll('li[data-id]').length)
                    lista.innerHTML = _vacio();
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.mensaje || 'No se pudo eliminar.', confirmButtonColor: '#EC5FA3' });
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fi fi-rr-trash text-red-400 text-xs pointer-events-none"></i>'; }
            }
        } catch (_) {
            Swal.fire({ icon: 'error', title: 'Error de conexión', confirmButtonColor: '#EC5FA3' });
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fi fi-rr-trash text-red-400 text-xs pointer-events-none"></i>'; }
        }
    };

    // ─── Init (se dispara cuando el tab es cargado) ──────────────────────────
    const init = () => {
        cargarDocs();

        // Abrir/cerrar modal
        const modal    = document.getElementById('modal-subir-doc');
        const overlay  = document.getElementById('modal-doc-overlay');
        const btnAbrir = document.getElementById('btn-abrir-modal-doc');
        const btnCerrar = document.getElementById('btn-cerrar-modal-doc');
        const btnListo  = document.getElementById('btn-listo-modal-doc');

        const abrirModal  = () => { document.getElementById('modal-doc-lista')?.classList.add('hidden'); modal?.classList.remove('hidden'); };
        const cerrarModal = () => modal?.classList.add('hidden');

        btnAbrir?.addEventListener('click', abrirModal);
        btnCerrar?.addEventListener('click', cerrarModal);
        btnListo?.addEventListener('click', cerrarModal);
        overlay?.addEventListener('click', cerrarModal);

        // Upload
        document.getElementById('doc-tienda-input')?.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            e.target.value = '';
            for (const file of files) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (!EXTS.includes(ext)) {
                    Swal.fire({ icon: 'error', title: 'Tipo no permitido', html: `<b>${file.name}</b><br>Solo: PDF, Office, JPG.`, confirmButtonColor: '#EC5FA3' });
                    continue;
                }
                if (file.size > MAX_TAM) {
                    Swal.fire({ icon: 'error', title: 'Archivo muy grande', html: `<b>${file.name}</b> supera los 5MB.`, confirmButtonColor: '#EC5FA3' });
                    continue;
                }
                await subirArchivo(file);
            }
        });

        // Eliminar (event delegation sobre la lista)
        document.getElementById('doc-tienda-lista')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-del-doc-tienda');
            if (!btn) return;
            eliminarDoc(btn.dataset.id, btn.dataset.nombre, btn.closest('li'));
        });
    };

    document.addEventListener('tabLoaded', (e) => {
        if (e.detail.tabId === 'documentacion') init();
    });
})();
