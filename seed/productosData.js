import { v4 as uuidv4 } from 'uuid';
 const nombresData = [
  {
        idProducto: uuidv4(),
        nombreProducto: 'Camiseta Básica Negra',
        slug: 'camiseta-basica-negra',
        idCategoria: 'ropa',
        precioVentaMayorista: 25000.00,
        precioVentaPublicoFinal: 45000.00,
        tax: 19.00,
        sku: 'CAM-NEG-001',
        ean: '7701234567890',
        tags: 'camiseta,ropa,negro',
        descripcion: 'Camiseta básica de algodón color negro',
        activo: 1,
        web: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        idProducto: uuidv4(),
        nombreProducto: 'Jean Slim Azul',
        slug: 'jean-slim-azul',
        idCategoria: 'ropa',
        precioVentaMayorista: 60000.00,
        precioVentaPublicoFinal: 98000.00,
        tax: 19.00,
        sku: 'JEAN-AZ-002',
        ean: '7701234567891',
        tags: 'jean,denim,azul',
        descripcion: 'Jean slim fit azul oscuro',
        activo: 1,
        web: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        idProducto: uuidv4(),
        nombreProducto: 'Gorra Urbana Gris',
        slug: 'gorra-urbana-gris',
        idCategoria: 'accesorios',
        precioVentaMayorista: 18000.00,
        precioVentaPublicoFinal: 35000.00,
        tax: 19.00,
        sku: 'GOR-GRI-003',
        ean: null,
        tags: 'gorra,accesorios,gris',
        descripcion: 'Gorra urbana ajustable color gris',
        activo: 1,
        web: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
]


export default nombresData