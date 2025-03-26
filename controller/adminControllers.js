const adminLogin = (req, res)=>{
    res.render("./auth/login", {
        pagina: "Login Page"
    })
}

const registerLogin = (req, res)=>{
    res.render("./auth/register", {
        pagina: "Register Page"
    })
    
}

const forgotLogin = (req, res)=>{
    res.render("./auth/forgot", {
        pagina: "Forgot Your Password"
    })
    
}


export {
            adminLogin,registerLogin, forgotLogin
    }