// Departamento → ciudad del formulario de proveedores (alta y edición).
//
// Los dos son buscables (window.enhanceSelectBuscable, helpers.js): el operador elige de la
// lista o escribe el nombre para filtrarla, pero solo puede quedarse con una opción de la
// lista, nunca con texto libre. Las opciones son las del servidor (departamentos) y las de
// /admin/json/municipios (ciudades); sus valores son los códigos DANE, que es lo que guarda
// PROVEDORES y lo que el servidor revalida con resolverUbicacionDane.
//
// En la edición, `data-selected` del select de ciudad trae la ciudad guardada para dejarla
// elegida al cargar.

const depto  = document.getElementById('departamentoSelect');
const ciudad = document.getElementById('ciudadSelect');

if (depto && ciudad) {
    window.enhanceSelectBuscable?.(depto, { placeholder: 'Escribe o elige un departamento' });
    const ciudadBuscable = window.enhanceSelectBuscable?.(ciudad, { placeholder: 'Escribe o elige una ciudad' }) || { refresh() {} };
    let pedido = '';   // departamento de la última carga: descarta respuestas viejas

    const opcion = (valor, texto) => {
        const o = document.createElement('option');
        o.value = valor;
        o.textContent = texto;
        return o;
    };

    const cargarCiudades = async (idDepartamento, elegida = '') => {
        pedido = idDepartamento;
        ciudad.replaceChildren(opcion('', idDepartamento ? 'Cargando ciudades…' : 'Elige primero el departamento'));
        ciudad.disabled = true;
        ciudadBuscable.refresh();
        if (!idDepartamento) return;
        try {
            const lista = await fetch(`/admin/json/municipios/${encodeURIComponent(idDepartamento)}`).then(r => r.json());
            if (pedido !== idDepartamento) return;
            ciudad.replaceChildren(opcion('', 'Selecciona la ciudad'), ...lista.map(m => opcion(m.id, m.nombre)));
            ciudad.value = elegida;
            ciudad.disabled = false;
        } catch {
            if (pedido === idDepartamento) ciudad.replaceChildren(opcion('', 'No se pudieron cargar las ciudades'));
        }
        ciudadBuscable.refresh();
    };

    depto.addEventListener('change', () => cargarCiudades(depto.value));
    cargarCiudades(depto.value, ciudad.dataset.selected || '');
}
