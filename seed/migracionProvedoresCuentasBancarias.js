import dotenv from 'dotenv';
import db from '../config/bd.js';
import { ProvedoresCuentasBancarias } from '../models/index.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// Crea PROVEDORES_CUENTAS_BANCARIAS: las cuentas a las que se le paga a cada proveedor.
//
//   npm run db:migrar-provedores-cuentas
//   npm run db:migrar-provedores-cuentas -- --revertir   (solo si la tabla está vacía)

const TABLA = 'PROVEDORES_CUENTAS_BANCARIAS';
const REVERTIR = process.argv.includes('--revertir');

const existeTabla = async () => {
    const [r] = await db.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
        { replacements: { t: TABLA }, type: QueryTypes.SELECT });
    return r.n > 0;
};

const run = async () => {
    await db.authenticate();

    if (REVERTIR) {
        if (await existeTabla()) {
            const [{ n }] = await db.query(`SELECT COUNT(*) n FROM ${TABLA}`, { type: QueryTypes.SELECT });
            if (n > 0) { console.error(`✗ ABORTADO: ${TABLA} tiene ${n} cuenta(s).`); process.exit(1); }
            await db.query(`DROP TABLE ${TABLA}`);
            console.log(`✓ ${TABLA} eliminada`);
        }
        process.exit(0);
    }

    if (await existeTabla()) {
        // Bre-B, agregado después de crear la tabla: llave como tipo de cuenta, su tipo y un
        // número más largo (una llave puede ser un correo). Cada paso solo si falta.
        const col = async (c) => (await db.query(`SHOW COLUMNS FROM ${TABLA} LIKE :c`, { replacements: { c }, type: QueryTypes.SELECT }))[0];
        if (!String((await col('tipoCuenta')).Type).includes('llave_breb')) {
            await db.query(`ALTER TABLE ${TABLA} MODIFY tipoCuenta ENUM('ahorros','corriente','deposito_electronico','llave_breb') NOT NULL`);
            console.log('✓ tipoCuenta admite llave_breb');
        }
        if (!(await col('tipoLlaveBreb'))) {
            await db.query(`ALTER TABLE ${TABLA} ADD COLUMN tipoLlaveBreb ENUM('celular','documento','correo','alfanumerica','comercio') NULL AFTER tipoCuenta`);
            console.log('✓ tipoLlaveBreb agregada');
        }
        if (String((await col('numeroCuenta')).Type) !== 'varchar(100)') {
            await db.query(`ALTER TABLE ${TABLA} MODIFY numeroCuenta VARCHAR(100) NOT NULL`);
            console.log('✓ numeroCuenta ampliada a 100');
        }
        // Verificación: las cuentas del registro web llegan sin verificar. Las que ya
        // existían las cargó el panel, así que quedan verificadas (sin usuario: no se sabe
        // quién fue).
        if (!(await col('verificada'))) {
            await db.query(`ALTER TABLE ${TABLA}
                ADD COLUMN origen ENUM('panel','web') NOT NULL DEFAULT 'panel' AFTER principal,
                ADD COLUMN verificada TINYINT(1) NOT NULL DEFAULT 0 AFTER origen,
                ADD COLUMN idUsuarioVerifico CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER verificada,
                ADD COLUMN fechaVerificacion DATETIME NULL AFTER idUsuarioVerifico`);
            const [, meta] = await db.query(`UPDATE ${TABLA} SET verificada = 1, fechaVerificacion = createdAt`);
            console.log(`✓ origen/verificada agregadas · ${meta?.affectedRows ?? 0} cuenta(s) existentes quedan verificadas`);
        }
        console.log(`· ${TABLA} ya existía`);
    } else {
        await ProvedoresCuentasBancarias.sync();
        console.log(`✓ ${TABLA} creada`);
    }
    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    cols.forEach(c => console.log(`   ${c.Field.padEnd(26)}${String(c.Type).padEnd(56)}null:${c.Null}`));
    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
