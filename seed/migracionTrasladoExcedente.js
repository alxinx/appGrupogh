import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Excedente en un traslado de efectivo: cuando a destino llega MÁS de lo que el punto de
// venta despachó.
//
// Pasa de verdad y por un motivo mundano: dos billetes pegados en el fajo que el operador
// armó. Hasta ahora el sistema lo bloqueaba —el administrador veía "llegaron $50.000 de
// más" y no podía confirmar—, así que la plata quedaba en la cuenta y el traslado en
// tránsito para siempre.
//
// La decisión de diseño: el traslado NO se toca. Sigue valiendo lo que el punto de venta
// registró, y el sobrante entra como un movimiento aparte en la misma cuenta, con una
// observación que lo liga a ese traslado. Así la conciliación contra el extracto sigue
// siendo directa y el sobrante no queda escondido dentro de otra cifra.
//
// Esta migración agrega:
//   1. TRASLADO_EFECTIVO.valorExcedente        — cuánto llegó de más
//   2. TRASLADO_EFECTIVO.idMovimientoExcedente — el movimiento aparte que lo asentó
//   3. 'Excedente' al ENUM de TRASLADO_EFECTIVO_HISTORIAL.tipoTransaccion
//
// Es aditiva: ninguna fila existente cambia de valor. Los traslados anteriores quedan con
// `valorExcedente` en NULL, que es exactamente lo que fueron — traslados sin excedente.
//
//   node ./seed/migracionTrasladoExcedente.js            (muestra qué haría)
//   node ./seed/migracionTrasladoExcedente.js --aplicar
//   node ./seed/migracionTrasladoExcedente.js --revertir
//
// Idempotente.

const TABLA = 'TRASLADO_EFECTIVO';
const HIST  = 'TRASLADO_EFECTIVO_HISTORIAL';
const APLICAR  = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');

// La collation se declara igual que la de la columna referenciada o MySQL rechaza la FK:
// Sequelize crea los UUID con utf8mb4_bin.
const TIPO_UUID = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';
const FK_EXCEDENTE = 'fk_traslado_mov_excedente';

const ENUM_VIEJO = "ENUM('Ingreso','Salida','Controversia','Rechazado')";
const ENUM_NUEVO = "ENUM('Ingreso','Salida','Controversia','Rechazado','Excedente')";

const columnas = (tabla) => db.getQueryInterface().describeTable(tabla);

const tieneFK = async (nombre) => {
    const [f] = await db.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND CONSTRAINT_NAME = :n`,
        { replacements: { t: TABLA, n: nombre }, type: QueryTypes.SELECT }
    );
    return !!f;
};

const run = async () => {
    await db.authenticate();

    const cols = await columnas(TABLA);
    const colsHist = await columnas(HIST);
    const enumActual = colsHist.tipoTransaccion?.type || '';
    const yaTieneExcedente = /Excedente/i.test(enumActual);

    if (REVERTIR) {
        // Revertir con datos adentro borraría el rastro de sobrantes ya asentados. Los
        // movimientos seguirían en la cuenta, pero nadie podría saber de qué traslado
        // salieron: justamente lo que estas columnas existen para no perder.
        const [{ n }] = await db.query(
            `SELECT COUNT(*) n FROM \`${TABLA}\` WHERE valorExcedente IS NOT NULL`,
            { type: QueryTypes.SELECT }
        ).catch(() => [{ n: 0 }]);

        if (n > 0) {
            console.error(`✗ ABORTADO: ${n} traslado(s) ya tienen excedente registrado.`);
            console.error('  Revertir dejaría esos movimientos en la cuenta sin forma de saber de qué traslado salieron.');
            process.exit(1);
        }
        if (await tieneFK(FK_EXCEDENTE))
            await db.query(`ALTER TABLE \`${TABLA}\` DROP FOREIGN KEY ${FK_EXCEDENTE}`);
        if (cols.idMovimientoExcedente)
            await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN idMovimientoExcedente`);
        if (cols.valorExcedente)
            await db.query(`ALTER TABLE \`${TABLA}\` DROP COLUMN valorExcedente`);
        if (yaTieneExcedente)
            await db.query(`ALTER TABLE \`${HIST}\` MODIFY tipoTransaccion ${ENUM_VIEJO} NOT NULL`);
        console.log('✓ Revertido.');
        process.exit(0);
    }

    const pasos = [];
    if (!cols.valorExcedente)         pasos.push('TRASLADO_EFECTIVO.valorExcedente DECIMAL(15,2) NULL');
    if (!cols.idMovimientoExcedente)  pasos.push('TRASLADO_EFECTIVO.idMovimientoExcedente + FK a MOVIMIENTOS_CAJAS_BANCOS');
    if (!yaTieneExcedente)            pasos.push(`${HIST}.tipoTransaccion += 'Excedente'`);

    if (!pasos.length) {
        console.log('· Todo aplicado, nada que hacer.');
        process.exit(0);
    }

    console.log('Por aplicar:');
    pasos.forEach(p => console.log(`   + ${p}`));

    if (!APLICAR) {
        console.log('\n(simulación) Para aplicarlo:');
        console.log('   node ./seed/migracionTrasladoExcedente.js --aplicar');
        process.exit(0);
    }

    if (!cols.valorExcedente) {
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD COLUMN valorExcedente DECIMAL(15,2) NULL AFTER valorTraslado`
        );
        console.log('✓ valorExcedente agregada');
    }

    if (!cols.idMovimientoExcedente) {
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD COLUMN idMovimientoExcedente ${TIPO_UUID} NULL AFTER idMovimiento`
        );
        console.log('✓ idMovimientoExcedente agregada');
    }

    if (!await tieneFK(FK_EXCEDENTE)) {
        // RESTRICT y no CASCADE: si alguien intenta borrar el movimiento del sobrante,
        // que falle. Borrarlo en cascada dejaría el traslado diciendo que hubo un
        // excedente sin nada que lo respalde.
        await db.query(
            `ALTER TABLE \`${TABLA}\` ADD CONSTRAINT ${FK_EXCEDENTE}
             FOREIGN KEY (idMovimientoExcedente) REFERENCES MOVIMIENTOS_CAJAS_BANCOS(idMovimiento)
             ON DELETE RESTRICT ON UPDATE CASCADE`
        );
        console.log('✓ FK del movimiento del excedente');
    }

    if (!yaTieneExcedente) {
        // Agregar un valor al final de un ENUM no reescribe las filas: MySQL guarda el
        // índice del valor, y los cuatro anteriores conservan el suyo.
        await db.query(`ALTER TABLE \`${HIST}\` MODIFY tipoTransaccion ${ENUM_NUEVO} NOT NULL`);
        console.log("✓ 'Excedente' agregado al ENUM de la bitácora");
    }

    const [resumen] = await db.query(
        `SELECT COUNT(*) total, SUM(valorExcedente IS NOT NULL) conExcedente FROM \`${TABLA}\``,
        { type: QueryTypes.SELECT }
    );
    console.log(`\nTraslados: ${resumen.total} · con excedente: ${resumen.conExcedente || 0}`);
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
