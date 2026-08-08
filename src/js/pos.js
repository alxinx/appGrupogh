import ciiuData from '../json/ciiu.json';

(function () {

    // ─── BLOQUEO DE FACTURACIÓN ───────────────────────────────────────────────
    // Devuelve true y muestra Swal si no se puede facturar; false si puede continuar.
    const bloquearSiSinCaja = () => {
        if (window.__PUEDE_FACTURAR__ === false) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin permiso',
                text: 'No tienes permiso para crear facturas.',
                confirmButtonColor: '#EC5FA3'
            });
            return true;
        }
        if (window.__cajaAbierta !== false) return false;
        Swal.fire({
            icon: 'warning',
            title: window.__CAJAS_PENDIENTES__ ? 'Cajas anteriores sin cerrar' : 'Caja no abierta',
            html: window.__CAJAS_PENDIENTES__
                ? 'Debes cerrar las cajas de días anteriores antes de poder abrir la caja de hoy.<br><br><a href="/store/storebehivors/" style="color:#EC5FA3;font-weight:bold;text-decoration:underline;">Ir a cuadre de caja →</a>'
                : 'Debes abrir la caja antes de registrar una venta.',
            confirmButtonColor: '#EC5FA3'
        });
        return true;
    };

    // ─── BUSCADOR POS ─────────────────────────────────────────────────────────
    const inputCodigo    = document.getElementById('codigo');
    const catalogoPos    = document.getElementById('catalogo-pos');
    const posEscena      = document.getElementById('pos-escena');
    const autoAddToggle  = document.getElementById('auto-add-toggle');
    let   buscarTimer    = null;

    const setEscena = (visible) => {
        if (!posEscena) return;
        if (visible) {
            posEscena.style.opacity  = '1';
            posEscena.style.height   = '';
            posEscena.style.overflow = '';
        } else {
            posEscena.style.opacity  = '0';
            posEscena.style.height   = '0';
            posEscena.style.overflow = 'hidden';
        }
    };

    // Productos actualmente visibles en pantalla (lookup para carrito)
    const productosEnPantalla = new Map();

    // Anima las tarjetas con stagger al aparecer
    const animarTarjetas = () => {
        catalogoPos?.querySelectorAll('.product-card-individual').forEach((card, i) => {
            card.style.opacity   = '0';
            card.style.transform = 'translateY(10px)';
            card.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
            setTimeout(() => {
                card.style.opacity   = '1';
                card.style.transform = 'translateY(0)';
            }, i * 55);
        });
    };

    const renderTarjetaProducto = (p) => {
        const precioM = parseFloat(p.precioVentaMayorista).toLocaleString('es-CO', { maximumFractionDigits: 0 });
        const precioD = parseFloat(p.precioVentaPublicoFinal).toLocaleString('es-CO', { maximumFractionDigits: 0 });
        const modalId = `modal-producto-${p.idProducto}`;
        const sinStock = !p.stock || p.stock <= 0;

        return `
        <div
            id="product-${p.idProducto}"
            class="product-card product-card-individual group cursor-pointer ${sinStock ? 'opacity-50' : ''}"
            data-name="${p.nombreProducto}"
            data-codigo="${p.sku}"
            data-modal-target="${modalId}"
            draggable="${sinStock ? 'false' : 'true'}"
        >
            <div class="relative aspect-[4/5] rounded-[1rem] overflow-hidden mb-4 bg-gray-50 shadow-sm">
                <img
                    src="${p.imagen}"
                    alt="${p.nombreProducto}"
                    class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    loading="lazy"
                    onerror="this.src='/img/image-default.webp'"
                >
                <span class="absolute bottom-4 left-3 px-3 py-1.5 ${sinStock ? 'bg-red-100 text-red-500' : 'bg-white/80 text-gh-primaryHover'} backdrop-blur-sm text-[10px] font-bold uppercase rounded-xl shadow-sm border border-white/20">
                    ${sinStock ? 'Sin stock' : p.stock + ' en stock'}
                </span>
            </div>
            <h3 class="font-bold text-gray-900 truncate px-2 text-sm md:text-base">${p.nombreProducto}</h3>
            <p class="text-xs text-gray-500 mb-4 px-2 flex items-center">
                <i class="fi-rr-rectangle-barcode pr-2 text-slate-400"></i>
                <span class="font-mono">${p.sku}</span>
            </p>
            <div class="flex items-center justify-between px-2 mb-4">
                <div class="flex flex-col">
                    <span class="text-[10px] text-slate-400 font-bold uppercase">X Mayor</span>
                    <span class="font-bold text-lg text-gray-900">$${precioM}</span>
                </div>
                <div class="flex flex-col text-right">
                    <span class="text-[10px] text-slate-400 font-bold uppercase">Al Detal</span>
                    <span class="font-bold text-lg text-gh-primary">$${precioD}</span>
                </div>
            </div>
            <button
                data-id="${p.idProducto}"
                class="btn-agregar-pedido w-full h-11 ${sinStock ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gh-primary/10 text-gh-primary cursor-pointer hover:bg-gh-primary hover:text-white'} rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                ${sinStock ? 'disabled' : ''}
            >
                <i class="fi-rr-add-document"></i>
                <span class="font-bold text-sm">${sinStock ? 'Sin stock' : 'Agregar al pedido'}</span>
            </button>
        </div>`;
    };

    const buscarProductos = async (q) => {
        if (!catalogoPos) return;
        setEscena(false);
        catalogoPos.innerHTML = `
            <div class="col-span-3 flex items-center justify-center py-12 text-gray-400">
                <i class="fi fi-rr-spinner animate-spin text-2xl mr-3"></i>
                Buscando...
            </div>`;
        try {
            const res  = await fetch(`/store/json/pos/buscar?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            if (!data.success) throw new Error();

            if (!data.productos.length) {
                productosEnPantalla.clear();
                catalogoPos.innerHTML = `
                    <div class="col-span-3 flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                        <i class="fi fi-rr-search text-3xl"></i>
                        <span>Sin resultados para "<strong>${q}</strong>"</span>
                    </div>`;
                return;
            }

            productosEnPantalla.clear();
            data.productos.forEach(p => productosEnPantalla.set(p.idProducto, p));

            // Auto-add: 1 resultado con stock + toggle activo → agrega y limpia
            if (data.productos.length === 1 && autoAddToggle?.checked) {
                const unico = data.productos[0];
                if (unico.stock > 0) {
                    addToCart(unico);
                    inputCodigo.value = '';
                    limpiarCatalogo();
                    return;
                }
            }

            catalogoPos.innerHTML = data.productos.map(renderTarjetaProducto).join('');
            setEscena(false);
            animarTarjetas();
            bindDragEnCatalogo();
        } catch {
            catalogoPos.innerHTML = `
                <div class="col-span-3 text-center py-12 text-red-400">Error al buscar productos.</div>`;
        }
    };

    const limpiarCatalogo = () => {
        productosEnPantalla.clear();
        if (catalogoPos) catalogoPos.innerHTML = '';
        setEscena(true);
    };

    if (inputCodigo) {
        // Búsqueda con debounce para escritura manual
        inputCodigo.addEventListener('input', () => {
            clearTimeout(buscarTimer);
            const q = inputCodigo.value.trim();
            if (!q) { limpiarCatalogo(); return; }
            buscarTimer = setTimeout(() => buscarProductos(q), 350);
        });

        // Enter / lector de barras: dispara inmediatamente sin esperar debounce
        inputCodigo.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(buscarTimer);
            const q = inputCodigo.value.trim();
            if (q) buscarProductos(q);
        });
    }


    // ─── CARRITO MANAGER ──────────────────────────────────────────────────────
    // Estado aislado por tab (memoria JS — cada tab tiene su propio contexto)
    const cart = new Map(); // idProducto → item
    let pedidoWebActivo = null; // idPedido de PEDIDOS_WEB que se está despachando en esta orden, si aplica
    // Pago ya cobrado por la pasarela para ese pedido. El cajero no lo digita ni lo puede editar:
    // el backend lo reconstruye desde PAGOS_PEDIDO_WEB al facturar. Acá solo se muestra.
    let pagoWebActivo = null;
    const WHOLESALE_MIN = parseInt(document.getElementById('drop-zone')?.dataset.wholesaleMin) || 6;

    const cartList      = document.getElementById('cart-list');
    const cartCount     = document.getElementById('cart-count');
    const cartBadge     = document.getElementById('cart-modo-badge');
    const dropZone      = document.getElementById('drop-zone');
    const cartScrollHint = document.getElementById('cart-scroll-hint');

    // ── Indicador "más productos abajo" ──────────────────────────────────────
    const actualizarScrollHint = () => {
        if (!cartList || !cartScrollHint) return;
        const hayMas = cartList.scrollHeight - cartList.scrollTop - cartList.clientHeight > 10;
        cartScrollHint.classList.toggle('hidden', !hayMas);
    };

    cartList?.addEventListener('scroll', actualizarScrollHint);

    cartScrollHint?.addEventListener('click', () => {
        cartList?.scrollBy({ top: cartList.clientHeight * 0.6, behavior: 'smooth' });
    });

    const fmt = (n) => Math.round(n).toLocaleString('es-CO');
    const totalQtyEnOrden = () => [...cart.values()].reduce((s, i) => s + i.cantidad, 0);
    const getModo = () => totalQtyEnOrden() >= WHOLESALE_MIN ? 'mayorista' : 'detal';
    const getPrecioItem = (item) => getModo() === 'mayorista' ? item.precioMayorista : item.precioDetal;

    // ── Agregar o incrementar ────────────────────────────────────────────────
    // Un pedido web cargado es inmodificable: el cliente ya pagó una lista concreta de
    // productos. El backend además reconstruye artículos y cliente desde el pedido e ignora
    // lo que mande el POS, así que esto es solo para no dejar al cajero intentarlo en vano.
    let cargandoPedidoWeb = false;

    // Deja el botón de cliente acorde al estado: en un pedido web el cliente ya viene
    // definido por la compra y no se puede tocar.
    const sincronizarBotonCliente = () => {
        const btn = document.getElementById('btn-abrir-modal-cliente');
        if (!btn) return;
        const bloqueado = !!pedidoWebActivo;
        btn.disabled = bloqueado;
        btn.classList.toggle('opacity-40', bloqueado);
        btn.classList.toggle('cursor-not-allowed', bloqueado);
        btn.title = bloqueado ? 'El cliente de un pedido web no se puede cambiar' : '';
    };

    const bloqueadoPorPedidoWeb = (accion = 'modificar esta orden') => {
        if (!pedidoWebActivo || cargandoPedidoWeb) return false;
        window.showToast?.(`No podés ${accion}: es un pedido web ya pagado. Vaciá la orden si necesitás empezar de cero.`, 'warning');
        return true;
    };

    const addToCart = (p, qty = 1) => {
        if (!p?.idProducto || qty < 1) return;

        if (bloquearSiSinCaja()) return;
        if (bloqueadoPorPedidoWeb('agregar productos')) return;

        if (cart.has(p.idProducto)) {
            const item = cart.get(p.idProducto);
            const nueva = Math.min(item.cantidad + qty, item.stock);
            if (nueva === item.cantidad) {
                window.showToast?.(`Stock máximo alcanzado para "${item.nombre}"`, 'warning');
                return;
            }
            item.cantidad = nueva;
        } else {
            if (!p.stock || p.stock <= 0) {
                window.showToast?.(`"${p.nombreProducto}" no tiene stock en tienda`, 'warning');
                return;
            }
            cart.set(p.idProducto, {
                idProducto:      p.idProducto,
                nombre:          p.nombreProducto,
                imagen:          p.imagen,
                sku:             p.sku,
                stock:           parseInt(p.stock) || 0,
                precioMayorista: parseFloat(p.precioVentaMayorista)    || 0,
                precioDetal:     parseFloat(p.precioVentaPublicoFinal) || 0,
                cantidad:        Math.min(qty, parseInt(p.stock) || 1)
            });
        }
        renderCarrito();
    };

    // ── Pedidos web asignados a esta tienda (banner + carga al carrito) ───────
    let pedidosWebPendientesLocal = Array.isArray(window.__PEDIDOS_WEB_PENDIENTES__) ? window.__PEDIDOS_WEB_PENDIENTES__ : [];

    const ETIQUETA_METODO_PAGO = { tarjeta: 'Tarjeta', pse: 'PSE', nequi: 'Nequi', contraentrega: 'Contraentrega' };
    const ETIQUETA_ENTREGA_WEB = { domicilio: 'Domicilio', tienda: 'Punto de venta' };

    const renderPedidosWebBanner = () => {
        const banner = document.getElementById('pedidos-web-banner');
        const lista  = document.getElementById('pedidos-web-lista');
        if (!banner || !lista) return;

        if (!pedidosWebPendientesLocal.length) {
            banner.classList.add('hidden');
            lista.innerHTML = '';
            return;
        }
        banner.classList.remove('hidden');
        lista.innerHTML = pedidosWebPendientesLocal.map(p => `
            <div class="flex items-center gap-4 bg-white rounded-2xl px-4 py-3">
                <div class="w-14 h-14 rounded-full bg-gradient-to-br from-gray-200 to-purple-300 flex items-center justify-center flex-shrink-0 shadow-inner shadow-purple-700">
                    <img src="/img/avatars/pedido.webp" alt="Pedido" class="w-11 h-11 object-contain">
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap mb-1">
                        <h4 class="text-base font-bold text-slate-800">${p.numeroPedido}</h4>
                        <span class="status-chip status-active">${ETIQUETA_METODO_PAGO[p.metodoPago] || p.metodoPago}</span>
                        <span class="status-chip status-pending">${ETIQUETA_ENTREGA_WEB[p.tipoEntrega] || p.tipoEntrega}</span>
                    </div>
                    <div class="flex items-center gap-1.5 text-sm text-gray-500 truncate">
                        <i class="fi fi-rr-user"></i>
                        <span class="truncate">${p.nombreCliente}</span>
                        <span>·</span>
                        <span class="font-bold text-gh-grayText">$${fmt(p.total)}</span>
                    </div>
                </div>
                <button type="button" class="btn-cargar-pedido-web btn btn-primary flex-shrink-0 flex items-center gap-2" data-id="${p.idPedido}">
                    <i class="fi fi-rr-shopping-bag"></i>
                    Cargar en el carrito
                </button>
            </div>`).join('');

        lista.querySelectorAll('.btn-cargar-pedido-web').forEach(btn => {
            btn.addEventListener('click', () => cargarPedidoWebEnCarrito(btn.dataset.id, btn));
        });
    };

    // Intenta emparejar el pedido con un cliente ya registrado (por cédula); si no hay
    // coincidencia, solo muestra el nombre a modo informativo — no se inventa un cliente.
    const vincularClientePedidoWeb = async (data) => {
        const elNombre = document.getElementById('cli-display-nombre');
        const elDoc    = document.getElementById('cli-display-doc');

        if (data.cedula) {
            try {
                const resp = await fetch(`/store/json/clientes/buscar?doc=${encodeURIComponent(data.cedula)}`);
                const encontrado = await resp.json();
                if (encontrado.success && encontrado.cliente) {
                    const cli = encontrado.cliente;
                    const nombreCompleto = cli.razon_social || `${cli.primer_nombre || ''} ${cli.primer_apellido || ''}`.trim();
                    if (inputIdCliente) inputIdCliente.value = cli.idCliente;
                    const idHidden = document.getElementById('cli-id-hidden');
                    if (idHidden) idHidden.value = cli.idCliente;
                    if (elNombre) elNombre.textContent = nombreCompleto || data.nombreCliente;
                    if (elDoc)    elDoc.textContent    = cli.numero_doc || data.cedula;
                    return;
                }
            } catch (_) { /* sigue al fallback informativo */ }
        }

        // Sin coincidencia (o sin cédula) — se factura al cliente genérico, solo se informa el nombre.
        if (elNombre) elNombre.textContent = data.nombreCliente;
        if (elDoc)    elDoc.textContent    = 'Pedido web — sin registrar';
    };

    const cargarPedidoWebEnCarrito = async (idPedido, btn) => {
        if (bloquearSiSinCaja()) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }

        try {
            const res  = await fetch(`/store/json/pedidos-web/${idPedido}/cargar`);
            const data = await res.json();
            if (!data.success) {
                window.showToast?.(data.mensaje || 'No se pudo cargar el pedido.', 'error');
                if (btn) { btn.disabled = false; btn.textContent = 'Cargar en el carrito'; }
                return;
            }

            // La carga inicial sí puede escribir en el carrito; a partir de ahí queda bloqueado.
            cargandoPedidoWeb = true;
            try {
                data.items.forEach(it => addToCart(it, it.cantidadPedida));
                pedidoWebActivo = idPedido;
            } finally {
                cargandoPedidoWeb = false;
            }
            renderCarrito();
            sincronizarBotonCliente();
            pagoWebActivo  = data.pagoWeb || null;

            await vincularClientePedidoWeb(data);

            const elPedidoWebInfo = document.getElementById('cli-pedido-web-info');
            if (elPedidoWebInfo) {
                elPedidoWebInfo.textContent = `Pedido ${data.numeroPedido} · Pagado con ${ETIQUETA_METODO_PAGO[data.metodoPago] || data.metodoPago}`;
                elPedidoWebInfo.classList.remove('hidden');
            }

            pedidosWebPendientesLocal = pedidosWebPendientesLocal.filter(p => p.idPedido !== idPedido);
            renderPedidosWebBanner();

            window.showToast?.(`Pedido ${data.numeroPedido} cargado en el carrito.`, 'success');
        } catch (e) {
            console.error('cargarPedidoWebEnCarrito:', e);
            window.showToast?.('Error de conexión al cargar el pedido.', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Cargar en el carrito'; }
        }
    };

    renderPedidosWebBanner();

    // Llegada desde /store/pedidos-web con "Cargar en el carrito" → carga automática al entrar.
    const idPedidoWebDesdeUrl = new URLSearchParams(window.location.search).get('cargarPedido');
    if (idPedidoWebDesdeUrl) {
        cargarPedidoWebEnCarrito(idPedidoWebDesdeUrl);
        const url = new URL(window.location.href);
        url.searchParams.delete('cargarPedido');
        window.history.replaceState({}, '', url);
    }

    window.__recargarPedidosWebPendientes = async () => {
        try {
            const res  = await fetch('/store/json/pedidos-web/pendientes');
            const data = await res.json();
            if (data.success) {
                pedidosWebPendientesLocal = data.pedidos;
                renderPedidosWebBanner();
            }
        } catch (_) {}
    };

    // ── Actualizar cantidad (+ o -) ──────────────────────────────────────────
    const updateQty = async (idProducto, delta) => {
        if (!cart.has(idProducto)) return;
        if (bloqueadoPorPedidoWeb('cambiar las cantidades')) return;
        const item = cart.get(idProducto);
        const nueva = item.cantidad + delta;

        if (delta > 0 && nueva > item.stock) {
            window.showToast?.(`Stock máximo: ${item.stock} unidades`, 'warning');
            return;
        }

        if (nueva <= 0) {
            const { isConfirmed } = await Swal.fire({
                title: '¿Eliminar producto?',
                html: `¿Quitar <strong>${item.nombre}</strong> de la orden?`,
                icon: 'question',
                showCancelButton:  true,
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText:  'Cancelar',
                confirmButtonColor: '#EC5FA3'
            });
            if (isConfirmed) { cart.delete(idProducto); renderCarrito(); }
            return;
        }

        item.cantidad = nueva;
        renderCarrito();
    };

    // ── Eliminar directo ─────────────────────────────────────────────────────
    const removeFromCart = (idProducto) => {
        if (bloqueadoPorPedidoWeb('quitar productos')) return;
        cart.delete(idProducto);
        renderCarrito();
    };

    // ── HTML de un item del carrito ──────────────────────────────────────────
    const renderItemCarrito = (item) => {
        const precio = getPrecioItem(item);
        const total  = precio * item.cantidad;
        const atMax  = item.cantidad >= item.stock;
        // Sin controles cuando es un pedido web: mostrar botones que no hacen nada
        // confunde más que ayudar. Se ve la cantidad, y ya.
        const bloqueado = !!pedidoWebActivo;

        const controlesCantidad = bloqueado
            ? `<span class="text-xs font-black text-gh-grayText bg-gray-100/50 rounded-xl px-3 py-1.5 border border-gray-100">
                   ${item.cantidad} und.
               </span>`
            : `<div class="flex items-center gap-3 bg-gray-100/50 rounded-xl px-2.5 py-1.5 border border-gray-100">
                    <button class="btn-qty-minus text-gray-400 hover:text-gh-primary flex items-center transition-transform active:scale-90 cursor-pointer"
                            data-id="${item.idProducto}">
                        <i class="fi-rr-minus-small"></i>
                    </button>
                    <span class="text-xs font-black w-5 text-center qty-display text-gh-grayText">${item.cantidad}</span>
                    <button class="btn-qty-plus flex items-center transition-transform active:scale-90 ${atMax ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-gh-primary cursor-pointer'}"
                            data-id="${item.idProducto}" ${atMax ? 'disabled' : ''}>
                        <i class="fi-rr-plus-small"></i>
                    </button>
               </div>`;

        const botonEliminar = bloqueado
            ? `<span class="text-gray-300 p-1 flex-shrink-0" title="Un pedido web no se puede modificar">
                   <i class="fi-rr-lock text-sm"></i>
               </span>`
            : `<button class="btn-remove-item text-gray-400 cursor-pointer hover:text-red-500 transition-colors p-1 flex-shrink-0"
                       data-id="${item.idProducto}" title="Eliminar">
                    <i class="fi-rr-trash-xmark text-lg"></i>
               </button>`;

        return `
        <div class="flex gap-4 p-2 bg-white rounded-[0.5rem] group border border-white/60 transition-all shadow-sm hover:shadow-md"
             id="cart-item-${item.idProducto}" data-id="${item.idProducto}">
            <img src="${item.imagen}" alt="${item.nombre}"
                 class="w-20 h-20 rounded-2xl object-cover shadow-sm flex-shrink-0"
                 onerror="this.src='/img/image-default.webp'">
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start gap-1">
                    <div class="min-w-0">
                        <h4 class="text-sm font-bold text-gray-900 leading-tight truncate">${item.nombre}</h4>
                        <p class="text-[10px] text-gray-500 font-medium mt-1 uppercase tracking-wider">SKU: ${item.sku}</p>
                    </div>
                    ${botonEliminar}
                </div>
                <div class="flex items-center justify-between mt-4">
                    ${controlesCantidad}
                    <div class="text-right">
                        <p class="text-[10px] text-gray-400 font-medium leading-none mb-1">Unid: $${fmt(precio)}</p>
                        <p class="font-bold text-base text-gh-grayText leading-none">$${fmt(total)}</p>
                    </div>
                </div>
            </div>
        </div>`;
    };

    // ── Re-render completo del carrito ───────────────────────────────────────
    const renderCarrito = () => {
        const items    = [...cart.values()];
        const totalQty = totalQtyEnOrden();
        const modo     = getModo();

        // Header: conteo + badge mayorista
        if (cartCount) cartCount.textContent = `${totalQty} item${totalQty !== 1 ? 's' : ''} seleccionados`;
        if (cartBadge) {
            if (modo === 'mayorista') {
                cartBadge.textContent = '· Precio mayorista';
                cartBadge.className = 'text-[9px] font-bold bg-gh-primary text-white px-2 py-0.5 rounded-full uppercase ml-1';
            } else {
                cartBadge.className = 'hidden';
            }
        }

        if (!cartList) return;

        if (!items.length) {
            cartList.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full py-10 gap-3">
                    <img src="/img/avatars/sadBag.webp" alt="Carrito vacío" class="sad-bag-sigh w-24 h-24 object-contain opacity-70">
                    <p class="text-sm font-medium text-gray-400">La orden está vacía</p>
                </div>`;
            renderResumen(0);
            return;
        }

        cartList.innerHTML = [...items].reverse().map(renderItemCarrito).join('');

        // Bind eventos (después del render)
        cartList.querySelectorAll('.btn-qty-minus').forEach(btn =>
            btn.addEventListener('click', () => updateQty(btn.dataset.id, -1))
        );
        cartList.querySelectorAll('.btn-qty-plus').forEach(btn =>
            btn.addEventListener('click', () => { if (!btn.disabled) updateQty(btn.dataset.id, 1); })
        );
        cartList.querySelectorAll('.btn-remove-item').forEach(btn =>
            btn.addEventListener('click', () => removeFromCart(btn.dataset.id))
        );

        // Resumen
        const subtotal = items.reduce((s, i) => s + getPrecioItem(i) * i.cantidad, 0);
        renderResumen(subtotal);

        actualizarScrollHint();
    };

    const renderResumen = (subtotal) => {
        const elSub   = document.getElementById('res-subtotal');
        const elTotal = document.getElementById('res-total');
        if (elSub)   elSub.textContent   = `$${fmt(subtotal)}`;
        if (elTotal) elTotal.textContent = `$${fmt(subtotal)}`;
    };

    // ── Limpiar orden ────────────────────────────────────────────────────────
    document.getElementById('btn-clear-cart')?.addEventListener('click', async () => {
        if (!cart.size) return;
        const { isConfirmed } = await Swal.fire({
            title: '¿Limpiar orden?',
            text: 'Se eliminarán todos los productos de la orden.',
            icon: 'warning',
            showCancelButton:  true,
            confirmButtonText: 'Sí, limpiar',
            cancelButtonText:  'Cancelar',
            confirmButtonColor: '#EC5FA3'
        });
        if (isConfirmed) {
            cart.clear(); pedidoWebActivo = null; pagoWebActivo = null;
            renderCarrito(); sincronizarBotonCliente();
        }
    });

    // ── Agregar desde catálogo (click en botón) ──────────────────────────────
    catalogoPos?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-agregar-pedido');
        if (!btn || btn.disabled) return;
        const p = productosEnPantalla.get(btn.dataset.id);
        if (p) addToCart(p);
    });

    // ── Drag & Drop (mouse + touch) ──────────────────────────────────────────
    const _dropHighlight = (on) => {
        dropZone?.classList.toggle('ring-2',             on);
        dropZone?.classList.toggle('ring-gh-primary/40', on);
        dropZone?.classList.toggle('ring-inset',         on);
    };

    const _sobreDropZone = (clientX, clientY) => {
        const r = dropZone?.getBoundingClientRect();
        return r && clientX >= r.left && clientX <= r.right &&
                    clientY >= r.top  && clientY <= r.bottom;
    };

    const bindDragEnCatalogo = () => {
        catalogoPos?.querySelectorAll('.product-card-individual[draggable="true"]').forEach(card => {

            // ── Eventos mouse (desktop) ──────────────────────────────────────
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', card.id.replace('product-', ''));
                e.dataTransfer.effectAllowed = 'copy';
                card.classList.add('opacity-50', 'scale-95');
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('opacity-50', 'scale-95');
            });

            // ── Eventos touch (móvil / tablet) ───────────────────────────────
            let ghost     = null;
            let dragging  = false;
            let cardRect  = null;
            let t0x = 0, t0y = 0;

            const touchCleanup = () => {
                ghost?.remove(); ghost = null;
                dragging = false; cardRect = null;
                card.classList.remove('opacity-50', 'scale-95');
                _dropHighlight(false);
            };

            card.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                t0x = t.clientX; t0y = t.clientY;
            }, { passive: true });

            card.addEventListener('touchmove', (e) => {
                const t = e.touches[0];

                // Iniciar drag solo tras superar el umbral de movimiento (10 px)
                if (!dragging) {
                    if (Math.hypot(t.clientX - t0x, t.clientY - t0y) < 10) return;
                    dragging = true;
                    cardRect = card.getBoundingClientRect();
                    ghost    = card.cloneNode(true);
                    ghost.style.cssText = [
                        'position:fixed',
                        `width:${cardRect.width}px`,
                        `top:${t.clientY - cardRect.height / 2}px`,
                        `left:${t.clientX - cardRect.width  / 2}px`,
                        'opacity:.75', 'pointer-events:none', 'z-index:9999',
                        'transform:scale(.92)', 'border-radius:1rem',
                        'box-shadow:0 8px 30px rgba(0,0,0,.2)', 'transition:none'
                    ].join(';');
                    document.body.appendChild(ghost);
                    card.classList.add('opacity-50', 'scale-95');
                }

                e.preventDefault();
                ghost.style.top  = `${t.clientY - cardRect.height / 2}px`;
                ghost.style.left = `${t.clientX - cardRect.width  / 2}px`;
                _dropHighlight(_sobreDropZone(t.clientX, t.clientY));
            }, { passive: false });

            card.addEventListener('touchend', (e) => {
                if (!dragging) return;
                const t    = e.changedTouches[0];
                const over = _sobreDropZone(t.clientX, t.clientY);
                touchCleanup();
                if (over) {
                    const p = productosEnPantalla.get(card.id.replace('product-', ''));
                    if (p) addToCart(p);
                }
            }, { passive: true });

            card.addEventListener('touchcancel', touchCleanup, { passive: true });
        });
    };

    // Eventos drop para mouse (el touch los maneja en touchend)
    dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        _dropHighlight(true);
    });
    dropZone?.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) _dropHighlight(false);
    });
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        _dropHighlight(false);
        const p = productosEnPantalla.get(e.dataTransfer.getData('text/plain'));
        if (p) addToCart(p);
    });

    // Render inicial (carrito vacío)
    renderCarrito();


    // ─── MODAL CLIENTE ────────────────────────────────────────────────────────
    const modalCliente    = document.getElementById('modal-cliente');
    const inputIdCliente  = document.getElementById('idCliente');
    const btnAbrirCliente = document.getElementById('btn-abrir-modal-cliente');

    // Snapshot del cliente genérico (render inicial) para poder volver a él tras cada venta
    const CLIENTE_GENERICO = {
        idCliente: inputIdCliente?.value || '0',
        nombre:    document.getElementById('cli-display-nombre')?.textContent?.trim() || 'Cliente Genérico',
        doc:       document.getElementById('cli-display-doc')?.textContent?.trim()    || ''
    };

    // ── Abrir / cerrar ────────────────────────────────────────────────────────
    const abrirModalCliente = () => {
        if (bloqueadoPorPedidoWeb('cambiar el cliente')) return;
        if (!modalCliente) return;
        const h = document.getElementById('cli-id-hidden');
        if (h) h.value = inputIdCliente?.value || '0';
        modalCliente.classList.remove('hidden');
        modalCliente.classList.add('flex');
        modalCliente.querySelector('.bg-white')?.animate([
            { transform: 'scale(0.96)', opacity: 0 },
            { transform: 'scale(1)',    opacity: 1 }
        ], { duration: 180, easing: 'ease-out' });
    };

    const cerrarModalCliente = () => {
        modalCliente?.classList.add('hidden');
        modalCliente?.classList.remove('flex');
    };

    btnAbrirCliente?.addEventListener('click', abrirModalCliente);
    modalCliente?.addEventListener('click', (e) => { if (e.target === modalCliente) cerrarModalCliente(); });
    modalCliente?.querySelectorAll('.btn-cerrar-modal-cliente').forEach(b => b.addEventListener('click', cerrarModalCliente));

    // ── Pestañas ──────────────────────────────────────────────────────────────
    const TAB_ACTIVE   = ['bg-gh-primary/10', 'text-gh-primary'];
    const TAB_INACTIVE = ['text-gray-400'];

    let tabActivo = 'natural'; // 'natural' | 'empresa'

    const TIPOS_EMPRESA  = new Set(['CC', 'NIT']);
    const TODOS_LOS_TIPOS = ['CC', 'CE', 'TI', 'NIT', 'PP', 'DE'];

    const filtrarTipoDoc = (tab) => {
        const sel = document.getElementById('cli-tipo-doc');
        if (!sel) return;
        if (tab === 'empresa') {
            sel.querySelectorAll('option').forEach(o => {
                o.hidden = !TIPOS_EMPRESA.has(o.value);
            });
            if (!TIPOS_EMPRESA.has(sel.value)) sel.value = 'NIT';
        } else {
            sel.querySelectorAll('option').forEach(o => { o.hidden = false; });
        }
    };

    const switchTab = (tab) => {
        tabActivo = tab;
        ['natural', 'empresa'].forEach(t => {
            const btn = document.getElementById(`tab-btn-${t}`);
            if (!btn) return;
            const esActivo = t === tab;
            TAB_ACTIVE.forEach(c  => btn.classList.toggle(c, esActivo));
            TAB_INACTIVE.forEach(c => btn.classList.toggle(c, !esActivo));
            modalCliente?.querySelectorAll(`.tab-${t}-content`).forEach(el => {
                el.classList.toggle('hidden', !esActivo);
            });
        });
        filtrarTipoDoc(tab);
        actualizarHeaderModal();
    };

    document.getElementById('tab-btn-natural')?.addEventListener('click', () => switchTab('natural'));
    document.getElementById('tab-btn-empresa')?.addEventListener('click', () => switchTab('empresa'));

    // ── Preview en tiempo real del encabezado del modal ───────────────────────
    const actualizarHeaderModal = () => {
        const elNombre     = document.getElementById('cli-modal-nombre');
        const elDocDisplay = document.getElementById('cli-modal-doc-display');
        if (!elNombre || !elDocDisplay) return;

        const tipoDoc = document.getElementById('cli-tipo-doc')?.value || '';
        const numDoc  = document.getElementById('cli-numero-doc')?.value?.trim() || '';

        if (tabActivo === 'empresa') {
            const razon = document.getElementById('cli-razon-social')?.value?.trim();
            elNombre.textContent = razon || 'Empresa';
        } else {
            const pn = document.getElementById('cli-primer-nombre')?.value?.trim()    || '';
            const pa = document.getElementById('cli-primer-apellido')?.value?.trim()  || '';
            elNombre.textContent = [pn, pa].filter(Boolean).join(' ') || 'Nuevo cliente';
        }

        elDocDisplay.textContent = numDoc ? `${tipoDoc} ${numDoc}` : 'Completa el formulario';
    };

    ['cli-primer-nombre', 'cli-primer-apellido', 'cli-razon-social'].forEach(id =>
        document.getElementById(id)?.addEventListener('input', actualizarHeaderModal)
    );
    document.getElementById('cli-numero-doc')?.addEventListener('input', (e) => {
        const el = e.target;
        const pos = el.selectionStart - (el.value.length - el.value.replace(/\s/g, '').length);
        el.value = el.value.replace(/\s/g, '');
        el.setSelectionRange(pos, pos);
        actualizarHeaderModal();
    });
    document.getElementById('cli-tipo-doc')?.addEventListener('change',   actualizarHeaderModal);

    // ── Cascade departamento → municipios ─────────────────────────────────────
    const cargarMunicipios = async (deptoId, selectedId = '') => {
        const sel = document.getElementById('cli-municipio');
        if (!sel || !deptoId) return;
        sel.innerHTML = '<option>Cargando...</option>';
        try {
            const resp = await fetch(`/store/json/municipios/${deptoId}`);
            const data = await resp.json();
            sel.innerHTML = '<option value="">Seleccionar...</option>' +
                data.map(m => `<option value="${m.id}"${m.id === selectedId ? ' selected' : ''}>${m.nombre}</option>`).join('');
        } catch {
            sel.innerHTML = '<option value="">Error al cargar</option>';
        }
    };

    document.getElementById('cli-departamento')?.addEventListener('change', (e) => {
        if (e.target.value) cargarMunicipios(e.target.value);
        else {
            const sel = document.getElementById('cli-municipio');
            if (sel) sel.innerHTML = '<option value="">— selecciona un departamento —</option>';
        }
    });

    // ── Autocomplete CIIU ─────────────────────────────────────────────────────
    const ciiuMap = new Map(ciiuData.map(c => [c.codigo, c.descripcion]));

    document.getElementById('cli-ciiu')?.addEventListener('input', (e) => {
        const codigo = e.target.value.trim();
        const descEl = document.getElementById('cli-desc-ciiu');
        if (!descEl) return;
        const desc = ciiuMap.get(codigo);
        if (desc) {
            descEl.value = desc;
            descEl.classList.add('text-gh-primary');
        } else {
            if (descEl.value === (ciiuMap.get(codigo) ?? '')) descEl.value = '';
            descEl.classList.remove('text-gh-primary');
        }
    });

    // ── Espacio en primer nombre salta a segundo nombre ──────────────────────
    document.getElementById('cli-primer-nombre')?.addEventListener('keydown', (e) => {
        if (e.key !== ' ') return;
        e.preventDefault();
        document.getElementById('cli-segundo-nombre')?.focus();
    });

    // ── Nombre archivo RUT ────────────────────────────────────────────────────
    document.getElementById('cli-rut-file')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        const el   = document.getElementById('cli-rut-nombre');
        if (!el) return;
        if (file) { el.textContent = file.name; el.classList.remove('hidden'); }
        else       { el.classList.add('hidden'); }
    });

    // ── Llenar formulario cuando se encuentra cliente ─────────────────────────
    const llenarFormCliente = (cli) => {
        const fill = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

        fill('cli-tipo-doc',   cli.tipo_documento);
        fill('cli-numero-doc', cli.numero_doc);

        const esEmpresa = cli.tipo_persona === 'J' || cli.tipo_documento === 'NIT';
        switchTab(esEmpresa ? 'empresa' : 'natural');

        if (esEmpresa) {
            fill('cli-razon-social', cli.razon_social);
            fill('cli-digito-verif', cli.digito_verif);
            fill('cli-email-e',      cli.email);
            fill('cli-telefono-e',   cli.telefono);
            const trib = cli.tributario?.[0];
            if (trib) {
                fill('cli-regimen',   trib.regimen_fiscal);
                fill('cli-ciiu',      trib.ciiu);
                fill('cli-desc-ciiu', trib.descripcion_ciiu);
                fill('cli-fecha-rut', trib.fecha_rut);
                ['gran_contribuyente','autorretenedor','agente_retencion','obligado_aduanero'].forEach(n => {
                    const el = modalCliente?.querySelector(`[name="${n}"]`);
                    if (el) el.checked = !!trib[n];
                });
            }
        } else {
            fill('cli-primer-nombre',    cli.primer_nombre);
            fill('cli-segundo-nombre',   cli.segundo_nombre);
            fill('cli-primer-apellido',  cli.primer_apellido);
            fill('cli-segundo-apellido', cli.segundo_apellido);
            fill('cli-email-n',    cli.email);
            fill('cli-telefono-n', cli.telefono);
        }

        const ub = cli.ubicaciones?.[0];
        if (ub) {
            const deptoSel = document.getElementById('cli-departamento');
            if (deptoSel) deptoSel.value = ub.idDepartamento || '';
            if (ub.idDepartamento) cargarMunicipios(ub.idDepartamento, ub.idMunicipio);
            fill('cli-direccion', ub.direccion);
        }

        const h = document.getElementById('cli-id-hidden');
        if (h) h.value = cli.idCliente;

        actualizarHeaderModal();
    };

    // ── Volver al cliente genérico (tras finalizar una venta) ─────────────────
    const resetCliente = () => {
        if (inputIdCliente) inputIdCliente.value = CLIENTE_GENERICO.idCliente;
        const elNombre = document.getElementById('cli-display-nombre');
        const elDoc    = document.getElementById('cli-display-doc');
        if (elNombre) elNombre.textContent = CLIENTE_GENERICO.nombre;
        if (elDoc)    elDoc.textContent    = CLIENTE_GENERICO.doc;
        const elPedidoWebInfo = document.getElementById('cli-pedido-web-info');
        if (elPedidoWebInfo) { elPedidoWebInfo.textContent = ''; elPedidoWebInfo.classList.add('hidden'); }

        const idHidden = document.getElementById('cli-id-hidden');
        if (idHidden) idHidden.value = CLIENTE_GENERICO.idCliente;

        ['cli-numero-doc', 'cli-primer-nombre', 'cli-segundo-nombre', 'cli-primer-apellido', 'cli-segundo-apellido',
         'cli-email-n', 'cli-telefono-n', 'cli-razon-social', 'cli-digito-verif', 'cli-email-e', 'cli-telefono-e',
         'cli-regimen', 'cli-ciiu', 'cli-desc-ciiu', 'cli-fecha-rut', 'cli-direccion'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const tipoDocSel = document.getElementById('cli-tipo-doc');
        if (tipoDocSel) tipoDocSel.value = 'CC';

        const deptoSel = document.getElementById('cli-departamento');
        if (deptoSel) deptoSel.value = '';
        const munSel = document.getElementById('cli-municipio');
        if (munSel) munSel.innerHTML = '<option value="">Seleccionar...</option>';

        modalCliente?.querySelectorAll('[name="gran_contribuyente"], [name="autorretenedor"], [name="agente_retencion"], [name="obligado_aduanero"]')
            .forEach(el => { el.checked = false; });

        const rutFile = document.getElementById('cli-rut-file');
        if (rutFile) rutFile.value = '';
        document.getElementById('cli-rut-nombre')?.classList.add('hidden');

        switchTab('natural');
    };

    // ── Búsqueda async por documento ─────────────────────────────────────────
    let docTimer = null;
    const inputNumDoc = document.getElementById('cli-numero-doc');
    const docLoader   = document.getElementById('cli-doc-loader');

    inputNumDoc?.addEventListener('input', () => {
        clearTimeout(docTimer);
        const val = inputNumDoc.value.trim();
        if (val.length < 5) return;
        docLoader?.classList.remove('hidden');
        docTimer = setTimeout(async () => {
            try {
                const resp = await fetch(`/store/json/clientes/buscar?doc=${encodeURIComponent(val)}`);
                const data = await resp.json();
                if (data.success && data.cliente) {
                    llenarFormCliente(data.cliente);
                    window.showToast?.('Cliente encontrado — datos cargados', 'success');
                }
            } catch { /* silencioso */ }
            finally { docLoader?.classList.add('hidden'); }
        }, 500);
    });

    // ── Guardar cliente ───────────────────────────────────────────────────────
    document.getElementById('btn-guardar-cliente')?.addEventListener('click', async () => {
        const csrf         = document.querySelector('meta[name="csrf-token"]')?.content || '';
        const idCliModal   = document.getElementById('cli-id-hidden')?.value || inputIdCliente?.value || '0';
        const esEmpresa    = tabActivo === 'empresa';
        const getVal       = (id) => document.getElementById(id)?.value?.trim() || '';
        const getChk       = (name) => (modalCliente?.querySelector(`[name="${name}"]`)?.checked ? 'true' : 'false');

        const numerDoc = getVal('cli-numero-doc');
        if (!numerDoc) { window.showToast?.('El número de documento es requerido', 'warning'); return; }

        const fd = new FormData();
        fd.append('idCliente',      idCliModal);
        fd.append('tipo_persona',   esEmpresa ? 'J' : 'N');
        fd.append('tipo_documento', getVal('cli-tipo-doc'));
        fd.append('numero_doc',     numerDoc);

        if (esEmpresa) {
            fd.append('razon_social',     getVal('cli-razon-social'));
            fd.append('digito_verif',     getVal('cli-digito-verif'));
            fd.append('email',            getVal('cli-email-e'));
            fd.append('telefono',         getVal('cli-telefono-e'));
            fd.append('regimen_fiscal',   getVal('cli-regimen'));
            fd.append('ciiu',             getVal('cli-ciiu'));
            fd.append('descripcion_ciiu', getVal('cli-desc-ciiu'));
            fd.append('fecha_rut',        getVal('cli-fecha-rut'));
            fd.append('gran_contribuyente', getChk('gran_contribuyente'));
            fd.append('autorretenedor',     getChk('autorretenedor'));
            fd.append('agente_retencion',   getChk('agente_retencion'));
            fd.append('obligado_aduanero',  getChk('obligado_aduanero'));
        } else {
            fd.append('primer_nombre',    getVal('cli-primer-nombre'));
            fd.append('segundo_nombre',   getVal('cli-segundo-nombre'));
            fd.append('primer_apellido',  getVal('cli-primer-apellido'));
            fd.append('segundo_apellido', getVal('cli-segundo-apellido'));
            fd.append('email',    getVal('cli-email-n'));
            fd.append('telefono', getVal('cli-telefono-n'));
        }

        const deptoSel = document.getElementById('cli-departamento');
        const munSel   = document.getElementById('cli-municipio');
        fd.append('idDepartamento',     deptoSel?.value || '');
        fd.append('nombreDepartamento', deptoSel?.options[deptoSel?.selectedIndex]?.text || '');
        fd.append('idMunicipio',        munSel?.value  || '');
        fd.append('nombreMunicipio',    munSel?.options[munSel?.selectedIndex]?.text || '');
        fd.append('direccion',          getVal('cli-direccion'));

        const rutFile = document.getElementById('cli-rut-file')?.files?.[0];
        if (rutFile) fd.append('rut', rutFile);

        const btn = document.getElementById('btn-guardar-cliente');
        btn.disabled = true;
        const txtOrig = btn.textContent;
        btn.textContent = 'Guardando...';

        try {
            const resp = await fetch('/store/clientes/guardar', {
                method:  'POST',
                headers: { 'X-CSRF-Token': csrf },
                body:    fd
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.mensaje || 'Error al guardar');

            if (inputIdCliente) inputIdCliente.value = data.idCliente;
            const elNombre = document.getElementById('cli-display-nombre');
            const elDoc    = document.getElementById('cli-display-doc');
            if (elNombre) elNombre.textContent = data.nombre;
            if (elDoc)    elDoc.textContent    = data.documento;

            window.showToast?.('Cliente guardado correctamente', 'success');
            cerrarModalCliente();
        } catch (err) {
            window.showToast?.(err.message || 'Error al guardar el cliente', 'error');
        } finally {
            btn.disabled    = false;
            btn.textContent = txtOrig;
        }
    });


    // ─── MODAL DETALLE PRODUCTO ───────────────────────────────────────────────
    {
        const modal         = document.getElementById('modal-detalle-producto');
        const mainImg       = document.getElementById('mdp-main-image');
        const elNombre      = document.getElementById('mdp-nombre');
        const elDesc        = document.getElementById('mdp-descripcion');
        const elTallas      = document.getElementById('mdp-tallas');
        const elColores     = document.getElementById('mdp-colores');
        const elMayor       = document.getElementById('mdp-precio-mayor');
        const elDetal       = document.getElementById('mdp-precio-detal');
        const elStockBadge  = document.getElementById('mdp-stock-badge');
        const elStockIcon   = document.getElementById('mdp-stock-icon');
        const elStockTexto  = document.getElementById('mdp-stock-texto');
        const elTiendas     = document.getElementById('mdp-tiendas');
        const qtyInput      = document.getElementById('mdp-qty');
        const btnQtyMinus   = document.getElementById('mdp-qty-minus');
        const btnQtyPlus    = document.getElementById('mdp-qty-plus');
        const btnAgregar    = document.getElementById('mdp-btn-agregar');
        const btnTrasladar  = document.getElementById('mdp-btn-trasladar');

        let mdpImagenes       = [];
        let mdpIdx            = 0;
        let mdpProductoActual = null;
        let mdpStockLocal     = 0;

        const tipoIcono = { 'Punto de venta': 'fi-rr-shop', 'Bodega': 'fi-rr-box', 'Transito': 'fi-rr-truck', 'web': 'fi-rr-globe' };

        const setQty = (v) => {
            const val = Math.max(1, Math.min(v, mdpStockLocal || 1));
            qtyInput.value = val;
        };

        const actualizarEstadoStock = (stockLocal) => {
            mdpStockLocal = stockLocal;
            const haStock = stockLocal > 0;

            if (haStock) {
                elStockBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold mb-4 bg-green-50 text-green-700';
                elStockIcon.className  = 'fi fi-rr-check-circle text-base';
                elStockTexto.textContent = `${stockLocal} unidad${stockLocal === 1 ? '' : 'es'} disponible${stockLocal === 1 ? '' : 's'} en esta tienda`;
            } else {
                elStockBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold mb-4 bg-red-50 text-red-500';
                elStockIcon.className  = 'fi fi-rr-cross-circle text-base';
                elStockTexto.textContent = 'Sin existencias en esta tienda';
            }

            qtyInput.max        = stockLocal;
            qtyInput.disabled   = !haStock;
            btnQtyMinus.disabled  = !haStock;
            btnQtyPlus.disabled   = !haStock;
            btnAgregar.disabled   = !haStock;
            btnTrasladar.disabled = !haStock;
            setQty(1);
        };

        const mostrarImagen = (i) => {
            mdpIdx = i;
            mainImg.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: 'ease-in-out' });
            mainImg.src = mdpImagenes[mdpIdx];
        };

        const cerrar = () => {
            modal?.classList.add('hidden');
            modal?.classList.remove('flex');
            mdpProductoActual = null;
        };

        const abrir = async (idProducto) => {
            if (!modal) return;

            // Datos básicos inmediatos desde productosEnPantalla
            const basico = productosEnPantalla.get(idProducto);
            if (basico) {
                elNombre.textContent = basico.nombreProducto;
                elDesc.textContent   = '';
                elTallas.innerHTML   = '';
                elColores.innerHTML  = '';
                elTiendas.innerHTML  = '<p class="text-xs text-slate-400 italic">Cargando...</p>';
                elMayor.textContent  = `$${parseFloat(basico.precioVentaMayorista).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
                elDetal.textContent  = `$${parseFloat(basico.precioVentaPublicoFinal).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
                mdpImagenes          = [basico.imagen];
                mdpIdx               = 0;
                mainImg.src          = basico.imagen;
                mdpProductoActual    = basico;
                actualizarEstadoStock(basico.stock || 0);
            }

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            modal.querySelector('.bg-white')?.animate(
                [{ transform: 'scale(0.95)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
                { duration: 200, easing: 'ease-out' }
            );

            // Fetch completo de detalles
            try {
                const res  = await fetch(`/store/json/pos/producto/${idProducto}`);
                const data = await res.json();
                if (!data.success) {
                    elTiendas.innerHTML = '<p class="text-xs text-red-400 italic">Error al cargar disponibilidad</p>';
                    return;
                }
                const p = data.producto;

                elNombre.textContent = p.nombre;
                elDesc.textContent   = p.descripcion;
                elMayor.textContent  = `$${p.precioMayor.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
                elDetal.textContent  = `$${p.precioDetal.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

                if (p.imagenes.length) { mdpImagenes = p.imagenes; mostrarImagen(0); }

                elTallas.innerHTML = p.tallas.length
                    ? p.tallas.map(t => `<button class="px-4 py-1.5 border border-slate-100 rounded-xl text-xs font-bold cursor-default hover:border-gh-primary hover:text-gh-primary transition-all">${t}</button>`).join('')
                    : '<span class="text-xs text-slate-300 italic">—</span>';

                elColores.innerHTML = p.colores.length
                    ? p.colores.map(c => `<div class="w-7 h-7 rounded-full border-2 border-white shadow-sm cursor-default" style="background-color:${c.codigo}" title="${c.valor}"></div>`).join('')
                    : '<span class="text-xs text-slate-300 italic">—</span>';

                actualizarEstadoStock(p.stockLocal);

                // Lista de tiendas con stock
                if (p.stockPorTienda.length) {
                    elTiendas.innerHTML = p.stockPorTienda.map(t => {
                        const icono = tipoIcono[t.tipo] || 'fi-rr-store';
                        const badge = t.esLocal
                            ? 'bg-gh-primary/10 text-gh-primary border-gh-primary/20'
                            : 'bg-slate-50 text-slate-600 border-slate-100';
                        return `
                        <div class="flex items-center justify-between px-3 py-2 rounded-xl border ${badge}">
                            <div class="flex items-center gap-2">
                                <i class="fi ${icono} text-sm"></i>
                                <span class="text-xs font-semibold">${t.nombre}${t.esLocal ? ' <span class="text-[9px] font-bold uppercase opacity-60">esta tienda</span>' : ''}</span>
                            </div>
                            <span class="text-xs font-black">${t.stock} uds.</span>
                        </div>`;
                    }).join('');
                } else {
                    elTiendas.innerHTML = '<p class="text-xs text-slate-300 italic">Sin stock en ninguna tienda</p>';
                }
            } catch {
                elTiendas.innerHTML = '<p class="text-xs text-red-400 italic">Error al cargar disponibilidad</p>';
            }
        };

        // ── Qty controls ─────────────────────────────────────────────────────────
        btnQtyMinus?.addEventListener('click', () => setQty(parseInt(qtyInput.value) - 1));
        btnQtyPlus?.addEventListener('click',  () => setQty(parseInt(qtyInput.value) + 1));
        qtyInput?.addEventListener('input', () => setQty(parseInt(qtyInput.value) || 1));

        // ── Agregar al carrito desde el modal ─────────────────────────────────────
        btnAgregar?.addEventListener('click', () => {
            if (!mdpProductoActual || !mdpStockLocal) return;
            const qty = parseInt(qtyInput.value) || 1;
            addToCart(mdpProductoActual, qty);
            cerrar();
        });

        // ── Trasladar → perfil del producto (tiene flujo de traslado) ────────────
        btnTrasladar?.addEventListener('click', () => {
            if (!mdpProductoActual) return;
            window.location.href = `/store/inventario/perfilProducto/${mdpProductoActual.idProducto}`;
        });

        // ── Doble clic en tarjeta (mouse) ────────────────────────────────────────
        document.addEventListener('dblclick', (e) => {
            if (e.target.closest('.btn-agregar-pedido')) return;
            const tarjeta = e.target.closest('.product-card-individual');
            if (!tarjeta) return;
            const idProducto = tarjeta.id.replace('product-', '');
            if (idProducto) abrir(idProducto);
        });

        // ── Doble tap en tarjeta (touch) ──────────────────────────────────────────
        let _lastTapTarget = null;
        let _lastTapTime   = 0;
        document.addEventListener('touchend', (e) => {
            if (e.target.closest('.btn-agregar-pedido')) return;
            const tarjeta = e.target.closest('.product-card-individual');
            if (!tarjeta) return;
            const ahora = Date.now();
            if (tarjeta === _lastTapTarget && ahora - _lastTapTime < 300) {
                e.preventDefault(); // evitar zoom nativo del doble tap
                _lastTapTarget = null;
                _lastTapTime   = 0;
                const idProducto = tarjeta.id.replace('product-', '');
                if (idProducto) abrir(idProducto);
            } else {
                _lastTapTarget = tarjeta;
                _lastTapTime   = ahora;
            }
        }, { passive: false });

        // ── Clicks generales ─────────────────────────────────────────────────────
        document.addEventListener('click', (e) => {
            if (!modal || modal.classList.contains('hidden')) return;
            if (e.target === modal || e.target.closest('.btn-close-modal')) { cerrar(); return; }
            if (e.target.closest('.btn-prev-image')) { mostrarImagen((mdpIdx - 1 + mdpImagenes.length) % mdpImagenes.length); return; }
            if (e.target.closest('.btn-next-image')) { mostrarImagen((mdpIdx + 1) % mdpImagenes.length); return; }
        });

        // ── Escape ────────────────────────────────────────────────────────────────
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) cerrar();
        });
    }

    // ─── FINALIZAR VENTA ──────────────────────────────────────────────────────
    {
        const modalFV     = document.getElementById('modal-finalizar-venta');
        const btnAbrir    = document.getElementById('btn-procesar-factura');
        const btnCerrar   = document.getElementById('btn-cerrar-finalizar-venta');

        let transferenciasData        = [];
        let tarjetaData               = [];
        let creditoData               = [];
        const entidadesActivas        = new Map(); // transferencia
        const entidadesActivasTarjeta = new Map(); // tarjeta
        const entidadesActivasCredito = new Map(); // credito

        let empleadoActual   = null; // { idEmpleado, nombre } o null si no validado
        let empleadoTimer    = null;

        const calcularSubtotal = () =>
            [...cart.values()].reduce((s, i) => s + getPrecioItem(i) * i.cantidad, 0);

        // Formato de miles en campo de efectivo
        window.initMoneyInput?.(document.getElementById('fv-efectivo-monto'));

        // ── Abrir ──────────────────────────────────────────────────────────────
        // Bloque de solo lectura con el pago que ya cobró la pasarela. Cuando existe, los métodos
        // manuales se ocultan: el cajero no está recibiendo plata, solo emitiendo la factura.
        const pintarPagoWeb = () => {
            const caja = document.getElementById('fv-pago-web');
            if (!caja) return;

            const metodosManuales = ['efectivo', 'transferencia', 'tarjeta', 'credito']
                .map(m => document.getElementById(`fv-metodo-${m}`));

            if (!pagoWebActivo) {
                caja.classList.add('hidden');
                // Las otras tres tarjetas ya las restituyó cargarEntidades() según las
                // entidades disponibles; efectivo no depende de ninguna entidad.
                document.getElementById('fv-metodo-efectivo')?.classList.remove('hidden');
                return;
            }

            caja.classList.remove('hidden');
            metodosManuales.forEach(el => el?.classList.add('hidden'));

            const fmtCop = (n) => new Intl.NumberFormat('es-CO').format(Math.round(n));
            document.getElementById('fv-pago-web-metodo').textContent = pagoWebActivo.etiqueta || 'Pago en línea';
            document.getElementById('fv-pago-web-valor').textContent  = `$${fmtCop(pagoWebActivo.valor)}`;

            const ref = pagoWebActivo.idTransaccion || pagoWebActivo.referencia;
            document.getElementById('fv-pago-web-ref').textContent = ref
                ? `Transacción ${ref}`
                : 'Confirmado por la pasarela — no requiere cobro en caja';
        };

        const abrirFV = async () => {
            if (!cart.size) {
                Swal.fire({ icon: 'info', title: 'Orden vacía', text: 'Agrega productos antes de procesar la factura.', confirmButtonColor: '#EC5FA3' });
                return;
            }
            poblarCliente();
            poblarProductos();
            actualizarTotalesFV();
            // Se espera a cargarEntidades: al terminar vuelve a mostrar las tarjetas de
            // transferencia/tarjeta/crédito, así que pintarPagoWeb tiene que correr después
            // para poder ocultarlas cuando el pedido ya viene pago.
            await cargarEntidades();
            resetearPagos();
            pintarPagoWeb();
            modalFV.classList.remove('hidden');
            modalFV.classList.add('flex');
        };

        const cerrarFV = () => {
            if (!modalFV) return;
            modalFV.classList.add('hidden');
            modalFV.classList.remove('flex');
        };

        // ── Cliente ────────────────────────────────────────────────────────────
        const poblarCliente = () => {
            const nombre = document.getElementById('cli-display-nombre')?.textContent?.trim() || 'Cliente';
            const doc    = document.getElementById('cli-display-doc')?.textContent?.trim() || '';
            const tel    = document.getElementById('cli-telefono-n')?.value?.trim() || '';

            const iniciales = nombre.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

            const elInic   = document.getElementById('fv-cli-iniciales');
            const elNombre = document.getElementById('fv-cli-nombre');
            const elDoc    = document.getElementById('fv-cli-doc');
            const elTel    = document.getElementById('fv-cli-tel');

            if (elInic)   elInic.textContent   = iniciales || 'CG';
            if (elNombre) elNombre.textContent  = nombre;
            if (elDoc)    elDoc.textContent     = doc;
            if (elTel)    elTel.textContent     = tel ? `Tel: ${tel}` : '';
        };

        // ── Productos ──────────────────────────────────────────────────────────
        const poblarProductos = () => {
            const lista = document.getElementById('fv-lista-productos');
            if (!lista) return;
            lista.innerHTML = [...cart.values()].map(item => {
                const precio = getPrecioItem(item);
                const total  = precio * item.cantidad;
                return `
                <div class="flex items-center gap-3 py-3">
                    <img src="${item.imagen}" alt="${item.nombre}"
                         class="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                         onerror="this.src='/img/image-default.webp'">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold text-gray-800 truncate">${item.nombre}</p>
                        <p class="text-xs text-gray-400 font-medium mt-0.5">${item.cantidad} × $${fmt(precio)}</p>
                    </div>
                    <p class="text-base font-black text-gray-900 flex-shrink-0 ml-2">$${fmt(total)}</p>
                </div>`;
            }).join('');
        };

        // ── Totales ────────────────────────────────────────────────────────────
        const actualizarTotalesFV = () => {
            const subtotal  = calcularSubtotal();
            const impuestos = 0;
            const total     = subtotal + impuestos;
            const elSub  = document.getElementById('fv-subtotal');
            const elImp  = document.getElementById('fv-impuestos');
            const elTot  = document.getElementById('fv-total');
            if (elSub)  elSub.textContent  = `$${fmt(subtotal)}`;
            if (elImp)  elImp.textContent  = `$${fmt(impuestos)}`;
            if (elTot)  elTot.textContent  = `$${fmt(total)}`;
        };

        // ── Empleado vendedor ──────────────────────────────────────────────────
        const mostrarBadgeEmpleado = (ok, nombre) => {
            const badge  = document.getElementById('fv-empleado-badge');
            const icon   = document.getElementById('fv-empleado-icon');
            const span   = document.getElementById('fv-empleado-nombre');
            if (!badge) return;
            badge.classList.remove('hidden');
            badge.classList.add('flex');
            if (ok) {
                icon.className  = 'fi-rr-check-circle text-sm text-green-500 flex-shrink-0';
                span.className  = 'text-xs font-black text-green-600 truncate';
                span.textContent = nombre;
            } else {
                icon.className  = 'fi-rr-cross-circle text-sm text-red-400 flex-shrink-0';
                span.className  = 'text-xs font-black text-red-400 truncate';
                span.textContent = 'No encontrado';
            }
        };

        const ocultarBadgeEmpleado = () => {
            const badge = document.getElementById('fv-empleado-badge');
            if (!badge) return;
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        };

        const validarEmpleado = async (codigo) => {
            if (!codigo.trim()) {
                empleadoActual = null;
                ocultarBadgeEmpleado();
                actualizarResumenPagos();
                return;
            }
            try {
                const r    = await fetch(`/store/json/personal/codigo/${encodeURIComponent(codigo.trim())}`);
                const data = await r.json();
                if (data.success) {
                    empleadoActual = { idEmpleado: data.idEmpleado, nombre: data.nombre };
                    mostrarBadgeEmpleado(true, data.nombre);
                } else {
                    empleadoActual = null;
                    mostrarBadgeEmpleado(false, '');
                }
            } catch {
                empleadoActual = null;
                ocultarBadgeEmpleado();
            }
            actualizarResumenPagos();
        };

        // Bind con debounce al input de código de empleado
        document.getElementById('fv-empleado-codigo')?.addEventListener('input', (e) => {
            clearTimeout(empleadoTimer);
            const val = e.target.value.toUpperCase();
            e.target.value = val;
            empleadoActual  = null;
            ocultarBadgeEmpleado();
            actualizarResumenPagos();
            if (val.trim().length >= 3) {
                empleadoTimer = setTimeout(() => validarEmpleado(val), 600);
            }
        });

        document.getElementById('fv-empleado-codigo')?.addEventListener('blur', (e) => {
            clearTimeout(empleadoTimer);
            if (e.target.value.trim().length >= 3) validarEmpleado(e.target.value);
        });

        // ── Entidades ──────────────────────────────────────────────────────────
        // Muestra u oculta cada tarjeta de método según haya entidades de ese tipo.
        // Va aparte a propósito: pintarPagoWeb las oculta al facturar un pedido web, y en la
        // venta siguiente hay que restituirlas. Si esto viviera solo dentro del fetch, el
        // camino de cache saldría antes de tocarlas y los métodos quedarían ocultos hasta
        // recargar la página.
        const aplicarVisibilidadMetodos = () => {
            const tarjetas = [
                ['fv-metodo-transferencia', transferenciasData],
                ['fv-metodo-tarjeta',       tarjetaData],
                ['fv-metodo-credito',       creditoData]
            ];
            for (const [id, datos] of tarjetas) {
                document.getElementById(id)?.classList.toggle('hidden', datos.length === 0);
            }
        };

        const cargarEntidades = async () => {
            if (transferenciasData.length || tarjetaData.length || creditoData.length) {
                aplicarVisibilidadMetodos();
                renderTransferencias();
                renderTarjeta();
                renderCredito();
                return;
            }
            try {
                const res  = await fetch('/store/json/entidades');
                const data = await res.json();
                if (data.success) {
                    transferenciasData = data.entidades.filter(e => e.tipoEntidad === 'Banco' || e.tipoEntidad === 'Billetera Virtual');
                    tarjetaData        = data.entidades.filter(e => e.tipoEntidad === 'Tarjeta Credito');
                    creditoData        = data.entidades.filter(e => e.tipoEntidad === 'Entidad Crediticia');
                    aplicarVisibilidadMetodos();
                    renderTransferencias();
                    renderTarjeta();
                    renderCredito();
                }
            } catch (e) {
                console.error('cargarEntidades:', e);
            }
        };

        const renderTransferencias = () => {
            const chips = document.getElementById('fv-bancos-chips');
            if (!chips) return;
            chips.innerHTML = transferenciasData.map(b => `
                <button type="button"
                    class="fv-banco-chip px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-all cursor-pointer"
                    data-id="${b.idEntidad}" data-nombre="${b.nombreEntidad}" data-grupo="transferencia">
                    ${b.nombreEntidad}
                </button>`).join('');
        };

        const renderTarjeta = () => {
            const chips = document.getElementById('fv-tarjeta-chips');
            if (!chips) return;
            chips.innerHTML = tarjetaData.map(b => `
                <button type="button"
                    class="fv-banco-chip px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-purple-400 hover:text-purple-600 transition-all cursor-pointer"
                    data-id="${b.idEntidad}" data-nombre="${b.nombreEntidad}" data-grupo="tarjeta">
                    ${b.nombreEntidad}
                </button>`).join('');
        };

        const renderCredito = () => {
            const chips = document.getElementById('fv-credito-chips');
            if (!chips) return;
            chips.innerHTML = creditoData.map(b => `
                <button type="button"
                    class="fv-banco-chip px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-orange-400 hover:text-orange-600 transition-all cursor-pointer"
                    data-id="${b.idEntidad}" data-nombre="${b.nombreEntidad}" data-grupo="credito">
                    ${b.nombreEntidad}
                </button>`).join('');
        };

        // ── Rows por entidad ───────────────────────────────────────────────────
        const calcularTransferencia = () => {
            let suma = 0;
            entidadesActivas.forEach((_, id) => {
                suma += window.parseMoney?.(document.getElementById(`fv-tr-monto-${id}`)?.value) ?? 0;
            });
            return suma;
        };

        const añadirRowEntidad = (id, nombre) => {
            const contenedor = document.getElementById('fv-transferencia-rows');
            if (!contenedor || document.getElementById(`fv-tr-row-${id}`)) return;
            const row = document.createElement('div');
            row.id        = `fv-tr-row-${id}`;
            row.className = 'flex gap-2 items-center p-2 bg-white rounded-xl border border-blue-100';
            row.innerHTML = `
                <span class="text-[10px] font-black text-blue-600 uppercase tracking-wide w-20 flex-shrink-0 truncate">${nombre}</span>
                <div class="relative flex-[3]">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm pointer-events-none">$</span>
                    <input id="fv-tr-monto-${id}" type="text" inputmode="numeric"
                           placeholder="Monto"
                           class="w-full pl-6 pr-2 h-9 bg-gray-50 border border-gray-100 rounded-lg text-right font-black text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-300">
                </div>
                <input id="fv-tr-ref-${id}" type="text"
                       placeholder="Ref."
                       class="w-28 flex-none h-9 bg-gray-50 border border-gray-100 rounded-lg px-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-300">`;
            contenedor.appendChild(row);
            window.initMoneyInput?.(document.getElementById(`fv-tr-monto-${id}`));
            document.getElementById(`fv-tr-monto-${id}`)?.addEventListener('input', () => { checkExcesoMonto(`fv-tr-monto-${id}`); actualizarResumenPagos(); });
            document.getElementById(`fv-tr-ref-${id}`)?.addEventListener('input', actualizarResumenPagos);
            // Pre-rellenar con el restante
            const montoTr = document.getElementById(`fv-tr-monto-${id}`);
            if (montoTr) { const r = calcularRestante(); if (r > 0) { montoTr.value = fmtMoney(r); actualizarResumenPagos(); } }
        };

        const quitarRowEntidad = (id) => {
            document.getElementById(`fv-tr-row-${id}`)?.remove();
            entidadesActivas.delete(id);
            actualizarResumenPagos();
        };

        // ── Rows por tarjeta ───────────────────────────────────────────────────
        const calcularTarjeta = () => {
            let suma = 0;
            entidadesActivasTarjeta.forEach((_, id) => {
                suma += window.parseMoney?.(document.getElementById(`fv-ta-monto-${id}`)?.value) ?? 0;
            });
            return suma;
        };

        const añadirRowTarjeta = (id, nombre) => {
            const contenedor = document.getElementById('fv-tarjeta-rows');
            if (!contenedor || document.getElementById(`fv-ta-row-${id}`)) return;
            const row = document.createElement('div');
            row.id        = `fv-ta-row-${id}`;
            row.className = 'flex gap-2 items-center p-2 bg-white rounded-xl border border-purple-100';
            row.innerHTML = `
                <span class="text-[10px] font-black text-purple-600 uppercase tracking-wide w-20 flex-shrink-0 truncate">${nombre}</span>
                <div class="relative flex-[3]">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm pointer-events-none">$</span>
                    <input id="fv-ta-monto-${id}" type="text" inputmode="numeric"
                           placeholder="Monto"
                           class="w-full pl-6 pr-2 h-9 bg-gray-50 border border-gray-100 rounded-lg text-right font-black text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-300">
                </div>
                <input id="fv-ta-ref-${id}" type="text"
                       placeholder="Ref."
                       class="w-28 flex-none h-9 bg-gray-50 border border-gray-100 rounded-lg px-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-300">`;
            contenedor.appendChild(row);
            window.initMoneyInput?.(document.getElementById(`fv-ta-monto-${id}`));
            document.getElementById(`fv-ta-monto-${id}`)?.addEventListener('input', () => { checkExcesoMonto(`fv-ta-monto-${id}`); actualizarResumenPagos(); });
            document.getElementById(`fv-ta-ref-${id}`)?.addEventListener('input', actualizarResumenPagos);
            // Pre-rellenar con el restante
            const montoTa = document.getElementById(`fv-ta-monto-${id}`);
            if (montoTa) { const r = calcularRestante(); if (r > 0) { montoTa.value = fmtMoney(r); actualizarResumenPagos(); } }
        };

        const quitarRowTarjeta = (id) => {
            document.getElementById(`fv-ta-row-${id}`)?.remove();
            entidadesActivasTarjeta.delete(id);
            actualizarResumenPagos();
        };

        // ── Rows por entidad crediticia ────────────────────────────────────────
        const calcularCredito = () => {
            let suma = 0;
            entidadesActivasCredito.forEach((_, id) => {
                suma += window.parseMoney?.(document.getElementById(`fv-cr-monto-${id}`)?.value) ?? 0;
            });
            return suma;
        };

        const añadirRowCredito = (id, nombre) => {
            const contenedor = document.getElementById('fv-credito-rows');
            if (!contenedor || document.getElementById(`fv-cr-row-${id}`)) return;
            const row = document.createElement('div');
            row.id        = `fv-cr-row-${id}`;
            row.className = 'flex gap-2 items-center p-2 bg-white rounded-xl border border-orange-100';
            row.innerHTML = `
                <span class="text-[10px] font-black text-orange-600 uppercase tracking-wide w-20 flex-shrink-0 truncate">${nombre}</span>
                <div class="relative flex-[3]">
                    <span class="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm pointer-events-none">$</span>
                    <input id="fv-cr-monto-${id}" type="text" inputmode="numeric"
                           placeholder="Monto"
                           class="w-full pl-6 pr-2 h-9 bg-gray-50 border border-gray-100 rounded-lg text-right font-black text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-300">
                </div>
                <input id="fv-cr-ref-${id}" type="text"
                       placeholder="Ref."
                       class="w-28 flex-none h-9 bg-gray-50 border border-gray-100 rounded-lg px-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-300">`;
            contenedor.appendChild(row);
            window.initMoneyInput?.(document.getElementById(`fv-cr-monto-${id}`));
            document.getElementById(`fv-cr-monto-${id}`)?.addEventListener('input', () => { checkExcesoMonto(`fv-cr-monto-${id}`); actualizarResumenPagos(); });
            document.getElementById(`fv-cr-ref-${id}`)?.addEventListener('input', actualizarResumenPagos);
            // Pre-rellenar con el restante
            const montoCr = document.getElementById(`fv-cr-monto-${id}`);
            if (montoCr) { const r = calcularRestante(); if (r > 0) { montoCr.value = fmtMoney(r); actualizarResumenPagos(); } }
        };

        const quitarRowCredito = (id) => {
            document.getElementById(`fv-cr-row-${id}`)?.remove();
            entidadesActivasCredito.delete(id);
            actualizarResumenPagos();
        };

        // ── Reset pagos ────────────────────────────────────────────────────────
        const resetearPagos = () => {
            // Cerrar acordeones
            ['efectivo', 'transferencia', 'tarjeta', 'credito'].forEach(m => {
                document.getElementById(`fv-${m}-body`)?.classList.add('hidden');
                document.getElementById(`fv-${m}-chevron`)?.classList.remove('rotate-180');
            });
            // Limpiar campos fijos
            ['fv-efectivo-monto'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            document.getElementById('fv-efectivo-cambio') && (document.getElementById('fv-efectivo-cambio').textContent = '$0');
            // Limpiar empleado
            empleadoActual = null;
            clearTimeout(empleadoTimer);
            const elCodigo = document.getElementById('fv-empleado-codigo');
            if (elCodigo) elCodigo.value = '';
            ocultarBadgeEmpleado();
            // Limpiar rows de transferencia
            entidadesActivas.clear();
            const rows = document.getElementById('fv-transferencia-rows');
            if (rows) rows.innerHTML = '';
            // Limpiar rows de tarjeta
            entidadesActivasTarjeta.clear();
            const rowsTa = document.getElementById('fv-tarjeta-rows');
            if (rowsTa) rowsTa.innerHTML = '';
            // Limpiar rows de crédito
            entidadesActivasCredito.clear();
            const rowsCred = document.getElementById('fv-credito-rows');
            if (rowsCred) rowsCred.innerHTML = '';
            // Desactivar chips visualmente
            document.querySelectorAll('.fv-banco-chip').forEach(c => {
                c.disabled = false;
                c.classList.remove(
                    'border-blue-400',   'text-blue-600',   'bg-blue-50',
                    'border-purple-400', 'text-purple-600', 'bg-purple-50',
                    'border-orange-400', 'text-orange-600', 'bg-orange-50',
                    'opacity-40', 'cursor-not-allowed'
                );
                c.classList.add('cursor-pointer');
            });
            // Resetear recuadros resumen y botón
            ['fv-resumen-efectivo-val', 'fv-resumen-transferencia-val', 'fv-resumen-tarjeta-val', 'fv-resumen-credito-val'].forEach(id => {
                const el = document.getElementById(id); if (el) el.textContent = '$0';
            });
            const btn = document.getElementById('btn-procesar-pago');
            if (btn) {
                btn.disabled  = true;
                btn.className = 'flex items-center gap-3 px-8 py-3.5 bg-gray-200 text-gray-400 rounded-2xl font-bold transition-all cursor-not-allowed';
            }
        };

        // ── Acordeón ───────────────────────────────────────────────────────────
        const togglePago = (metodo, activeColor) => {
            const body    = document.getElementById(`fv-${metodo}-body`);
            const chevron = document.getElementById(`fv-${metodo}-chevron`);
            const card    = document.getElementById(`fv-metodo-${metodo}`);
            if (!body) return;
            const isOpen  = !body.classList.contains('hidden');
            body.classList.toggle('hidden', isOpen);
            if (chevron) chevron.classList.toggle('rotate-180', !isOpen);
            if (card) {
                card.classList.toggle(activeColor, !isOpen);
                card.classList.toggle('border-transparent', isOpen);
            }
        };

        // ── Resumen de pagos + activación del botón ───────────────────────────
        const leerMonto = (id) => window.parseMoney?.(document.getElementById(id)?.value) ?? 0;

        const fmtMoney = (n) => n > 0 ? new Intl.NumberFormat('es-CO').format(n) : '';

        const calcularRestante = () => Math.max(0,
            calcularSubtotal()
            - leerMonto('fv-efectivo-monto')
            - calcularTransferencia()
            - calcularTarjeta()
            - calcularCredito()
        );

        // Si la suma total supera el valor de la orden, limpia el campo que lo causó
        const checkExcesoMonto = (elId) => {
            const total = calcularSubtotal();
            if (total <= 0) return;
            const suma = leerMonto('fv-efectivo-monto') + calcularTransferencia() + calcularTarjeta() + calcularCredito();
            if (suma > total) {
                const el = document.getElementById(elId);
                if (el) el.value = '';
            }
        };

        const actualizarResumenPagos = () => {
            const efectivo      = leerMonto('fv-efectivo-monto');
            const transferencia = calcularTransferencia();
            const tarjeta       = calcularTarjeta();
            const credito       = calcularCredito();
            const pagoEnLinea   = pagoWebActivo?.valor || 0;
            const suma          = efectivo + transferencia + tarjeta + credito + pagoEnLinea;
            const total         = calcularSubtotal();

            const elEf = document.getElementById('fv-resumen-efectivo-val');
            const elTr = document.getElementById('fv-resumen-transferencia-val');
            const elTa = document.getElementById('fv-resumen-tarjeta-val');
            const elCr = document.getElementById('fv-resumen-credito-val');
            if (elEf) elEf.textContent = `$${fmt(efectivo)}`;
            if (elTr) elTr.textContent = `$${fmt(transferencia)}`;
            if (elTa) elTa.textContent = `$${fmt(tarjeta)}`;
            if (elCr) elCr.textContent = `$${fmt(credito)}`;

            // Referencia obligatoria para transferencias, tarjeta y crédito
            const refsOk = [...entidadesActivas.keys()].every(id => {
                const monto = window.parseMoney?.(document.getElementById(`fv-tr-monto-${id}`)?.value) ?? 0;
                if (monto === 0) return true;
                return (document.getElementById(`fv-tr-ref-${id}`)?.value?.trim().length ?? 0) > 0;
            });
            const refsTaOk = [...entidadesActivasTarjeta.keys()].every(id => {
                const monto = window.parseMoney?.(document.getElementById(`fv-ta-monto-${id}`)?.value) ?? 0;
                if (monto === 0) return true;
                return (document.getElementById(`fv-ta-ref-${id}`)?.value?.trim().length ?? 0) > 0;
            });
            const refsCrOk = [...entidadesActivasCredito.keys()].every(id => {
                const monto = window.parseMoney?.(document.getElementById(`fv-cr-monto-${id}`)?.value) ?? 0;
                if (monto === 0) return true;
                return (document.getElementById(`fv-cr-ref-${id}`)?.value?.trim().length ?? 0) > 0;
            });

            const btn    = document.getElementById('btn-procesar-pago');
            if (!btn) return;
            const activo = total > 0 && suma >= total && refsOk && refsTaOk && refsCrOk && empleadoActual !== null;
            btn.disabled  = !activo;
            btn.className = activo
                ? 'flex items-center gap-3 px-8 py-3.5 bg-gh-primaryHover text-white rounded-2xl font-bold shadow-lg shadow-gh-primary/30 hover:brightness-110 transition-all active:scale-95 cursor-pointer'
                : 'flex items-center gap-3 px-8 py-3.5 bg-gray-200 text-gray-400 rounded-2xl font-bold transition-all cursor-not-allowed';

            // Bloquear chips inactivos si el total ya está cubierto
            const totalCubierto = total > 0 && suma >= total;
            document.querySelectorAll('.fv-banco-chip').forEach(chip => {
                const cid   = chip.dataset.id;
                const grupo = chip.dataset.grupo;
                const isActive =
                    (grupo === 'transferencia' && entidadesActivas.has(cid)) ||
                    (grupo === 'tarjeta'       && entidadesActivasTarjeta.has(cid)) ||
                    (grupo === 'credito'       && entidadesActivasCredito.has(cid));
                const bloquear = totalCubierto && !isActive;
                chip.disabled = bloquear;
                chip.classList.toggle('opacity-40',        bloquear);
                chip.classList.toggle('cursor-not-allowed', bloquear);
                chip.classList.toggle('cursor-pointer',    !bloquear);
            });
        };

        // ── Efectivo: cambio + resumen ─────────────────────────────────────────
        document.getElementById('fv-efectivo-monto')?.addEventListener('input', () => {
            checkExcesoMonto('fv-efectivo-monto');
            const monto  = leerMonto('fv-efectivo-monto');
            const total  = calcularSubtotal();
            const cambio = Math.max(0, monto - total);
            const elCambio = document.getElementById('fv-efectivo-cambio');
            if (elCambio) elCambio.textContent = `$${fmt(cambio)}`;
            actualizarResumenPagos();
        });


        // ── Eventos delegados ──────────────────────────────────────────────────
        document.addEventListener('click', (e) => {
            if (!modalFV || modalFV.classList.contains('hidden')) return;

            if (e.target.closest('#fv-efectivo-header')) {
                togglePago('efectivo', 'border-green-200');
                const efBody = document.getElementById('fv-efectivo-body');
                if (efBody && !efBody.classList.contains('hidden')) {
                    const elEf = document.getElementById('fv-efectivo-monto');
                    if (elEf && leerMonto('fv-efectivo-monto') === 0) {
                        const r = calcularRestante();
                        if (r > 0) {
                            elEf.value = fmtMoney(r);
                            const elCambio = document.getElementById('fv-efectivo-cambio');
                            if (elCambio) elCambio.textContent = '$0';
                            actualizarResumenPagos();
                        }
                    }
                }
                return;
            }
            if (e.target.closest('#fv-transferencia-header')) { togglePago('transferencia', 'border-blue-200');   return; }
            if (e.target.closest('#fv-tarjeta-header'))       { togglePago('tarjeta',       'border-purple-200'); return; }
            if (e.target.closest('#fv-credito-header'))       { togglePago('credito',       'border-orange-200'); return; }

            const chip = e.target.closest('.fv-banco-chip');
            if (chip) {
                const id     = chip.dataset.id;
                const nombre = chip.dataset.nombre;
                const grupo  = chip.dataset.grupo;
                if (grupo === 'tarjeta') {
                    if (entidadesActivasTarjeta.has(id)) {
                        chip.classList.remove('border-purple-400', 'text-purple-600', 'bg-purple-50');
                        quitarRowTarjeta(id);
                    } else {
                        chip.classList.add('border-purple-400', 'text-purple-600', 'bg-purple-50');
                        entidadesActivasTarjeta.set(id, { nombre });
                        añadirRowTarjeta(id, nombre);
                    }
                } else if (grupo === 'credito') {
                    if (entidadesActivasCredito.has(id)) {
                        chip.classList.remove('border-orange-400', 'text-orange-600', 'bg-orange-50');
                        quitarRowCredito(id);
                    } else {
                        chip.classList.add('border-orange-400', 'text-orange-600', 'bg-orange-50');
                        entidadesActivasCredito.set(id, { nombre });
                        añadirRowCredito(id, nombre);
                    }
                } else {
                    if (entidadesActivas.has(id)) {
                        chip.classList.remove('border-blue-400', 'text-blue-600', 'bg-blue-50');
                        quitarRowEntidad(id);
                    } else {
                        chip.classList.add('border-blue-400', 'text-blue-600', 'bg-blue-50');
                        entidadesActivas.set(id, { nombre });
                        añadirRowEntidad(id, nombre);
                    }
                }
                return;
            }

            if (e.target.closest('#fv-btn-cambiar-cliente')) {
                cerrarFV();
                document.getElementById('btn-abrir-modal-cliente')?.click();
                return;
            }
        });

        // Overlay click
        modalFV?.addEventListener('click', (e) => { if (e.target === modalFV) cerrarFV(); });

        // Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalFV && !modalFV.classList.contains('hidden')) cerrarFV();
        });

        if (btnAbrir)  btnAbrir.addEventListener('click', abrirFV);
        if (btnCerrar) btnCerrar.addEventListener('click', cerrarFV);

        // Botón procesar pago (placeholder)
        document.getElementById('btn-procesar-pago')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-procesar-pago');
            if (!btn || btn.disabled) return;

            // ── Armar payload ────────────────────────────────────────────────
            const idCliente  = document.getElementById('idCliente')?.value?.trim() || '0';
            const idEmpleado = empleadoActual?.idEmpleado;

            const items = [...cart.values()].map(i => ({ idProducto: i.idProducto, cantidad: i.cantidad }));

            const pagosPayload = [];

            // Efectivo
            const montoEf = leerMonto('fv-efectivo-monto');
            if (montoEf > 0) pagosPayload.push({ idEntidad: null, valor: montoEf, nroReferencia: null });

            // Transferencia
            entidadesActivas.forEach((_, id) => {
                const val = leerMonto(`fv-tr-monto-${id}`);
                const ref = document.getElementById(`fv-tr-ref-${id}`)?.value?.trim() || null;
                if (val > 0) pagosPayload.push({ idEntidad: parseInt(id), valor: val, nroReferencia: ref });
            });

            // Tarjeta
            entidadesActivasTarjeta.forEach((_, id) => {
                const val = leerMonto(`fv-ta-monto-${id}`);
                const ref = document.getElementById(`fv-ta-ref-${id}`)?.value?.trim() || null;
                if (val > 0) pagosPayload.push({ idEntidad: parseInt(id), valor: val, nroReferencia: ref });
            });

            // Crédito
            entidadesActivasCredito.forEach((_, id) => {
                const val = leerMonto(`fv-cr-monto-${id}`);
                const ref = document.getElementById(`fv-cr-ref-${id}`)?.value?.trim() || null;
                if (val > 0) pagosPayload.push({ idEntidad: parseInt(id), valor: val, nroReferencia: ref });
            });

            // ── Enviar ───────────────────────────────────────────────────────
            if (bloquearSiSinCaja()) return;

            btn.disabled  = true;
            btn.className = 'flex items-center gap-3 px-8 py-3.5 bg-gray-200 text-gray-400 rounded-2xl font-bold transition-all cursor-not-allowed';

            try {
                const csrf = document.querySelector('meta[name="csrf-token"]')?.content
                          || document.cookie.match(/_csrf=([^;]+)/)?.[1] || '';

                const resp = await fetch('/store/facturas/procesar', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                    body:    JSON.stringify({ idCliente, idEmpleado, items, pagos: pagosPayload, idPedidoWeb: pedidoWebActivo })
                });
                const data = await resp.json();

                if (!data.success) {
                    Swal.fire({ icon: 'error', title: 'Error al facturar', text: data.mensaje, confirmButtonColor: '#EC5FA3' });
                    btn.disabled  = false;
                    actualizarResumenPagos();
                    return;
                }

                // Éxito → abrir tirilla y dejar el POS listo para una nueva orden
                window.open(`/store/facturas/${data.idFacturaCliente}/tirilla`, '_blank');
                cerrarFV();
                cart.clear();
                pedidoWebActivo = null;
                sincronizarBotonCliente();
                pagoWebActivo   = null;
                renderCarrito();
                resetCliente();

                if (data.redirigirCierre) {
                    await Swal.fire({
                        icon: 'warning',
                        title: 'Cupo extemporáneo agotado',
                        text: 'Se han usado todas las facturas extemporáneas autorizadas. Debes cerrar la caja ahora.',
                        confirmButtonColor: '#EC5FA3',
                        confirmButtonText: 'Ir a cierre de caja'
                    });
                    window.location.href = '/store/storebehivors/';
                } else {
                    Swal.fire({
                        icon: 'success', title: '¡Venta registrada!',
                        text: 'La factura fue generada correctamente.',
                        timer: 2500, timerProgressBar: true, showConfirmButton: false
                    });
                }

            } catch (err) {
                console.error('procesarFactura:', err);
                const texto = err?.message?.includes('JSON') || err?.message?.includes('fetch')
                    ? 'No se pudo conectar con el servidor.'
                    : (err?.message || 'Error inesperado.');
                Swal.fire({ icon: 'error', title: 'Error de conexión', text: texto, confirmButtonColor: '#EC5FA3' });
                btn.disabled  = false;
                actualizarResumenPagos();
            }
        });
    }

    // ─── GUARD DE NAVEGACIÓN ─────────────────────────────────────────────────
    // Cierre / recarga de pestaña → dialog nativo del browser
    window.addEventListener('beforeunload', (e) => {
        if (!cart.size) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // Navegación por links internos → SweetAlert
    document.addEventListener('click', async (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
        if (!cart.size) return;

        e.preventDefault();

        const totalItems = totalQtyEnOrden();
        const { isConfirmed } = await Swal.fire({
            icon: 'warning',
            title: '¿Salir del POS?',
            html: `Tienes <strong>${totalItems} unidad${totalItems === 1 ? '' : 'es'}</strong> en la orden actual.<br>Si sales ahora <strong>se perderá</strong> el progreso de esta venta.`,
            showCancelButton: true,
            confirmButtonText: 'Sí, salir',
            cancelButtonText: 'Quedarme',
            confirmButtonColor: '#EC5FA3',
            cancelButtonColor: '#6b7280',
            reverseButtons: true
        });

        if (isConfirmed) window.location.href = href;
    });
})();
