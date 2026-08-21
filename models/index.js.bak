import Usuarios from './Usuarios.js'
import Departamentos from './Departamentos.js'
import Municipios from './Municipios.js'
import PuntosDeVenta from './PuntosDeVenta.js'
import RegimenFacturacion from './RegimenFacturacion.js'
import Categorias from './Categorias.js'
import Atributos from './Atributos.js'
import VariacionesProducto from './VariacionesProducto.js'
import Productos from './Productos.js'
import Familia from './Familia.js'
import ReservasCarrito from './ReservasCarrito.js'
import Imagenes from './Imagenes.js'; import Documentacion from './Documentacion.js'
import Provedores from './Provedores.js'; import CategoriasDeProvedores from './CategoriasDeProvedores.js'
import Traslados from './Traslados.js'; import DetalleTraslados from './DetalleTraslados.js'
import InsidenciaTraslado from './InsidenciasTraslados.js'
import Egresos from './Egresos.js'
import DetallesFacturaProvedores from './DetallesFacturaProvedores.js'
import CuentasPorPagar from './CuentasPorPagar.js'
import PermisosRecursos from './PermisosRecursos.js'
import PermisosAcciones from './PermisosAcciones.js'
import UserPermisos from './UserPermisos.js'

import Stock from './Stock.js'

import FacturaProveedores from './FacturaProvedores.js'
import AbonosProveedores from './abonoProvedores.js'

import Dosificaciones from './Dosificaciones.js';
import Pack from './Packs.js';
import DetallesPack from './DetallesPack.js'

import Empleados from './Empleados.js'
import Clientes from './Clientes.js'
import ClientesTributario from './ClientesTributario.js'
import ClientesUbicacion from './ClientesUbicacion.js'
import CajaTienda from './CajaTienda.js'
import CajasYBancos from './CajasYBancos.js'
import MovimientosCajasBancos from './MovimientosCajasBancos.js'
import TrasladoEfectivo from './TrasladoEfectivo.js'
import TrasladoEfectivoHistorial from './TrasladoEfectivoHistorial.js'
import Entidades from './Entidades.js'
import EntidadesQrHistorial from './EntidadesQrHistorial.js'
import FacturaClientes from './FacturaClientes.js'
import DetallesFactura from './DetallesFactura.js'
import DetallesImpuestosFacturaCliente from './DetallesImpuestosFacturaCliente.js'
import DetallesPagosFactura from './DetallesPagosFactura.js'
import BannersWeb from './BannersWeb.js'
import CenefasWeb from './CenefasWeb.js'
import SeccionesWeb from './SeccionesWeb.js'
import PopupWeb from './PopupWeb.js'
import Interesados from './Interesados.js'
import EtiquetasWeb from './EtiquetasWeb.js'
import PaginasWeb from './PaginasWeb.js'
import VisitantesWeb from './VisitantesWeb.js'
import VisitasProducto from './VisitasProducto.js'
import PedidosWeb from './PedidosWeb.js'
import PedidosWebHistorialEstado from './PedidosWebHistorialEstado.js'
import Secuencias from './Secuencias.js'
import DetallesPedidoWeb from './DetallesPedidoWeb.js'
import PagosPedidoWeb from './PagosPedidoWeb.js'
//ASOCIACIONES

// Una familia agrupa las variantes del mismo artículo. El nombre vive en FAMILIA;
// PRODUCTOS solo referencia la fila, así renombrarla no toca ningún producto.
Familia.hasMany(Productos, {
  as: 'productos',
  foreignKey: 'idFamilia'
});

Productos.belongsTo(Familia, {
  as: 'familia',
  foreignKey: 'idFamilia'
});

// Intenciones de compra vivas (carrito web / orden de POS) sobre un producto.
// Con qué cuenta se pagó un egreso, cuando no fue en efectivo. Es la misma tabla que
// usan los pagos de las facturas, para que el cuadre hable de las mismas entidades.
Entidades.hasMany(Egresos,   { as: 'egresos', foreignKey: 'idEntidad' });
Egresos.belongsTo(Entidades, { as: 'entidad', foreignKey: 'idEntidad' });

