// ⚠️ IMPORTANTE: COLOCA AQUÍ LA URL DE TU SCRIPT DE GOOGLE
const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbwguUMdCXX0UWIV6-rsZVuaO8k_WAogw1UfU11FLM8m2dDD_OtBxRSRYJsqkdKgOx8I/exec';

// VARIABLES GLOBALES EN MEMORIA
let CONFIG_SESION = { usuario: "", clave: "", rol: "" };
let CACHE_INVENTARIO = [];
let CACHE_HISTORIAL = [];
let CARRITO = [];
let ZONA_ACTUAL = 'TODOS';

// === SEGURIDAD BÁSICA ===
function sanitizarTexto(texto) {
    if (!texto) return "Sin observaciones.";
    const div = document.createElement('div'); div.innerText = texto; return div.innerHTML;
}

// === INICIO DE SESIÓN ===
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const user = document.getElementById('loginUser').value; 
    const pass = document.getElementById('loginPass').value;
    const errorDiv = document.getElementById('loginError'); 
    errorDiv.style.display = 'none';

    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST', body: JSON.stringify({ action: "LOGIN", usuario: user, clave: pass })
        });
        const res = await response.json();
        if(res.status === 'success') {
            CONFIG_SESION.usuario = res.usuario; 
            CONFIG_SESION.clave = pass; 
            CONFIG_SESION.rol = res.rol;
            
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            document.getElementById('sessionLabel').innerText = `${res.usuario} (${res.rol})`;
            
            if(res.rol === 'Admin') {
                document.querySelectorAll('.admin-only').forEach(el => {
                    if(el.tagName === 'TH' || el.tagName === 'TD') el.style.display = 'table-cell';
                    else el.style.display = 'block';
                });
            }
            sincronizarSistema();
        } else {
            errorDiv.innerText = res.message; errorDiv.style.display = 'block';
        }
    } catch(err) { errorDiv.innerText = "Error de conexión con el servidor."; errorDiv.style.display = 'block'; }
});

document.getElementById('btnLogout').addEventListener('click', () => location.reload());

// === SINCRONIZACIÓN CON LA NUBE ===
async function sincronizarSistema() {
    document.getElementById('loadingInventory').style.display = 'block';
    document.getElementById('inventoryTable').style.display = 'none';
    try {
        const url = `${GOOGLE_API_URL}?usuario=${encodeURIComponent(CONFIG_SESION.usuario)}&clave=${encodeURIComponent(CONFIG_SESION.clave)}`;
        const response = await fetch(url);
        const res = await response.json();
        if(res.status === 'success') {
            CACHE_INVENTARIO = res.inventario;
            CACHE_HISTORIAL = res.historial;
            CARRITO = []; // Limpiamos el carrito en cada refresco
            
            renderizarCarrito();
            renderizarInventario();
            renderizarHistorial(res.historial);
            calcularYRenderizarPendientes(res.historial);
        }
    } catch(error) { console.error("Error al sincronizar:", error); }
}

// === CÁLCULO DE DEUDAS ===
function calcularYRenderizarPendientes(historial) {
    let balances = {};
    historial.forEach(h => {
        let key = h.usuario + "|||" + h.ninventario;
        if(!balances[key]) balances[key] = { usuario: h.usuario, ninventario: h.ninventario, descripcion: h.descripcion, balance: 0 };
        if(h.tipo === "PRESTADO") balances[key].balance += 1;
        if(h.tipo === "DEVUELTO") balances[key].balance -= 1;
    });

    const pendientes = Object.values(balances).filter(b => b.balance > 0);
    const tbody = document.getElementById('pendientesBody'); 
    tbody.innerHTML = '';

    if(pendientes.length === 0) {
        let cols = CONFIG_SESION.rol === 'Admin' ? 4 : 3;
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center; color:#27AE60; font-weight:bold;">No hay equipos pendientes.</td></tr>`;
        return;
    }

    pendientes.forEach(p => {
        let adminControls = "";
        if(CONFIG_SESION.rol === 'Admin') {
            adminControls = `
                <td class="admin-only" style="display: table-cell; vertical-align: middle;">
                    <button class="btn btn-success" style="padding: 6px 12px; font-size:12px;" onclick="procesarDevolucionAdmin('${p.usuario}', '${p.ninventario}', '${p.descripcion}')">Marcar Devuelto</button>
                </td>`;
        }
        tbody.innerHTML += `
            <tr>
                <td><strong>${p.usuario}</strong></td>
                <td><code>${p.ninventario}</code></td>
                <td>${p.descripcion}</td>
                ${adminControls}
            </tr>`;
    });
}

