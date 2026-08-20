import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import { tituloLista } from './textoLista.js';
import {
    TrasladoEfectivo, TrasladoEfectivoHistorial,
    Empleados, PuntosDeVenta, CajasYBancos
} from '../models/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname, '../public/img/logo.png');

// ─────────────────────────────────────────────────────────────────────────────
// Comprobante de un traslado de efectivo.
//
// Vive acá y no en un controlador porque lo emiten dos lados: la tienda al despacharlo y
// el administrador al aceptarlo, rechazarlo o dejarlo en controversia. Dos copias del
// mismo comprobante terminarían diciendo cosas distintas sobre el mismo traslado.
//
// Se arma al vuelo y no se guarda: los datos ya están en la base, y un PDF archivado
// sería una segunda versión que puede quedar vieja cuando el traslado cambia de estado.
// ─────────────────────────────────────────────────────────────────────────────

const W = 227, MARGIN = 10, CW = W - MARGIN * 2, LOGO_H = 55;

const ROTULO_ESTADO = {
    'En Transito':  'EN TRÁNSITO',
    'Recibido':     'RECIBIDO',
    'Rechazado':    'RECHAZADO',
    'Controversia': 'EN CONTROVERSIA'
};

/**
 * Trae el traslado con todo lo que el comprobante necesita.
 * `where` extra permite al POS acotarlo a su propia tienda; el admin no lo acota.
 */
export const buscarTrasladoParaPDF = (idTraslado, whereExtra = {}) =>
    TrasladoEfectivo.findOne({
        where: { idTrasladosEfectivo: idTraslado, ...whereExtra },
        include: [
            { model: Empleados,     as: 'empleadoEnvia',    attributes: ['PrimerNombre', 'PrimerApellido', 'codigoEmpleado'], required: false },
            { model: Empleados,     as: 'empleadoRecibe',   attributes: ['PrimerNombre', 'PrimerApellido', 'codigoEmpleado'], required: false },
            { model: PuntosDeVenta, as: 'tiendaOrigen',     attributes: ['nombreComercial'], required: false },
            { model: CajasYBancos,  as: 'cajaBancoDestino', attributes: ['nombreCajaBanco', 'tipo', 'referencia'], required: false }
        ]
    });

/**
 * @param {object} traslado  Fila de TRASLADO_EFECTIVO con sus includes.
 * @returns {Promise<Buffer>}
 */
