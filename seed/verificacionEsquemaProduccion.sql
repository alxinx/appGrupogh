-- ============================================================================
-- GRUPO GH — Chequeo previo de esquema (SOLO LECTURA)
--
-- Reporta qué objetos le faltan a la base contra la que se ejecuta, para el
-- rango de commits 7768537 -> c2ae54d (rama `clientes` fusionada a `main`).
-- No modifica nada: se puede correr en producción sin riesgo.
--
--   mysql -h HOST -u USER -p BASE < seed/verificacionEsquemaProduccion.sql
--
-- Todo lo que salga como 'FALTA' lo crea seed/migracionEsquemaProduccion.sql.
-- ============================================================================

SELECT 'TABLA' AS tipo, t.n AS objeto,
       IF(EXISTS(SELECT 1 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=t.n),'ya existe','FALTA') AS estado
FROM (SELECT 'CLIENTES_CREDITO_HISTORIAL' n UNION ALL SELECT 'CREDITO_DISPONIBLE_CLIENTE'
      UNION ALL SELECT 'CREDITO_DISPONIBLE_CLIENTE_HISTORIAL' UNION ALL SELECT 'ABONO_CLIENTE_CREDITOS') t
UNION ALL
SELECT 'COLUMNA', CONCAT(c.t,'.',c.col),
       IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=c.t AND COLUMN_NAME=c.col),'ya existe','FALTA')
FROM (
  SELECT 'CLIENTES' t,'tipoDocumento' col UNION ALL SELECT 'CLIENTES','valorCredito'
  UNION ALL SELECT 'FACTURA_CLIENTES','credito'  UNION ALL SELECT 'FACTURA_CLIENTES','subtotal'
  UNION ALL SELECT 'FACTURA_CLIENTES','totalImpuestos' UNION ALL SELECT 'FACTURA_CLIENTES','total'
  UNION ALL SELECT 'FACTURA_CLIENTES','descuentoMayorista'
  UNION ALL SELECT 'DETALLES_FACTURA','porcentajeIva' UNION ALL SELECT 'DETALLES_FACTURA','valorImpuesto'
  UNION ALL SELECT 'CAJA_TIENDA','ventasCreditoTienda' UNION ALL SELECT 'CAJA_TIENDA','ventasCreditoTiendaRegistrada'
  UNION ALL SELECT 'PEDIDOS_WEB','idDepartamento' UNION ALL SELECT 'PEDIDOS_WEB','idMunicipio'
) c
UNION ALL
SELECT 'ENUM','EMPLEADOS.TipoDocumento (PPT)',
       IF((SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
           AND TABLE_NAME='EMPLEADOS' AND COLUMN_NAME='TipoDocumento') LIKE '%PPT%','ya existe','FALTA')
UNION ALL
SELECT 'ENUM','DETALLES_PAGOS_FACTURA.metodoPago (Credito En Tienda)',
       IF((SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
           AND TABLE_NAME='DETALLES_PAGOS_FACTURA' AND COLUMN_NAME='metodoPago') LIKE '%Credito En Tienda%','ya existe','FALTA')
UNION ALL
SELECT 'DATO','PERMISOS_RECURSOS "Mis Clientes"',
       IF(EXISTS(SELECT 1 FROM PERMISOS_RECURSOS WHERE tipo='vendedor' AND nombreRecurso='Mis Clientes'),'ya existe','FALTA');
