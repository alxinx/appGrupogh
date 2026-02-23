(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const cargarMetadata = async () => {
            const pathParts = window.location.pathname.split('/');
            const id = pathParts[pathParts.length - 1]; // El ID es el último segmento: /admin/dosificaciones/ver/:id

            try {
                const res = await fetch(`/admin/api/dosificaciones/metadata/${id}`);
                const data = await res.json();

                // Solo actualizamos los widgets de arriba
                if (document.querySelector('#widget-fecha-creacion'))
                    document.querySelector('#widget-fecha-creacion').innerText = data.fechaFormateada;

                if (document.querySelector('#widget-units-pack'))
                    document.querySelector('#widget-units-pack').innerText = data.unidadesPorPaquete;

                if (document.querySelector('#widget-sobrantes'))
                    document.querySelector('#widget-sobrantes').innerText = data.sobrantes;

                if (document.querySelector('#widget-total-bultos'))
                    document.querySelector('#widget-total-bultos').innerText = data.totalBultos;

                if (document.querySelector('#widget-total-productos'))
                    document.querySelector('#widget-total-productos').innerText = data.totalUnidades;

            } catch (error) {
                console.error('Error cargando widgets:', error);
            }
        };

        const initPacksList = () => {
            const tbody = document.querySelector('#tbodyPacks');
            const busquedaInput = document.querySelector('#busquedaPack');
            const selectAll = document.querySelector('#selectAllPacks');
            const btnTrasladar = document.querySelector('#btnTrasladarPacks');
            const paginacionContenedor = '#paginacionPacks';

            let filteredPacks = window.initialPacks || [];
            let currentPage = 1;
            const itemsPerPage = 10;

            const renderTable = (page) => {
                currentPage = page;
                const start = (page - 1) * itemsPerPage;
                const end = start + itemsPerPage;
                const paginatedPacks = filteredPacks.slice(start, end);

                tbody.innerHTML = paginatedPacks.map(pack => {
                    let tipoClass = pack.tipo === 'RESIDUO' ? 'bg-[#ffebf0] text-[#ff4d7d]' : 'bg-[#e7f0ff] text-[#4d86ff]';
                    let estadoClass = 'bg-slate-100 text-slate-500';
                    switch (pack.estado) {
                        case 'EMPACADO': estadoClass = 'bg-[#e6fff2] text-[#00cc66]'; break;
                        case 'SEPARADO': estadoClass = 'bg-[#fff4e6] text-[#ff9900]'; break;
                        case 'DESPACHADO': estadoClass = 'bg-[#eef2ff] text-[#4f46e5]'; break;
                        case 'TRASLADADO': estadoClass = 'bg-[#f5f3ff] text-[#7c3aed]'; break;
                        case 'ANULADO': estadoClass = 'bg-[#fef2f2] text-[#ef4444]'; break;
                    }

                    return `
                        <tr class="bg-white hover:bg-slate-50 transition-colors group border border-transparent hover:border-slate-100">
                            <td class="px-4 py-4 text-center rounded-l-2xl">
                                <input type="checkbox" name="selectedPack" value="${pack.idPack}" class="checkbox-pack w-4 h-4 rounded border-slate-200 text-gh-primaryHover focus:ring-gh-primaryHover">
                            </td>
                            <td class="px-4 py-4">
                                <div class="flex items-center gap-3">
                                    <span class="fi-rr-barcode-read text-slate-400 text-lg"></span>
                                    <span class="font-mono font-bold text-slate-700">${pack.codigoEtiqueta}</span>
                                </div>
                            </td>
                            <td class="px-4 py-4"><span class="text-slate-500 font-medium">LT-${pack.numLote}</span></td>
                            <td class="px-4 py-4"><span class="px-3 py-1 rounded-full text-2xs font-bold uppercase tracking-wide ${tipoClass}">${pack.tipo}</span></td>
                            <td class="px-4 py-4"><span class="px-3 py-1 rounded-full text-2xs font-bold uppercase tracking-wide ${estadoClass}">${pack.estado}</span></td>
                            <td class="px-4 py-4 text-right rounded-r-2xl">
                                <div class="flex items-center justify-end gap-2">
                                    <button type="button" class="p-2 text-slate-400 hover:text-gh-primaryHover hover:bg-gh-primaryHover/5 rounded-lg transition-colors" title="Ver Detalle"><span class="fi-rr-eye"></span></button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');

                // Actualizar contadores
                const total = filteredPacks.length;
                document.querySelector('#packsCountStart').innerText = total > 0 ? start + 1 : 0;
                document.querySelector('#packsCountEnd').innerText = Math.min(end, total);
                document.querySelector('#packsCountTotal').innerText = total;

                // Generar Paginación
                if (window.generarPaginacion) {
                    window.generarPaginacion(paginacionContenedor, Math.ceil(total / itemsPerPage), page, renderTable);
                }

                // Re-bind events to new checkboxes
                bindCheckboxes();
                updateBtnVisibility();
                selectAll.checked = false;
            };

            const bindCheckboxes = () => {
                const checkboxes = document.querySelectorAll('.checkbox-pack');
                checkboxes.forEach(cb => {
                    cb.addEventListener('change', updateBtnVisibility);
                });
            };

            const updateBtnVisibility = () => {
                const selected = document.querySelectorAll('.checkbox-pack:checked');
                if (selected.length > 0) {
                    btnTrasladar.classList.remove('hidden');
                } else {
                    btnTrasladar.classList.add('hidden');
                }
            };

            selectAll.addEventListener('change', () => {
                const checkboxes = document.querySelectorAll('.checkbox-pack');
                checkboxes.forEach(cb => cb.checked = selectAll.checked);
                updateBtnVisibility();
            });

            busquedaInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                filteredPacks = window.initialPacks.filter(p =>
                    p.codigoEtiqueta.toLowerCase().includes(term) ||
                    p.numLote.toString().includes(term)
                );
                renderTable(1);
            });

            // Lógica del Modal (se mantiene similar pero ajustada)
            const modal = document.querySelector('#modalTraslado');
            const selectDestino = document.querySelector('#idDestinoTraslado');
            const confirmBtn = document.querySelector('#confirmTraslado');
            const countSpan = document.querySelector('#countPacksSelected');

            btnTrasladar.addEventListener('click', async () => {
                const selected = document.querySelectorAll('.checkbox-pack:checked');
                countSpan.innerText = selected.length;
                modal.classList.remove('hidden');

                if (selectDestino.options.length <= 1) {
                    try {
                        const res = await fetch('/admin/json/tiendas');
                        const tiendas = await res.json();
                        tiendas.forEach(t => {
                            const opt = document.createElement('option');
                            opt.value = t.idPuntoDeVenta;
                            opt.text = t.nombreComercial;
                            selectDestino.add(opt);
                        });
                    } catch (e) {
                        console.error('Error cargando tiendas', e);
                    }
                }
            });

            document.querySelector('#closeModalTraslado').onclick = () => modal.classList.add('hidden');
            document.querySelector('#cancelTraslado').onclick = () => modal.classList.add('hidden');

            confirmBtn.addEventListener('click', async () => {
                const idDestino = selectDestino.value;
                if (!idDestino) {
                    alert('Por favor seleccione un destino');
                    return;
                }

                const selectedPacks = Array.from(document.querySelectorAll('.checkbox-pack:checked')).map(cb => cb.value);

                confirmBtn.disabled = true;
                confirmBtn.innerText = 'Procesando...';

                try {
                    const res = await fetch('/admin/dosificaciones/trasladar', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content
                        },
                        body: JSON.stringify({ packs: selectedPacks, idDestino })
                    });

                    const result = await res.json();
                    if (result.success) {
                        window.location.reload();
                    } else {
                        alert('Error: ' + result.mensaje);
                    }
                } catch (error) {
                    console.error('Error en traslado', error);
                    alert('Error en la comunicación con el servidor');
                } finally {
                    confirmBtn.disabled = false;
                    confirmBtn.innerText = 'Confirmar Traslado';
                }
            });

            renderTable(1);
        };

        cargarMetadata();
        initPacksList();
    });
})();