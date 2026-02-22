(function(){
document.addEventListener('DOMContentLoaded', () => {
    const cargarMetadata = async () => {
        const pathParts = window.location.pathname.split('/');
        const id = pathParts[pathParts.length - 2]; // Ajusta el índice según tu URL

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

    cargarMetadata();
});
})();