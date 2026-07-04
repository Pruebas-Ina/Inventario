// CONFIGURACIÓN PRINCIPAL
const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbwguUMdCXX0UWIV6-rsZVuaO8k_WAogw1UfU11FLM8m2dDD_OtBxRSRYJsqkdKgOx8I/exec';

let CONFIG_SESION = { usuario: "", clave: "", rol: "" };
let CACHE_INVENTARIO = [];
let ZONA_ACTUAL = 'TODOS';

// === SEGURIDAD: PREVENCIÓN DE XSS ===
function sanitizarTexto(texto) {
    if (!texto) return "Sin observaciones.";
    const div = document.createElement('div'); 
    div.innerText = texto; 
    return div.innerHTML;
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
            method: 'POST', 
            body: JSON.stringify({ action: "LOGIN", usuario: user, clave: pass })
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
                // CORRECCIÓN VISUAL: Muestra los elementos Admin cuidando la estructura de las tablas
                document.querySelectorAll('.admin-only').forEach(el => {
                    if(el.tagName === 'TH' || el.tagName === 'TD') {
                        el.style.display = 'table-cell';
                    } else {
                        el.style.display = 'block';
                    }
                });
                document.getElementById('historialTitle').innerText = "Historial General de Auditoría";
            }
            sincronizarSistema();
        } else {
            errorDiv.innerText = res.message; 
            errorDiv.style.display = 'block';
        }
    } catch(err) { 
        errorDiv.innerText = "Error de conexión con el servidor."; 
        errorDiv.style.display = 'block'; 
    }
});

// === CERRAR SESIÓN ===
document.getElementById('btnLogout').addEventListener('click', () => {
    location.reload();
});

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
            renderizarInventario();
            renderizarHistorial(res.historial);
            calcularYRenderizarPendientes(res.historial);
        }
    } catch(error) { 
        console.error("Error al sincronizar datos:", error); 
    }
}

// === CÁLCULO DE EQUIPOS PENDIENTES (QUIÉN DEBE QUÉ) ===
function calcularYRenderizarPendientes(historial) {
    let balances = {};
    
    // Suma préstamos y resta devoluciones matemáticas
    historial.forEach(h => {
        let key = h.usuario + "|||" + h.id_item;
        if(!balances[key]) balances[key] = { usuario: h.usuario, id_item: h.id_item, nombre: h.nombre, balance: 0 };
        
        if(h.tipo === "PRESTADO") balances[key].balance += Number(h.cantidad);
        if(h.tipo === "DEVUELTO") balances[key].balance -= Number(h.cantidad);
    });

    const pendientes = Object.values(balances).filter(b => b.balance > 0);
    const tbody = document.getElementById('pendientesBody');
    tbody.innerHTML = '';

    if(pendientes.length === 0) {
        let cols = CONFIG_SESION.rol === 'Admin' ? 5 : 4;
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center; color:#10b981; font-weight:bold;">¡Todo al día! No hay equipos pendientes.</td></tr>`;
        return;
    }

    pendientes.forEach(p => {
        let adminControls = "";
        const idLimpio = p.usuario.replace(/\s+/g, '_'); 
        const esAdmin = CONFIG_SESION.rol === 'Admin';
        
        // Construimos dinámicamente la celda de control, oculta si es profesor
        adminControls = `
            <td class="admin-only" style="display: ${esAdmin ? 'table-cell' : 'none'}; vertical-align: middle;">
                <div style="display:flex; gap:5px;">
                    <input type="number" id="dev-qty-${idLimpio}-${p.id_item}" value="${p.balance}" min="1" max="${p.balance}" class="qty-input">
                    <button class="btn btn-success" style="padding: 6px 12px; font-size:12px;" onclick="procesarDevolucionAdmin('${p.usuario}', '${p.id_item}', '${p.nombre}')">Devolver</button>
                </div>
            </td>
        `;

        tbody.innerHTML += `
            <tr>
                <td><strong>${p.usuario}</strong></td>
                <td><code>${p.id_item}</code></td>
                <td>${p.nombre}</td>
                <td style="font-weight:bold; color:var(--danger); font-size:16px;">${p.balance}</td>
                ${adminControls}
            </tr>
        `;
    });
}

