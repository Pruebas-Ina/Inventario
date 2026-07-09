// ⚠️ IMPORTANTE: COLOCA AQUÍ LA URL DE TU SCRIPT DE GOOGLE
const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbwguUMdCXX0UWIV6-rsZVuaO8k_WAogw1UfU11FLM8m2dDD_OtBxRSRYJsqkdKgOx8I/exec';

let CONFIG_SESION = { usuario: "", clave: "", rol: "" };
let CACHE_INVENTARIO = [];
let CACHE_HISTORIAL = []; 
let CARRITO = [];
let ZONA_ACTUAL = 'TODOS';

function sanitizarTexto(texto) {
    if (!texto) return "Sin observaciones.";
    const div = document.createElement('div'); div.innerText = texto; return div.innerHTML;
}

document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const user = document.getElementById('loginUser').value; const pass = document.getElementById('loginPass').value;
    const errorDiv = document.getElementById('loginError'); errorDiv.style.display = 'none';

    try {
        const response = await fetch(GOOGLE_API_URL, { method: 'POST', body: JSON.stringify({ action: "LOGIN", usuario: user, clave: pass }) });
        const res = await response.json();
        if(res.status === 'success') {
            CONFIG_SESION.usuario = res.usuario; CONFIG_SESION.clave = pass; CONFIG_SESION.rol = res.rol;
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            document.getElementById('sessionLabel').innerText = `${res.usuario} (${res.rol})`;
            
            if(res.rol === 'Admin') {
                document.querySelectorAll('.admin-only').forEach(el => {
                    if(el.tagName === 'TH' || el.tagName === 'TD') el.style.display = 'table-cell'; else el.style.display = 'block';
                });
            }
            sincronizarSistema();
        } else { errorDiv.innerText = res.message; errorDiv.style.display = 'block'; }
    } catch(err) { errorDiv.innerText = "Error de conexión."; errorDiv.style.display = 'block'; }
});

document.getElementById('btnLogout').addEventListener('click', () => location.reload());

async function sincronizarSistema() {
    document.getElementById('loadingInventory').style.display = 'block';
    document.getElementById('inventoryTable').style.display = 'none';
    try {
        const url = `${GOOGLE_API_URL}?usuario=${encodeURIComponent(CONFIG_SESION.usuario)}&clave=${encodeURIComponent(CONFIG_SESION.clave)}`;
        const response = await fetch(url);
        const res = await response.json();
        if(res.status === 'success') {
            CACHE_INVENTARIO = res.inventario; CACHE_HISTORIAL = res.historial; CARRITO = []; 
            renderizarCarrito(); renderizarInventario(); renderizarHistorial(res.historial); calcularYRenderizarPendientes(res.historial);
        }
    } catch(error) { console.error("Error al sincronizar:", error); }
}

function calcularYRenderizarPendientes(historial) {
    let balances = {};
    historial.forEach(h => {
        let key = h.usuario + "|||" + h.id_item;
        if(!balances[key]) balances[key] = { usuario: h.usuario, id_item: h.id_item, nombre: h.nombre, balance: 0 };
        if(h.tipo === "PRESTADO") balances[key].balance += Number(h.cantidad);
        if(h.tipo === "DEVUELTO") balances[key].balance -= Number(h.cantidad);
    });

    const pendientes = Object.values(balances).filter(b => b.balance > 0);
    const tbody = document.getElementById('pendientesBody'); tbody.innerHTML = '';

    if(pendientes.length === 0) {
        let cols = CONFIG_SESION.rol === 'Admin' ? 5 : 4;
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center; color:#27AE60; font-weight:bold;">No hay equipos pendientes.</td></tr>`;
        return;
    }

    pendientes.forEach(p => {
        let adminControls = "";
        const idLimpio = p.usuario.replace(/\s+/g, '_'); 
        if(CONFIG_SESION.rol === 'Admin') {
            adminControls = `
                <td class="admin-only" style="display: table-cell; vertical-align: middle;">
                    <div style="display:flex; gap:5px;">
                        <input type="number" id="dev-qty-${idLimpio}-${p.id_item}" value="${p.balance}" min="1" max="${p.balance}" class="qty-input">
                        <button class="btn btn-success" style="padding: 6px 12px; font-size:12px;" onclick="procesarDevolucionAdmin('${p.usuario}', '${p.id_item}', '${p.nombre}')">Devolver</button>
                    </div>
                </td>`;
        }
        tbody.innerHTML += `<tr><td><strong>${p.usuario}</strong></td><td><code>${p.id_item}</code></td><td>${p.nombre}</td><td style="font-weight:bold; color:var(--danger);">${p.balance}</td>${adminControls}</tr>`;
    });
}

