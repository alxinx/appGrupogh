import { Dosificaciones, Pack, DetallesPack, Productos, Traslados, Usuarios, Stock, DetalleTraslados } from '../models/index.js';
import jwt from "jsonwebtoken";
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
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
        btnName: "Guardar Dosificación"
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
            }); ''

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
const verDosificacion = async (req, res) => {
    try {
        const { idDosificacion, codigo } = req.params;

        const dose = await Dosificaciones.findByPk(idDosificacion, {
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

        if (!dose) {
            return res.redirect('/dosificaciones');
        }

        // Agrupar por numLote
        const gruposLotes = dose.PACKs.reduce((acc, pack) => {
            const lote = pack.numLote;
            if (!acc[lote]) acc[lote] = [];
            acc[lote].push(pack);
            return acc;
        }, {});

        const lotesOrdenados = Object.keys(gruposLotes).sort((a, b) => a - b).map(numLote => {
            const bultos = gruposLotes[numLote];
            const primerPack = bultos[0];
            return {
                numLote,
                esResiduo: primerPack.tipo === 'RESIDUO',
                cantidadBultos: bultos.length,
                detalles: primerPack.DETALLES_PACKs,
                codigoEtiqueta: primerPack.codigoEtiqueta,
                numTipos: primerPack.DETALLES_PACKs.length
            };
        });

        const totalColumnas = lotesOrdenados.length;
        // Si son 3 columnas -> span 4, si 4 -> span 3. Maximo 4 columnas por fila (span 3)
        const colSpan = totalColumnas > 0 ? Math.floor(12 / Math.min(totalColumnas, 4)) : 12;

        return res.status(201).render('./administrador/dose/ver', {
            pagina: "Dosificacion de productos",
            subPagina: `Ver dosificacion de ${codigo}`,
            idDosificacion,
            codigoDose: codigo,
            csrfToken: req.csrfToken(),
            currentPath: '/dosificaciones',
            subPath: 'dosificaciones',
            lotes: lotesOrdenados,
            packs: dose.PACKs, // Lista plana para la tabla de abajo
            colSpan
        });
    } catch (error) {
        console.error("Error al ver dosificación:", error);
        res.status(500).send('Error interno del servidor');
    }
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

        if (!dose) return res.status(404).json({ error: 'No encontrada' });

        const gruposLotes = dose.PACKs.reduce((acc, pack) => {
            const lote = pack.numLote;
            if (!acc[lote]) acc[lote] = [];
            acc[lote].push(pack);
            return acc;
        }, {});

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



const nroPacks = async (req, res) => {
    try {
        const total = await Dosificaciones.count();
        res.json({ total })

    } catch (error) {
        res.status(500).json({ error: 'Error Al Contar' })
    }
}



const trasladarPacks = async (req, res) => {
    const { packs, idDestino } = req.body;
    const token = req.cookies?._token;
    if (!token) return res.status(401).json({ success: false, mensaje: 'Sesión expirada' });

    let usuarioId;
    try {
        const decoded = jwt.verify(token, process.env.APP_PRIVATEKEY);
        // Ajustamos según la estructura que mostraste: decoded.id.id o decoded.id
        usuarioId = decoded.id?.id || decoded.id;
    } catch (error) {
        return res.status(401).json({ success: false, mensaje: 'Token inválido' });
    }
    const t = await db.transaction();


    try {
        // 1. Obtener los packs con sus detalles
        const recordsPacks = await Pack.findAll({
            where: { idPack: packs },
            include: [{
                model: DetallesPack,
                as: 'DETALLES_PACKs',
                include: [{ model: Productos, as: 'producto' }]
            }],
            transaction: t
        });

        // 2. Generar Código de Traslado Único
        const ultimoTraslado = await Traslados.findOne({
            order: [['createdAt', 'DESC']],
            transaction: t
        });
        const nroSiguiente = ultimoTraslado ? parseInt(ultimoTraslado.codigoTraslado.split('-')[1]) + 1 : 1000;
        const nuevoCodigo = `TR-${nroSiguiente}`;

        // 3. Crear el Registro del Traslado (Encabezado)
        // Usamos req.usuario que ya viene inyectado por tu middleware de autenticación


        const traslado = await Traslados.create({
            codigoTraslado: nuevoCodigo,
            idOrigen: 'BODEGA-VIRTUAL', // Tu identificador de bodega virtual
            idDestino: idDestino, // Bodega Norte, El Tesoro, etc.
            idUsuarioDespacha: usuarioId,
            estado: 'EN_TRANSITO' // Cambiamos a EN_TRANSITO para que el destino lo vea
        }, { transaction: t });

        // 4. Procesar cada Pack seleccionado en la tabla
        for (const pack of recordsPacks) {

            // Calculamos el valor del bulto sumando sus detalles
            const valorTotalBulto = pack.DETALLES_PACKs.reduce((acc, det) => {
                const precio = det.producto ? det.producto.precioVentaPublicoFinal : 0;
                return acc + (precio * det.cantidad);
            }, 0);

            // Determinar producto de referencia (el primero que encuentre en el pack)
            //const idProductoRef = pack.DETALLES_PACKs.length > 0 ? pack.DETALLES_PACKs[0].idProducto : null;

            // CREAR REGISTRO EN STOCK (Escenario: El pack entra al inventario del destino)
            // Nota: cantidadExistente es 1 porque es el pack cerrado
            await Stock.create({
                idPuntoVenta: idDestino,
                idPack: pack.idPack,
                idProducto: 0,
                cantidadExistente: 1,
                cantidadOriginal: 1,
                valorUnidad: valorTotalBulto,
                estadoInterno: 'CERRADO'
            }, { transaction: t });

            // Crear el detalle del documento de traslado
            await DetalleTraslados.create({
                idTraslado: traslado.idTraslado,
                idPack: pack.idPack,
                cantidad: 1
            }, { transaction: t });

            // Actualizar estado del Pack a TRASLADADO
            await pack.update({ estado: 'TRASLADADO' }, { transaction: t });
        }

        await t.commit();
        res.json({ success: true, mensaje: 'Traslado exitoso', codigo: nuevoCodigo }); //

    } catch (error) {
        await t.rollback();
        console.error("Error en traslado:", error);
        res.status(500).json({ success: false, mensaje: 'Error interno' });
    }
};

const imprimirEtiquetasLote = async (req, res) => {
    try {
        const { idDosificacion, numLote } = req.params;

        const packs = await Pack.findAll({
            where: {
                idDosificacion,
                numLote
            },
            order: [['codigoEtiqueta', 'ASC']]
        });

        if (!packs || packs.length === 0) {
            return res.status(404).send('No se encontraron paquetes para este lote');
        }

        // Crear PDF - Tamaño 10x5 cm (aprox 283x142 puntos)
        const doc = new PDFDocument({
            size: [283.46, 141.73],
            margins: { top: 10, bottom: 10, left: 10, right: 10 }
        });

        // Configurar pipe a la respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=etiquetas_lote_${numLote}.pdf`);
        doc.pipe(res);

        for (let i = 0; i < packs.length; i++) {
            const pack = packs[i];

            if (i > 0) doc.addPage();

            // Título/Info superior
            doc.fontSize(10).font('Helvetica-Bold').text(`LOTE: ${numLote}`, 10, 15);
            //doc.fontSize(8).font('Helvetica').text(`ID: ${pack.codigoEtiqueta}`, 10, 28);

            try {
                // Generar Código de Barras
                const buffer = await bwipjs.toBuffer({
                    bcid: 'code128',       // Tipo de código
                    text: pack.codigoEtiqueta,    // Texto
                    scale: 3,               // Escala
                    height: 15,              // Altura en mm
                    includetext: true,      // Incluir texto debajo
                    textxalign: 'center',   // Alinear texto al centro
                });

                // Insertar imagen del código de barras
                doc.image(buffer, 10, 45, { width: 263 });
            } catch (err) {
                console.error('Error generando barcode:', err);
                doc.text('Error al generar código de barras', 10, 60);
            }
        }

        doc.end();

    } catch (error) {
        console.error('Error generando PDF etiquetas:', error);
        res.status(500).send('Error interno al generar etiquetas');
    }
};





const imprimirEtiquetasPorPack = async (req, res) => {
    try {
        const { idPack } = req.params;
        
        // 1. Buscamos el pack específico
        const pack = await Pack.findOne({
            where: { idPack },
            attributes: ['codigoEtiqueta', 'numLote']
        });

        if (!pack) {
            return res.status(404).send('No se encontró el paquete solicitado');
        }

        // 2. Configuración del PDF (10x5 cm)
        const doc = new PDFDocument({
            size: [283.46, 141.73], // 10cm x 5cm en puntos postscript
            margins: { top: 5, bottom: 5, left: 10, right: 10 }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=etiqueta_${pack.codigoEtiqueta}.pdf`);
        doc.pipe(res);

        // 3. Diseño de la Etiqueta
        doc.fontSize(10).font('Helvetica-Bold').text(`GRUPO GH - LOTE ${pack.numLote}`, 10, 15, { align: 'center' });
        
        try {
            // Generar Código de Barras dinámico
            const buffer = await bwipjs.toBuffer({
                bcid: 'code128',
                text: pack.codigoEtiqueta,
                scale: 3,
                height: 12, // Altura ajustada para el formato 10x5
                includetext: true,
                textxalign: 'center',
                textsize: 10
            });

            // Insertar Barcode centrado
            doc.image(buffer, 10, 40, { width: 263 });
            
            // Texto adicional de seguridad
            doc.fontSize(7).font('Helvetica').text('Verifique el sello de seguridad antes de recibir.', 10, 115, { align: 'center' });

        } catch (err) {
            console.error('Error generando barcode:', err);
            doc.fontSize(10).text('ERROR BARCODE', 10, 60, { align: 'center' });
        }

        doc.end();

    } catch (error) {
        console.error('Error generando PDF etiquetas:', error);
        res.status(500).send('Error interno al generar etiquetas');
    }
};

export {
    guardarDosificacion, homeDose, verDosificacionDetalle, obtenerMetadataDose,
    newDose, obtenerDosificacionesPaginadas, nroPacks, verDosificacion, widgetGlobales,
    obtenerProductosPorDose, trasladarPacks, imprimirEtiquetasLote, imprimirEtiquetasPorPack
};