// === DEVOLUCIÓN ADMINISTRATIVA ===
window.procesarDevolucionAdmin = async function(usuarioAfectado, idItem, nombreItem) {
    const statusDiv = document.getElementById('returnStatus');
    if(!confirm(`¿Confirmar recepción de "${nombreItem}" devuelto por ${usuarioAfectado}?`)) return;

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b'; statusDiv.innerText = "Procesando..."; statusDiv.style.display = 'block';
    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "PEDIDO_MULTIPLE", 
                usuario: CONFIG_SESION.usuario, 
                clave: CONFIG_SESION.clave, 
                tipo_movimiento: "DEVUELTO",
                items: [{ ninventario: idItem, descripcion: nombreItem, observaciones: "Recepcionado por Admin", usuario_asignado: usuarioAfectado }]
            })
        });
        const res = await response.json();
        if(res.status === 'success') { 
            statusDiv.style.display = 'none'; 
            sincronizarSistema(); 
        }
    } catch (e) { 
        statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = "Error de red."; 
    }
}

// === BUSCADOR Y ZONAS ===
document.getElementById('searchInput').addEventListener('keyup', renderizarInventario);

document.querySelectorAll('.zone-card').forEach(card => {
    card.addEventListener('click', (e) => {
        document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        ZONA_ACTUAL = e.target.getAttribute('data-zone');
        renderizarInventario();
    });
});

// === RENDERIZAR VITRINA ===
function renderizarInventario() {
    const tbody = document.getElementById('inventoryBody'); 
    tbody.innerHTML = '';
    const terminoBusqueda = document.getElementById('searchInput').value.toLowerCase();
    
    const filtrados = CACHE_INVENTARIO.filter(item => {
        const matchZona = (ZONA_ACTUAL === 'TODOS' || item.ubicacion === ZONA_ACTUAL);
        const matchTexto = (item.ninventario.toLowerCase().includes(terminoBusqueda) || 
                            item.descripcion.toLowerCase().includes(terminoBusqueda) ||
                            item.marca.toLowerCase().includes(terminoBusqueda) ||
                            item.modelo.toLowerCase().includes(terminoBusqueda));
        return matchZona && matchTexto;
    });
    
    if(filtrados.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No se encontraron resultados.</td></tr>`; 
        return; 
    }
    
    filtrados.forEach(item => {
        const estaEnCarrito = CARRITO.some(c => c.ninventario === item.ninventario);
        const estaPrestado = item.prestado_a && item.prestado_a !== "";
        let botonAccion = "";

        if(estaPrestado) {
            botonAccion = `<span class="badge unavailable">En uso por ${item.prestado_a}</span>`;
        } else if (estaEnCarrito) {
            botonAccion = `<span class="badge" style="background:#34495E; color:white;">En carrito</span>`;
        } else {
            botonAccion = `<button class="btn btn-add" onclick="agregarAlCarrito('${item.ninventario}')">Añadir al Carrito</button>`;
        }

        tbody.innerHTML += `
            <tr>
                <td><code>${item.ninventario}</code></td>
                <td><strong>${item.descripcion}</strong></td>
                <td><span style="font-size:12px; color:#7F8C8D;">${item.marca} ${item.modelo}</span></td>
                <td>${item.estado}</td>
                <td style="text-align: center;">${estaPrestado ? `<span class="badge unavailable">0</span>` : `<span class="badge available">1</span>`}</td>
                <td>${botonAccion}</td>
            </tr>`;
    });
    document.getElementById('loadingInventory').style.display = 'none';
    document.getElementById('inventoryTable').style.display = 'table';
}

function renderizarHistorial(historial) {
    const tbody = document.getElementById('historyBody'); tbody.innerHTML = '';
    historial.forEach(h => {
        const f = new Date(h.fecha).toLocaleDateString('es-CL', {hour:'2-digit', minute:'2-digit'});
        const opStyle = h.tipo === 'PRESTADO' ? 'color:var(--danger);font-weight:bold;' : 'color:var(--success);font-weight:bold;';
        tbody.innerHTML += `<tr><td><small>${f}</small></td><td>${h.usuario}</td><td><code>${h.ninventario}</code></td><td>${h.descripcion}</td><td style="${opStyle}">${h.tipo}</td><td><small>${h.obs}</small></td></tr>`;
    });
}

// === LÓGICA DEL CARRITO ===
window.agregarAlCarrito = function(idItem) {
    const item = CACHE_INVENTARIO.find(i => i.ninventario === idItem);
    if(item && !CARRITO.some(c => c.ninventario === idItem)) {
        CARRITO.push({ ...item, nota: "" });
        renderizarCarrito();
        renderizarInventario(); // Actualiza el botón a "En carrito"
    }
}

window.quitarDelCarrito = function(idItem) {
    CARRITO = CARRITO.filter(c => c.ninventario !== idItem);
    renderizarCarrito();
    renderizarInventario();
}

function renderizarCarrito() {
    const card = document.getElementById('cartCard');
    const tbody = document.getElementById('cartBody');
    tbody.innerHTML = '';
    
    if(CARRITO.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    CARRITO.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td><code>${item.ninventario}</code></td>
                <td><strong>${item.descripcion}</strong></td>
                <td><input type="text" class="obs-input" id="cart-obs-${item.ninventario}" placeholder="Comentarios (opcional)..." value="${item.nota}"></td>
                <td><button class="btn" style="background:var(--danger); padding: 5px 10px;" onclick="quitarDelCarrito('${item.ninventario}')">X</button></td>
            </tr>`;
    });
}