window.procesarDevolucionAdmin = async function(usuarioAfectado, idItem, nombreItem) {
    const idLimpio = usuarioAfectado.replace(/\s+/g, '_');
    const qtyInput = document.getElementById(`dev-qty-${idLimpio}-${idItem}`);
    if(!qtyInput) return;
    const cantidad = qtyInput.value;
    const statusDiv = document.getElementById('returnStatus');
    if(!confirm(`¿Confirmar recepción de ${cantidad} unidades de "${nombreItem}" devueltas por ${usuarioAfectado}?`)) return;

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b'; statusDiv.innerText = "Procesando..."; statusDiv.style.display = 'block';
    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST', body: JSON.stringify({
                action: "PEDIDO_MULTIPLE", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, tipo_movimiento: "DEVUELTO",
                items: [{ id_item: idItem, nombre: nombreItem, cantidad: cantidad, observaciones: "Recepción Admin", usuario_asignado: usuarioAfectado }]
            })
        });
        const res = await response.json();
        if(res.status === 'success') { statusDiv.style.display = 'none'; sincronizarSistema(); }
    } catch (e) { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = "Error."; }
}

document.getElementById('searchInput').addEventListener('keyup', renderizarInventario);

document.querySelectorAll('.zone-card').forEach(card => {
    card.addEventListener('click', (e) => {
        document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('active')); e.target.classList.add('active');
        ZONA_ACTUAL = e.target.getAttribute('data-zone'); renderizarInventario();
    });
});