// Destino del efectivo cuando el egreso es un traslado a una cuenta propia.
CajasYBancos.hasMany(Egresos,   { as: 'egresosRecibidos', foreignKey: 'idCajaBanco' });
Egresos.belongsTo(CajasYBancos, { as: 'cajaBancoDestino', foreignKey: 'idCajaBanco' });

// ── TRASLADOS DE EFECTIVO ────────────────────────────────────────────────────
// El documento del traslado cuelga de todo lo que interviene: la tienda que envía, el
// turno de caja del que salió, los dos empleados, la cuenta destino y —cuando se
// acepta— el movimiento que asentó la plata.
PuntosDeVenta.hasMany(TrasladoEfectivo,   { as: 'trasladosEfectivo', foreignKey: 'idTiendaOrigen' });
TrasladoEfectivo.belongsTo(PuntosDeVenta, { as: 'tiendaOrigen',      foreignKey: 'idTiendaOrigen' });

CajasYBancos.hasMany(TrasladoEfectivo,   { as: 'trasladosRecibidos', foreignKey: 'idCajaBanco' });
TrasladoEfectivo.belongsTo(CajasYBancos, { as: 'cajaBancoDestino',   foreignKey: 'idCajaBanco' });

// Dos alias distintos para EMPLEADOS: quien despacha y quien recibe no son la misma
// persona, y el comprobante tiene que poder nombrar a las dos.
Empleados.hasMany(TrasladoEfectivo,   { as: 'trasladosEnviados',  foreignKey: 'idEmpleadoEnvia' });
TrasladoEfectivo.belongsTo(Empleados, { as: 'empleadoEnvia',      foreignKey: 'idEmpleadoEnvia' });
Empleados.hasMany(TrasladoEfectivo,   { as: 'trasladosRecibidos', foreignKey: 'idEmpleadoRecibe' });
TrasladoEfectivo.belongsTo(Empleados, { as: 'empleadoRecibe',     foreignKey: 'idEmpleadoRecibe' });

CajaTienda.hasMany(TrasladoEfectivo,   { as: 'trasladosEfectivo', foreignKey: 'idCajaTienda' });
TrasladoEfectivo.belongsTo(CajaTienda, { as: 'cajaTienda',        foreignKey: 'idCajaTienda' });

TrasladoEfectivo.belongsTo(MovimientosCajasBancos, { as: 'movimiento', foreignKey: 'idMovimiento' });
// El sobrante tiene su propio movimiento: dos alias distintos sobre la misma tabla porque
// son dos hechos distintos del mismo traslado.
TrasladoEfectivo.belongsTo(MovimientosCajasBancos, { as: 'movimientoExcedente', foreignKey: 'idMovimientoExcedente' });

// El egreso que descuenta el cajón por este traslado. Uno solo: un traslado saca la
// plata del cajón una vez. El egreso es lo que ve el cuadre de caja; el traslado es el
// documento que viaja hasta que alguien lo acepta.
TrasladoEfectivo.hasOne(Egresos,    { as: 'egreso',           foreignKey: 'idTrasladoEfectivo' });
Egresos.belongsTo(TrasladoEfectivo, { as: 'trasladoEfectivo', foreignKey: 'idTrasladoEfectivo' });

// La bitácora del traslado: varios pasos por envío, en orden.
TrasladoEfectivo.hasMany(TrasladoEfectivoHistorial,   { as: 'historial', foreignKey: 'idTrasladosEfectivo' });
TrasladoEfectivoHistorial.belongsTo(TrasladoEfectivo, { as: 'traslado',  foreignKey: 'idTrasladosEfectivo' });
TrasladoEfectivoHistorial.belongsTo(Empleados,        { as: 'empleado',  foreignKey: 'idEmpleado' });

