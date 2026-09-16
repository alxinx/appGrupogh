import { randomUUID } from 'crypto';
import mysql from 'mysql2/promise';
import db from '../config/bd.js';
import { Traslados, DetalleTraslados, InsidenciaTraslado, Stock, Pack } from '../models/index.js';
import { migrarTrasladoDevuelto } from '../seed/migracionTrasladoDevuelto.js';

// Estos tests escriben, borran y recrean la base entera. El guard va antes de cualquier
// consulta: si DB_NAME no es una base *_test, no se toca nada.
const DESTINO = process.env.DB_NAME || '';
const ORIGEN  = process.env.DB_ESQUEMA_ORIGEN || 'grupogh';
if (!/_test$/.test(DESTINO) || DESTINO === ORIGEN) {
    throw new Error(`Los tests requieren DB_NAME terminado en _test (llegó "${DESTINO}"). Corré: npm test`);
}

// Esquema clonado de la base real y no generado con db.sync(): la base real no coincide con
// los modelos (TRASLADOS.estado sin DEVUELTO, INSIDENCIAS_TRASLADOS.idEmpleado NOT NULL), y
// probar contra los modelos escondería justamente lo que falla en producción.
export async function prepararBaseDePrueba() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASS || undefined
    });
    try {
        await conn.query(`DROP DATABASE IF EXISTS \`${DESTINO}\``);
        await conn.query(`CREATE DATABASE \`${DESTINO}\``);
        const [tablas] = await conn.query(
            "SELECT TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
            [ORIGEN]
        );
        if (!tablas.length) throw new Error(`La base de origen "${ORIGEN}" no tiene tablas para clonar.`);

        await conn.query(`USE \`${DESTINO}\``);
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const { nombre } of tablas) {
            const [[fila]] = await conn.query(`SHOW CREATE TABLE \`${ORIGEN}\`.\`${nombre}\``);
            await conn.query(fila['Create Table']);
        }
        await conn.query("INSERT INTO SECUENCIAS (nombre, valor) VALUES ('traslado', 5000)");
    } finally {
        await conn.end();
    }
    await migrarTrasladoDevuelto();
}

export const cerrarBase = () => db.close();

export const TIENDA_A = randomUUID();
export const TIENDA_B = randomUUID();
export const empleadoDe = (nombre) => ({ idEmpleado: randomUUID(), idUsuario: randomUUID(), nombre, codigoEmpleado: nombre.toUpperCase() });

let correlativo = 0;
const codigo = (prefijo) => `${prefijo}-${Date.now().toString(36)}-${++correlativo}`;

export const resSimulada = () => ({
    statusCode: 200,
    body: undefined,
    cookieBorrada: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    clearCookie() { this.cookieBorrada = true; return this; }
});

// Un usuario del panel con su ficha de empleado (o sin ella). Las llaves foráneas de EMPLEADOS
// piden un punto de venta real; en la transacción se apagan para no sembrar uno.
export async function crearEmpleadoConUsuario({ estado = 'activo', conEmpleado = true } = {}) {
    const idUsuario = randomUUID();
    const idEmpleado = randomUUID();
    const codigoEmpleado = String(10000 + Math.floor(Math.random() * 89999)) + (++correlativo);
    await db.transaction(async (t) => {
        await db.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: t });
        await db.query(
            "INSERT INTO USUARIOS (idUsuario, nombreUsuario, emailUsuario, password, permisos, createdAt, updatedAt) VALUES (:id, 'Prueba', :email, 'x', 'ADMIN', NOW(), NOW())",
            { replacements: { id: idUsuario, email: `${idUsuario}@prueba.test` }, transaction: t }
        );
        if (conEmpleado) {
            await db.query(
                `INSERT INTO EMPLEADOS (idEmpleado, idUsuario, idPuntoDeVenta, PrimerNombre, PrimerApellido, NumeroDocumento, emailEmpleado, fechaIngreso, codigoEmpleado, estado, createdAt, updatedAt)
                 VALUES (:idEmpleado, :idUsuario, :pdv, 'Empleado', 'Prueba', :doc, :email, CURDATE(), :codigo, :estado, NOW(), NOW())`,
                { replacements: { idEmpleado, idUsuario, pdv: TIENDA_A, doc: codigoEmpleado, email: `${idEmpleado}@prueba.test`, codigo: codigoEmpleado, estado }, transaction: t }
            );
        }
        await db.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: t });
    });
    return { idUsuario, idEmpleado: conEmpleado ? idEmpleado : null, codigoEmpleado: conEmpleado ? codigoEmpleado : null };
}

export const llamar = async (handler, req) => {
    const res = resSimulada();
    await handler(req, res);
    return res;
};

export async function crearTrasladoEnTransito({ idOrigen, idDestino, lineas, fechaEnvio = new Date() }) {
    const traslado = await Traslados.create({
        codigoTraslado: codigo('TR-TEST'), idOrigen, idDestino,
        idUsuarioDespacha: randomUUID(), estado: 'EN_TRANSITO', fechaEnvio
    });
    const detalles = [];
    for (const l of lineas) {
        detalles.push(await DetalleTraslados.create({ idTraslado: traslado.idTraslado, cantidad: 1, ...l }));
    }
    return { traslado, detalles };
}

export const crearStock = (datos) => Stock.create({ cantidadOriginal: datos.cantidadExistente, valorUnidad: 0, ...datos });

export const crearPack = (estado) => Pack.create({
    idDosificacion: randomUUID(), codigoEtiqueta: codigo('PK'), numLote: 1, tipo: 'ESTANDAR', estado
});

export const stockTotal = async (where) => Number(await Stock.sum('cantidadExistente', { where })) || 0;

export const insidenciasDe = (idTraslado) =>
    InsidenciaTraslado.findAll({ where: { idTraslado }, order: [['idInsidencia', 'ASC']], raw: true });

export const recargar = (idTraslado) => Traslados.findByPk(idTraslado, { raw: true });
