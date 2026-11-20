// Duración de un video elegido en el navegador, antes de subirlo (fichas de confección:
// asistente nuevo y editor). Se lee de los metadatos del archivo con un <video> fuera del
// documento. Si el navegador no puede leerlo (un códec que no soporta, como HEVC en
// algunos Chrome) devuelve null: el servidor y Cloudflare siguen poniendo el tope.
export const duracionVideo = (archivo) => new Promise((resolve) => {
    const url = URL.createObjectURL(archivo);
    const video = document.createElement('video');
    const terminar = (valor) => { URL.revokeObjectURL(url); resolve(valor); };
    const espera = setTimeout(() => terminar(null), 8000);
    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => {
        clearTimeout(espera);
        terminar(Number.isFinite(video.duration) ? video.duration : null);
    }, { once: true });
    video.addEventListener('error', () => { clearTimeout(espera); terminar(null); }, { once: true });
    video.src = url;
});
