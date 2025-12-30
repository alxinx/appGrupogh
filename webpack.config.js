
import path from "path"
export default {
    mode : 'development',
    entry : {
        menu : './src/js/menus.js',
        dataAsync : './src/js/dataAsync.js',
        dropdownBtn : './src/js/dropdownBtn'
    },
    output : {
        filename : '[name].js',
        path : path.resolve('public/js/')

    }
}