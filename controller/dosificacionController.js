import { Dosificaciones, Pack, DetallesPack, Productos } from '../models/index.js';
import { formatearFecha } from '../helpers/helpers.js';
import db from '../config/bd.js';
import { v4 as uuidv4 } from 'uuid'; // Para generar los códigos de etiqueta únicos
import { Op } from 'sequelize';
import dotenv from "dotenv"

dotenv.config()




//DASHBOARD DOSIDI
const homeDose = async (req, res) => {
    return res.status(201).render('./administrador/dose/homeDose', {
        pagina: "Dosificacion de productos",
        subPagina: "Dosificar Productos",
        csrfToken: req.csrfToken(),
        currentPath: '/dosificaciones',
        subPath: 'dosificaciones',
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
        btnName : "Guardar Dosificación"
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
                const codigo = `D${prefijoDose}-P${correlativo}`;
                
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




const obtenerDosificacionesPaginadas = async (req, res) => {
    try {
        const { query } = req.params;
        
        const { pagina = 1, estado = '' } = req.query;
        const limite = parseInt(process.env.LIMIT_PER_PAGE)
        const offset = (pagina - 1) * limite;

        let whereCondition = {};
        // if (query && query !== 'all') {
        //     const busquedaLimpia = query.startsWith('D') ? query.substring(1) : query;
        //     whereCondition.idDosificacion = { [Op.like]: `${busquedaLimpia}%` };
        // }
        if (query !== 'all') {
            whereCondition.codigo = { [Op.like]: `%${query}%` }; 
        }
       // if (estado) whereCondition.estado = estado.toUpperCase();
       if (estado !== '') {
            whereCondition.estado = estado;
        }
        
        // Solo traemos Dosificación y contamos los Packs (mucho más rápido)
        const { count, rows } = await Dosificaciones.findAndCountAll({
            where: whereCondition,
            include: [{ 
                model: Pack, 
                attributes: ['idPack'] // Solo traemos el ID para contar, nada más
            }],
            limit: limite,
            offset: offset,
            order: [['createdAt', 'DESC']],
            distinct: true
        });

        const dosificaciones = rows.map(d => ({
            id: d.idDosificacion,
            fecha: new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d.createdAt),
            codigo: `D${d.idDosificacion.substring(0, 4).toUpperCase()}`,
            nroPaquetes: (d.PACKs || d.packs || []).length, // Mantenemos el dato de cantidad
            estado: d.estado
        }));

        res.json({ total: count, dosificaciones, paginas: Math.ceil(count / limite) });
    } catch (error) {
        res.status(500).json({ error: 'Error optimizado' });
    }
};





//VISUAL DE LA DOSIFICACION
const verDosificacion = async(req, res)=>{
    const { idDosificacion, codigo } = req.params;
    
    return res.status(201).render('./administrador/dose/ver', {
        pagina: "Dosificacion de productos",
        subPagina: `Ver dosificacion de ${codigo}`,
        idDosificacion,
        codigoDose: codigo, // Lo pasamos específicamente para el widget
        csrfToken: req.csrfToken(),
        currentPath: '/dosificaciones',
        subPath: 'dosificaciones',
    })
}



const verDosificacionDetalle = async (req, res) => {
    try {
        const { idDosificacion } = req.params;
        const dose = await Dosificacion.findByPk(idDosificacion, {
        include: [{
            model: Pack,
            as: 'PACKs',
            include: [{
                model: DetallesPack,
                as: 'DETALLES_PACKs',
                include: [{ model: Producto, as: 'producto' }]
            }]
        }]
    });



       
    } catch (error) {
        res.status(500).send('Error');
    }
};


//formatearFecha

    const obtenerMetadataDose = async (req, res) => {
    try {
        const { id } = req.params;
        
        const dose = await Dosificaciones.findByPk(id, {
            include: [{ 
                model: Pack, 
                as: 'PACKs',
                include: [{ 
                    model: DetallesPack, 
                    as: 'DETALLES_PACKs',
                    include: [{ model: Productos, as: 'producto' }]
                }]
            }]
        });

        const gruposLotes = dose.PACKs.reduce((acc, pack) => {
        const lote = pack.numLote;
        if (!acc[lote]) acc[lote] = [];
                acc[lote].push(pack);
                return acc;
            }, {});
        const totalColumnas = Object.keys(gruposLotes).length;
        const colSpan = totalColumnas > 0 ? Math.floor(12 / Math.min(totalColumnas, 4)) : 12;

        if (!dose) return res.status(404).json({ error: 'No encontrada' });

        // DEBUG: Verifica si aquí los valores vienen en 0 o con datos

        const totalBultos = dose.PACKs ? dose.PACKs.length : 0;

        const totalPrendas = (dose.PACKs || []).reduce((accPack, pack) => {
            const sumaDetalles = (pack.DETALLES_PACKs || []).reduce((accDet, det) => {
                return accDet + (parseInt(det.cantidad) || 0);
            }, 0);
            return accPack + sumaDetalles;
        }, 0);

                const calculoSobrantes = dose.capacidadBolsa > 0 ? (totalPrendas % dose.capacidadBolsa) : 0;


        res.json({
            fechaFormateada: formatearFecha(dose.createdAt),
            // Forzamos la conversión a número por si vienen como String de la DB
            unidadesPorPaquete: Number(dose.capacidadBolsa) || 0,
            sobrantes: Number(calculoSobrantes) || 0,
            totalUnidades: totalPrendas,
            totalBultos: totalBultos 
        });

    } catch (error) {
        console.error("Error Sequelize:", error);
        res.status(500).json({ error: 'Error interno' });
    }
};



const obtenerProductosPorDose = async (req, res) => {
    try {
        const { id } = req.params;
        const dose = await Dosificaciones.findByPk(id, {
            include: [{
                model: Pack,
                // Quitamos el limit para ver todos los bultos
                include: [{
                    model: DetallesPack,
                    include: [{ 
                        model: Productos, 
                        as: 'producto', 
                        attributes: ['nombreProducto'] 
                    }]
                }]
            }]
        });

        if (!dose) return res.status(404).json({ error: 'Dosificación no encontrada' });

        const packs = dose.PACKs || dose.Packs || [];
        
        // Recorremos todos los bultos y todos sus detalles
        const todosLosProductos = packs.flatMap(p => {
            const detalles = p.DETALLES_PACKs || p.DetallesPacks || [];
            return detalles.map(dp => dp.producto ? dp.producto.nombreProducto : null);
        }).filter(n => n !== null); // Limpiamos nulos

        // aqui me aseguro que  el nombre solo salga una vez en el modal (dios bendiga a set)
        const productosUnicos = [...new Set(todosLosProductos)];

        res.json({ productos: productosUnicos });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
}; 




//STATS



const widgetGlobales = async (req, res) => {
    const [totalDose, totalP] = await Promise.all([
        Dosificaciones.count(),
        Pack.count()
    ]);
    // Respuesta plana y directa
    res.json({
        totalDosificaciones: totalDose,
        totalPacks: totalP
    });
};



const nroPacks = async (req, res)=>{
    try {
        const total =  await  Dosificaciones.count();
        res.json({total})

    } catch (error) {
        res.status(500).json({error: 'Error Al Contar'})
    }
}


export { guardarDosificacion,homeDose, verDosificacionDetalle,obtenerMetadataDose,
newDose, obtenerDosificacionesPaginadas,nroPacks,verDosificacion, widgetGlobales, obtenerProductosPorDose };