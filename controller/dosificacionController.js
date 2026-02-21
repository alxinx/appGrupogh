import { Dosificaciones, Pack, DetallesPack, Productos } from '../models/index.js';
import db from '../config/bd.js';
import { v4 as uuidv4 } from 'uuid'; // Para generar los códigos de etiqueta únicos







//DASHBOARD DOSIDI
const homeDose = async (req, res) => {
    return res.status(201).render('./administrador/dose/homeDose', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/dosificaciones',
        subPath: 'dosificaciones',
        btnName : "Pre-Calcular"
    })
}

//DASHBOARD DOSIDI
const newDose = async (req, res) => {
    return res.status(201).render('./administrador/dose/new', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/dosificaciones',
        subPath: 'dosificar',
        btnName : "Pre-Calcular"
    })
}










const guardarDosificacion = async (req, res) => {
    // 1. Extraer ID del JWT (Estructura: usuario { id: { id: "..." } })
    const idUsuarioSesion = req.usuario.idUsuario;
    const t = await db.transaction();

    try {
        const { productos, capacidadBolsa } = req.body; // idUsuario ya no viene del body por seguridad

        // 2. Crear el Maestro (Dosificación)
        const totalUnidades = productos.reduce((acc, p) => acc + parseInt(p.cantidad), 0);
        const dosificacion = await Dosificaciones.create({
            capacidadBolsa,
            totalUnidades,
            idUsuario: idUsuarioSesion,
            estado: 'COMPLETADA'
        }, { transaction: t });

        // 3. Ejecutar Algoritmo de Kitting en el Servidor
        const resultadoKitting = ejecutarAlgoritmoKittingBackend(productos, capacidadBolsa);

        // 4. Guardar Packs y Detalles
        // Procesamos los lotes calculados (resultadoKitting.packs)
        let contadorGlobalPacks = 1;
        const prefijoDose = dosificacion.idDosificacion.substring(0, 4).toUpperCase();

        const mapaPrecios = {};
        productos.forEach(p => {
                mapaPrecios[p.idProducto] = p.valorUnidad;
            });
        
        
        for (const [index, grupo] of resultadoKitting.packs.entries()) {
            
            // El contador debe moverse dentro del map para que cada pack sea único
            const packsData = Array.from({ length: grupo.cantidad }).map(() => {
                const correlativo = String(contadorGlobalPacks).padStart(3, '0');
                const codigo = `D${prefijoDose}P${correlativo}`;
                
                contadorGlobalPacks++; // Incrementamos para el siguiente bulto

                return {
                    idDosificacion: dosificacion.idDosificacion,
                    codigoEtiqueta: codigo,
                    numLote: index + 1,
                    tipo: 'ESTANDAR',
                    estado: 'EMPACADO'
                };
            });''

            const packsCreados = await Pack.bulkCreate(packsData, { 
                transaction: t, 
                returning: true 
            });


            

            // Preparar los detalles para este grupo de bultos
            const detallesBulk = [];
            packsCreados.forEach(p => {
                Object.entries(grupo.detalle).forEach(([idProducto, cant]) => {
                    detallesBulk.push({
                        idPack: p.idPack,
                        idProducto: idProducto,
                        cantidad: cant,
                        valorUnidad: mapaPrecios[idProducto] // <--- ASIGNAMOS EL PRECIO AQUÍ
                    });
                });
            });
            await DetallesPack.bulkCreate(detallesBulk, { transaction: t });
                }

        // 5. Manejar el Pack de Residuo (Saldo) si existe
        if (Object.keys(resultadoKitting.residuo).length > 0) {
            const packResiduo = await Pack.create({
                idDosificacion: dosificacion.idDosificacion,
                codigoEtiqueta: `RES-${Date.now()}`,
                numLote: resultadoKitting.packs.length + 1,
                tipo: 'RESIDUO',
                estado: 'EMPACADO'
            }, { transaction: t });

            const detallesResiduo = Object.entries(resultadoKitting.residuo).map(([idProducto, cant]) => ({
                idPack: packResiduo.idPack,
                idProducto: idProducto,
                cantidad: cant
            }));
            await DetallesPack.bulkCreate(detallesResiduo, { transaction: t });
        }

        await t.commit();
        res.json({ mensaje: 'ok', idDosificacion: dosificacion.idDosificacion });

    } catch (error) {
        await t.rollback();
        console.error("Error en Dosificación:", error);
        res.status(500).json({ mensaje: 'error', detalle: error.message });
    }
};

/* ==========================================
   LÓGICA DEL ALGORITMO (Backend Version)
   ========================================== */
function ejecutarAlgoritmoKittingBackend(productosArray, capacidad) {
    // Convertimos el array del body a un objeto de stock para el algoritmo
    let stock = {};
    productosArray.forEach(p => { stock[p.idProducto] = p.cantidad; });

    let totalUnidades = Object.values(stock).reduce((a, b) => a + b, 0);
    let numPacksCompletos = Math.floor(totalUnidades / capacidad);
    let planEmpaque = [];

    for (let i = 0; i < numPacksCompletos; i++) {
        let bolsa = {};
        let totalEnBolsa = 0;
        let stockRestanteBolsa = Object.values(stock).reduce((a, b) => a + b, 0);

        Object.keys(stock).forEach(idProd => {
            let proporcion = stock[idProd] / stockRestanteBolsa;
            let asignacion = Math.floor(proporcion * capacidad);
            asignacion = Math.min(asignacion, stock[idProd]);
            bolsa[idProd] = asignacion;
            totalEnBolsa += asignacion;
            stock[idProd] -= asignacion;
        });

        while (totalEnBolsa < capacidad) {
            let idPrioridad = Object.keys(stock).reduce((a, b) => stock[a] > stock[b] ? a : b);
            if (stock[idPrioridad] > 0) {
                bolsa[idPrioridad]++;
                stock[idPrioridad]--;
                totalEnBolsa++;
            } else break;
        }
        planEmpaque.push(bolsa);
    }

    // Agrupación por configuración para optimizar inserts
    const grupos = {};
    planEmpaque.forEach(p => {
        const key = JSON.stringify(Object.fromEntries(Object.entries(p).sort()));
        grupos[key] = (grupos[key] || 0) + 1;
    });

    return {
        packs: Object.entries(grupos).map(([config, cantidad]) => ({
            cantidad,
            detalle: JSON.parse(config)
        })),
        residuo: Object.fromEntries(Object.entries(stock).filter(([_, v]) => v > 0))
    };
}

export { guardarDosificacion,homeDose,
newDose };