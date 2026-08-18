import dotenv from 'dotenv';
import db from '../config/bd.js';
import { MovimientosCajasBancos } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea MOVIMIENTOS_CAJAS_BANCOS y la sella como append-only.
//
// Los hooks del modelo solo protegen lo que pasa por Sequelize. Estos triggers protegen
// la tabla frente a CUALQUIER cliente: consola de MySQL, un cliente gráfico, otro
// servicio, un script de mantenimiento. Sin ellos, "no se puede editar" es una promesa
// de la aplicación, no una propiedad de los datos.
//
// SIGNAL SQLSTATE '45000' aborta la sentencia con un error de usuario, así que el UPDATE
// o el DELETE fallan enteros y la transacción se revierte.
//
//   node ./seed/migracionMovimientosCaja.js
//   node ./seed/migracionMovimientosCaja.js --revertir
//
// Idempotente.

const TABLA = 'MOVIMIENTOS_CAJAS_BANCOS';
const CHECK_VALOR = 'chk_movimientos_valor_positivo';
const TRIGGERS = [`${TABLA}_sin_update`, `${TABLA}_sin_delete`];
const REVERTIR = process.argv.includes('--revertir');

const MENSAJE = 'MOVIMIENTOS_CAJAS_BANCOS es append-only: un movimiento no se edita ni se elimina.';

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT }
    );
    return r.n > 0;
};