// === RENDERIZAR VITRINA (AQUÍ SE PIDEN LAS CANTIDADES) ===
function renderizarInventario() {
    const tbody = document.getElementById('inventoryBody'); tbody.innerHTML = '';
    const terminoBusqueda = document.getElementById('searchInput').value.toLowerCase();
    
    const filtrados = CACHE_INVENTARIO.filter(item => {
        const matchZona = (ZONA_ACTUAL === 'TODOS' || item.zona === ZONA_ACTUAL);
        const idTexto = String(item.id_item || "").toLowerCase();
        const nombreTexto = String(item.nombre || "").toLowerCase();
        const matchTexto = (idTexto.includes(terminoBusqueda) || nombreTexto.includes(terminoBusqueda));
        return matchZona && matchTexto;
    });
    
    if(filtrados.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No se encontraron resultados.</td></tr>`; return; }
    
    filtrados.forEach(item => {
        const disponible = Number(item.disponibles);
        const estaEnCarrito = CARRITO.some(c => c.id_item === item.id_item);
        const badge = disponible > 0 ? `<span class="badge available">${disponible} Disp.</span>` : `<span class="badge unavailable">Agotado</span>`;
        
        let inputCant = `<input type="number" id="pre-qty-${item.id_item}" class="qty-input" value="1" min="1" max="${disponible}" style="width: 50px;">`;
        let inputObs = `<input type="text" id="pre-obs-${item.id_item}" class="obs-input" placeholder="Nota de uso..." style="width: 100%;">`;
        let botonAccion = "";

        if(disponible <= 0) {
            botonAccion = `<span style="font-size:12px; color:#95A5A6;">Agotado</span>`;
            inputCant = "-"; inputObs = "-";
        } else if (estaEnCarrito) {
            botonAccion = `<span class="badge" style="background:#34495E; color:white;">En carrito</span>`;
            inputCant = "-"; inputObs = "-";
        } else {
            botonAccion = `<button class="btn btn-add" onclick="agregarAlCarrito('${item.id_item}')">Añadir</button>`;
        }

        tbody.innerHTML += `
            <tr>
                <td><code>${item.id_item}</code></td>
                <td><strong>${item.nombre}</strong><br><span style="font-size:11px; color:#7F8C8D;">📦 ${item.zona}</span></td>
                <td style="text-align: center;">${badge}</td>
                <td>${inputCant}</td>
                <td>${inputObs}</td>
                <td>${botonAccion}</td>
            </tr>`;
    });
    document.getElementById('loadingInventory').style.display = 'none'; document.getElementById('inventoryTable').style.display = 'table';
}

function renderizarHistorial(historial) {
    const tbody = document.getElementById('historyBody'); tbody.innerHTML = '';
    historial.forEach(h => {
        const f = new Date(h.fecha).toLocaleDateString('es-CL', {hour:'2-digit', minute:'2-digit'});
        const opStyle = h.tipo === 'PRESTADO' ? 'color:var(--danger);font-weight:bold;' : 'color:var(--success);font-weight:bold;';
        tbody.innerHTML += `<tr><td><small>${f}</small></td><td>${h.usuario}</td><td><code>${h.id_item}</code></td><td>${h.nombre}</td><td>${h.cantidad}</td><td style="${opStyle}">${h.tipo}</td><td><small>${h.obs}</small></td></tr>`;
    });
}

// === CARRITO INTELIGENTE ===
window.agregarAlCarrito = function(idItem) {
    const item = CACHE_INVENTARIO.find(i => i.id_item === idItem);
    if(item && !CARRITO.some(c => c.id_item === idItem)) {
        // Captura la cantidad y la nota DESDE la tabla principal antes de agregarlo
        const qty = document.getElementById(`pre-qty-${idItem}`).value;
        const obs = document.getElementById(`pre-obs-${idItem}`).value;
        CARRITO.push({ ...item, cantidadPedida: qty, nota: obs }); 
        renderizarCarrito(); 
        renderizarInventario(); // Refresca para bloquear la fila añadida
    }
}

window.quitarDelCarrito = function(idItem) {
    CARRITO = CARRITO.filter(c => c.id_item !== idItem); renderizarCarrito(); renderizarInventario();
}

function renderizarCarrito() {
    const card = document.getElementById('cartCard'); const tbody = document.getElementById('cartBody'); tbody.innerHTML = '';
    if(CARRITO.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    CARRITO.forEach(item => {
        // El carrito ahora solo MUESTRA la información (No tiene inputs que se reinicien)
        tbody.innerHTML += `
            <tr>
                <td><code>${item.id_item}</code></td>
                <td><strong>${item.nombre}</strong></td>
                <td style="text-align:center; font-weight:bold;">${item.cantidadPedida}</td>
                <td><small>${item.nota || 'Sin notas'}</small></td>
                <td><button class="btn" style="background:var(--danger); padding: 5px 10px;" onclick="quitarDelCarrito('${item.id_item}')">X</button></td>
            </tr>`;
    });
}

document.getElementById('btnConfirmarCarrito').addEventListener('click', async () => {
    if(CARRITO.length === 0) return;
    const statusDiv = document.getElementById('cartStatus');
    const itemsAProcesar = CARRITO.map(c => ({ 
        id_item: c.id_item, 
        nombre: c.nombre, 
        cantidad: c.cantidadPedida, 
        observaciones: sanitizarTexto(c.nota) 
    }));

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b'; statusDiv.innerText = "Despachando solicitud..."; statusDiv.style.display = 'block';

    try {
        const response = await fetch(GOOGLE_API_URL, { method: 'POST', body: JSON.stringify({ action: "PEDIDO_MULTIPLE", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, tipo_movimiento: "PRESTADO", items: itemsAProcesar }) });
        const res = await response.json();
        if(res.status === 'success') {
            statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534'; statusDiv.innerText = "¡Préstamo autorizado!";
            setTimeout(() => { statusDiv.style.display = 'none'; }, 3000); sincronizarSistema();
        }
    } catch (e) { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = "Error en el servidor."; }
});

// === EXPORTAR HISTORIAL MENSUAL (AUDITORÍA COMPLETA) ===
document.getElementById('btnExportarHistorial').addEventListener('click', async () => {
    if(CONFIG_SESION.rol !== 'Admin') return alert("Acceso denegado.");
    const btn = document.getElementById('btnExportarHistorial');
    const textoOriginal = btn.innerText;
    btn.innerText = "⏳ Construyendo reporte desde la nube..."; btn.disabled = true;

    try {
        const response = await fetch(GOOGLE_API_URL, { method: 'POST', body: JSON.stringify({ action: "DESCARGAR_HISTORIAL_COMPLETO", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave }) });
        const res = await response.json();
        
        if(res.status === 'success') {
            const historialCompleto = res.historial;
            if(historialCompleto.length === 0) { alert("No hay movimientos."); btn.innerText = textoOriginal; btn.disabled = false; return; }

            const historialPorMes = {};
            historialCompleto.forEach(h => {
                const fechaObj = new Date(h.fecha);
                const mesAnio = fechaObj.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
                const nombreHoja = mesAnio.charAt(0).toUpperCase() + mesAnio.slice(1); 
                if(!historialPorMes[nombreHoja]) historialPorMes[nombreHoja] = [];
                historialPorMes[nombreHoja].push({
                    "Fecha y Hora": fechaObj.toLocaleString('es-CL'), "Operador/Profesor": h.usuario, "ID": h.id_item,
                    "Descripción del Artículo": h.nombre, "Tipo de Operación": h.tipo, "Cantidad": h.cantidad, "Observaciones / Notas": h.obs
                });
            });

            const wb = XLSX.utils.book_new();
            for (let mes in historialPorMes) {
                const ws = XLSX.utils.json_to_sheet(historialPorMes[mes]);
                ws['!cols'] = [{wch: 20}, {wch: 25}, {wch: 15}, {wch: 40}, {wch: 15}, {wch: 10}, {wch: 40}];
                XLSX.utils.book_append_sheet(wb, ws, mes.substring(0, 31));
            }
            XLSX.writeFile(wb, "Auditoria_Mensual_Panol_Informatica.xlsx");
        } else { alert("Error: " + res.message); }
    } catch(e) { alert("Error al intentar descargar el reporte."); }
    btn.innerText = textoOriginal; btn.disabled = false;
});

// === EXPORTAR STOCK (FORMATO OFICIAL ERP INACAP) ===
document.getElementById('btnExportar').addEventListener('click', () => {
    if(CACHE_INVENTARIO.length === 0) return alert("No hay datos disponibles para exportar.");
    
    // 1. Cabeceras estrictas del ERP
    const ws_data = [
        [null, null, null, null, null, null, "SEDE", "VALPARAÍSO", null, "RESPONSABLE CUSTODIA", "ÁREA INFORMÁTICA"],
        [null, null, null, null, null, null, "EDIFICIO / SECTOR", "SEDE CENTRAL", null, "FECHA INVENTARIO", new Date().toLocaleDateString('es-CL')],
        [null, null, null, null, null, null, "BODEGA / PAÑOL", "PAÑOL INFORMÁTICA", null, "TIPO INVENTARIO", "INVENTARIO GENERAL"],
        [null, null, null, null, null, null, "ÁREA RESPONSABLE", "INFORMÁTICA"],
        [null, null, 'Si el articulo no esta en "Articulo 1 buscar en "Articulo 2"'],
        [null, null, null, null, 'No Modificar'],
        [null, null, "Articulo 1", "Articulo 2", "Código Art", "Grupo Art", "Descr Familia Art", "Uni Medida", "Fecha Ingreso", "Tipo movimiento", "Cantidad Mov", "Doc Respaldo", "Fecha Vencimiento", "Prog Estudio Solicitante", "Área Solicitante"]
    ];

    // 2. Mapeo del Inventario Físico ("Inventario Inicial" en jerga ERP)[cite: 3]
    CACHE_INVENTARIO.forEach(item => {
        ws_data.push([ 
            null, null, 
            item.nombre,                     // Articulo 1
            "",                              // Articulo 2 
            item.id_item,                    // Código Art 
            "MATERIALES_INS",                // Grupo Art 
            "SEDE",                          // Descr Familia Art
            item.unidad || "UNI",            // Uni Medida
            new Date().toLocaleDateString('es-CL'), // Fecha Ingreso
            "Inventario Inicial",            // Tipo movimiento (Así declaran Stock)
            item.total,                      // Cantidad Mov (Cantidad Total Física)
            "Sistema Interno Pañol",         // Doc Respaldo
            "", "", "" 
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventarios pañoles");
    XLSX.writeFile(wb, "Inventario_Stock_INACAP.xlsx");
});

// === IMPORTADOR DE TU EXCEL BASE LOCAL (7 COLUMNAS) ===
document.getElementById('dropZone').addEventListener('click', () => document.getElementById('excelFile').click());
document.getElementById('excelFile').addEventListener('change', function(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader(); const statusDiv = document.getElementById('importStatus');
    statusDiv.style.display = 'block'; statusDiv.innerText = "Actualizando catálogo local...";

    reader.onload = async function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
        
        const payloadData = json.map(row => {
            let r = {}; for (let c in row) r[c.toLowerCase().replace(/[\s_°]/g, '')] = row[c];
            return {
                id_item: r['iditem'] || 'S/N', nombre: r['nombre'] || 'Sin nombre', zona: r['zona'] || 'Bodega', 
                cantidad_total: Number(r['cantidadtotal']) || 0, unidad: r['unidad'] || 'Unidad'
            };
        });

        try {
            const response = await fetch(GOOGLE_API_URL, { method: 'POST', body: JSON.stringify({ action: "IMPORTAR_INVENTARIO", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, data: payloadData }) });
            const res = await response.json();
            if(res.status === 'success') {
                statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534'; statusDiv.innerText = "¡Catálogo importado!";
                sincronizarSistema();
            } else { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = res.message; }
        } catch(err) { statusDiv.style.background = '#FADBD8'; statusDiv.style.color = '#78281F'; statusDiv.innerText = "Error de red."; }
    };
    reader.readAsArrayBuffer(file);
});
