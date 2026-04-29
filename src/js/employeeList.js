(function () {
    const inputBusqueda = document.getElementById('busquedaEmpleado');
    const contenedor = document.getElementById('contenedor-empleados');
    const resumen = document.getElementById('resumenEmpleados');

    if (!contenedor) return;

    let paginaActual = 1;

    const estadoBadge = (estado) => {
        const map = {
            activo:      'bg-emerald-100 text-emerald-700',
            suspendido:  'bg-yellow-100 text-yellow-700',
            despedido:   'bg-red-100 text-red-700',
            vacaciones:  'bg-blue-100 text-blue-700',
            enfermedad:  'bg-orange-100 text-orange-700',
            licencia:    'bg-purple-100 text-purple-700',
            otro:        'bg-gray-100 text-gray-600',
        };
        const clase = map[estado] || map.otro;
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${clase}">${estado}</span>`;
    };

    const mostrarEmpleados = (empleados) => {
        contenedor.innerHTML = '';

        if (empleados.length === 0) {
            contenedor.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-gray-400">No se encontraron empleados.</td></tr>';
            return;
        }

        const filas = empleados.map(emp => {
            const sede = emp.sede ? emp.sede.nombreComercial : '<span class="text-gray-400 italic text-xs">Sin sede</span>';
            return `
                <tr class="border-b border-gray-100 hover:bg-gray-100 transition-colors">
                    <td class="px-6 py-4">
                        <p class="font-bold text-slate-800">${emp.PrimerNombre} ${emp.PrimerApellido}</p>
                        <p class="text-xs text-slate-400">${emp.emailEmpleado}</p>
                    </td>
                    <td class="px-4 py-4 text-center text-sm text-slate-600">${emp.NumeroDocumento}</td>
                    <td class="px-4 py-4 text-center text-sm text-slate-600">${emp.telefonoContacto || '--'}</td>
                    <td class="px-4 py-4 text-center">
                        <span
                            class="codigo-empleado font-mono text-xs bg-slate-100 px-2 py-1 rounded cursor-pointer select-none"
                            style="filter:blur(5px); transition:filter 0.25s ease;"
                            title="Doble clic para revelar"
                        >${emp.codigoEmpleado}</span>
                    </td>
                    <td class="px-4 py-4 text-center text-sm text-slate-600">${sede}</td>
                    <td class="px-6 py-4 text-center">
                        <a href="/admin/personal/ver/${emp.idEmpleado}" class="btn btn-secondary text-xs">
                            <i class="fi-rr-eye text-xs"></i> Ver más
                        </a>
                    </td>
                </tr>
            `;
        });

        contenedor.innerHTML = filas.join('');

        contenedor.querySelectorAll('.codigo-empleado').forEach(el => {
            let timer = null;
            el.addEventListener('dblclick', () => {
                el.style.filter = 'blur(0)';
                el.title = 'Se ocultará en 3 segundos...';
                clearTimeout(timer);
                timer = setTimeout(() => {
                    el.style.filter = 'blur(5px)';
                    el.title = 'Doble clic para revelar';
                }, 3000);
            });
        });
    };

    const obtenerEmpleados = async () => {
        contenedor.style.opacity = '0.5';
        try {
            const params = new URLSearchParams({
                busqueda: inputBusqueda?.value || '',
                pagina: paginaActual,
            });

            const response = await fetch(`/admin/json/personal/lista?${params}`);
            const data = await response.json();

            contenedor.style.opacity = '1';

            if (!data.success) return;

            mostrarEmpleados(data.empleados);

            if (resumen) {
                resumen.innerHTML = `Mostrando <span class="font-bold text-slate-600">${data.empleados.length}</span> de <span class="font-bold text-slate-600">${data.totalRegistros}</span> empleados`;
            }

            if (typeof generarPaginacion === 'function') {
                generarPaginacion(
                    '#paginacionEmpleados',
                    data.totalPaginas,
                    data.paginaActual,
                    (nuevaPagina) => {
                        paginaActual = nuevaPagina;
                        obtenerEmpleados();
                    }
                );
            }
        } catch (error) {
            contenedor.style.opacity = '1';
            contenedor.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-red-500">Error al cargar datos.</td></tr>';
        }
    };

    const filtrar = () => {
        paginaActual = 1;
        obtenerEmpleados();
    };

    let timer;
    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(filtrar, 300);
        });
    }

    document.addEventListener('DOMContentLoaded', obtenerEmpleados);
})();