const triggersExistentes = async () => {
    const filas = await db.query(
        `SELECT TRIGGER_NAME t FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT }
    );
    return filas.map(f => f.t);
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        for (const tg of await triggersExistentes()) {
            await db.query(`DROP TRIGGER IF EXISTS \`${tg}\``);
            console.log(`✓ trigger ${tg} eliminado`);
        }
        if (await existeTabla()) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
            if (n > 0) {
                console.error(`✗ ABORTADO: ${TABLA} tiene ${n} movimiento(s). Es un libro contable; no se elimina con datos adentro.`);
                process.exit(1);
            }
            await db.query(`DROP TABLE ${TABLA}`);
            console.log(`✓ ${TABLA} eliminada`);
        }
        console.log('\nReversión completada.');
        process.exit(0);
    }

    if (await existeTabla()) {
        console.log(`· ${TABLA} ya existe, se omite`);
    } else {
        await MovimientosCajasBancos.sync();
        console.log(`✓ ${TABLA} creada`);
    }

    const yaHay = await triggersExistentes();

    if (yaHay.includes(TRIGGERS[0])) {
        console.log(`· trigger ${TRIGGERS[0]} ya existe, se omite`);
    } else {
        await db.query(`
            CREATE TRIGGER \`${TRIGGERS[0]}\`
            BEFORE UPDATE ON \`${TABLA}\`
            FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MENSAJE}'
        `);
        console.log(`✓ trigger ${TRIGGERS[0]} creado (bloquea UPDATE)`);
    }

    if (yaHay.includes(TRIGGERS[1])) {
        console.log(`· trigger ${TRIGGERS[1]} ya existe, se omite`);
    } else {
        await db.query(`
            CREATE TRIGGER \`${TRIGGERS[1]}\`
            BEFORE DELETE ON \`${TABLA}\`
            FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MENSAJE}'
        `);
        console.log(`✓ trigger ${TRIGGERS[1]} creado (bloquea DELETE)`);
    }

    // El valor nunca puede ser negativo ni cero: el signo lo da `tipo`, y un "egreso de
    // -5000" sería un ingreso disfrazado que rompería cualquier suma agrupada. El
    // validador de Sequelize ya lo frena, pero igual que con los triggers, la garantía
    // real tiene que estar en la base: un INSERT desde la consola no pasa por Node.
    const [{ hayCheck }] = await db.query(
        `SELECT COUNT(*) hayCheck FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :c`,
        { replacements: { t: TABLA, c: CHECK_VALOR }, type: QueryTypes.SELECT }
    );
    if (hayCheck) {
        console.log(`· CHECK ${CHECK_VALOR} ya existe, se omite`);
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD CONSTRAINT \`${CHECK_VALOR}\` CHECK (valor > 0)`);
        console.log(`✓ CHECK ${CHECK_VALOR} creado (valor > 0)`);
    }

    // Columnas agregadas después de la creación inicial. `sync()` no las suma a una
    // tabla que ya existe, así que van con ALTER explícito. Los triggers append-only
    // no bloquean DDL, solo UPDATE y DELETE sobre las filas.
    const existentes = await db.getQueryInterface().describeTable(TABLA);

    if (existentes.referencia) {
        console.log('· referencia ya existe, se omite');
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN referencia VARCHAR(50) NULL AFTER valor`);
        console.log('✓ referencia agregada');
    }

    // `descripcion` se llamó `observacion` en la primera versión.
    if (existentes.descripcion) {
        console.log('· descripcion ya existe, se omite');
    } else if (existentes.observacion) {
        await db.query(`ALTER TABLE \`${TABLA}\` CHANGE COLUMN observacion descripcion TEXT NULL`);
        console.log('✓ observacion renombrada a descripcion');
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN descripcion TEXT NULL AFTER referencia`);
        console.log('✓ descripcion agregada');
    }

    // `fecha`: cuándo ocurrió el movimiento, contra `createdAt`, que es cuándo se asentó.
    // A las filas que ya existen se les copia el createdAt: es lo único que se sabe de
    // ellas y deja el libro consistente sin inventar nada.
    if (existentes.fecha) {
        console.log('· fecha ya existe, se omite');
    } else {
        await db.query(`ALTER TABLE \`${TABLA}\` ADD COLUMN fecha DATETIME NULL AFTER idEmpleado`);

        // El backfill es un UPDATE, y el trigger append-only aborta cualquier UPDATE sobre
        // esta tabla — incluido éste. Hay que bajarlo para llenar la columna y volver a
        // subirlo. El `finally` garantiza que la tabla no quede desprotegida si el backfill
        // falla: sin eso, un error acá dejaría el libro editable desde cualquier cliente.
        await db.query(`DROP TRIGGER IF EXISTS \`${TRIGGERS[0]}\``);
        try {
            const [res] = await db.query(`UPDATE \`${TABLA}\` SET fecha = createdAt WHERE fecha IS NULL`);
            console.log(`  · backfill desde createdAt: ${res?.affectedRows ?? 0} fila(s)`);
        } finally {
            await db.query(`
                CREATE TRIGGER \`${TRIGGERS[0]}\`
                BEFORE UPDATE ON \`${TABLA}\`
                FOR EACH ROW
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MENSAJE}'
            `);
        }

        // NOT NULL recién después del backfill: con filas adentro y la columna vacía, el
        // MODIFY fallaría en modo estricto. Es DDL, así que el trigger no lo estorba.
        await db.query(`ALTER TABLE \`${TABLA}\` MODIFY COLUMN fecha DATETIME NOT NULL`);
        console.log('✓ fecha agregada');
    }

    // Índice del orden del libro: (idCajaBanco, fecha, idMovimiento). El id va al final
    // porque es el desempate de la paginación por cursor cuando dos movimientos comparten
    // fecha; sin él la misma fila puede salir en dos páginas.
    const indices = await db.query(`SHOW INDEX FROM \`${TABLA}\``, { type: QueryTypes.SELECT });
    if (indices.some(i => i.Key_name === 'idx_movimientos_caja_orden')) {
        console.log('· idx_movimientos_caja_orden ya existe, se omite');
    } else {
        await db.query(`CREATE INDEX idx_movimientos_caja_orden ON \`${TABLA}\` (idCajaBanco, fecha, idMovimiento)`);
        console.log('✓ idx_movimientos_caja_orden creado');
    }

    // El índice viejo sobre createdAt se conserva con su nombre nuevo: sigue sirviendo
    // para auditar en qué momento se asentó cada cosa.
    if (indices.some(i => i.Key_name === 'idx_movimientos_caja_fecha')) {
        await db.query(`ALTER TABLE \`${TABLA}\` RENAME INDEX idx_movimientos_caja_fecha TO idx_movimientos_caja_asiento`);
        console.log('✓ idx_movimientos_caja_fecha renombrado a idx_movimientos_caja_asiento');
    }

    // DOCUMENTACION.pertenece necesita el origen de los adjuntos de un movimiento.
    const [docCol] = await db.query(
        `SELECT COLUMN_TYPE ct FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DOCUMENTACION' AND COLUMN_NAME = 'pertenece'`,
        { type: QueryTypes.SELECT }
    );
    if (docCol && !docCol.ct.includes('transacciones_bancarias')) {
        await db.query(
            `ALTER TABLE DOCUMENTACION MODIFY COLUMN pertenece
             ENUM('cliente','punto_venta','provedor','general','orden_compra','empleado','transacciones_bancarias')`
        );
        console.log("✓ DOCUMENTACION.pertenece acepta 'transacciones_bancarias'");
    } else {
        console.log('· DOCUMENTACION.pertenece ya lo acepta, se omite');
    }

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    cols.forEach(c => console.log(`   ${c.Field.padEnd(15)}${String(c.Type).padEnd(28)}null:${c.Null}  key:${c.Key || '-'}`));

    const idx = await db.query(`SHOW INDEX FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nÍndices:');
    [...new Set(idx.map(i => i.Key_name))].forEach(n =>
        console.log(`   ${n.padEnd(32)}(${idx.filter(i => i.Key_name === n).map(i => i.Column_name).join(', ')})`));

    const fks = await db.query(
        `SELECT CONSTRAINT_NAME k, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND REFERENCED_TABLE_NAME IS NOT NULL`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT }
    );
    console.log('\nClaves foráneas:');
    fks.forEach(f => console.log(`   ${f.c} → ${f.rt}.${f.rc}`));

    console.log('\nMigración completada. La tabla es append-only a nivel de base de datos.');
    process.exit(0);
};

run().catch((e) => {
    console.error('Migración fallida:', e);
    process.exit(1);
});
