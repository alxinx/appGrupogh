import dotenv from 'dotenv';
import db from '../config/bd.js';
import { Municipios, Departamentos } from '../models/index.js';
import municipiosDane from './municipiosDaneData.js';

dotenv.config();

// Completa MUNICIPIOS con los 1.122 municipios de la DIVIPOLA del DANE.
//
//   npm run db:migrar-municipios-dane
//
// La base traía 32 municipios —los que se fueron creando a mano— y `MUNICIPIOS.id` ES el
// código DIVIPOLA. La importación de clientes viene con ese código por fila, y
// `CLIENTES_UBICACION.idMunicipio` es FK con RESTRICT: un código que no exista no deja
// crear la ubicación. De los 467 códigos de ciudad del Excel de clientes, 435 no estaban.
//
// Es ADITIVA a propósito: no pisa ni borra nada. Los 32 que ya estaban tienen código,
// nombre y departamento correctos (se verificó uno por uno contra el DANE), así que no hay
// id que corregir — y corregir un id sería mover una FK, no un UPDATE. Si alguna vez
// aparece un id mal puesto, esto lo REPORTA y no lo toca: quién lo referencia se decide
// antes de moverlo.
//
// Se puede correr dos veces sin efecto: `ignoreDuplicates` hace INSERT IGNORE.

const ejecutar = async () => {
    try {
        await db.authenticate();

        // 1. Los departamentos tienen que estar antes: MUNICIPIOS.departamento_id es FK.
        const departamentos = await Departamentos.findAll({ attributes: ['id'], raw: true });
        const idsDepartamento = new Set(departamentos.map((d) => String(d.id)));
        const departamentosFaltantes = [...new Set(municipiosDane.map((m) => m.departamento_id))]
            .filter((id) => !idsDepartamento.has(id));

        if (departamentosFaltantes.length) {
            console.error(`✗ Faltan ${departamentosFaltantes.length} departamentos en DEPARTAMENTOS: ${departamentosFaltantes.join(', ')}`);
            console.error('  Corré primero el seed de departamentos (seed/departamentosData.js).');
            process.exitCode = 1;
            return;
        }

        // 2. Lo que ya está, para saber qué se inserta y qué se revisa.
        const existentes = await Municipios.findAll({
            attributes: ['id', 'departamento_id', 'nombre'],
            raw: true
        });
        const porId = new Map(existentes.map((m) => [String(m.id), m]));

        console.log(`MUNICIPIOS: ${existentes.length} filas antes | listado DANE: ${municipiosDane.length}`);

        // 3. Diferencias en los que ya existían. Solo se informan.
        const normalizar = (s) => String(s ?? '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toUpperCase().replace(/[^A-Z0-9]/g, '');

        const discrepancias = [];
        for (const oficial of municipiosDane) {
            const actual = porId.get(oficial.id);
            if (!actual) continue;
            if (String(actual.departamento_id) !== oficial.departamento_id) {
                discrepancias.push(`${oficial.id} departamento ${actual.departamento_id} → DANE ${oficial.departamento_id}`);
            } else if (normalizar(actual.nombre) !== normalizar(oficial.nombre)) {
                discrepancias.push(`${oficial.id} "${actual.nombre}" → DANE "${oficial.nombre}"`);
            }
        }

        // Un id que está en la base y no en el DANE: código inventado o municipio suprimido.
        const sobrantes = existentes
            .map((m) => String(m.id))
            .filter((id) => !municipiosDane.some((o) => o.id === id));

        // 4. Inserción de los que faltan.
        const aInsertar = municipiosDane.filter((m) => !porId.has(m.id));
        if (aInsertar.length) {
            await Municipios.bulkCreate(aInsertar, { ignoreDuplicates: true });
        }

        const despues = await Municipios.count();
        console.log(`✓ Insertados ${aInsertar.length} municipios — MUNICIPIOS queda con ${despues} filas`);

        if (discrepancias.length) {
            console.log(`\n⚠ ${discrepancias.length} municipios que ya existían difieren del DANE (NO se tocaron):`);
            discrepancias.forEach((d) => console.log('   ', d));
            console.log('    Son nombres, no códigos: el id —que es lo que referencian las FK— está bien.');
        }

        if (sobrantes.length) {
            console.log(`\n⚠ ${sobrantes.length} ids en MUNICIPIOS que el DANE no tiene (NO se tocaron): ${sobrantes.join(', ')}`);
            console.log('    Revisá quién los referencia antes de borrarlos.');
        }

        // 5. Ninguna fila que apunte a MUNICIPIOS puede haber quedado colgada. La migración
        //    no borra nada, así que esto solo puede fallar si ya estaba roto — y entonces
        //    hay que saberlo ahora, no cuando la importación de clientes explote.
        const [huerfanos] = await db.query(`
            SELECT 'CLIENTES_UBICACION' AS tabla, COUNT(*) AS filas
              FROM CLIENTES_UBICACION cu
              LEFT JOIN MUNICIPIOS m ON m.id = cu.idMunicipio
             WHERE cu.idMunicipio IS NOT NULL AND m.id IS NULL
            UNION ALL
            SELECT 'PUNTO_DE_VENTA', COUNT(*)
              FROM PUNTO_DE_VENTA p
              LEFT JOIN MUNICIPIOS m ON m.id = p.ciudad
             WHERE p.ciudad IS NOT NULL AND m.id IS NULL
            UNION ALL
            SELECT 'PEDIDOS_WEB', COUNT(*)
              FROM PEDIDOS_WEB pw
              LEFT JOIN MUNICIPIOS m ON m.id = pw.idMunicipio
             WHERE pw.idMunicipio IS NOT NULL AND m.id IS NULL`);

        const colgadas = huerfanos.filter((f) => Number(f.filas) > 0);
        if (colgadas.length) {
            console.log('\n⚠ Filas que apuntan a un municipio inexistente (venían así):');
            colgadas.forEach((f) => console.log(`    ${f.tabla}: ${f.filas}`));
        } else {
            console.log('✓ Sin filas colgadas en las tres tablas que referencian MUNICIPIOS');
        }
    } catch (error) {
        console.error('✗ Error en la migración de municipios:', error.message);
        process.exitCode = 1;
    } finally {
        await db.close();
    }
};

ejecutar();