document.getElementById('btnConfirmarCarrito').addEventListener('click', async () => {
    if(CARRITO.length === 0) return;
    const statusDiv = document.getElementById('cartStatus');
    
    const itemsAProcesar = CARRITO.map(c => ({
        ninventario: c.ninventario,
        descripcion: c.descripcion,
        observaciones: sanitizarTexto(document.getElementById(`cart-obs-${c.ninventario}`).value)
    }));

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b'; statusDiv.innerText = "Despachando solicitud..."; statusDiv.style.display = 'block';

    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "PEDIDO_MULTIPLE", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, tipo_movimiento: "PRESTADO", items: itemsAProcesar })
        });
        const res = await response.json();
        if(res.status === 'success') {
            statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534'; statusDiv.innerText = "¡Préstamo autorizado!";
            setTimeout(() => { statusDiv.style.display = 'none'; }, 3000);
            sincronizarSistema();
        }
    } catch (e) { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = "Error en el servidor."; }
});

// === EXPORTAR HISTORIAL MENSUAL (SOLO ADMIN) ===
document.getElementById('btnExportarHistorial').addEventListener('click', () => {
    if(CONFIG_SESION.rol !== 'Admin') return alert("Acceso denegado.");
    if(CACHE_HISTORIAL.length === 0) return alert("No hay movimientos registrados.");

    const historialPorMes = {};

    CACHE_HISTORIAL.forEach(h => {
        const fechaObj = new Date(h.fecha);
        const mesAnio = fechaObj.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
        const nombreHoja = mesAnio.charAt(0).toUpperCase() + mesAnio.slice(1); 

        if(!historialPorMes[nombreHoja]) historialPorMes[nombreHoja] = [];

        historialPorMes[nombreHoja].push({
            "Fecha y Hora": fechaObj.toLocaleString('es-CL'),
            "Operador/Profesor": h.usuario,
            "N° Inventario": h.ninventario,
            "Descripción del Artículo": h.descripcion,
            "Tipo de Operación": h.tipo,
            "Observaciones / Notas": h.obs
        });
    });

    const wb = XLSX.utils.book_new();
    for (let mes in historialPorMes) {
        const ws = XLSX.utils.json_to_sheet(historialPorMes[mes]);
        ws['!cols'] = [{wch: 20}, {wch: 25}, {wch: 15}, {wch: 40}, {wch: 15}, {wch: 40}];
        XLSX.utils.book_append_sheet(wb, ws, mes.substring(0, 31));
    }
    XLSX.writeFile(wb, "Auditoria_Mensual_Panol_Informatica.xlsx");
});

