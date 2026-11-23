import { fileURLToPath } from 'url';
import path from 'path';
import PDFDocument from 'pdfkit';
import { NOMBRE_EMPRESA } from '../config/marca.js';
import { ETIQUETA_ESTADO_CORTE } from './ordenesCorte.js';

// Hoja de la orden de corte para el cortador (GET /admin/procesos/cortes/:id/pdf). Sigue el
// formato que el taller usaba a mano (taller/CORTES/ORDEN DE CORTE (1).pdf): encabezado con
// fecha, tela, proveedor y número de trazo, y un recuadro por referencia con REFERENCIA,
// TIPO DE PRENDA, TALLAS, VECES X TALLA, PIEZAS y SEPARAR PIEZAS, dos por fila. Suma lo que
// esa hoja no tenía y el sistema ya sabe: rollos con sus capas, prendas por color y talla.
// Los datos llegan ya presentados por `detalleCorte` (controller/ordenCorteController.js),
// la misma copia que pinta la pantalla. Se escribe en streaming sobre `destino` (§11).

const LOGO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/img/logo.png');

// Paleta de marca (CLAUDE.md §4.1/§4.3), la misma de helpers/fichaConfeccionPdf.js.
const PINK = '#E24C95';
const PINK_SOFT = '#FDE7F2';
const SLATE_900 = '#1f2430';
const SLATE_500 = '#64748b';
const GRIS_FILA = '#F3F4F6';
const BORDE = '#E7B8D0';

const W = 841.89, H = 595.28, M = 28, CW = W - M * 2, ABAJO = H - M;
const PAD = 5;

const num = (n) => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fechaLarga = (f, utc = false) => f
    ? new Date(f).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: utc ? 'UTC' : 'America/Bogota' }).toUpperCase()
    : '—';

/** Una fila de celdas `{ etiqueta, valor, ancho }` (ancho en fracción de la fila). */
function medirFila(doc, celdas, w) {
    return Math.max(18, ...celdas.map(c => {
        doc.font('Helvetica-Bold').fontSize(8.5);
        return doc.heightOfString(`${c.etiqueta ? c.etiqueta + ': ' : ''}${c.valor ?? ''}`, { width: w * c.ancho - PAD * 2 }) + PAD * 2;
    }));
}

function dibujarFila(doc, x, y, w, celdas, { fondo = null, alto } = {}) {
    const h = alto ?? medirFila(doc, celdas, w);
    let cx = x;
    for (const c of celdas) {
        const cw = w * c.ancho;
        if (fondo) doc.rect(cx, y, cw, h).fill(fondo);
        doc.rect(cx, y, cw, h).lineWidth(0.6).strokeColor(BORDE).stroke();
        const opciones = { width: cw - PAD * 2 };
        if (c.etiqueta) {
            doc.fillColor(SLATE_500).font('Helvetica').fontSize(7.5).text(`${c.etiqueta}: `, cx + PAD, y + PAD + 0.5, { ...opciones, continued: true });
            doc.fillColor(c.color || SLATE_900).font('Helvetica-Bold').fontSize(8.5).text(String(c.valor ?? '—'), opciones);
        } else {
            doc.fillColor(c.color || SLATE_900).font('Helvetica-Bold').fontSize(8.5).text(String(c.valor ?? '—'), cx + PAD, y + PAD, opciones);
        }
        cx += cw;
    }
    doc.fillColor('#000');
    return y + h;
}

// "S ×2 · M ×3" — cuántas veces va cada talla en una capa del trazo. Con una sola talla, "X3"
// como en la hoja a mano.
const vecesPorTalla = (tallas) => tallas.length === 1
    ? `X${tallas[0].porCapa}`
    : tallas.map(t => `${t.etiqueta} ×${t.porCapa}`).join(' · ');

// Piezas de la prenda, una vez cada nombre, con cuántas lleva si son más de una.
function textoPiezas(piezas) {
    const porNombre = new Map();
    for (const p of piezas) porNombre.set(p.nombre, Math.max(porNombre.get(p.nombre) || 0, p.porPrenda || 1));
    return [...porNombre].map(([nombre, n]) => (n > 1 ? `${n} ${nombre}` : nombre)).join(' - ') || '—';
}

