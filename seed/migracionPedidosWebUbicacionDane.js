import dotenv from 'dotenv';
import db from '../config/bd.js';

dotenv.config();

// Agrega idDepartamento/idMunicipio a PEDIDOS_WEB. Hasta ahora ciudad/departamento del
// checkout eran texto libre que tipeaba el comprador (ver el comentario que tenía
// resolverClienteDePedido en webApiController.js) — esto prepara el backend para que el
// checkout mande los ids reales del DANE en vez de texto sin validar. Las columnas de
// texto (ciudad, departamento) se quedan: siguen siendo el nombre a mostrar sin necesidad
// de join, y los pedidos históricos sin id los conservan igual.
//
//   node ./seed/migracionPedidosWebUbicacionDane.js
//   node ./seed/migracionPedidosWebUbicacionDane.js --revertir

const TABLA = 'PEDIDOS_WEB';
const REVERTIR = process.argv.includes('--revertir');

const run = async () => {
    await db.authenticate();
    const cols = await db.getQueryInterface().describeTable(TABLA);

    if (REVERTIR) {
        if (!cols.idDepartamento && !cols.idMunicipio) {
            console.log('· idDepartamento/idMunicipio no existen, nada que revertir');
            process.exit(0);
        }
        if (cols.idMunicipio) await db.getQueryInterface().removeColumn(TABLA, 'idMunicipio');
        if (cols.idDepartamento) await db.getQueryInterface().removeColumn(TABLA, 'idDepartamento');
        console.log('✓ idDepartamento/idMunicipio eliminadas de PEDIDOS_WEB');
        process.exit(0);
    }

    if (cols.idDepartamento && cols.idMunicipio) {
        console.log('· idDepartamento/idMunicipio ya existen, se omite');
        process.exit(0);
    }

    if (!cols.idDepartamento) {
        await db.query(`
            ALTER TABLE \`${TABLA}\`
            ADD COLUMN idDepartamento VARCHAR(5) NULL AFTER departamento,
            ADD CONSTRAINT fk_pedidos_web_departamento
                FOREIGN KEY (idDepartamento) REFERENCES DEPARTAMENTOS(id)
                ON UPDATE CASCADE ON DELETE SET NULL
        `);
        console.log('✓ idDepartamento agregada a PEDIDOS_WEB');
    }

    if (!cols.idMunicipio) {
        await db.query(`
            ALTER TABLE \`${TABLA}\`
            ADD COLUMN idMunicipio VARCHAR(5) NULL AFTER idDepartamento,
            ADD CONSTRAINT fk_pedidos_web_municipio
                FOREIGN KEY (idMunicipio) REFERENCES MUNICIPIOS(id)
                ON UPDATE CASCADE ON DELETE SET NULL
        `);
        console.log('✓ idMunicipio agregada a PEDIDOS_WEB');
    }

    process.exit(0);
};

run().catch((e) => { console.error('Migración fallida:', e); process.exit(1); });
