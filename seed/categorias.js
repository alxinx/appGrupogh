 const nombresData = [
    { nombreCategoria: 'Superior', tipo: 'CATEGORIA' }, // id 1
    { nombreCategoria: 'Inferior', tipo: 'CATEGORIA' }, // id 2
    { nombreCategoria: 'Enterizos', tipo: 'CATEGORIA' } ,// id 3
    { nombreCategoria: 'Top', tipo: 'SUBCATEGORIA', idPadre: 1 },
    { nombreCategoria: 'Straple', tipo: 'SUBCATEGORIA', idPadre: 1 },
    { nombreCategoria: 'Blusa', tipo: 'SUBCATEGORIA', idPadre: 1 },
    { nombreCategoria: 'Basica', tipo: 'SUBCATEGORIA', idPadre: 1 },
    { nombreCategoria: 'Body', tipo: 'SUBCATEGORIA', idPadre: 3 },
    { nombreCategoria: 'Vestidos', tipo: 'SUBCATEGORIA', idPadre: 3 }
 ]

 export default nombresData;