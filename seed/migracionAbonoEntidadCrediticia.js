import dotenv from 'dotenv';
import db from '../config/bd.js';
import { QueryTypes } from 'sequelize';

dotenv.config();

// ABONO_CLIENTE_CREDITOS ya existía sin 'Entidad Crediticia' en metodoPago ni columna
// idEntidad (el abono a crédito no admitía financiación de terceros). Ahora sí: el
// cliente puede cancelar su deuda financiándose con un tercero (Addi, Sistecrédito) que le
// paga a la tienda directamente — mismo criterio que DETALLES_PAGOS_FACTURA.
//
//   node ./seed/migracionAbonoEntidadCrediticia.js

const TABLA = 'ABONO_CLIENTE_CREDITOS';

const run = async () => {
    await db.authenticate();

    const cols = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    const yaTiene = cols.some(c => c.Field === 'idEntidad');

    if (yaTiene) {
        console.log(`· ${TABLA}.idEntidad ya existe, se omite`);
    } else {
        await db.query(`
            ALTER TABLE ${TABLA}
            MODIFY COLUMN metodoPago ENUM('Banco','Billetera Virtual','Entidad Crediticia','Tarjeta Credito','Efectivo') NOT NULL,
            ADD COLUMN idEntidad INT NULL AFTER metodoPago,
            ADD CONSTRAINT acc_fk_entidad FOREIGN KEY (idEntidad) REFERENCES ENTIDADES(idEntidad)
        `);
        console.log(`✓ ${TABLA}: metodoPago ampliado con 'Entidad Crediticia' + columna idEntidad agregada`);
    }

    const colsFinal = await db.query(`SHOW COLUMNS FROM ${TABLA}`, { type: QueryTypes.SELECT });
    console.log('\nEstructura:');
    colsFinal.forEach(c => console.log(`   ${c.Field.padEnd(18)}${String(c.Type).padEnd(60)}null:${c.Null}`));

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