export const generarPDFTraslado = async (traslado) => {
    // La bitácora completa: el comprobante de un traslado resuelto tiene que mostrar el
    // recorrido, no solo el estado final. Es lo que responde "¿por qué entró menos de lo
    // que salió?" sin tener que abrir el sistema.
    const pasos = await TrasladoEfectivoHistorial.findAll({
        where: { idTrasladosEfectivo: traslado.idTrasladosEfectivo },
        include: [{ model: Empleados, as: 'empleado', attributes: ['PrimerNombre', 'PrimerApellido'], required: false }],
        order: [['idTransaccion', 'ASC']]
    });

    const doc = new PDFDocument({
        size: [W, 620],
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        autoFirstPage: true
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const fin = new Promise(r => doc.on('end', r));

    const pesos = (n) => `$${Math.round(parseFloat(n) || 0).toLocaleString('es-CO')}`;

    const hr = () => {
        doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y).strokeColor('#BBBBBB').lineWidth(0.5).stroke();
        doc.moveDown(0.4);
    };

    const fila = (label, valor) => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(6.5).text(label, MARGIN, y, { width: CW * 0.38 });
        doc.font('Helvetica').fontSize(6.5).text(String(valor), MARGIN + CW * 0.38, y, { width: CW * 0.62 });
        doc.y = Math.max(doc.y, y + 11);
        doc.moveDown(0.1);
    };

    const firma = (rotulo, nombre) => {
        doc.moveDown(2.2);
        const y = doc.y;
        doc.moveTo(MARGIN + 10, y).lineTo(MARGIN + CW - 10, y).strokeColor('#333333').lineWidth(0.5).stroke();
        doc.y = y + 3;
        doc.font('Helvetica-Bold').fontSize(6).text(rotulo, MARGIN, doc.y, { width: CW, align: 'center' });
        doc.font('Helvetica').fontSize(6).text(nombre, MARGIN, doc.y, { width: CW, align: 'center' });
    };

    const fechaHora = (f) => {
        const d = new Date(f);
        return d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) + ' ' +
               d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    };

    const logoX = MARGIN + (CW - LOGO_H) / 2;
    doc.image(LOGO_PATH, logoX, MARGIN, { width: LOGO_H, height: LOGO_H });
    doc.y = MARGIN + LOGO_H + 6;

    doc.font('Helvetica-Bold').fontSize(9).text('TRASLADO DE EFECTIVO', MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(8).text(traslado.codigoTraslado, MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.2);
    // El estado va destacado: en un comprobante de traslado resuelto es el dato por el
    // que se lo imprime.
    // Un 'Recibido' con excedente no es un recibido normal, y el rótulo tiene que decirlo:
    // es lo primero que se lee del comprobante.
    const rotulo = (ROTULO_ESTADO[traslado.estado] || String(traslado.estado).toUpperCase())
        + (Math.round(parseFloat(traslado.valorExcedente) || 0) > 0 ? ' CON EXCEDENTE' : '');
    doc.font('Helvetica-Bold').fontSize(7)
       .text(rotulo, MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.5);
    hr();

    const destino = traslado.cajaBancoDestino
        ? tituloLista(traslado.cajaBancoDestino.nombreCajaBanco) +
          (traslado.cajaBancoDestino.referencia ? ` (${traslado.cajaBancoDestino.referencia})` : '')
        : 'N/A';

    const envia = traslado.empleadoEnvia
        ? `${traslado.empleadoEnvia.PrimerNombre} ${traslado.empleadoEnvia.PrimerApellido}`
        : 'N/A';

    fila('Origen:',  tituloLista(traslado.tiendaOrigen?.nombreComercial || 'N/A'));
    fila('Destino:', destino);
    if (traslado.referencia) fila('Referencia:', traslado.referencia);
    fila('Despachado:', fechaHora(traslado.createdAt));
    fila('Trasladado por:', envia);
    if (traslado.empleadoEnvia?.codigoEmpleado) fila('Código:', traslado.empleadoEnvia.codigoEmpleado);

    if (traslado.empleadoRecibe) {
        fila('Resuelto por:', `${traslado.empleadoRecibe.PrimerNombre} ${traslado.empleadoRecibe.PrimerApellido}`);
        fila('Fecha:', fechaHora(traslado.updatedAt));
    }

    doc.moveDown(0.2); hr();

    // Lo que efectivamente se asentó contra lo despachado. El paso 'Excedente' queda
    // afuera de esta suma a propósito: no es parte de lo que la tienda mandó, es plata
    // que apareció de más. Sumarlo acá haría ver un traslado incompleto como completo.
    const asentado = pasos
        .filter(p => p.tipoTransaccion === 'Ingreso' || p.tipoTransaccion === 'Controversia')
        .reduce((s, p) => s + (parseFloat(p.valorTransaccion) || 0), 0);

    const excedente = Math.round(parseFloat(traslado.valorExcedente) || 0);

    doc.font('Helvetica').fontSize(6.5).text('VALOR DESPACHADO', MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.1);
    doc.font('Helvetica-Bold').fontSize(16).text(pesos(traslado.valorTraslado), MARGIN, doc.y, { width: CW, align: 'center' });
    doc.moveDown(0.4);

    // Llegó de más. Va con el mismo peso visual que el faltante: es la otra cara del
    // mismo hecho —lo contado no fue lo despachado— y quien recibe este papel necesita
    // ver el número sin buscarlo en la bitácora.
    if (excedente > 0) {
        doc.font('Helvetica').fontSize(6.5).text('EXCEDENTE RECIBIDO', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.1);
        doc.font('Helvetica-Bold').fontSize(12).text(pesos(excedente), MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.15);
        doc.font('Helvetica-Bold').fontSize(7)
           .text(`TOTAL CONTADO: ${pesos((parseFloat(traslado.valorTraslado) || 0) + excedente)}`,
                 MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(6)
           .text('Se asento en un movimiento aparte de la cuenta destino. Salio de la caja menor del punto de venta, que queda corta por ese monto.',
                 MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.4);
    }

    if (traslado.estado === 'Controversia' || traslado.estado === 'Rechazado') {
        const diferencia = (parseFloat(traslado.valorTraslado) || 0) - asentado;
        doc.font('Helvetica').fontSize(6.5).text('VALOR ACEPTADO', MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.1);
        doc.font('Helvetica-Bold').fontSize(12).text(pesos(asentado), MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.15);
        doc.font('Helvetica-Bold').fontSize(7)
           .text(`DIFERENCIA: ${pesos(diferencia)}`, MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(6)
           .text('Ese efectivo NO entró a la cuenta destino y permanece en el punto de venta.',
                 MARGIN, doc.y, { width: CW, align: 'center' });
        doc.moveDown(0.4);
    }

    hr();

    // Recorrido del traslado.
    doc.font('Helvetica-Bold').fontSize(6.5).text('MOVIMIENTOS', MARGIN, doc.y, { width: CW });
    doc.moveDown(0.2);
    for (const p of pasos) {
        const quien = p.empleado ? `${p.empleado.PrimerNombre} ${p.empleado.PrimerApellido}` : '—';
        doc.font('Helvetica-Bold').fontSize(6)
           .text(`${p.tipoTransaccion.toUpperCase()} · ${pesos(p.valorTransaccion)}`, MARGIN, doc.y, { width: CW });
        doc.font('Helvetica').fontSize(5.5)
           .text(`${fechaHora(p.createdAt)} · ${quien}`, MARGIN, doc.y, { width: CW });
        if (p.observacion) {
            doc.font('Helvetica').fontSize(5.5).text(p.observacion, MARGIN, doc.y, { width: CW });
        }
        doc.moveDown(0.3);
    }

    hr();

    firma('ENTREGA', envia);
    firma('RECIBE', traslado.empleadoRecibe
        ? `${traslado.empleadoRecibe.PrimerNombre} ${traslado.empleadoRecibe.PrimerApellido}`
        : 'Nombre y cédula');

    doc.moveDown(1);
    const footerCD = process.env.FOOTER_CODEDREAM || '';
    if (footerCD) doc.font('Helvetica').fontSize(6).text(footerCD, MARGIN, doc.y, { width: CW, align: 'center' });

    doc.end();
    await fin;
    return Buffer.concat(chunks);
};

export default generarPDFTraslado;
