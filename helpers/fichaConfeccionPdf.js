import { fileURLToPath } from 'url';
import path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { GetObjectCommand } from '@aws-sdk/client-s3';

import r2PrivateClient, { R2_PRIVATE_BUCKET } from '../config/r2Private.js';
import { money } from './formatMoney.js';
import { NOMBRE_EMPRESA } from '../config/marca.js';
import { urlVerVideo } from './cloudflareStream.js';

const __dirname_ficha = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname_ficha, '../public/img/logo.png');

// Paleta — mismo rosa de marca que el resto del proyecto (CLAUDE.md §4.1/§4.3:
// --color-gh-primaryHover / --color-gh-primarySoft), nunca uno nuevo para este documento.
const PINK = '#E24C95';
const PINK_SOFT = '#FDE7F2';
const PINK_BAND = '#FDF6FA';
const SLATE_900 = '#1f2430';
const SLATE_600 = '#475569';
const SLATE_400 = '#94a3b8';
const BORDE = '#F0E4EA';

// PDF de una ficha de confección terminada (admin/procesos/fichas-confeccion/nueva,
// "Guardar ficha" — controller/fichaConfeccionController.js). Diseño pedido explícitamente
// por el usuario (maqueta de referencia): franja de encabezado, tira de datos clave, dos
// columnas (izquierda: molde subido + generado con IA; derecha: info general, colores y
// cantidades, información adicional de taller), códigos QR de los videos y observaciones.
// Mismo patrón que pdfOrdenCompra (controller/ordenesCompraController.js): A4, logo, buffer
// en memoria — liviano (unas pocas imágenes y tablas cortas), no justifica streaming a disco
// (CLAUDE.md §11).
//
// Imágenes: PDFKit solo acepta JPEG y PNG — el molde original sube como JPG o PDF (si es
// PDF, se omite: este proyecto no puede rasterizar un PDF a imagen, mismo límite que la
// generación con IA) y la imagen aprobada de la IA se guarda en WebP (controller/
// fichaConfeccionMoldeController.js aprobarMoldeIa) — se convierte a PNG acá con sharp antes
// de `doc.image()`.
async function descargarObjeto(key) {
    const obj = await r2PrivateClient.send(new GetObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: key }));
    const partes = [];
    for await (const parte of obj.Body) partes.push(parte);
    return Buffer.concat(partes);
}

/**
 * @param {object} ficha - FichaConfeccion con sus includes: dxf, molde, moldeIaIntento,
 *   videos, colores (cada uno con `color`, el Atributo — trae `codigo1`, el hex del swatch).
 * @returns {Promise<Buffer>} el PDF completo.
 */
