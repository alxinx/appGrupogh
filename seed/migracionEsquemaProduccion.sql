-- ============================================================================
-- GRUPO GH — Migración de esquema  7768537 -> c2ae54d
-- (rama `clientes` fusionada a `main`: crédito de clientes, abono global desde
--  la tienda, impuestos reales en facturación, ubicación DANE en pedidos web)
--
--   1. Correr primero seed/verificacionEsquemaProduccion.sql para ver qué falta.
--   2. BACKUP. MySQL hace COMMIT implícito en cada DDL: no hay rollback.
--   3. mysql -h HOST -u USER -p BASE < seed/migracionEsquemaProduccion.sql
--
-- Las CREATE TABLE son IF NOT EXISTS: si la app ya arrancó con DB_SYNC=true,
-- Sequelize habrá creado las 4 tablas nuevas (pero NINGUNA columna de las tablas
-- que ya existían), y este archivo se puede correr igual sin chocar con ellas.
--
-- NO usar sync() / DB_SYNC. El orden importa: CREDITO_DISPONIBLE_CLIENTE_HISTORIAL
-- depende de CREDITO_DISPONIBLE_CLIENTE, y descuentoMayorista va AFTER total.
--
-- Cinco columnas de acá no tienen script en seed/*.js y por eso este archivo no
-- delega en ellos: FACTURA_CLIENTES.credito/subtotal/totalImpuestos/total,
-- CLIENTES.valorCredito y el ENUM de EMPLEADOS.TipoDocumento. Además
-- migracionImpuestosFactura.js hace `ADD COLUMN descuentoMayorista AFTER total`,
-- que falla si `total` todavía no existe.
--
-- Validado: se clonó la estructura de la base de desarrollo a un esquema
-- desechable, se la regresó al estado de 7768537 y se corrió este archivo
-- completo sin errores. El resultado coincide con desarrollo en las 684
-- columnas, 208 índices y 81 claves foráneas. Única diferencia deliberada:
-- FACTURA_CLIENTES.credito queda NOT NULL DEFAULT 0 (lo que declara el modelo),
-- mientras que en desarrollo está como nullable sin default.
--
-- Aparte de esto queda la carga de datos de municipios DANE, que no es esquema:
--   npm run db:migrar-municipios-colombia
-- ============================================================================

-- ─── 1. CLIENTES ────────────────────────────────────────────────────────────
-- tipo_documento (VARCHAR libre) -> tipoDocumento (ENUM). Mismo vocabulario que
-- EMPLEADOS. Los valores fuera del ENUM (p.ej. 'DE') se mapean a 'CC'.
ALTER TABLE `CLIENTES`
  ADD COLUMN `tipoDocumento` ENUM('CC','CE','TI','NIT','PP','PPT','PEP') NOT NULL DEFAULT 'CC' AFTER `tipo_persona`;

UPDATE `CLIENTES`
  SET `tipoDocumento` = CASE
      WHEN `tipo_documento` IN ('CC','CE','TI','NIT','PP','PPT','PEP') THEN `tipo_documento`
      ELSE 'CC' END;

ALTER TABLE `CLIENTES` DROP COLUMN `tipo_documento`;

-- Cupo de crédito del cliente (espejo denormalizado de CREDITO_DISPONIBLE_CLIENTE).
ALTER TABLE `CLIENTES`
  ADD COLUMN `valorCredito` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `credito`;

-- ─── 2. EMPLEADOS ───────────────────────────────────────────────────────────
-- Se suma PPT (Permiso por Protección Temporal).
ALTER TABLE `EMPLEADOS`
  MODIFY COLUMN `TipoDocumento` ENUM('CC','CE','TI','NIT','PP','PPT') DEFAULT 'CC';

-- ─── 3. FACTURA_CLIENTES ────────────────────────────────────────────────────
-- Invariante: subtotal - descuentoMayorista + totalImpuestos = total
ALTER TABLE `FACTURA_CLIENTES`
  ADD COLUMN `credito`            TINYINT(1)     NOT NULL DEFAULT 0 AFTER `estado`,
  ADD COLUMN `subtotal`           DECIMAL(12,2)  NOT NULL DEFAULT 0,
  ADD COLUMN `totalImpuestos`     DECIMAL(12,2)  NOT NULL DEFAULT 0 AFTER `subtotal`,
  ADD COLUMN `total`              DECIMAL(12,2)  NOT NULL DEFAULT 0 AFTER `totalImpuestos`,
  ADD COLUMN `descuentoMayorista` DECIMAL(12,2)  NOT NULL DEFAULT 0 AFTER `total`;

-- ─── 4. DETALLES_FACTURA ────────────────────────────────────────────────────
-- Descomposición del precio (que ya incluye IVA) en base gravable + impuesto.
ALTER TABLE `DETALLES_FACTURA`
  ADD COLUMN `porcentajeIva` DECIMAL(5,2)  NOT NULL DEFAULT 0 AFTER `valorUnidad`,
  ADD COLUMN `valorImpuesto` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `subTotal`;

-- ─── 5. DETALLES_PAGOS_FACTURA ──────────────────────────────────────────────
-- Se suma 'Credito En Tienda' (la tienda financia con su propio cupo).
ALTER TABLE `DETALLES_PAGOS_FACTURA`
  MODIFY COLUMN `metodoPago` ENUM('Banco','Billetera Virtual','Entidad Crediticia','Tarjeta Credito','Efectivo','Credito En Tienda') NOT NULL;

-- ─── 6. CAJA_TIENDA ─────────────────────────────────────────────────────────
ALTER TABLE `CAJA_TIENDA`
  ADD COLUMN `ventasCreditoTienda`           DECIMAL(10,2) NULL DEFAULT 0 AFTER `ventasCreditoRegistradas`,
  ADD COLUMN `ventasCreditoTiendaRegistrada` DECIMAL(10,2) NULL DEFAULT 0 AFTER `ventasCreditoTienda`;

-- ─── 7. PEDIDOS_WEB ─────────────────────────────────────────────────────────
-- Códigos DANE de departamento/municipio del envío.
ALTER TABLE `PEDIDOS_WEB`
  ADD COLUMN `idDepartamento` VARCHAR(5) NULL AFTER `departamento`,
  ADD CONSTRAINT `fk_pedidos_web_departamento` FOREIGN KEY (`idDepartamento`) REFERENCES `DEPARTAMENTOS` (`id`);

ALTER TABLE `PEDIDOS_WEB`
  ADD COLUMN `idMunicipio` VARCHAR(5) NULL AFTER `idDepartamento`,
  ADD CONSTRAINT `fk_pedidos_web_municipio` FOREIGN KEY (`idMunicipio`) REFERENCES `MUNICIPIOS` (`id`);

-- ─── 8. CLIENTES_CREDITO_HISTORIAL (nueva) ──────────────────────────────────
-- Bitácora append-only de otorgar/suspender crédito.
CREATE TABLE IF NOT EXISTS `CLIENTES_CREDITO_HISTORIAL` (
  `idHistorial`    CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `idCliente`      CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `accion`         ENUM('otorgado','suspendido') NOT NULL,
  `idEmpleado`     CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `nombreEmpleado` VARCHAR(120) DEFAULT NULL,
  `codigoEmpleado` VARCHAR(20)  DEFAULT NULL,
  `idUsuario`      CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `motivo`         VARCHAR(255) DEFAULT NULL,
  `createdAt`      DATETIME NOT NULL,
  PRIMARY KEY (`idHistorial`),
  KEY `idEmpleado` (`idEmpleado`),
  KEY `idUsuario` (`idUsuario`),
  KEY `c_l_i_e_n_t_e_s__c_r_e_d_i_t_o__h_i_s_t_o_r_i_a_l_id_cliente` (`idCliente`),
  CONSTRAINT `clientes_credito_historial_ibfk_1` FOREIGN KEY (`idCliente`)  REFERENCES `CLIENTES`  (`idCliente`)  ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `clientes_credito_historial_ibfk_2` FOREIGN KEY (`idEmpleado`) REFERENCES `EMPLEADOS` (`idEmpleado`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `clientes_credito_historial_ibfk_3` FOREIGN KEY (`idUsuario`)  REFERENCES `USUARIOS`  (`idUsuario`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── 9. CREDITO_DISPONIBLE_CLIENTE (nueva) ──────────────────────────────────
-- Cupo de crédito / saldo a favor. PK en UUID v7 (única tabla que se aparta de v4).
CREATE TABLE IF NOT EXISTS `CREDITO_DISPONIBLE_CLIENTE` (
  `idCreditoDisponible`  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `idCliente`            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `valorCreditoCliente`  DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `creditoDisponible`    DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  `tiempoCredito`        INT DEFAULT NULL,
  `tipo`                 ENUM('Credito','Saldo a Favor') NOT NULL DEFAULT 'Credito',
  `autorizo`             CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `createdAt`            DATETIME NOT NULL,
  `updatedAt`            DATETIME NOT NULL,
  PRIMARY KEY (`idCreditoDisponible`),
  KEY `c_r_e_d_i_t_o__d_i_s_p_o_n_i_b_l_e__c_l_i_e_n_t_e_id_cliente` (`idCliente`),
  KEY `c_r_e_d_i_t_o__d_i_s_p_o_n_i_b_l_e__c_l_i_e_n_t_e_autorizo` (`autorizo`),
  CONSTRAINT `credito_disponible_cliente_ibfk_1` FOREIGN KEY (`idCliente`) REFERENCES `CLIENTES`  (`idCliente`)  ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `credito_disponible_cliente_ibfk_2` FOREIGN KEY (`autorizo`)  REFERENCES `EMPLEADOS` (`idEmpleado`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── 10. CREDITO_DISPONIBLE_CLIENTE_HISTORIAL (nueva) ───────────────────────
-- Bitácora de aumentos de cupo. Depende de la tabla anterior.
CREATE TABLE IF NOT EXISTS `CREDITO_DISPONIBLE_CLIENTE_HISTORIAL` (
  `idHistorial`          CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `idCreditoDisponible`  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `idCliente`            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `valorAnterior`        DECIMAL(12,2) NOT NULL,
  `valorNuevo`           DECIMAL(12,2) NOT NULL,
  `idEmpleado`           CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `nombreEmpleado`       VARCHAR(120) DEFAULT NULL,
  `codigoEmpleado`       VARCHAR(20)  DEFAULT NULL,
  `idUsuario`            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `createdAt`            DATETIME NOT NULL,
  PRIMARY KEY (`idHistorial`),
  KEY `idEmpleado` (`idEmpleado`),
  KEY `idUsuario` (`idUsuario`),
  KEY `cdch_idx_credito_disponible` (`idCreditoDisponible`),
  KEY `cdch_idx_cliente` (`idCliente`),
  CONSTRAINT `credito_disponible_cliente_historial_ibfk_1` FOREIGN KEY (`idCreditoDisponible`) REFERENCES `CREDITO_DISPONIBLE_CLIENTE` (`idCreditoDisponible`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `credito_disponible_cliente_historial_ibfk_2` FOREIGN KEY (`idCliente`)  REFERENCES `CLIENTES`  (`idCliente`)  ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `credito_disponible_cliente_historial_ibfk_3` FOREIGN KEY (`idEmpleado`) REFERENCES `EMPLEADOS` (`idEmpleado`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `credito_disponible_cliente_historial_ibfk_4` FOREIGN KEY (`idUsuario`)  REFERENCES `USUARIOS`  (`idUsuario`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── 11. ABONO_CLIENTE_CREDITOS (nueva) ─────────────────────────────────────
-- Ledger append-only de abonos a facturas de crédito. Ya incluye idEntidad y
-- 'Entidad Crediticia': en una base que nunca tuvo la tabla NO hace falta correr
-- después la migración migracionAbonoEntidadCrediticia.
CREATE TABLE IF NOT EXISTS `ABONO_CLIENTE_CREDITOS` (
  `idAbonoClienteCredito` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `idFacturaCliente`      CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `idCliente`             CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `totalFactura`          DECIMAL(12,2) NOT NULL,
  `valorAbono`            DECIMAL(12,2) NOT NULL,
  `valorPorPagar`         DECIMAL(12,2) NOT NULL,
  `metodoPago`            ENUM('Banco','Billetera Virtual','Entidad Crediticia','Tarjeta Credito','Efectivo') NOT NULL,
  `idEntidad`             INT DEFAULT NULL,
  `nroReferencia`         VARCHAR(50)  DEFAULT NULL,
  `idEmpleado`            CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `nombreEmpleado`        VARCHAR(120) DEFAULT NULL,
  `codigoEmpleado`        VARCHAR(20)  DEFAULT NULL,
  `idUsuario`             CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `loteAbonoGlobal`       CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `motivo`                VARCHAR(255) DEFAULT NULL,
  `createdAt`             DATETIME NOT NULL,
  PRIMARY KEY (`idAbonoClienteCredito`),
  KEY `idEmpleado` (`idEmpleado`),
  KEY `idUsuario` (`idUsuario`),
  KEY `acc_idx_factura_cliente` (`idFacturaCliente`),
  KEY `acc_idx_cliente` (`idCliente`),
  KEY `acc_idx_lote_abono_global` (`loteAbonoGlobal`),
  KEY `acc_fk_entidad` (`idEntidad`),
  CONSTRAINT `abono_cliente_creditos_ibfk_1` FOREIGN KEY (`idFacturaCliente`) REFERENCES `FACTURA_CLIENTES` (`idFacturaCliente`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `abono_cliente_creditos_ibfk_2` FOREIGN KEY (`idCliente`)  REFERENCES `CLIENTES`  (`idCliente`)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `abono_cliente_creditos_ibfk_3` FOREIGN KEY (`idEmpleado`) REFERENCES `EMPLEADOS` (`idEmpleado`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `abono_cliente_creditos_ibfk_4` FOREIGN KEY (`idUsuario`)  REFERENCES `USUARIOS`  (`idUsuario`)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `acc_fk_entidad` FOREIGN KEY (`idEntidad`) REFERENCES `ENTIDADES` (`idEntidad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ─── 12. DATOS: permiso "Mis Clientes" ──────────────────────────────────────
-- Nadie lo tiene por defecto: hay que otorgarlo desde la ficha de cada empleado.
INSERT INTO `PERMISOS_RECURSOS` (`idRecurso`,`nombreRecurso`,`tipo`,`folder`,`createdAt`)
SELECT UUID(), 'Mis Clientes', 'vendedor', '/clientes', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT * FROM `PERMISOS_RECURSOS`) x
  WHERE x.`tipo`='vendedor' AND x.`nombreRecurso`='Mis Clientes'
);