// ── CAJAS Y BANCOS ↔ SUS MOVIMIENTOS ─────────────────────────────────────────
// El saldo de una caja no se guarda en ninguna columna: se calcula sumando sus
// movimientos. Así el saldo nunca puede contradecir al libro que lo respalda.
CajasYBancos.hasMany(MovimientosCajasBancos, { as: 'movimientos', foreignKey: 'idCajaBanco' });
MovimientosCajasBancos.belongsTo(CajasYBancos, { as: 'cajaBanco',  foreignKey: 'idCajaBanco' });

// Quién registró cada movimiento. EMPLEADOS es paranoid: un empleado despedido sigue
// apareciendo como autor del movimiento que hizo.
Empleados.hasMany(MovimientosCajasBancos, { as: 'movimientosCaja', foreignKey: 'idEmpleado' });
MovimientosCajasBancos.belongsTo(Empleados, { as: 'empleado',       foreignKey: 'idEmpleado' });

Productos.hasMany(ReservasCarrito, { as: 'reservas', foreignKey: 'idProducto' });
ReservasCarrito.belongsTo(Productos, { as: 'producto', foreignKey: 'idProducto' });
ReservasCarrito.belongsTo(PuntosDeVenta, { as: 'puntoDeVenta', foreignKey: 'idPuntoDeVenta' });

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



Stock.belongsTo(Productos, { foreignKey: 'idProducto', as: 'producto' });
Productos.hasMany(Stock, { foreignKey: 'idProducto', as: 'existencias' });

Stock.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoVenta', as: 'ubicacion' });
PuntosDeVenta.hasMany(Stock, { foreignKey: 'idPuntoVenta', as: 'inventario' });

Stock.belongsTo(Pack, { foreignKey: 'idPack', as: 'packOrigen' });
Pack.hasMany(Stock, { foreignKey: 'idPack', as: 'stocksGenerados' });

Stock.belongsTo(FacturaProveedores, { foreignKey: 'idFacturaPro', as: 'factura' });
FacturaProveedores.hasMany(Stock, { foreignKey: 'idFacturaPro', as: 'ingresos' });


FacturaProveedores.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoVentaDestino', as: 'destino' });

// Un Traslado tiene muchos detalles
Traslados.hasMany(DetalleTraslados, { foreignKey: 'idTraslado', as: 'items' });
DetalleTraslados.belongsTo(Traslados, { foreignKey: 'idTraslado' });

// Relaciones de Origen y Destino (Puntos de Venta)
Traslados.belongsTo(PuntosDeVenta, { foreignKey: 'idOrigen', as: 'origen' });
Traslados.belongsTo(PuntosDeVenta, { foreignKey: 'idDestino', as: 'destino' });

// Relaciones del Detalle
DetalleTraslados.belongsTo(Pack, { foreignKey: 'idPack', as: 'pack' });
DetalleTraslados.belongsTo(Productos, { foreignKey: 'idProducto', as: 'producto' });

// Insidencias
Traslados.hasMany(InsidenciaTraslado, { foreignKey: 'idTraslado', as: 'insidencias' });
InsidenciaTraslado.belongsTo(Traslados, { foreignKey: 'idTraslado' });
InsidenciaTraslado.belongsTo(DetalleTraslados, { foreignKey: 'idDetalleTraslado', as: 'detalle' });
InsidenciaTraslado.belongsTo(Empleados, { foreignKey: 'idEmpleado', as: 'empleado' });

// Clientes
Clientes.hasMany(ClientesTributario, { foreignKey: 'idCliente', as: 'tributario' });
ClientesTributario.belongsTo(Clientes, { foreignKey: 'idCliente' });

Clientes.hasMany(ClientesUbicacion, { foreignKey: 'idCliente', as: 'ubicaciones' });
ClientesUbicacion.belongsTo(Clientes, { foreignKey: 'idCliente' });

// Caja tienda
Empleados.hasMany(CajaTienda, { foreignKey: 'idEmpleadoApertura', as: 'cajasApertura' });
CajaTienda.belongsTo(Empleados, { foreignKey: 'idEmpleadoApertura', as: 'empleadoApertura' });

