// Galería de fotos de un proveedor (admin/provedores/ver/:id).
// Marcado en views/administrador/supplier/ver.pug: cada tarjeta de imagen lleva
// [data-doc-imagen] con data-href/data-nombre/data-fecha; el modal es #lightbox-documentos-proveedor.
// La lista de fotos sale de recorrer el DOM en orden, no de un JSON aparte — es la misma
// idea que #lightbox-comprobante en adminPedidoDetalle.js, pero con más de una foto.

const tarjetas = Array.from(document.querySelectorAll('[data-doc-imagen]'));
if (tarjetas.length) {
    const fotos = tarjetas.map(t => ({
        href:   t.dataset.href,
        nombre: t.dataset.nombre || '',
        fecha:  t.dataset.fecha || ''
    }));

    const lightbox  = document.getElementById('lightbox-documentos-proveedor');
    const img       = document.getElementById('galeria-documentos-img');
    const nombreEl  = document.getElementById('galeria-documentos-nombre');
    const contador  = document.getElementById('galeria-documentos-contador');
    const abrirLink = document.getElementById('galeria-documentos-abrir');
    const btnPrev   = document.getElementById('galeria-documentos-prev');
    const btnNext   = document.getElementById('galeria-documentos-next');

    let indice = 0;

    const mostrar = (i) => {
        indice = (i + fotos.length) % fotos.length;
        const foto = fotos[indice];
        img.src = foto.href;
        img.alt = foto.nombre;
        nombreEl.textContent = foto.nombre;
        contador.textContent = fotos.length > 1 ? `${indice + 1} / ${fotos.length}` : '';
        abrirLink.href = foto.href;
    };

    const abrir = (i) => {
        mostrar(i);
        lightbox.classList.remove('hidden');
        lightbox.classList.add('flex');
    };

    const cerrar = () => {
        lightbox.classList.add('hidden');
        lightbox.classList.remove('flex');
    };

    const multiple = fotos.length > 1;
    btnPrev.classList.toggle('hidden', !multiple);
    btnNext.classList.toggle('hidden', !multiple);

    tarjetas.forEach((t, i) => t.addEventListener('click', () => abrir(i)));
    lightbox.querySelectorAll('[data-cerrar-galeria-documentos]').forEach(el => el.addEventListener('click', cerrar));
    btnPrev.addEventListener('click', () => mostrar(indice - 1));
    btnNext.addEventListener('click', () => mostrar(indice + 1));

    document.addEventListener('keydown', (e) => {
        if (lightbox.classList.contains('hidden')) return;
        if (e.key === 'Escape') cerrar();
        else if (e.key === 'ArrowLeft' && multiple) mostrar(indice - 1);
        else if (e.key === 'ArrowRight' && multiple) mostrar(indice + 1);
    });
}