// === DEVOLUCIÓN CONTROLADA POR EL ADMINISTRADOR ===
window.procesarDevolucionAdmin = async function(usuarioAfectado, idItem, nombreItem) {
    const idLimpio = usuarioAfectado.replace(/\s+/g, '_');
    const qtyInput = document.getElementById(`dev-qty-${idLimpio}-${idItem}`);
    
    if(!qtyInput) { alert("Error al capturar la celda de cantidad."); return; }
    
    const cantidadADevolver = qtyInput.value;
    const statusDiv = document.getElementById('returnStatus');

    if(!confirm(`¿Confirmar recepción física de ${cantidadADevolver} unidades de "${nombreItem}" devueltas por ${usuarioAfectado}?`)) return;

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b';
    statusDiv.innerText = "Procesando el reingreso en la base de datos...";
    statusDiv.style.display = 'block';

    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "PEDIDO_MULTIPLE",
                usuario: CONFIG_SESION.usuario, 
                clave: CONFIG_SESION.clave,
                tipo_movimiento: "DEVUELTO",
                items: [{
                    id_item: idItem,
                    nombre: nombreItem,
                    cantidad: cantidadADevolver,
                    observaciones: "Recepcionado y verificado físicamente por el Administrador.",
                    usuario_asignado: usuarioAfectado 
                }]
            })
        });
        const res = await response.json();
        if(res.status === 'success') {
            statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534';
            statusDiv.innerText = "¡Devolución registrada! El inventario ha sido actualizado.";
            setTimeout(() => { statusDiv.style.display = 'none'; }, 3000);
            sincronizarSistema(); 
        } else {
            statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
            statusDiv.innerText = res.message || "Error al procesar el reingreso.";
        }
    } catch (e) {
        statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
        statusDiv.innerText = "Error crítico de comunicación con el servidor.";
    }
}

// === FILTRADO POR ZONAS ===
document.querySelectorAll('.zone-card').forEach(card => {
    card.addEventListener('click', (e) => {
        document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        ZONA_ACTUAL = e.target.getAttribute('data-zone');
        renderizarInventario();
    });
});

// === RENDERIZAR VITRINA DEL INVENTARIO ===
function renderizarInventario() {
    const tbody = document.getElementById('inventoryBody'); 
    tbody.innerHTML = '';
    
    const filtrados = CACHE_INVENTARIO.filter(item => ZONA_ACTUAL === 'TODOS' || item.zona === ZONA_ACTUAL);
    
    if(filtrados.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; font-style:italic;">No hay elementos registrados en esta zona.</td></tr>`; 
        return; 
    }
    
    filtrados.forEach(item => {
        const disponible = Number(item.disponibles);
        const badge = disponible > 0 ? `<span class="badge available">${disponible} ${item.unidad}</span>` : `<span class="badge unavailable">Agotado</span>`;
        tbody.innerHTML += `
            <tr id="row-${item.id_item}">
                <td><input type="checkbox" class="item-select" value="${item.id_item}" ${disponible <= 0 ? 'disabled' : ''}></td>
                <td><small><code>${item.id_item}</code></small></td>
                <td><strong>${item.nombre}</strong></td>
                <td><span style="font-size:13px; color:#4b5563;">📦 ${item.zona}</span></td>
                <td style="text-align: center;">${badge}</td>
                <td><input type="number" class="qty-input" id="qty-${item.id_item}" value="1" min="1" max="${disponible}"></td>
                <td><input type="text" class="obs-input" id="obs-${item.id_item}" placeholder="Agregar nota..."></td>
            </tr>
        `;
    });
    document.getElementById('loadingInventory').style.display = 'none';
    document.getElementById('inventoryTable').style.display = 'table';
}

// === RENDERIZAR HISTORIAL DE AUDITORÍA ===
function renderizarHistorial(historial) {
    const tbody = document.getElementById('historyBody'); 
    tbody.innerHTML = '';
    historial.forEach(h => {
        const f = new Date(h.fecha).toLocaleDateString('es-CL', {hour:'2-digit', minute:'2-digit'});
        const opStyle = h.tipo === 'PRESTADO' ? 'color:var(--danger);font-weight:bold;' : 'color:var(--success);font-weight:bold;';
        tbody.innerHTML += `<tr><td><small>${f}</small></td><td>${h.usuario}</td><td><code>${h.id_item}</code></td><td>${h.nombre}</td><td>${h.cantidad}</td><td style="${opStyle}">${h.tipo}</td><td><small>${h.obs}</small></td></tr>`;
    });
}

