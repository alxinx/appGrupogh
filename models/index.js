import Usuarios from './Usuarios.js'
import Departamentos from './Departamentos.js'
import Municipios from './Municipios.js'
import PuntosDeVenta from './PuntosDeVenta.js'
import RegimenFacturacion from './RegimenFacturacion.js'
import Categorias from './Categorias.js'
import Atributos from './Atributos.js'
import VariacionesProducto from './VariacionesProducto.js'
import Productos from './Productos.js'
import Imagenes from './Imagenes.js'; import Documentacion from './Documentacion.js'
import Provedores from './Provedores.js'; import CategoriasDeProvedores from './CategoriasDeProvedores.js'




//ASOCIACIONES
  

Productos.hasMany(Imagenes, {
  as: 'imagenes',
  foreignKey: 'idProducto'
});

Imagenes.belongsTo(Productos, {
  as: 'producto',
  foreignKey: 'idProducto'
});


Provedores.belongsToMany(CategoriasDeProvedores, { 
    through: 'PROVEDOR_CATEGORIAS', 
    foreignKey: 'idProveedor',
    otherKey: 'idCategoria',
    as: 'categorias' // Alias útil para consultas (include)
});

CategoriasDeProvedores.belongsToMany(Provedores, { 
    through: 'PROVEDOR_CATEGORIAS', 
    foreignKey: 'idCategoria',
    otherKey: 'idProveedor'
});


//Provedores.hasMany(OrdenDeCompra, { foreignKey: 'idProveedor' });
//OrdenDeCompra.belongsTo(Provedores, { foreignKey: 'idProveedor' });


export {
    Usuarios,
    Departamentos,
    Municipios,
    PuntosDeVenta,
    RegimenFacturacion,
    Categorias, Atributos, VariacionesProducto,
    Productos, Provedores, CategoriasDeProvedores,
    Imagenes, Documentacion
}