
const redireccion = (rol)=>{

    console.log(rol)
    if(rol === 'ADMIN'){
        return '/admin'
    }else if(rol === 'STORE'){
        return '/store'

    }else if(rol === 'EMPLOYER'){
        return '/admin'

    }
}

export {
    redireccion
}