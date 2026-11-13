// Biblioteca de fichas de confección (admin/procesos/fichas-confeccion/biblioteca) —
// listado filtrado y paginado por GET /admin/json/fichas-confeccion, mismo contrato y
// mismo paginador global (window.generarPaginacion, src/js/paginador.js) que el listado de
// inventario (src/js/productList.js, CLAUDE.md DRY — "mismos principios de paginación").
(function () {
    const inputBusqueda = document.querySelector('#busquedaFichas');
    const selectFamilia = document.querySelector('#familiaFichas');
    const selectTela = document.querySelector('#telaFichas');
    const contenedor = document.querySelector('#contenedor-fichas');
    if (!inputBusqueda || !contenedor) return;

    let paginaActual = 1;

    // Igual que productList.js: una respuesta lenta de una búsqueda vieja no debe pisar
    // una más nueva que ya llegó.
    let ultimaConsultaId = 0;

    const mostrarFichas = (fichas) => {
        contenedor.innerHTML = '';
        if (fichas.length === 0) {
            contenedor.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-500">No se encontraron fichas.</td></tr>';
            return;
        }

        fichas.forEach((f) => {
            const fila = document.createElement('tr');
            fila.className = 'border-b border-slate-100 last:border-0';
            fila.innerHTML = `
                <td class="py-3.5 px-5 font-semibold text-slate-800"></td>
                <td class="py-3.5 px-5 text-slate-600"></td>
                <td class="py-3.5 px-5 text-right tabular-nums">${f.cantidadTotal.toLocaleString('es-CO')}</td>
                <td class="py-3.5 px-5 text-right tabular-nums">$${Math.round(f.precioConfeccion).toLocaleString('es-CO')}</td>
                <td class="py-3.5 px-5 text-right text-slate-500 text-xs">${new Date(f.createdAt).toLocaleDateString('es-CO')}</td>
                <td class="py-3.5 px-5 text-right">
                    <div class="flex items-center justify-end gap-3">
                        <a href="/admin/procesos/fichas-confeccion/${f.idFicha}" class="inline-flex items-center gap-1.5 text-xs font-bold text-gh-primaryHover hover:underline">
                            <i class="fi fi-rr-folder-open text-xs"></i>
                            Abrir
                        </a>
                        <a href="/admin/procesos/fichas-confeccion/${f.idFicha}/pdf" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-gh-primaryHover hover:underline">
                            <i class="fi fi-rr-document-signed text-xs"></i>
                            Ver PDF
                        </a>
                    </div>
                </td>`;
            // Referencia y tela van por textContent, no por el template de arriba: son
            // texto libre congelado al crear la ficha (FichaConfeccion.referencia/
            // materialNombre), no HTML de confianza.
            fila.children[0].textContent = f.referencia;
            fila.children[1].textContent = f.materialNombre;
            contenedor.appendChild(fila);
        });
    };

    const leerFiltros = () => ({
        busqueda: inputBusqueda.value,
        familia: selectFamilia?.value || '',
        tela: selectTela?.value || ''
    });

    const obtenerFichas = async () => {
        const consultaId = ++ultimaConsultaId;
        try {
            const params = new URLSearchParams({ ...leerFiltros(), pagina: paginaActual }).toString();
            const r = await fetch(`/admin/json/fichas-confeccion?${params}`);
            const d = await r.json();
            if (consultaId !== ultimaConsultaId) return; // ya salió otra consulta más nueva

            if (d.success) {
                mostrarFichas(d.fichas);
                generarPaginacion('#paginacionFichas', d.totalPaginas, d.paginaActual, (nuevaPagina) => {
                    paginaActual = nuevaPagina;
                    obtenerFichas();
                });
            }
        } catch (e) {
            console.error('fichaConfeccionBiblioteca:', e);
        }
    };

    const filtrar = () => {
        paginaActual = 1;
        obtenerFichas();
    };

    let timer;
    inputBusqueda.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(filtrar, 300);
    });
    [selectFamilia, selectTela].filter(Boolean).forEach((el) => el.addEventListener('change', filtrar));

    document.addEventListener('DOMContentLoaded', filtrar);
})();
