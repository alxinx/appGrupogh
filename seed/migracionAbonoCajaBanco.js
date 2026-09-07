import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// ABONO_CLIENTE_CREDITOS guardaba con qué método pagó el cliente ('Efectivo', 'Banco'…)
// pero no A QUÉ CUENTA entró la plata, y `aplicarAbonoFIFO` no escribía nada en
// MOVIMIENTOS_CAJAS_BANCOS. El abono quedaba registrado como cobrado y el saldo de las
// cajas y bancos nunca lo veía.
//
// Esta columna cierra el circuito: cada abono apunta a la caja/banco/billetera que
// recibió el dinero, y el abono genera su movimiento de ingreso en el libro de esa cuenta.
//
// NULL permitido a propósito: los abonos anteriores a este cambio no tienen cuenta y no
// se les puede inventar una — no hay forma de saber a qué caja entró esa plata. Se
// distinguen justamente por tener la columna vacía.
//
//   node ./seed/migracionAbonoCajaBanco.js

const TABLA = 'ABONO_CLIENTE_CREDITOS';

const run = async () => {
    await db.authenticate();

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });

    if (cols.some(c => c.Field === 'idCajaBanco')) {
        console.log(`· ${TABLA}.idCajaBanco ya existe, se omite`);
    } else {
        // utf8mb4_bin explícito: es la collation de CAJAS_Y_BANCOS.idCajaBanco (y de los
        // demás UUID del proyecto). Sin eso MySQL rechaza la FK con ER_FK_INCOMPATIBLE_COLUMNS,
        // porque la columna nueva heredaría la collation por defecto de la tabla.
        await db.query(`
            ALTER TABLE ${TABLA}
            ADD COLUMN idCajaBanco CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER idEntidad,
            ADD CONSTRAINT acc_fk_caja_banco FOREIGN KEY (idCajaBanco)
                REFERENCES CAJAS_Y_BANCOS(idCajaBanco)
                ON UPDATE CASCADE ON DELETE RESTRICT
        `);
        console.log(`✓ ${TABLA}: columna idCajaBanco agregada con FK a CAJAS_Y_BANCOS`);
    }

    // El abono también deja su rastro en el libro de la cuenta. Esa fila se busca por
    // MOVIMIENTOS_CAJAS_BANCOS.referencia (el nº de factura), pero para reconciliar en
    // sentido inverso conviene el índice por cuenta que ya existe — no hace falta uno nuevo.
    const sinCuenta = await db.query(
        `SELECT COUNT(*) AS n FROM ${TABLA} WHERE idCajaBanco IS NULL`,
        { type: QueryTypes.SELECT }
    );
    console.log(`\n· Abonos históricos sin cuenta asociada: ${sinCuenta[0].n} (quedan en NULL a propósito)`);

    const colsFinal = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    colsFinal.forEach(c => console.log(`   ${c.Field.padEnd(24)}${String(c.Type).padEnd(58)}null:${c.Null}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
