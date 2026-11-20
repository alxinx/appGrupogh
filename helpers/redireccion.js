
const redireccion = (rol)=>{
    if(rol === 'ADMIN'){
        return '/admin'
    }else if(rol === 'STORE'){
        return '/store'

    }else if(rol === 'EMPLOYER'){
        // Bodega trabaja desde el área de tienda; /admin solo admite ADMIN (index.js).
        return '/store'

    }
    return null
}

export {
    redireccion
}