import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prepararBaseDePrueba, cerrarBase, llamar } from './bdPrueba.js';
import { Clientes, ClientesTributario, ClientesUbicacion, Municipios, Departamentos } from '../models/index.js';
import { procesarImportacionClientes, descargarPlantillaClientes } from '../controller/importacionesController.js';

// La importación de clientes carga los datos maestros con los que después se factura: un
// documento duplicado, un NIT que no es de quien dice, o un teléfono de otra persona se
// arrastran a cada venta. Lo que se fija acá son las reglas con las que se decidió leer el
// export de EFFI — no el formato del archivo, que puede cambiar, sino qué se hace con cada
// dato y, sobre todo, qué NO entra.

before(async () => {
    await prepararBaseDePrueba();
    // Dos municipios reales con su departamento: CLIENTES_UBICACION.idMunicipio es FK.
    await Departamentos.bulkCreate([
        { id: '05', nombre: 'Antioquia' },
        { id: '17', nombre: 'Caldas' }
    ]);
    await Municipios.bulkCreate([
        { id: '05001', departamento_id: '05', nombre: 'Medellín' },
        { id: '17174', departamento_id: '17', nombre: 'Chinchiná' }
    ]);
});
after(cerrarBase);

// Columnas de la hoja Clientes, por nombre, para que los casos se lean.
const C = {
    tipoDocumento: 1, numeroDoc: 2, dv: 3,
    n1: 4, n2: 5, a1: 6, a2: 7,
    tel1: 8, tel2: 9, celular: 10, email: 11,
    codDepartamento: 13, codCiudad: 15, direccion: 17,
    tipoPersona: 18, regimen: 19, ciiu: 21
};

/**
 * Arma el Excel partiendo de la plantilla que descarga el propio panel: así el test también
 * fija que la plantilla que se le entrega al operador es un archivo que el importador acepta.
 */
