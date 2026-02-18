import { Departamentos, Municipios, Categorias, Atributos, VariacionesProducto, Productos , CategoriasDeProvedores} from "../models/index.js";
//import nombresData from "./departamentosData.js";
//import municipios from "./municipiosData.js";
//import nombresData from "./atributos.js";
//import nombresData from "./categorias.js";
import categoriaProvedores from './categoriasProvedores.js';
//import productosData from './productosData.js'
import db from '../config/bd.js'

const importarDatos = async () => {
    try {
        // Autentico
        await db.authenticate();
        console.log('Conexión a DB OK');
        // Sincronizoz
        await db.sync(); 
        await CategoriasDeProvedores.bulkCreate(categoriaProvedores)
       // await Departamentos.bulkCreate(nombresData);
       // await Municipios.bulkCreate(municipios)
        
        console.log('Datos Importados Correctamente');
        process.exit(0);

    } catch (error) {
        console.log(`El error es : ${error} `);
        process.exit(1);
    }
}

const eliminarDatos = async () => {
    try {   
        // Usamos truncate: true para reiniciar los IDs y limpiar todo rápido
        await Departamentos.destroy({ where: {}, truncate: true });
        console.log('Datos Eliminados');
        process.exit(0);
        
    } catch (error) {
        console.log(`Error al eliminar : ${error}`);
        process.exit(1);
    }
}

if(process.argv[2] === '-i'){
    importarDatos();
}

if(process.argv[2] === '-e'){
    eliminarDatos();
}