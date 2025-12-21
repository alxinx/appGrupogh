
import path from "path"
export default {
    mode : 'development',
    entry : {
        menu : './src/js/menus.js'
    },
    output : {
        filename : '[name].js',
        path : path.resolve('public/js/')

    }
}