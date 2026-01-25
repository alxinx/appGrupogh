import Usuarios from './Usuarios.js'
import Departamentos from './Departamentos.js'
import Municipios from './Municipios.js'
import PuntosDeVenta from './PuntosDeVenta.js'
import RegimenFacturacion from './RegimenFacturacion.js'
import Categorias from './Categorias.js'
import Atributos from './Atributos.js'
import VariacionesProducto from './VariacionesProducto.js'
import Productos from './Productos.js'
import Imagenes from './Imagenes.js'



//ASOCIACIONES


Productos.hasMany(Imagenes, {
  as: 'imagenes',
  foreignKey: 'idProducto'
});

Imagenes.belongsTo(Productos, {
  as: 'producto',
  foreignKey: 'idProducto'
});



export {
    Usuarios,
    Departamentos,
    Municipios,
    PuntosDeVenta,
    RegimenFacturacion,
    Categorias, Atributos, VariacionesProducto,
    Productos, 
    Imagenes
}