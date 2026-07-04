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
            body: JSON.stringify({ 
                action: "LOGIN", 
                usuario: user, 
                clave: pass 
            })
        });
        const res = await response.json();

        if(res.status === 'success') {
            CONFIG_SESION.usuario = res.usuario;
            CONFIG_SESION.clave = pass; // <-- GUARDAMOS LA CLAVE COMO FIRMA DIGITAL
            CONFIG_SESION.rol = res.rol;
            
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            document.getElementById('sessionLabel').innerText = `${res.usuario} (${res.rol})`;
            
            if(res.rol === 'Admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
                document.getElementById('historialTitle').innerText = "Historial General de Auditoría";
            }
            sincronizarSistema();
        } else {
            errorDiv.innerText = res.message;
            errorDiv.style.display = 'block';
        }
    } catch(err) {
        errorDiv.innerText = "Error crítico de conexión con el servidor.";
        errorDiv.style.display = 'block';
    }
});

// === CERRAR SESIÓN ===
document.getElementById('btnLogout').addEventListener('click', () => {
    location.reload();
});

// === SINCRONIZACIÓN GET ===
async function sincronizarSistema() {
    document.getElementById('loadingInventory').style.display = 'block';
    document.getElementById('inventoryTable').style.display = 'none';

    try {
        // Enviamos la clave por la URL para que el servidor autorice la lectura
        const url = `${GOOGLE_API_URL}?usuario=${encodeURIComponent(CONFIG_SESION.usuario)}&clave=${encodeURIComponent(CONFIG_SESION.clave)}&rol=${encodeURIComponent(CONFIG_SESION.rol)}`;
        const response = await fetch(url);
        const res = await response.json();

        if(res.status === 'success') {
            CACHE_INVENTARIO = res.inventario;
            renderizarInventario();
            renderizarHistorial(res.historial);
        } else {
            console.error("Error del servidor:", res.message);
        }
    } catch(error) {
        console.error("Error al sincronizar datos:", error);
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

// === RENDER INVENTARIO ===
function renderizarInventario() {
    const tbody = document.getElementById('inventoryBody');
    tbody.innerHTML = '';
    
    const filtrados = CACHE_INVENTARIO.filter(item => ZONA_ACTUAL === 'TODOS' || item.zona === ZONA_ACTUAL);
    
    if(filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; font-style:italic;">No hay elementos registrados en esta zona.</td></tr>`;
    } else {
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
    }
    document.getElementById('loadingInventory').style.display = 'none';
    document.getElementById('inventoryTable').style.display = 'table';
}

// === RENDER HISTORIAL ===
function renderizarHistorial(historial) {
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '';
    historial.forEach(h => {
        const f = new Date(h.fecha).toLocaleDateString('es-CL', {hour:'2-digit', minute:'2-digit'});
        const opStyle = h.tipo === 'PRESTADO' ? 'color:var(--danger);font-weight:bold;' : 'color:var(--success);font-weight:bold;';
        tbody.innerHTML += `
            <tr>
                <td><small>${f}</small></td>
                <td>${h.usuario}</td>
                <td><code>${h.id_item}</code></td>
                <td>${h.nombre}</td>
                <td>${h.cantidad}</td>
                <td style="${opStyle}">${h.tipo}</td>
                <td><small>${h.obs}</small></td>
            </tr>
        `;
    });
}

// === ENVÍO DE PEDIDOS MÚLTIPLES ===
document.getElementById('btnProcesar').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.item-select:checked');
    if(checkboxes.length === 0) {
        alert("Debe seleccionar al menos un artículo.");
        return;
    }

    const statusDiv = document.getElementById('actionStatus');
    const tipoMovimiento = document.getElementById('bulkAction').value;
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

    statusDiv.style.background = '#e2e8f0'; statusDiv.style.color = '#1e293b';
    statusDiv.innerText = "Procesando el paquete masivo...";
    statusDiv.style.display = 'block';

    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "PEDIDO_MULTIPLE",
                usuario: CONFIG_SESION.usuario,
                clave: CONFIG_SESION.clave, // <-- SE ENVÍA LA CLAVE PARA AUTORIZAR LA ESCRITURA
                tipo_movimiento: tipoMovimiento,
                items: itemsAProcesar
            })
        });
        const res = await response.json();

        if(res.status === 'success') {
            statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534';
            statusDiv.innerText = "¡Transacción múltiple registrada con éxito! Correos despachados.";
            sincronizarSistema();
        } else {
            statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
            statusDiv.innerText = res.message || "Error en la transacción masiva.";
        }
    } catch (e) {
        statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
        statusDiv.innerText = "Error de conexión con el servidor.";
    }
});

// === IMPORTACIÓN DE EXCEL ===
document.getElementById('dropZone').addEventListener('click', () => {
    document.getElementById('excelFile').click();
});

document.getElementById('excelFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if(!file) return;

    const reader = new FileReader();
    const statusDiv = document.getElementById('importStatus');
    statusDiv.style.display = 'block';
    statusDiv.innerText = "Leyendo archivo Excel...";

    reader.onload = async function(e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        
        const payloadData = json.map(row => ({
            id_item: row['ID_Item'] || row['id_item'] || 'S/N',
            nombre: row['Nombre'] || row['nombre'] || 'Artículo sin nombre',
            zona: row['Zona'] || row['zona'] || 'Bodega Telecomunicaciones',
            cantidad_total: row['Cantidad_Total'] || row['cantidad_total'] || 0,
            unidad: row['Unidad'] || row['unidad'] || 'Unidad'
        }));

        statusDiv.innerText = "Inyectando nuevos datos en la nube (Batching)...";

        try {
            const response = await fetch(GOOGLE_API_URL, {
                method: 'POST',
                body: JSON.stringify({ 
                    action: "IMPORTAR_INVENTARIO", 
                    usuario: CONFIG_SESION.usuario,
                    clave: CONFIG_SESION.clave, // <-- SE ENVÍA LA CLAVE PARA VERIFICAR QUE ES ADMIN
                    data: payloadData 
                })
            });
            const res = await response.json();
            if(res.status === 'success') {
                statusDiv.style.background = '#dcfce7'; statusDiv.style.color = '#166534';
                statusDiv.innerText = "¡Inventario importado exitosamente!";
                sincronizarSistema();
            } else {
                statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
                statusDiv.innerText = res.message || "Error al subir.";
            }
        } catch(err) {
            statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
            statusDiv.innerText = "Error de conexión al subir el archivo.";
        }
    };
    reader.readAsArrayBuffer(file);
});