Empleados.hasMany(CajaTienda, { foreignKey: 'idEmpleadoCierre', as: 'cajasCierre' });
CajaTienda.belongsTo(Empleados, { foreignKey: 'idEmpleadoCierre', as: 'empleadoCierre' });

PuntosDeVenta.hasMany(CajaTienda, { foreignKey: 'idPuntoDeVenta', as: 'cajas' });
CajaTienda.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoDeVenta', as: 'puntoDeVenta' });

// Facturación clientes
Clientes.hasMany(FacturaClientes, { foreignKey: 'idCliente', as: 'facturas' });
FacturaClientes.belongsTo(Clientes, { foreignKey: 'idCliente', as: 'cliente' });

RegimenFacturacion.hasMany(FacturaClientes, { foreignKey: 'idRegimenFacturacion', as: 'facturas' });
FacturaClientes.belongsTo(RegimenFacturacion, { foreignKey: 'idRegimenFacturacion', as: 'regimen' });

PuntosDeVenta.hasMany(FacturaClientes, { foreignKey: 'idPuntoDeVenta', as: 'facturas' });
FacturaClientes.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoDeVenta', as: 'puntoDeVenta' });

Empleados.hasMany(FacturaClientes, { foreignKey: 'idEmpleado', as: 'facturas' });
FacturaClientes.belongsTo(Empleados, { foreignKey: 'idEmpleado', as: 'vendedor' });

FacturaClientes.hasMany(DetallesFactura, { foreignKey: 'idFacturaCliente', as: 'detalles' });
DetallesFactura.belongsTo(FacturaClientes, { foreignKey: 'idFacturaCliente', as: 'factura' });

DetallesFactura.belongsTo(Productos, { foreignKey: 'idProducto', as: 'producto' });
Productos.hasMany(DetallesFactura, { foreignKey: 'idProducto', as: 'lineasFactura' });

FacturaClientes.hasMany(DetallesImpuestosFacturaCliente, { foreignKey: 'idFacturaCliente', as: 'impuestos' });
DetallesImpuestosFacturaCliente.belongsTo(FacturaClientes, { foreignKey: 'idFacturaCliente', as: 'factura' });

DetallesFactura.hasMany(DetallesImpuestosFacturaCliente, { foreignKey: 'idDetallesFactura', as: 'impuestos' });
DetallesImpuestosFacturaCliente.belongsTo(DetallesFactura, { foreignKey: 'idDetallesFactura', as: 'lineaFactura' });



// 1. Relación con Acceso al Sistema
// El idUsuario en Empleados es opcional (null para operativos)
Usuarios.hasOne(Empleados, { foreignKey: 'idUsuario', as: 'perfil' });
Empleados.belongsTo(Usuarios, { foreignKey: 'idUsuario', as: 'cuenta' });

// 2. Relación con Sedes (Fábrica, Tiendas, Bodegas)
PuntosDeVenta.hasMany(Empleados, { foreignKey: 'idPuntoDeVenta', as: 'personal' });
Empleados.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoDeVenta', as: 'sede' });

//Provedores.hasMany(OrdenDeCompra, { foreignKey: 'idProveedor' });
//OrdenDeCompra.belongsTo(Provedores, { foreignKey: 'idProveedor' });


// ─── DetallesPagosFactura ────────────────────────────────────────────────────
FacturaClientes.hasMany(DetallesPagosFactura, { foreignKey: 'idFacturaCliente', as: 'pagos' });
DetallesPagosFactura.belongsTo(FacturaClientes, { foreignKey: 'idFacturaCliente' });
DetallesPagosFactura.belongsTo(Entidades, { foreignKey: 'idEntidad', as: 'entidad' });
Entidades.hasMany(DetallesPagosFactura, { foreignKey: 'idEntidad' });

// ─── Historial del QR de pago por entidad ────────────────────────────────────
Entidades.hasMany(EntidadesQrHistorial, { foreignKey: 'idEntidad', as: 'historialQr' });
EntidadesQrHistorial.belongsTo(Entidades, { foreignKey: 'idEntidad', as: 'entidad' });
EntidadesQrHistorial.belongsTo(Usuarios, { foreignKey: 'idUsuario', as: 'usuario' });
Entidades.belongsTo(Usuarios, { foreignKey: 'qrUploadedBy', as: 'qrAutor' });