function textoSeparar(ref) {
    if (ref.excluida) return 'NO SE CORTA EN ESTE TRAZO (sus piezas no forman prendas completas).';
    const partes = ref.sueltas.map(s => `${s.total} ${s.nombre}${s.talla ? ` ${s.talla}` : ''}`);
    if (ref.faltanPiezas) partes.push('la prenda lleva piezas que este trazo no trae');
    return partes.length ? `${partes.join(' - ')} (quedan pendientes de otro corte)` : '—';
}

function textoPrendas(ref, tallas) {
    if (ref.excluida) return '—';
    const porColor = ref.grilla
        .map(g => {
            const detalle = tallas.length === 1
                ? `${g.porTalla[tallas[0].codigo] || 0}`
                : tallas.map(t => `${t.etiqueta} ${g.porTalla[t.codigo] || 0}`).join(' · ');
            return `${g.color.valor.toUpperCase()}: ${detalle}`;
        });
    return `${porColor.join('   ')}   (TOTAL ${ref.prendas})`;
}

// Filas del recuadro de una referencia (como en la hoja a mano).
function filasReferencia(ref) {
    const tallas = ref.tallas;
    return [
        { fondo: GRIS_FILA, celdas: [
            { etiqueta: 'REFERENCIA', valor: ref.estilo, ancho: 0.58 },
            { etiqueta: 'TIPO DE PRENDA', valor: ref.tipoPrenda || 'Sin definir', ancho: 0.42, color: ref.tipoPrenda ? null : PINK }
        ] },
        { celdas: [
            { etiqueta: 'TALLAS', valor: tallas.map(t => t.etiqueta).join(', ').toUpperCase() || '—', ancho: 0.58 },
            { etiqueta: 'VECES X TALLA', valor: vecesPorTalla(tallas), ancho: 0.42 }
        ] },
        { celdas: [{ etiqueta: 'PIEZAS', valor: textoPiezas(ref.piezas), ancho: 1 }] },
        { celdas: [{ etiqueta: 'PRENDAS', valor: textoPrendas(ref, tallas), ancho: 1 }] },
        { celdas: [{ etiqueta: 'SEPARAR PIEZAS', valor: textoSeparar(ref), ancho: 1, color: ref.excluida || ref.sueltas.length || ref.faltanPiezas ? PINK : null }] }
    ];
}

/**
 * @param {object} detalle lo que devuelve detalleCorte().
 * @param {import('stream').Writable} destino la respuesta HTTP.
 */