export async function generarPdfFichaConfeccion(ficha) {
    const W = 595.28, MARGIN = 36, CW = W - MARGIN * 2;
    const doc = new PDFDocument({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    const trozos = [];
    doc.on('data', (d) => trozos.push(d));
    const fin = new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(trozos)));
        doc.on('error', reject);
    });

    // Encabezado de una sección: pastilla rosa suave con el título en mayúscula. Devuelve el
    // Y donde empieza el contenido de la sección.
    const seccionHeader = (texto, x, y, w) => {
        const h = 22;
        doc.roundedRect(x, y, w, h, 5).fill(PINK_SOFT);
        doc.fillColor(PINK).font('Helvetica-Bold').fontSize(8.5).text(texto.toUpperCase(), x + 10, y + 7, { width: w - 20 });
        doc.fillColor('#000');
        return y + h + 8;
    };

    // ── 1. Encabezado ─────────────────────────────────────────────────────────
    // Delgado a propósito (pedido explícito): el logo y las dos líneas de texto caben en
    // 52pt sin verse apretados, y lo que se gana acá es lo que permite que todo el PDF
    // quepa en una sola hoja.
    const headerH = 52;
    doc.roundedRect(MARGIN, MARGIN, CW, headerH, 9).fill(PINK_BAND);
    try { doc.image(LOGO_PATH, MARGIN + 11, MARGIN + 8, { width: 36, height: 36 }); } catch { /* sin logo no se rompe el PDF */ }
    doc.fillColor(SLATE_900).font('Helvetica-Bold').fontSize(13.5).text('FICHA DE CONFECCIÓN', MARGIN + 58, MARGIN + 9);
    doc.fillColor(PINK).font('Helvetica-Bold').fontSize(10.5).text(ficha.referencia, MARGIN + 58, MARGIN + 27);
    doc.fillColor(SLATE_400).font('Helvetica-Oblique').fontSize(8)
       .text(`${NOMBRE_EMPRESA} · Generada el ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}`,
             MARGIN + CW - 200, MARGIN + 21, { width: 190, align: 'right' });
    doc.fillColor('#000');

    let y = MARGIN + headerH + 10;

    // ── 2. Tira de datos clave: Referencia · Cantidad · Tela · Complementos ────
    const tiraH = 42;
    doc.roundedRect(MARGIN, y, CW, tiraH, 9).fill(PINK_SOFT);
    const datosTira = [
        { etiqueta: 'REFERENCIA', valor: ficha.referencia },
        { etiqueta: 'CANTIDAD', valor: `${ficha.cantidadTotal.toLocaleString('es-CO')} prendas` },
        { etiqueta: 'TELA', valor: ficha.materialNombre },
        { etiqueta: 'COMPLEMENTOS', valor: ficha.complementos || '—' }
    ];
    const colTiraW = CW / 4;
    datosTira.forEach((d, i) => {
        const cx = MARGIN + i * colTiraW + 16;
        doc.circle(cx, y + tiraH / 2, 3.5).fill(PINK);
        doc.fillColor(SLATE_400).font('Helvetica-Bold').fontSize(6.5).text(d.etiqueta, cx + 11, y + 9, { width: colTiraW - 26 });
        doc.fillColor(SLATE_900).font('Helvetica-Bold').fontSize(9)
           .text(d.valor, cx + 11, y + 20, { width: colTiraW - 26, height: 16, ellipsis: true });
    });
    doc.fillColor('#000');
    y += tiraH + 12;

    // ── 3. Dos columnas ──────────────────────────────────────────────────────
    const leftW = CW * 0.55, gap = 16, rightW = CW - leftW - gap;
    const leftX = MARGIN, rightX = MARGIN + leftW + gap;
    const topY = y;

    // ── Columna izquierda: molde subido + generado con IA (solo esos dos —
    // no hay "vistas frente/espalda" reales que mostrar en este flujo), una
    // debajo de la otra y a todo el ancho de la columna — se ven grandes,
    // aunque la columna quede más larga (pedido explícito del usuario).
    let yL = seccionHeader('Referencia visual', leftX, topY, leftW);
    // Las dos, una debajo de otra, a todo el ancho de la columna — grandes, pero sin pasarse
    // del margen inferior de la página: PDFKit pagina solo cuando un `.text()` cae más allá
    // del borde, aunque se le pase x/y explícitos, y eso desarma el layout de dos columnas
    // (cada página reinicia las coordenadas). 250 dejó margen de sobra con topY ≈ 204.
    const imgW = leftW, imgH = 250;

    const cajaImagen = async (x, yBase, etiqueta, buffer) => {
        doc.roundedRect(x, yBase, imgW, imgH, 8).strokeColor(BORDE).lineWidth(1).stroke();
        if (buffer) {
            try {
                doc.save();
                doc.roundedRect(x, yBase, imgW, imgH, 8).clip();
                doc.image(buffer, x, yBase, { fit: [imgW, imgH], align: 'center', valign: 'center' });
                doc.restore();
            } catch {
                doc.fillColor(SLATE_400).font('Helvetica').fontSize(8).text('No se pudo cargar la imagen.', x + 10, yBase + imgH / 2 - 4, { width: imgW - 20, align: 'center' });
                doc.fillColor('#000');
            }
        } else {
            doc.fillColor(SLATE_400).font('Helvetica').fontSize(8).text('Sin imagen', x + 10, yBase + imgH / 2 - 4, { width: imgW - 20, align: 'center' });
            doc.fillColor('#000');
        }
        doc.fillColor(SLATE_600).font('Helvetica-Bold').fontSize(8).text(etiqueta.toUpperCase(), x, yBase + imgH + 7, { width: imgW, align: 'center' });
        doc.fillColor('#000');
        return yBase + imgH + 22;
    };

    let bufferMolde = null;
    if (ficha.molde?.tipoArchivo === 'jpg' && ficha.molde?.objectKey) {
        try { bufferMolde = await descargarObjeto(ficha.molde.objectKey); } catch { /* se muestra "Sin imagen" */ }
    }
    let bufferIa = null;
    if (ficha.moldeIaIntento?.aprobado && ficha.moldeIaIntento?.objectKeyFinal) {
        try {
            const webp = await descargarObjeto(ficha.moldeIaIntento.objectKeyFinal);
            bufferIa = await sharp(webp).png().toBuffer();
        } catch { /* ídem */ }
    }

    yL = await cajaImagen(leftX, yL, 'Molde', bufferMolde);
    yL = await cajaImagen(leftX, yL, 'Generado con IA', bufferIa);

    // ── Columna derecha: información general, colores, información adicional ──
    let yR = seccionHeader('Información general', rightX, topY, rightW);
    const filasInfo = [
        ['Referencia', ficha.referencia],
        ['Cantidad', `${ficha.cantidadTotal.toLocaleString('es-CO')} prendas`],
        ['Tela', ficha.materialNombre],
        ['Complementos', ficha.complementos || '—']
    ];
    filasInfo.forEach(([etiqueta, valor]) => {
        const alturaValor = doc.font('Helvetica-Bold').fontSize(9).heightOfString(valor, { width: rightW * 0.55 });
        const alturaFila = Math.max(20, alturaValor + 8);
        doc.fillColor(SLATE_400).font('Helvetica').fontSize(8).text(etiqueta, rightX, yR + 4, { width: rightW * 0.42 });
        doc.fillColor(SLATE_900).font('Helvetica-Bold').fontSize(9).text(valor, rightX + rightW * 0.42, yR + 2, { width: rightW * 0.58, align: 'right' });
        doc.fillColor('#000');
        yR += alturaFila;
        doc.moveTo(rightX, yR).lineTo(rightX + rightW, yR).strokeColor(BORDE).lineWidth(0.5).stroke();
        yR += 4;
    });
    yR += 4;

    // Colores y cantidades — reemplaza "detalle de materiales": una fila por color, con su
    // pastilla de color real (ATRIBUTOS.codigo1) y la cantidad.
    yR = seccionHeader('Colores', rightX, yR, rightW);
    const colores = ficha.colores || [];
    if (!colores.length) {
        doc.fillColor(SLATE_400).font('Helvetica-Oblique').fontSize(8.5).text('Sin colores registrados.', rightX, yR);
        doc.fillColor('#000');
        yR += 18;
    } else {
        colores.forEach((linea) => {
            doc.circle(rightX + 6, yR + 7, 5).fill(linea.color?.codigo1 || '#cccccc');
            doc.circle(rightX + 6, yR + 7, 5).lineWidth(0.5).stroke('#D4D4D8');
            doc.fillColor(SLATE_900).font('Helvetica').fontSize(9).text(linea.color?.valor || '—', rightX + 18, yR + 2, { width: rightW * 0.55 });
            doc.fillColor(SLATE_600).font('Helvetica-Bold').fontSize(9)
               .text(`${linea.cantidad.toLocaleString('es-CO')}`, rightX, yR + 2, { width: rightW, align: 'right' });
            doc.fillColor('#000');
            yR += 16;
        });
    }
    yR += 6;

    // Información adicional — reemplaza "tabla de consumo": los datos de taller que este
    // sistema todavía no registra (cortador, fechas, taller) quedan en blanco para llenar a
    // mano; precio de confección y observaciones sí los tenemos y se imprimen. Firma al
    // final, como cierre de la tabla (pedido explícito del usuario).
    yR = seccionHeader('Información adicional', rightX, yR, rightW);
    const filaAdic = (yBase, alto, celdas) => {
        doc.rect(rightX, yBase, rightW, alto).strokeColor(BORDE).lineWidth(1).stroke();
        let cx = rightX;
        celdas.forEach((c, i) => {
            if (i > 0) doc.moveTo(cx, yBase).lineTo(cx, yBase + alto).strokeColor(BORDE).lineWidth(1).stroke();
            doc.fillColor(SLATE_600).font('Helvetica-Bold').fontSize(8).text(c.label, cx + 8, yBase + alto / 2 - 4, { width: c.w - (c.valor ? 60 : 16) });
            if (c.valor) {
                doc.fillColor(PINK).font('Helvetica-Bold').fontSize(9.5).text(c.valor, cx + 8, yBase + alto / 2 - 4.5, { width: c.w - 16, align: 'right' });
            }
            doc.fillColor('#000');
            cx += c.w;
        });
        return yBase + alto;
    };
    const filaH = 20;
    yR = filaAdic(yR, filaH, [{ label: 'CORTADOR:', w: rightW }]);
    yR = filaAdic(yR, filaH, [{ label: 'FECHA SALIDA:', w: rightW / 2 }, { label: 'FECHA ENTREGA:', w: rightW / 2 }]);
    yR = filaAdic(yR, filaH, [{ label: 'TALLER CONFECCIÓN:', w: rightW }]);
    yR = filaAdic(yR, filaH, [{ label: 'PRECIO CONFECCIÓN:', valor: `$${money(ficha.precioConfeccion)}`, w: rightW }]);

    // Observaciones — alto dinámico según cuánto texto haya, a diferencia de las filas de
    // arriba que son de una línea fija.
    const lineasObs = (ficha.observaciones || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const textoObs = lineasObs.length ? lineasObs : ['Sin observaciones.'];
    doc.font('Helvetica').fontSize(8);
    const altoLineasObs = textoObs.reduce((suma, l) => suma + doc.heightOfString(l, { width: rightW - 26 }) + 3, 0);
    const altoObs = 16 + altoLineasObs + 6;
    doc.rect(rightX, yR, rightW, altoObs).strokeColor(BORDE).lineWidth(1).stroke();
    doc.fillColor(SLATE_600).font('Helvetica-Bold').fontSize(8).text('OBSERVACIONES:', rightX + 8, yR + 6, { width: rightW - 16 });
    let yObs = yR + 18;
    textoObs.forEach((linea) => {
        doc.circle(rightX + 11, yObs + 4, 1.5).fill(lineasObs.length ? PINK : SLATE_400);
        doc.fillColor(SLATE_600).font('Helvetica').fontSize(8).text(linea, rightX + 18, yObs, { width: rightW - 26 });
        yObs = doc.y + 3;
    });
    doc.fillColor('#000');
    yR += altoObs;

    yR = filaAdic(yR, filaH + 8, [{ label: 'FIRMA', w: rightW }]);
    yR += 10;

    // ── 4. Códigos QR — dentro de la misma columna, debajo de la tabla ────────
    const videosConLink = (ficha.videos || [])
        .filter((v) => v.estado === 'ready')
        .map((v) => ({ v, url: urlVerVideo(v.cloudflareVideoUid) }))
        .filter((x) => x.url);

    if (videosConLink.length) {
        yR = seccionHeader('Códigos QR', rightX, yR, rightW);
        doc.fillColor(SLATE_400).font('Helvetica').fontSize(7).text('Escanea para ver el video del proceso.', rightX, yR, { width: rightW });
        doc.fillColor('#000');
        yR += 12;
        const ladoQR = 56, gapQR = 14;
        const porFila = Math.max(1, Math.floor((rightW + gapQR) / (ladoQR + gapQR)));
        for (let i = 0; i < videosConLink.length; i++) {
            const col = i % porFila, fila = Math.floor(i / porFila);
            const x = rightX + col * (ladoQR + gapQR);
            const yy = yR + fila * (ladoQR + 20);
            try {
                const qrBuffer = await QRCode.toBuffer(videosConLink[i].url, { type: 'png', width: 200, margin: 1 });
                doc.roundedRect(x - 5, yy - 5, ladoQR + 10, ladoQR + 18, 7).strokeColor(BORDE).lineWidth(1).stroke();
                doc.image(qrBuffer, x, yy, { width: ladoQR, height: ladoQR });
                doc.fillColor(SLATE_600).font('Helvetica-Bold').fontSize(6.5)
                   .text(`VIDEO ${videosConLink[i].v.orden}`, x, yy + ladoQR + 3, { width: ladoQR, align: 'center' });
                doc.fillColor('#000');
            } catch { /* un QR que falla no tumba el PDF */ }
        }
        const filasQR = Math.ceil(videosConLink.length / porFila);
        yR += filasQR * (ladoQR + 20);
    }

    y = Math.max(yL, yR);

    doc.end();
    return fin;
}