// ─── Permisos de usuario ──────────────────────────────────────────────────────
Usuarios.hasMany(UserPermisos, { foreignKey: 'idUsuario', as: 'accesos' });
UserPermisos.belongsTo(Usuarios, { foreignKey: 'idUsuario', as: 'usuario' });

PermisosRecursos.hasMany(UserPermisos, { foreignKey: 'idRecurso', as: 'permisos' });
UserPermisos.belongsTo(PermisosRecursos, { foreignKey: 'idRecurso', as: 'recurso' });

PermisosAcciones.hasMany(UserPermisos, { foreignKey: 'idAccion', as: 'permisos' });
UserPermisos.belongsTo(PermisosAcciones, { foreignKey: 'idAccion', as: 'accion' });

// ─── Provedores ↔ FacturaProveedores ─────────────────────────────────────────
Provedores.hasMany(FacturaProveedores, { foreignKey: 'idProveedor', as: 'facturas' });
FacturaProveedores.belongsTo(Provedores, { foreignKey: 'idProveedor', as: 'proveedor' });

// ─── Detalles Factura Proveedores ─────────────────────────────────────────────
FacturaProveedores.hasMany(DetallesFacturaProvedores, { foreignKey: 'idFacturaPro', as: 'detalles' });
DetallesFacturaProvedores.belongsTo(FacturaProveedores, { foreignKey: 'idFacturaPro', as: 'factura' });

DetallesFacturaProvedores.belongsTo(Productos, { foreignKey: 'idProducto', as: 'producto' });
Productos.hasMany(DetallesFacturaProvedores, { foreignKey: 'idProducto', as: 'detallesCompra' });

// ─── Cuentas por Pagar ────────────────────────────────────────────────────────
FacturaProveedores.hasMany(CuentasPorPagar, { foreignKey: 'idFacturaPro', as: 'cuentasPorPagar' });
CuentasPorPagar.belongsTo(FacturaProveedores, { foreignKey: 'idFacturaPro', as: 'factura' });

// ─── Egresos ─────────────────────────────────────────────────────────────────
PuntosDeVenta.hasMany(Egresos, { foreignKey: 'idPuntoDeVenta', as: 'egresos' });
Egresos.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoDeVenta', as: 'puntoDeVenta' });

Empleados.hasMany(Egresos, { foreignKey: 'idEmpleado', as: 'egresos' });
Egresos.belongsTo(Empleados, { foreignKey: 'idEmpleado', as: 'empleado' });

CajaTienda.hasMany(Egresos, { foreignKey: 'idCajaTienda', as: 'egresos' });
Egresos.belongsTo(CajaTienda, { foreignKey: 'idCajaTienda', as: 'caja' });

// ─── Web e-commerce ──────────────────────────────────────────────────────────
SeccionesWeb.belongsTo(Categorias, { foreignKey: 'idCategoria', as: 'categoria' });
Categorias.hasMany(SeccionesWeb, { foreignKey: 'idCategoria', as: 'seccionesWeb' });

// ─── Interesados ─────────────────────────────────────────────────────────────
Interesados.belongsTo(Productos, { foreignKey: 'producto', as: 'productoDetalle' });
Productos.hasMany(Interesados, { foreignKey: 'producto', as: 'interesados' });

// ─── Visitantes web / remarketing ─────────────────────────────────────────────
VisitasProducto.belongsTo(Productos, { foreignKey: 'idProducto', as: 'producto' });
Productos.hasMany(VisitasProducto, { foreignKey: 'idProducto', as: 'visitas' });

VisitasProducto.belongsTo(VisitantesWeb, { foreignKey: 'idVisitante', as: 'visitante' });
VisitantesWeb.hasMany(VisitasProducto, { foreignKey: 'idVisitante', as: 'vistasProducto' });

