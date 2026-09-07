import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname_tirilla = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname_tirilla, '../public/img/logo.png');

// Base de las tirillas de 80mm del panel. Antes cada comprobante repetía las mismas
// funciones (`hr`, `hrDot`, `rowKV`), la misma cabecera con logo y razón social y el
// mismo pie de firma: tres copias en adminControllers.js —abono a proveedor, abono a
// cliente y ahora el movimiento de cuenta— que se iban separando de a poco.
//
// El ancho es fijo: 227pt ≈ 80mm, el rollo de las impresoras térmicas del negocio.
export const ANCHO_TIRILLA = 227;
const MARGEN = 10;

export const fmtCOP   = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v);
export const fmtFecha = d => new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtHora  = d => new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

/**
 * Crea el documento y devuelve las piezas para armarlo.
 *
 * `alto` lo calcula cada comprobante según su contenido: la tirilla se imprime en rollo
 * continuo y cada punto de más es papel desperdiciado.
 */
export function crearTirilla({ alto }) {
    const doc = new PDFDocument({
        size: [ANCHO_TIRILLA, alto],
        margins: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
        autoFirstPage: true
    });

    const CW = ANCHO_TIRILLA - MARGEN * 2;

    /** Línea continua de separación. */
    const hr = () => {
        doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + CW, doc.y).strokeColor('#aaa').lineWidth(0.4).stroke();
        doc.moveDown(0.35);
    };

    /** Línea punteada, para separar dentro de un mismo bloque. */
    const hrDot = () => {
        doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + CW, doc.y).dash(2, { space: 2 }).strokeColor('#bbb').lineWidth(0.4).stroke().undash();
        doc.moveDown(0.35);
    };

    /** Fila etiqueta → valor, con el valor alineado a la derecha. */
    const rowKV = (etiqueta, valor, negrita = false) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(7).text(etiqueta, MARGEN, y, { width: CW * 0.5 });
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
           .text(String(valor), MARGEN + CW * 0.5, y, { width: CW * 0.5, align: 'right' });
        doc.y = y + 11;
    };

    /** Texto centrado a lo ancho de la tirilla. */
    const centrado = (texto, { size = 7, negrita = false, color = '#000' } = {}) => {
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
           .text(texto, MARGEN, doc.y, { width: CW, align: 'center' });
        doc.fillColor('#000');
    };

    /** Logo + razón social + NIT, y debajo el título del comprobante con su fecha. */
    const cabecera = ({ regimen, titulo, fecha }) => {
        const LOGO = 50;
        try { doc.image(LOGO_PATH, MARGEN + (CW - LOGO) / 2, MARGEN, { width: LOGO, height: LOGO }); } catch {}
        doc.y = MARGEN + LOGO + 4;

        centrado(regimen?.razonSocial || 'GRUPO GH', { size: 9, negrita: true });
        if (regimen?.taxId) centrado(`NIT: ${regimen.taxId}${regimen.DV ? '-' + regimen.DV : ''}`, { size: 6.5 });

        doc.moveDown(0.4); hr();
        centrado(titulo, { size: 8.5, negrita: true });
        centrado(`${fmtFecha(fecha)}  ${fmtHora(fecha)}`, { size: 6.5 });
        doc.moveDown(0.4); hr();
    };

    /**
     * Línea de firma al pie. El pie de la línea acompaña a la etiqueta: si arriba dice
     * "Registra:", abajo no puede decir "quien recibe".
     */
    const pieFirma = ({ etiqueta = 'Recibe:', quien = 'recibe' } = {}) => {
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(6.5).text(etiqueta, MARGEN, doc.y, { width: CW });
        doc.moveDown(2.5);
        doc.moveTo(MARGEN + 10, doc.y).lineTo(MARGEN + CW - 10, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
        doc.moveDown(0.3);
        centrado(`Firma y nombre de quien ${quien}`, { size: 6 });
    };

    return { doc, CW, MARGEN, hr, hrDot, rowKV, centrado, cabecera, pieFirma };
}
