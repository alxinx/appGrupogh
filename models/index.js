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

import Cajas from './Cajas.js'
import FacturaProveedores from './FacturaProvedores.js'
import AbonosProveedores from './abonoProvedores.js'

import Dosificaciones from './Dosificaciones.js';
import Pack from './Packs.js';
import DetallesPack from './DetallesPack.js'

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
  as: 'categorias', // Alias útil para consultas (include)
  onDelete: 'CASCADE'
});

CategoriasDeProvedores.belongsToMany(Provedores, {
  through: 'PROVEDOR_CATEGORIAS',
  foreignKey: 'idCategoria',
  otherKey: 'idProveedor',
  onDelete: 'CASCADE'
});


// 1. Relación Dosificación -> Packs
Dosificaciones.hasMany(Pack, { foreignKey: 'idDosificacion' });
Pack.belongsTo(Dosificaciones, { foreignKey: 'idDosificacion' });

// 2. Relación Pack -> DetallesPack
Pack.hasMany(DetallesPack, { foreignKey: 'idPack' });
DetallesPack.belongsTo(Pack, { foreignKey: 'idPack' });

// 3. Relación DetallesPack -> Producto (Relación doble vía)
DetallesPack.belongsTo(Productos, { as: 'producto', foreignKey: 'idProducto', targetKey: 'idProducto' });
Productos.hasMany(DetallesPack, { foreignKey: 'idProducto' });



//Provedores.hasMany(OrdenDeCompra, { foreignKey: 'idProveedor' });
//OrdenDeCompra.belongsTo(Provedores, { foreignKey: 'idProveedor' });


export {
  Usuarios,
  Departamentos,
  Municipios,
  PuntosDeVenta,
  RegimenFacturacion, Cajas,FacturaProveedores, AbonosProveedores, 
  Categorias, Atributos, VariacionesProducto,
  Productos, Provedores, CategoriasDeProvedores,
  Dosificaciones,Pack,DetallesPack,
  Imagenes, Documentacion
}