// === REGISTRAR SOLICITUD DE PRÉSTAMOS ===
document.getElementById('btnProcesar').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.item-select:checked');
    if(checkboxes.length === 0) return alert("Debe seleccionar al menos un artículo de la vitrina.");

    const statusDiv = document.getElementById('actionStatus');
    const itemsAProcesar = [];

    checkboxes.forEach(cb => {
        const id = cb.value; 
        const articuloCache = CACHE_INVENTARIO.find(i => i.id_item === id);
        itemsAProcesar.push({
            id_item: id, 
            nombre: articuloCache.nombre,
            cantidad: document.getElementById(`qty-${id}`).value,
            observaciones: sanitizarTexto(document.getElementById(`obs-${id}`).value)
        });
    });

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b'; statusDiv.innerText = "Despachando solicitud..."; statusDiv.style.display = 'block';

    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "PEDIDO_MULTIPLE", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, tipo_movimiento: "PRESTADO", items: itemsAProcesar })
        });
        const res = await response.json();
        if(res.status === 'success') {
            statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534'; statusDiv.innerText = "¡Préstamo autorizado con éxito! Comprobante enviado.";
            sincronizarSistema();
        } else {
            statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b'; statusDiv.innerText = res.message;
        }
    } catch (e) { 
        statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b'; statusDiv.innerText = "Error en la transacción."; 
    }
});

// === EXPORTAR BASE DE DATOS (ENCABEZADOS IDÉNTICOS A TU PLANTILLA) ===
document.getElementById('btnExportar').addEventListener('click', () => {
    if(CACHE_INVENTARIO.length === 0) return alert("No hay datos disponibles para exportar.");
    
    // Mapeo inverso: Reconstruye las columnas originales con mayúsculas y guiones bajos
    const datosEstandarizados = CACHE_INVENTARIO.map(item => ({
        "ID_Item": item.id_item,
        "Nombre": item.nombre,
        "Zona": item.zona,
        "Cantidad_Total": Number(item.total) || 0,
        "Cantidad_Prestada": Number(item.prestado) || 0,
        "Disponibles": Number(item.disponibles) || 0,
        "Unidad": item.unidad
    }));

    const ws = XLSX.utils.json_to_sheet(datosEstandarizados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario_Actual");
    XLSX.writeFile(wb, "Inventario_Maestro_Final.xlsx");
});

// === IMPORTADOR INTELIGENTE DE EXCEL (A PRUEBA DE MAYÚSCULAS/ESPACIOS) ===
document.getElementById('dropZone').addEventListener('click', () => document.getElementById('excelFile').click());
document.getElementById('excelFile').addEventListener('change', function(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    const statusDiv = document.getElementById('importStatus');
    statusDiv.style.display = 'block'; statusDiv.innerText = "Leyendo archivo Excel...";

    reader.onload = async function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
        
        // NORMALIZADOR INTELIGENTE: Pasa llaves a minúsculas y elimina espacios/guiones para evitar desajustes
        const payloadData = json.map(row => {
            let rowLimpia = {};
            for (let clave in row) {
                let claveNormalizada = clave.toLowerCase().replace(/[\s_]/g, '');
                rowLimpia[claveNormalizada] = row[clave];
            }

            return {
                id_item: rowLimpia['iditem'] || 'S/N', 
                nombre: rowLimpia['nombre'] || 'Artículo sin nombre',
                zona: rowLimpia['zona'] || 'Bodega', 
                cantidad_total: Number(rowLimpia['cantidadtotal']) || 0, 
                unidad: rowLimpia['unidad'] || 'Unidad'
            };
        });

        statusDiv.innerText = "Sincronizando actualizaciones en la nube...";
        try {
            const response = await fetch(GOOGLE_API_URL, {
                method: 'POST', 
                body: JSON.stringify({ action: "IMPORTAR_INVENTARIO", usuario: CONFIG_SESION.usuario, clave: CONFIG_SESION.clave, data: payloadData })
            });
            const res = await response.json();
            if(res.status === 'success') {
                statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534'; statusDiv.innerText = "¡Base de datos sincronizada correctamente!";
                sincronizarSistema();
            } else { 
                statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b'; statusDiv.innerText = res.message; 
            }
        } catch(err) { 
            statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b'; statusDiv.innerText = "Error de red al intentar subir el archivo."; 
        }
    };
    reader.readAsArrayBuffer(file);
});
