import { COLORES_CORREO as C, NOMBRE_EMPRESA } from '../config/marca.js';

// Estructura compartida por los correos "simples" (encabezado con título + cuerpo +
// pie). Nació de fusionar dos plantillas que eran la misma cosa escrita dos veces:
// plantillaBase() de helpers/emailSes.js y plantilla() de helpers/notificarQrPago.js.
//
// El correo de confirmación de pedido y el de cancelación NO usan esto: son diseños
// propios y mucho más ricos (tracker de estado, tabla de productos, tarjetas de info).
// Toman de acá los formatos y de config/marca.js el color de marca y las URLs, que es
// lo que de verdad estaba duplicado entre ellos.

// ─── Formatos ───────────────────────────────────────────────────────────────

/** "7 de septiembre de 2026, 10:30" — fecha larga, para avisos internos. */
export const fmtFechaLarga = (fecha) =>
    new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Bogota'
    }).format(fecha instanceof Date ? fecha : new Date(fecha));

/** "7 sept 2026" — fecha corta, para tablas y tarjetas. */
export const fmtFechaCorta = (fecha) => {
    if (!fecha) return '—';
    return new Date(fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** "10:30 AM" — deliberadamente no-locale, para que sea igual en cualquier cliente de correo. */
export const fmtHora = (fecha) => {
    if (!fecha) return '';
    const d = new Date(fecha);
    let horas = d.getHours();
    const minutos = String(d.getMinutes()).padStart(2, '0');
    const ampm = horas >= 12 ? 'PM' : 'AM';
    horas = horas % 12 || 12;
    return `${horas}:${minutos} ${ampm}`;
};

// ─── Iconos de línea ────────────────────────────────────────────────────────
//
// Primitivas simples (nada de paths largos) para los correos con layout propio
// (confirmación/cancelación de pedido, bienvenida de proveedor): se ven iguales en
// cualquier cliente moderno y heredan el color de marca, en vez de depender de cómo cada
// sistema operativo dibuje un emoji. Nació de dos copias idénticas de esta misma función
// en helpers/mailPedidoCancelado.js y helpers/mailBienvenidaProveedor.js.
export function icono(nombre, { size = 20, color = C.primary } = {}) {
    const base = `viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"`;
    const formas = {
        doc: `<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>`,
        carpeta: `<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>`,
        calendario: `<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/>`,
        calendarioX: `<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9.5" y1="14.5" x2="14.5" y2="19.5"/><line x1="14.5" y1="14.5" x2="9.5" y2="19.5"/>`,
        dolar: `<circle cx="12" cy="12" r="9"/><text x="12" y="16.3" text-anchor="middle" font-size="11" font-weight="700" fill="${color}" stroke="none" font-family="Helvetica,Arial,sans-serif">$</text>`,
        alerta: `<path d="M12 3 L22 21 L2 21 Z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17" r="0.7" fill="${color}" stroke="none"/>`,
        bolsa: `<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>`,
        audifonos: `<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19v1a3 3 0 0 1-3 3h-3"/>`,
        escudo: `<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/>`,
        estrella: `<polygon points="12 2 15 9 22 9.5 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.5 9 9"/>`,
        camion: `<rect x="1" y="7" width="13" height="10"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.6" fill="${color}" stroke="none"/><circle cx="17" cy="19" r="1.6" fill="${color}" stroke="none"/>`,
        mensaje: `<path d="M4 4h16v12H8l-4 4z"/>`,
        sobre: `<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 6 12 13 21 6"/>`,
        banco: `<polygon points="12 2 22 8 2 8"/><line x1="4" y1="8" x2="4" y2="19"/><line x1="9" y1="8" x2="9" y2="19"/><line x1="15" y1="8" x2="15" y2="19"/><line x1="20" y1="8" x2="20" y2="19"/><line x1="2" y1="21" x2="22" y2="21"/>`,
        llave: `<circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12 L21 2"/><path d="M17 6 L20 9"/><path d="M14 9 L16.5 11.5"/>`,
        etiqueta: `<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 11.5 12.5 20 3 11.5z"/><circle cx="7.5" cy="7.5" r="1.3" fill="${color}" stroke="none"/>`,
        instagram: `<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="${color}" stroke="none"/>`,
        facebook: `<circle cx="12" cy="12" r="9"/><path d="M14 8.5h-1.8c-.9 0-1.4.5-1.4 1.4V11h3.1l-.4 2.6h-2.7V21"/>`,
        tiktok: `<path d="M13 3v12.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M13 6.5c0 2.5 2 4.3 4.3 4.3"/>`
    };
    return `<svg ${base}>${formas[nombre] || ''}</svg>`;
}

// ─── Piezas reutilizables ───────────────────────────────────────────────────

/** Tabla etiqueta → valor. `lineas` es [['Entidad', 'Bancolombia'], ...]. */
export const filasDefinicion = (lineas) => `
    <table style="width:100%;border-collapse:collapse;">
        ${lineas.map(([etiqueta, valor]) => `
        <tr>
            <td style="padding:8px 0;color:${C.textoSuave};font-size:14px;">${etiqueta}</td>
            <td style="padding:8px 0;color:${C.texto};font-size:14px;font-weight:600;text-align:right;">${valor}</td>
        </tr>`).join('')}
    </table>`;

/**
 * Correo simple: encabezado de color con el título, cuerpo, y pie de marca.
 *
 * - `encabezado`: { fondo, texto }. Por defecto rosa suave con texto de marca (avisos al
 *   cliente); un aviso de seguridad lo pasa sólido — ver helpers/notificarQrPago.js.
 * - `avisoHtml`: franja destacada al final del cuerpo (el aviso de seguridad del QR).
 * - `pieBaja`: URL de baja, solo para correos que salen por lista (producto disponible).
 */
export function plantillaSimple({
    titulo,
    encabezado = { fondo: C.primarySoft, texto: C.primary },
    saludo,
    cuerpoHtml,
    avisoHtml,
    pieBaja
}) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 0; font-family: 'Helvetica', Arial, sans-serif; background-color: ${C.fondoNeutro}; color: #334155; }
    </style>
</head>
<body style="background-color: ${C.fondoNeutro}; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background: ${C.tarjeta}; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden;">
        <div style="background-color: ${encabezado.fondo}; padding: 30px; text-align: center;">
            <h1 style="color: ${encabezado.texto}; font-size: 22px; margin: 0;">${titulo}</h1>
        </div>
        <div style="padding: 40px;">
            ${saludo ? `<p style="font-weight: bold; font-size: 16px; margin-top: 0;">${saludo}</p>` : ''}
            <div style="font-size: 15px; line-height: 1.6; color: #334155;">${cuerpoHtml}</div>
            ${avisoHtml ? `<p style="margin:24px 0 0;padding:14px;background:${C.alertaSuave};border-left:4px solid ${C.alerta};color:${C.alertaTexto};font-size:14px;font-weight:700;">${avisoHtml}</p>` : ''}
        </div>
        <div style="background-color: #f8fafc; padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            <p style="font-weight: bold; color: #1e293b; margin-bottom: 5px;">${NOMBRE_EMPRESA}</p>
            <p style="margin: 0;">Este es un mensaje automático.</p>
            ${pieBaja ? `<p style="margin: 10px 0 0;"><a href="${pieBaja}" style="color: #94a3b8; text-decoration: underline;">Dar de baja este aviso</a></p>` : ''}
        </div>
    </div>
</body>
</html>`;
}
