import { CategoriasDeProvedores } from "../models/index.js";
import categoriaProvedores from './categoriasProvedores.js';
import db from '../config/bd.js'

// `npm run db:importar` (-i): carga las categorías de proveedores.
// Departamentos y municipios NO se cargan acá: los administra `npm run db:migrar-municipios-dane`.
// Había además un `-e` que hacía TRUNCATE de DEPARTAMENTOS; se quitó: ningún script lo
// usaba y esa tabla tiene llaves foráneas desde clientes, tiendas y pedidos.
const importarDatos = async () => {
    try {
        await db.authenticate();
        console.log('Conexión a DB OK');
        await db.sync();
        await CategoriasDeProvedores.bulkCreate(categoriaProvedores)

        console.log('Datos Importados Correctamente');
        process.exit(0);

    } catch (error) {
        console.log(`El error es : ${error} `);
        process.exit(1);
    }
}

if(process.argv[2] === '-i'){
    importarDatos();
}