// ─── Pedidos web ───────────────────────────────────────────────────────────
PedidosWeb.belongsTo(VisitantesWeb, { foreignKey: 'idVisitante', as: 'visitante' });
PedidosWeb.belongsTo(PuntosDeVenta, { foreignKey: 'idPuntoVentaRecogida', as: 'puntoRecogida' });
PedidosWeb.belongsTo(PuntosDeVenta, { foreignKey: 'idTiendaFacturacion', as: 'tiendaFacturacion' });
PedidosWeb.belongsTo(Empleados, { foreignKey: 'idOperadorRevisor', as: 'operadorRevisor' });
PedidosWeb.belongsTo(FacturaClientes, { foreignKey: 'idFacturaCliente', as: 'factura' });
PedidosWeb.belongsTo(Clientes, { foreignKey: 'idCliente', as: 'cliente' });
// Entidad a la que el comprador transfirió cuando eligió pagar por QR
PedidosWeb.belongsTo(Entidades, { foreignKey: 'idEntidadPagoQr', as: 'entidadPagoQr' });

// ─── Bitácora de cambios de estado hechos a mano desde el panel ──────────────
PedidosWeb.hasMany(PedidosWebHistorialEstado, { foreignKey: 'idPedido', as: 'historialEstado' });
PedidosWebHistorialEstado.belongsTo(PedidosWeb, { foreignKey: 'idPedido', as: 'pedido' });
PedidosWebHistorialEstado.belongsTo(Empleados, { foreignKey: 'idEmpleado', as: 'empleado' });
PedidosWebHistorialEstado.belongsTo(Usuarios, { foreignKey: 'idUsuario', as: 'usuario' });

PedidosWeb.hasMany(DetallesPedidoWeb, { foreignKey: 'idPedido', as: 'detalles' });
DetallesPedidoWeb.belongsTo(PedidosWeb, { foreignKey: 'idPedido', as: 'pedido' });
DetallesPedidoWeb.belongsTo(Productos, { foreignKey: 'idProducto', as: 'producto' });
Productos.hasMany(DetallesPedidoWeb, { foreignKey: 'idProducto', as: 'detallesPedidoWeb' });

PedidosWeb.hasMany(PagosPedidoWeb, { foreignKey: 'idPedido', as: 'pagos' });
PagosPedidoWeb.belongsTo(PedidosWeb, { foreignKey: 'idPedido', as: 'pedido' });

Traslados.belongsTo(PedidosWeb, { foreignKey: 'idPedidoWeb', as: 'pedidoWeb' });
PedidosWeb.hasMany(Traslados, { foreignKey: 'idPedidoWeb', as: 'traslados' });

export {
  Usuarios,
  Departamentos,
  Municipios,
  PuntosDeVenta,
  RegimenFacturacion, CajasYBancos, MovimientosCajasBancos, TrasladoEfectivo, TrasladoEfectivoHistorial, FacturaProveedores, AbonosProveedores,
  Categorias, Atributos, VariacionesProducto,
  Productos, Provedores, CategoriasDeProvedores,
  Dosificaciones, Pack, DetallesPack, Stock,
  Traslados, DetalleTraslados, InsidenciaTraslado,
  Imagenes, Documentacion, Empleados,
  Clientes, ClientesTributario, ClientesUbicacion,
  CajaTienda, Entidades, EntidadesQrHistorial,
  FacturaClientes, DetallesFactura, DetallesImpuestosFacturaCliente, DetallesPagosFactura,
  Egresos,
  PermisosRecursos, PermisosAcciones, UserPermisos,
  DetallesFacturaProvedores, CuentasPorPagar,
  BannersWeb, CenefasWeb, SeccionesWeb, PopupWeb,
  Interesados,
  EtiquetasWeb,
  PaginasWeb,
  VisitantesWeb,
  VisitasProducto,
  PedidosWeb, PedidosWebHistorialEstado,
  Secuencias,
  DetallesPedidoWeb,
  PagosPedidoWeb,
  Familia,
  ReservasCarrito,
}