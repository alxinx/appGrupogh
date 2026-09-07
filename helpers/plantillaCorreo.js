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
