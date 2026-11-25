import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';

// Etiqueta adhesiva de 5,5 × 2,5 cm con código de barras (Code 128) y unas líneas de texto
// debajo. Una sola copia para la etiqueta del SKU de un producto (adminControllers.js
// imprimirEtiquetaSKU) y la de un rollo de tela (controller/rollosTelaController.js): salen
// en la misma impresora, así que comparten medida, márgenes y código de barras.

export const ETIQUETA = { ancho: 155.91, alto: 70.87, margen: 4 };   // puntos PDF (5,5 × 2,5 cm)

const margenes = () => ({ top: ETIQUETA.margen, bottom: ETIQUETA.margen, left: ETIQUETA.margen, right: ETIQUETA.margen });

/** Documento vacío del tamaño de la etiqueta: cada etiqueta es una página (paginaEtiqueta). */
export const nuevoDocEtiquetas = () => new PDFDocument({ size: [ETIQUETA.ancho, ETIQUETA.alto], margins: margenes(), autoFirstPage: false });

/**
 * Agrega una etiqueta: el código de barras arriba y `lineas` abajo, centradas.
 * Cada línea: { texto, tamano, negrita, alto, recortar }. El código de barras ocupa lo que
 * queda. Ese alto se fija acá y NO sale de la proporción del PNG: el ancho del código
 * depende de cuántos caracteres tenga, así que un código largo daba barras más bajas que
 * uno corto y la etiqueta cambiaba de aspecto entre productos.
 */
export async function paginaEtiqueta(doc, { codigo, lineas }) {
    const { ancho, alto, margen } = ETIQUETA;
    const altoTexto = lineas.reduce((s, l) => s + l.alto, 0);
    const yTexto = alto - margen - altoTexto;
    const barras = await bwipjs.toBuffer({ bcid: 'code128', text: codigo, scale: 4, height: 14, includetext: false });
    doc.addPage({ size: [ancho, alto], margins: margenes() });
    doc.image(barras, margen, margen, { fit: [ancho - margen * 2, yTexto - margen - 1], align: 'center', valign: 'center' });
    let y = yTexto;
    for (const l of lineas) {
        doc.fontSize(l.tamano).font(l.negrita ? 'Helvetica-Bold' : 'Helvetica')
            .text(l.texto, margen, y, { width: ancho - margen * 2, height: l.alto, align: 'center', lineGap: 0, ellipsis: l.recortar || undefined });
        y += l.alto;
    }
}