const excelCon = async (filas, nits = []) => {
    const plantilla = await llamar(descargarPlantillaClientes, {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(plantilla.body);

    const ws = wb.getWorksheet('Clientes');
    filas.forEach((celdas, i) => {
        const fila = ws.getRow(i + 2);
        Object.entries(celdas).forEach(([campo, valor]) => { fila.getCell(C[campo]).value = valor; });
    });

    const hojaNit = wb.getWorksheet('Verificación NIT');
    nits.forEach(({ nit, observacion }, i) => {
        const fila = hojaNit.getRow(i + 2);
        fila.getCell(2).value = nit;
        fila.getCell(6).value = observacion;
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
};

const importar = async (filas, nits) =>
    llamar(procesarImportacionClientes, { file: { buffer: await excelCon(filas, nits) } });

/** Las filas de la hoja NO IMPORTADOS del informe que devuelve el endpoint. */
const rechazos = async (res) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const filas = [];
    wb.getWorksheet('NO IMPORTADOS').eachRow((r, n) => {
        if (n > 1) filas.push({ fila: r.getCell(1).value, documento: String(r.getCell(2).value), motivo: String(r.getCell(4).value) });
    });
    return filas;
};

const natural = (numeroDoc, extra = {}) => ({
    tipoDocumento: 'CC', numeroDoc, tipoPersona: 'N', n1: 'Ana', a1: 'Ruiz', ...extra
});

test('un NIT con observación en la hoja de verificación no entra, y el que no la tiene sí', async () => {
    const res = await importar([
        { tipoDocumento: 'NIT', numeroDoc: '901777177', dv: '8', tipoPersona: 'J', n1: 'Latin Ww S.A.S' },
        { tipoDocumento: 'NIT', numeroDoc: '900123456', dv: '1', tipoPersona: 'N', n1: 'Kira Omes' }
    ], [
        { nit: '901777177', observacion: 'Nombre en EFFI distinto al titular del RUT' },
        { nit: '900123456', observacion: '' }
    ]);

    assert.equal(res.headers['X-Importacion-Creados'], '1');
    assert.equal(res.headers['X-Importacion-Malos'], '1');

    const fuera = await rechazos(res);
    assert.equal(fuera.length, 1);
    assert.equal(fuera[0].documento, '901777177');
    assert.match(fuera[0].motivo, /observación/i);
    assert.equal(await Clientes.count({ where: { numero_doc: '901777177' } }), 0);

    // El que pasó: la razón social completa va en razon_social, no partida en nombres, y el
    // dígito de verificación queda guardado.
    const creado = await Clientes.findOne({ where: { numero_doc: '900123456' }, raw: true });
    assert.equal(creado.razon_social, 'Kira Omes');
    assert.equal(creado.primer_nombre, null);
    assert.equal(creado.digito_verif, '1');
});

test('el tipo de persona es el de la columna: una persona natural puede tener NIT', async () => {
    await importar([{ tipoDocumento: 'NIT', numeroDoc: '55247122', dv: '1', tipoPersona: 'N', n1: 'Katherine Cariz' }]);

    const cliente = await Clientes.findOne({ where: { numero_doc: '55247122' }, raw: true });
    assert.equal(cliente.tipo_persona, 'N', 'el NIT no debe convertir al cliente en jurídico');
    assert.equal(cliente.tipoDocumento, 'NIT');
});

test('un documento que ya existe no se carga, y uno repetido en el Excel se carga una sola vez', async () => {
    await Clientes.create({ tipo_persona: 'N', tipoDocumento: 'CC', numero_doc: '6120724', primer_nombre: 'Previo' });

    const res = await importar([
        natural('6120724', { n1: 'Otra' }),
        natural('1118291715', { n1: 'Primera' }),
        natural('1118291715', { n1: 'Segunda' })
    ]);

    assert.equal(res.headers['X-Importacion-Creados'], '1');
    const fuera = await rechazos(res);
    assert.equal(fuera.length, 2);
    assert.match(fuera.find((f) => f.documento === '6120724').motivo, /ya existe/i);
    assert.match(fuera.find((f) => f.documento === '1118291715').motivo, /repetido/i);

    // Se quedó la primera aparición, no la última.
    assert.equal((await Clientes.findOne({ where: { numero_doc: '1118291715' }, raw: true })).primer_nombre, 'Primera');
    // Y el cliente que ya estaba no se tocó.
    assert.equal((await Clientes.findOne({ where: { numero_doc: '6120724' }, raw: true })).primer_nombre, 'Previo');
});

test('el teléfono sale de la columna Celular; los fijos del export se ignoran', async () => {
    await importar([natural('1002003001', { tel1: '6041234567', tel2: '6049998888', celular: '3001234567' })]);

    assert.equal((await Clientes.findOne({ where: { numero_doc: '1002003001' }, raw: true })).telefono, '3001234567');
});

test('el régimen se mapea literal: "Régimen común" es responsable de IVA, vacío no lo es', async () => {
    await importar([
        natural('1002003002', { regimen: 'Régimen común' }),
        natural('1002003003', { regimen: '' })
    ]);

    const regimenDe = async (doc) => {
        const cliente = await Clientes.findOne({ where: { numero_doc: doc }, raw: true });
        const fila = await ClientesTributario.findOne({ where: { idCliente: cliente.idCliente }, raw: true });
        return fila.regimen_fiscal;
    };
    assert.equal(await regimenDe('1002003002'), '48');
    assert.equal(await regimenDe('1002003003'), '49');
});

test('el correo de la casa y el compartido por varios clientes quedan en blanco; el propio se conserva', async () => {
    const res = await importar([
        natural('1002003010', { email: 'graficogh@gmail.com' }),
        natural('1002003011', { email: 'compartido@gmail.com' }),
        natural('1002003012', { email: 'compartido@gmail.com' }),
        natural('1002003013', { email: 'compartido@gmail.com' }),
        natural('1002003014', { email: 'propio@gmail.com' })
    ]);

    assert.equal(res.headers['X-Importacion-Creados'], '5', 'un correo descartado no rechaza la fila');
    assert.equal(res.headers['X-Importacion-Correos-Descartados'], '4');

    const emailDe = async (doc) => (await Clientes.findOne({ where: { numero_doc: doc }, raw: true })).email;
    assert.equal(await emailDe('1002003010'), null, 'el correo de Grupo GH no es del cliente');
    assert.equal(await emailDe('1002003011'), null, 'un correo en tres fichas no identifica a nadie');
    assert.equal(await emailDe('1002003014'), 'propio@gmail.com');
});

test('la dirección entra tal como viene, sin reparar los caracteres dañados del export', async () => {
    const sucia = '*Colombia / Bol?r / Cartagena / Se 1 Mz 5';
    await importar([natural('1002003020', { codDepartamento: '05', codCiudad: '05001', direccion: sucia })]);

    const cliente = await Clientes.findOne({ where: { numero_doc: '1002003020' }, raw: true });
    const ubicacion = await ClientesUbicacion.findOne({ where: { idCliente: cliente.idCliente }, raw: true });
    assert.equal(ubicacion.direccion, sucia);
    // El nombre del municipio es el de MUNICIPIOS, no el que traía el Excel.
    assert.equal(ubicacion.nombreMunicipio, 'Medellín');
    assert.equal(ubicacion.nombreDepartamento, 'Antioquia');
    assert.ok(ubicacion.es_principal, 'la ubicación importada es la principal');
});

test('un municipio que no está en la base no rechaza al cliente: se guarda lo que sí resolvió', async () => {
    const res = await importar([natural('1002003030', { codDepartamento: '05', codCiudad: '05999', direccion: 'Calle 1' })]);

    assert.equal(res.headers['X-Importacion-Creados'], '1');
    assert.equal(res.headers['X-Importacion-Ubicacion-Incompleta'], '1');

    // El departamento y la dirección sí entran; el municipio queda nulo, no inventado.
    const cliente = await Clientes.findOne({ where: { numero_doc: '1002003030' }, raw: true });
    const ubicacion = await ClientesUbicacion.findOne({ where: { idCliente: cliente.idCliente }, raw: true });
    assert.equal(ubicacion.idMunicipio, null);
    assert.equal(ubicacion.nombreMunicipio, null);
    assert.equal(ubicacion.idDepartamento, '05');
    assert.equal(ubicacion.direccion, 'Calle 1');
});

test('una fila sin documento, sin nombre o con un tipo desconocido no entra y dice por qué', async () => {
    const res = await importar([
        { tipoDocumento: 'CC', numeroDoc: '', tipoPersona: 'N', n1: 'Sin Documento' },
        { tipoDocumento: 'CC', numeroDoc: '1002003040', tipoPersona: 'N', n1: '' },
        { tipoDocumento: 'XX', numeroDoc: '1002003041', tipoPersona: 'N', n1: 'Tipo Raro' },
        { tipoDocumento: 'CC', numeroDoc: '1002003042', tipoPersona: 'X', n1: 'Persona Rara' },
        { tipoDocumento: 'CC', numeroDoc: 'AB-123', tipoPersona: 'N', n1: 'Documento Con Letras' }
    ]);

    assert.equal(res.headers['X-Importacion-Creados'], '0');
    const fuera = await rechazos(res);
    assert.equal(fuera.length, 5);
    // La fila sin documento tiene nombre, así que no es una fila vacía: se rechaza con su motivo.
    assert.match(fuera.find((f) => f.documento === '').motivo, /falta el número/i);
    assert.match(fuera.find((f) => f.documento === '1002003040').motivo, /nombre|razón social/i);
    assert.match(fuera.find((f) => f.documento === '1002003041').motivo, /tipo de identificación/i);
    assert.match(fuera.find((f) => f.documento === '1002003042').motivo, /tipo de persona/i);
    assert.match(fuera.find((f) => f.documento === 'AB-123').motivo, /no es numérico/i);
});

test('un Excel con el encabezado cambiado se rechaza entero, sin crear ningún cliente', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clientes');
    ws.getRow(1).values = ['Documento', 'Nombre', 'Otra cosa'];
    ws.getRow(2).values = ['CC', '1002003050', 'x'];

    const antes = await Clientes.count();
    const res = await llamar(procesarImportacionClientes, { file: { buffer: Buffer.from(await wb.xlsx.writeBuffer()) } });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.mensaje, /encabezado/i);
    assert.equal(await Clientes.count(), antes);
});

test('cada cliente son sus tres tablas: si la fila entra, entran las tres', async () => {
    await importar([natural('1002003060', { codDepartamento: '17', codCiudad: '17174', direccion: 'Calle 11 No 9A-06', ciiu: 'Comercio al por menor de prendas' })]);

    const cliente = await Clientes.findOne({ where: { numero_doc: '1002003060' }, raw: true });
    assert.ok(cliente);
    const tributario = await ClientesTributario.findOne({ where: { idCliente: cliente.idCliente }, raw: true });
    assert.ok(tributario);
    // La columna del Excel es la DESCRIPCIÓN de la actividad, no el código DIAN.
    assert.equal(tributario.ciiu, null);
    assert.equal(tributario.descripcion_ciiu, 'Comercio al por menor de prendas');
    assert.ok(await ClientesUbicacion.findOne({ where: { idCliente: cliente.idCliente } }));
});
