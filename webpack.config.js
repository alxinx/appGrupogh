
import path from "path"
export default {
    mode: 'development',
    entry: {
        menu: './src/js/menus.js',
        dataAsync: './src/js/dataAsync.js',
        dropdownBtn: './src/js/dropdownBtn',
        steepForms: './src/js/steepForms.js',
        productDataForm: '/src/js/productDataForm.js',
        productList: '/src/js/productList.js',
        paginador: '/src/js/paginador.js',
        helpers: '/src/js/helpers.js',
        dataStore: '/src/js/dataStore.js',
        dataSupplier: '/src/js/dataSupplier.js',
        supplierList: '/src/js/supplierList.js',
        dataDose : '/src/js/dataDose.js',
        utils : '/src/js/utils.js',
        dosificador : '/src/js/dosificador.js',
        listadoDose : '/src/js/listadoDose.js',
        doseView : '/src/js/doseView.js',
        dataEmployee : '/src/js/dataEmployee.js'
    },
    output: {
        filename: '[name].js',
        path: path.resolve('public/js/')

    }
}