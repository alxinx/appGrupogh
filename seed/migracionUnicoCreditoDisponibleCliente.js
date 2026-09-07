import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Un cliente puede tener varias filas tipo 'Saldo a Favor' en CREDITO_DISPONIBLE_CLIENTE,
// pero nunca más de una 'Credito' — esa fila es el cupo del cliente, no una transacción
// repetible (ver comentario en controller/adminControllers.js `asignarCreditoDisponibleCliente`,
// que ya rechaza la segunda con un 409). Pero ese chequeo es "leer y luego crear": dos
// peticiones casi simultáneas (doble clic, dos pestañas) pueden las dos pasar el `findOne`
// antes de que cualquiera cree su fila, y quedar dos 'Credito' para el mismo cliente —
// pasó de verdad en dev con Cesar Porras, detectado en una simulación de abonos.
//
// MySQL no tiene índices únicos parciales (a diferencia de Postgres), así que se logra con
// una columna generada que vale idCliente solo cuando tipo='Credito' y NULL en cualquier
// otro caso — un índice único sobre esa columna deja como máximo una fila 'Credito' por
// cliente (los NULL de 'Saldo a Favor' no chocan entre sí, MySQL los trata como distintos).
// La columna es GENERATED ALWAYS: MySQL la calcula sola en cada INSERT/UPDATE, la app nunca
// la toca ni necesita declararla en el modelo Sequelize.
//
// VIRTUAL y no STORED: esta tabla tiene una FK en idCliente (→ CLIENTES), y MySQL rechaza
// ("Cannot add foreign key constraint") agregar una columna generada STORED ahí — problema
// conocido de InnoDB con columnas STORED que referencian una columna con FK en la misma
// ALTER. VIRTUAL sí es soportado para índices (desde MySQL 5.7.8) y no tiene ese conflicto.
//
//   node ./seed/migracionUnicoCreditoDisponibleCliente.js

const TABLA = 'CREDITO_DISPONIBLE_CLIENTE';

const run = async () => {
    await db.authenticate();

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    if (cols.some(c => c.Field === 'idClienteCredito')) {
        console.log(`· ${TABLA}.idClienteCredito ya existe, se omite`);
        process.exit(0);
    }

    // Salvavidas: si ya hubiera un duplicado sin corregir, el ALTER fallaría solo (el
    // índice único lo rechaza) — pero es mejor avisar con un mensaje claro que con el error
    // crudo de MySQL.
    const [dup] = await db.query(`
        SELECT idCliente, COUNT(*) n FROM ${TABLA} WHERE tipo = 'Credito'
        GROUP BY idCliente HAVING n > 1
    `, { type: QueryTypes.SELECT });
    if (dup) {
        console.error(`✗ ABORTADO: idCliente ${dup.idCliente} tiene ${dup.n} filas tipo 'Credito'. Corregilas antes de correr esta migración.`);
        process.exit(1);
    }

    await db.query(`
        ALTER TABLE ${TABLA}
        ADD COLUMN idClienteCredito CHAR(36)
            GENERATED ALWAYS AS (CASE WHEN tipo = 'Credito' THEN idCliente ELSE NULL END) VIRTUAL
    `);
    await db.query(`
        ALTER TABLE ${TABLA}
        ADD UNIQUE INDEX cdc_uniq_credito_cliente (idClienteCredito)
    `);
    console.log(`✓ ${TABLA}: agregada columna generada idClienteCredito + índice único (máximo un 'Credito' por cliente)`);

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