export function pdfOrdenCorte(detalle, destino) {
    const { corte, rollos, referencias, proveedores, capasTotal, metrosTotal, aprovechamiento } = detalle;
    // Margen inferior 0: cada bloque se mide antes de dibujarse y la página se corta a mano;
    // así PDFKit nunca abre una página por su cuenta en medio de una fila.
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: M, left: M, right: M, bottom: 0 } });
    doc.pipe(destino);

    const marcaDeAgua = () => {
        try {
            doc.save().opacity(0.05);
            doc.image(LOGO_PATH, W / 2 - 150, H / 2 - 130, { width: 300 });
            doc.restore();
        } catch { /* sin logo no se rompe el PDF */ }
    };

    const encabezado = (continuacion) => {
        marcaDeAgua();
        try { doc.image(LOGO_PATH, M, M, { width: 54 }); } catch { /* ídem */ }
        doc.fillColor(PINK).font('Helvetica-Bold').fontSize(17).text('ORDEN DE CORTE', M + 66, M + 2);
        doc.fillColor(SLATE_900).font('Helvetica-Bold').fontSize(11)
            .text(`${corte.numeroCorte}${continuacion ? '  (continuación)' : ''}`, M + 66, M + 22);
        doc.fillColor(SLATE_500).font('Helvetica').fontSize(7.5)
            .text(`${NOMBRE_EMPRESA} · ${ETIQUETA_ESTADO_CORTE[corte.estado] || corte.estado} · generada el ${fechaLarga(new Date())}`, M + CW - 300, M + 6, { width: 300, align: 'right' });
        doc.fillColor('#000');
        return M + 40;
    };

    let y = encabezado(false);

    // ── Datos del trazo (la parte de arriba de la hoja a mano) ───────────────────────
    const xDatos = M + 66, wDatos = CW - 66;
    const tela = corte.material ? `${corte.material.nombre}${corte.material.codigoMaterial ? ` (${corte.material.codigoMaterial})` : ''}` : '—';
    const filasDatos = [
        [
            { etiqueta: 'FECHA', valor: fechaLarga(corte.cortadaEn || corte.createdAt), ancho: 0.34 },
            { etiqueta: 'PARA EL', valor: fechaLarga(corte.fechaRequerida, true), ancho: 0.33 },
            { etiqueta: '# TRAZO', valor: `${corte.numeroCorte} · ${corte.nombreArchivo}`, ancho: 0.33 }
        ],
        [
            { etiqueta: 'TELA', valor: tela.toUpperCase(), ancho: 0.34 },
            { etiqueta: 'PROVEEDOR', valor: proveedores.length ? proveedores.join(', ').toUpperCase() : '—', ancho: 0.66 }
        ],
        [
            { etiqueta: 'LARGO DEL TRAZO', valor: `${num(Number(corte.largoCm) / 100)} m × ${num(Number(corte.anchoCm) / 100)} m de ancho`, ancho: 0.34 },
            { etiqueta: 'APROVECHAMIENTO', valor: `${num(aprovechamiento)} %`, ancho: 0.33 },
            { etiqueta: 'CAPAS', valor: `${capasTotal} · ${num(metrosTotal)} m de tela`, ancho: 0.33 }
        ]
    ];
    for (const celdas of filasDatos) y = dibujarFila(doc, xDatos, y, wDatos, celdas);

    // Rollos: cuatro por fila, con color, capas y metros que gasta cada uno.
    y += 8;
    const porFila = 4;
    for (let i = 0; i < rollos.length; i += porFila) {
        const grupo = rollos.slice(i, i + porFila);
        const celdas = grupo.map(r => ({ etiqueta: `ROLLO ${r.codigo}`, valor: `${r.color.toUpperCase()} · ${r.capas} capa${r.capas === 1 ? '' : 's'} · ${num(r.metros)} m`, ancho: 1 / porFila }));
        const alto = medirFila(doc, celdas, CW);   // la última fila puede quedar con menos de cuatro
        if (y + alto > ABAJO) { doc.addPage(); y = encabezado(true); }
        y = dibujarFila(doc, M, y, CW, celdas, { alto });
    }

    // ── Un recuadro por referencia, dos por fila ─────────────────────────────────────
    y += 10;
    const GAP = 12, wRef = (CW - GAP) / 2;
    const recuadros = referencias.map(ref => {
        const filas = filasReferencia(ref).map(f => ({ ...f, alto: medirFila(doc, f.celdas, wRef) }));
        return { filas, alto: filas.reduce((s, f) => s + f.alto, 0) };
    });
    for (let i = 0; i < recuadros.length; i += 2) {
        const par = recuadros.slice(i, i + 2);
        const alto = Math.max(...par.map(r => r.alto));
        if (y + alto > ABAJO) { doc.addPage(); y = encabezado(true); }
        par.forEach((r, j) => {
            let yy = y;
            const x = M + j * (wRef + GAP);
            r.filas.forEach((f, k) => {
                // La última fila se estira para que los dos recuadros del par terminen parejos.
                const altoFila = k === r.filas.length - 1 ? f.alto + (alto - r.alto) : f.alto;
                yy = dibujarFila(doc, x, yy, wRef, f.celdas, { fondo: f.fondo, alto: altoFila });
            });
            doc.rect(x, y, wRef, alto).lineWidth(1.2).strokeColor(PINK).stroke();
        });
        y += alto + GAP;
    }

    // ── Notas y firmas ───────────────────────────────────────────────────────────────
    const notas = [{ etiqueta: 'NOTAS', valor: corte.notas || '—', ancho: 1 }];
    const firmas = [
        { etiqueta: 'CORTÓ', valor: ' ', ancho: 0.34 },
        { etiqueta: 'REVISÓ', valor: ' ', ancho: 0.33 },
        { etiqueta: 'FECHA DE CORTE', valor: ' ', ancho: 0.33 }
    ];
    const altoFirmas = 30;
    const altoNotas = medirFila(doc, notas, CW);
    if (y + altoNotas + altoFirmas > ABAJO) { doc.addPage(); y = encabezado(true); }
    y = dibujarFila(doc, M, y, CW, notas, { alto: altoNotas });
    dibujarFila(doc, M, y, CW, firmas, { alto: altoFirmas });

    doc.end();
}