// === EXPORTAR CON FORMATO OFICIAL ERP INACAP ===
document.getElementById('btnExportar').addEventListener('click', () => {
    if(CACHE_INVENTARIO.length === 0) return alert("No hay datos disponibles para exportar.");
    
    const ws_data = [
        [null, null, null, null, null, null, "SEDE", "VALPARAÍSO", null, "RESPONSABLE CUSTODIA", "ÁREA INFORMÁTICA"],
        [null, null, null, null, null, null, "EDIFICIO / SECTOR", "SEDE CENTRAL", null, "FECHA INVENTARIO", new Date().toLocaleDateString('es-CL')],
        [null, null, null, null, null, null, "BODEGA / PAÑOL", "PAÑOL INFORMÁTICA", null, "TIPO INVENTARIO", "INVENTARIO GENERAL"],
        [null, null, null, null, null, null, "ÁREA RESPONSABLE", "INFORMÁTICA"],
        [null, null, 'Si el articulo no esta en "Articulo 1 buscar en "Articulo 2"'],
        [null, null, null, null, 'No Modificar'],
        [null, null, "Articulo 1", "Articulo 2", "Código Art", "Grupo Art", "Descr Familia Art", "Uni Medida", "Fecha Ingreso", "Tipo movimiento", "Cantidad Mov", "Doc Respaldo", "Fecha Vencimiento", "Prog Estudio Solicitante", "Área Solicitante"]
    ];

    CACHE_INVENTARIO.forEach(item => {
        ws_data.push([
            null, null, 
            item.descripcion,                // Articulo 1
            "",                              // Articulo 2 
            item.ninventario,                // Código Art (N° Inventario)
            "MATERIALES_INS",                // Grupo Art 
            "SEDE",                          // Descr Familia Art
            "UNI",                           // Uni Medida
            new Date().toLocaleDateString('es-CL'), // Fecha Ingreso
            "Inventario Inicial",            // Tipo movimiento
            1,                               // Cantidad Mov (Siempre 1 en inventario INACAP)
            "Sistema Pañol",                 // Doc Respaldo
            "", "", ""                       
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventarios pañoles");
    XLSX.writeFile(wb, "Planilla_Inventario_Valparaiso.xlsx");
});

// === IMPORTADOR INTELIGENTE (LEE LA PLANILLA INACAP) ===
document.getElementById('dropZone').addEventListener('click', () => document.getElementById('excelFile').click());
document.getElementById('excelFile').addEventListener('change', function(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    const statusDiv = document.getElementById('importStatus');
    statusDiv.style.display = 'block'; statusDiv.innerText = "Analizando formato corporativo INACAP...";

    reader.onload = async function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Magia: range: 6 le dice que la tabla empieza en la fila 7
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(worksheet, { range: 6, defval: "" });
        
        const payloadData = json.map(row => {
            let r = {};
            for (let c in row) r[c.toLowerCase().replace(/[\s_°]/g, '')] = row[c];
            
            return {
                ubicacion: 'Pañol Informática', 
                grupo: r['grupoart'] || '', 
                ninventario: r['códigoart'] || r['codigoart'] || 'S/N', 
                descripcion: r['articulo1'] || r['artículo1'] || 'Artículo sin nombre',
                estado: 'Bueno', 
                marca: '', 
                modelo: '', 
                nserie: ''
            };
        });

        const datosLimpios = payloadData.filter(item => item.descripcion !== 'Artículo sin nombre');

        statusDiv.innerText = "Inyectando catálogo en la base de datos local...";
        try {
            const response = await fetch(GOOGLE_API_URL, {
                method: 'POST', body: JSON.stringify({ action: "IMPORTAR_INVENTARIO", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, data: datosLimpios })
            });
            const res = await response.json();
            if(res.status === 'success') {
                statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534'; statusDiv.innerText = "¡Catálogo importado y sincronizado!";
                sincronizarSistema();
            } else { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = res.message; }
        } catch(err) { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = "Error de red."; }
    };
    reader.readAsArrayBuffer(file);
});
