const homePage = async (req, res)=>{

    return res.status(201).render('./web/index', {
        pagina: `Pagina`,

        
    })

}

const producto = async (req,res)=>{
    return res.status(201).render('./web/producto', {
        pagina: `Pagina`,

        
    })
}


const listadoProductos = async (req,res)=>{
    return res.status(201).render('./web/colecciones', {
        pagina: `Pagina`,

        
    })
}


export {
    homePage, producto, listadoProductos
}