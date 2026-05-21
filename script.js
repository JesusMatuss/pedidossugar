// CONFIGURACIÓN
const SPREADSHEET_ID = '10Nx3MAg19csBRH-Ndp11TEi3g7zbSUj3eNRx9h2q0VE';
const API_KEY = 'AIzaSyAg3CQI5xzQyedIusY7aMm6kPpvahYv6D4'; 
const RANGE = 'Productos!A2:K1000'; 
const REFRESH_INTERVAL = 30000; 

let allOrders = [];
let workers = JSON.parse(localStorage.getItem('workers') || '[]');

// --- FUNCIONES TRABAJADORES ---
function addWorker() {
    const name = document.getElementById('workerName').value;
    if (name && !workers.includes(name)) {
        workers.push(name);
        localStorage.setItem('workers', JSON.stringify(workers));
        document.getElementById('workerName').value = '';
        renderWorkers();
    }
}

function removeWorker(name) {
    workers = workers.filter(w => w !== name);
    localStorage.setItem('workers', JSON.stringify(workers));
    renderWorkers();
    aplicarFiltro();
}

function renderWorkers() {
    const list = document.getElementById('workersList');
    list.innerHTML = workers.map(w => `
        <li class="flex justify-between items-center bg-gray-100 dark:bg-gray-700 p-2 rounded">
            <span class="dark:text-white">${w}</span>
            <button data-name="${w}" onclick="removeWorker(this.dataset.name)" class="text-red-500">Eliminar</button>
        </li>
    `).join('');
    renderSummary();
    // NECESARIO: Al cambiar la lista de trabajadores, re-renderizar las tarjetas de pedidos
    aplicarFiltro();
}

// --- PERSISTENCIA PEDIDOS ---
function isOrderConfirmed(key) {
    return JSON.parse(localStorage.getItem('confirmedOrders') || '[]').includes(key);
}

function toggleOrderConfirmation(key) {
    let confirmed = JSON.parse(localStorage.getItem('confirmedOrders') || '[]');
    if (confirmed.includes(key)) confirmed = confirmed.filter(k => k !== key);
    else confirmed.push(key);
    localStorage.setItem('confirmedOrders', JSON.stringify(confirmed));
    aplicarFiltro();
}

// --- LÓGICA DE PEDIDOS ---
function parseExcelDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return new Date(0);
    const [datePart, timePart] = dateStr.split(', ');
    if (!datePart || !timePart) return new Date(0);
    const [day, month, year] = datePart.split('/');
    const [hours, minutes, seconds] = timePart.split(':');
    return new Date(year, month - 1, day, hours, minutes, seconds);
}

function agruparPedidos(pedidos) {
    const mapaAgrupado = new Map();
    pedidos.forEach(p => {
        const key = `${p.cliente}|${p.fechaCreacion.getTime()}`;
        if (!mapaAgrupado.has(key)) {
            mapaAgrupado.set(key, {
                idKey: key, 
                cliente: p.cliente, telefono: p.telefono, fechaCreacion: p.fechaCreacion,
                metodoEntrega: p.metodoEntrega, totalMonto: 0, pedidos: [] 
            });
        }
        const grupo = mapaAgrupado.get(key);
        grupo.pedidos.push(p);
        grupo.totalMonto += p.precioTotal;
    });
    return Array.from(mapaAgrupado.values());
}

// --- ASIGNACIÓN DELIVERY ---
function saveDelivery(btn) {
    const key = btn.dataset.key;
    const worker = btn.dataset.worker;
    const price = parseFloat(btn.dataset.price) || 0;
    const assignments = JSON.parse(localStorage.getItem('deliveryAssignments') || '{}');
    assignments[key] = { worker: worker, price: price };
    localStorage.setItem('deliveryAssignments', JSON.stringify(assignments));
    renderSummary();
    btn.textContent = '✓ Guardado';
    setTimeout(() => { btn.textContent = 'Confirmar'; }, 2000);
}

function deleteDelivery(btn) {
    const key = btn.dataset.key;
    const assignments = JSON.parse(localStorage.getItem('deliveryAssignments') || '{}');
    delete assignments[key];
    localStorage.setItem('deliveryAssignments', JSON.stringify(assignments));
    renderSummary();
    aplicarFiltro();
}

function renderSummary() {
    const assignments = JSON.parse(localStorage.getItem('deliveryAssignments') || '{}');
    const workersSummaryDiv = document.getElementById('workersSummary');
    
    const summaryData = {};
    workers.forEach(w => summaryData[w] = { total: 0, entregas: [] });

    Object.entries(assignments).forEach(([key, data]) => {
        if (data.worker && summaryData[data.worker]) {
            summaryData[data.worker].total += data.price;
            const pedido = allOrders.find(p => p.idKey === key);
            if (pedido) {
                summaryData[data.worker].entregas.push({
                    key: key,
                    cliente: pedido.cliente,
                    precio: data.price,
                    fecha: pedido.fechaCreacion.toLocaleString('es-ES', {hour12: false})
                });
            }
        }
    });

    workersSummaryDiv.innerHTML = workers.map(w => {
        const data = summaryData[w];
        const entregasHTML = data.entregas.map(e => `
            <div class="flex justify-between items-center py-1 border-b border-gray-300 dark:border-gray-600 last:border-0">
                <div class="text-xs text-gray-600 dark:text-gray-400 flex-1">
                    <span class="font-medium text-gray-900 dark:text-white">${e.cliente}</span><br>
                    ${e.fecha}
                </div>
                <div class="text-right flex items-center gap-2">
                    <span class="text-sm font-bold text-gray-900 dark:text-white">$${e.precio.toFixed(2)}</span>
                    <button data-key="${e.key}" onclick="deleteDelivery(this)" class="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                </div>
            </div>
        `).join('');
        
        return `
            <div class="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg mb-4">
                <div class="flex justify-between font-bold mb-2 dark:text-white border-b border-gray-400 dark:border-gray-500 pb-2">
                    <span>${w}</span>
                    <span>Total: $${data.total.toFixed(2)}</span>
                </div>
                ${entregasHTML || '<p class="text-xs italic text-gray-400">Sin entregas asignadas</p>'}
            </div>
        `;
    }).join('');
}

// --- OBTENER DATOS ---
async function fetchFromGoogleSheets() {
    const loader = document.getElementById('loadingIndicator');
    loader.classList.remove('hidden');
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${RANGE}?key=${API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.values) {
            const pedidosRaw = data.values.map(row => ({
                cliente: row[0], nombreProducto: row[1], especificacion: row[2], peso: row[3],
                topping: row[4], paquetes: isNaN(parseInt(row[5])) ? 0 : parseInt(row[5]),
                precioTotal: isNaN(parseFloat(row[6])) ? 0 : parseFloat(row[6]),
                telefono: row[7], fechaCreacion: parseExcelDate(row[8]),
                fechaEntrega: parseExcelDate(row[9]), metodoEntrega: row[10]
            }));
            allOrders = agruparPedidos(pedidosRaw);
            aplicarFiltro();
            // Refrescar resumen de deliverys con los pedidos cargados
            renderWorkers();
        }
    } catch (error) { console.error(error); } finally { loader.classList.add('hidden'); }
}

// --- RENDERIZADO ---
function renderizarPedidos(pedidos) {
    // Actualizar resumen de ingresos si la función existe
    if (typeof actualizarResumen === 'function') actualizarResumen(pedidos);
    
    const delCont = document.getElementById('deliveryContainer');
    const locCont = document.getElementById('localContainer');
    delCont.innerHTML = '';
    locCont.innerHTML = '';
    const assignments = JSON.parse(localStorage.getItem('deliveryAssignments') || '{}');

    pedidos.forEach(p => {
        const isDelivery = p.metodoEntrega?.trim().toLowerCase().startsWith('sí');
        const confirmed = isOrderConfirmed(p.idKey);
        const assignment = assignments[p.idKey] || { worker: '', price: 0 };
        
        const itemsHTML = p.pedidos.map(item => `
            <div class="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                <div>
                    <p class="font-semibold ${confirmed ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-white'}">${item.nombreProducto} <span class="text-xs ${confirmed ? 'text-gray-500' : 'text-gray-500'}">(${item.especificacion})</span></p>
                    <p class="text-xs ${confirmed ? 'text-gray-500' : 'text-orange-600 dark:text-orange-400'}">${item.topping} • ${item.peso}g</p>
                </div>
                <div class="text-right">
                    <p class="font-bold ${confirmed ? 'text-gray-500' : 'text-gray-900 dark:text-white'} text-lg">$${item.precioTotal.toFixed(2)}</p>
                    <p class="text-xs ${confirmed ? 'text-gray-500' : 'text-gray-500'} font-bold">${item.paquetes} paq.</p>
                </div>
            </div>
        `).join('');

        const cardHTML = `
            <article class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border ${confirmed ? 'border-orange-500' : 'border-gray-200 dark:border-gray-700'} overflow-hidden transition-all ${confirmed ? 'opacity-60' : ''}">
                <details class="group">
                    <summary class="p-5 cursor-pointer flex justify-between items-center hover:bg-orange-50 dark:hover:bg-gray-700 transition-colors">
                        <div class="flex items-center gap-3">
                                    <input type="checkbox" data-key="${p.idKey}" ${confirmed ? 'checked' : ''} onchange="toggleOrderConfirmation(this.dataset.key)" class="w-6 h-6 rounded cursor-pointer accent-orange-600">
                            <div>
                                <h3 class="text-lg font-bold ${confirmed ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-white'}">${p.cliente}</h3>
                                <p class="text-xs text-gray-500 dark:text-gray-400">Total: <span class="text-xl font-bold ${confirmed ? 'text-gray-500' : 'text-gray-900 dark:text-white'}">$${p.totalMonto.toFixed(2)}</span> • ${p.pedidos.length} productos</p>
                            </div>
                        </div>
                        <span class="text-gray-500 dark:text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div class="px-5 pb-5">
                        ${itemsHTML}
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-3">Tel: ${p.telefono}</p>
                        ${isDelivery ? `
                            <div class="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                                <select onchange="this.parentElement.querySelector('.confirm-btn').dataset.worker=this.value" class="w-full p-1 rounded dark:bg-gray-600 dark:text-white mb-2">
                                    <option value="">Seleccionar Delivery</option>
                                    ${workers.map(w => `<option value="${w}" ${assignment.worker === w ? 'selected' : ''}>${w}</option>`).join('')}
                                </select>
                                <input type="number" placeholder="Precio Delivery" value="${assignment.price}" onchange="this.parentElement.querySelector('.confirm-btn').dataset.price=this.value" class="w-full p-1 rounded dark:bg-gray-600 dark:text-white mb-2">
                                <button class="confirm-btn w-full py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg text-xs transition" data-key="${p.idKey}" data-worker="${assignment.worker}" data-price="${assignment.price}" onclick="saveDelivery(this)">Confirmar</button>
                                ${assignment.worker ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 block text-center mt-1">✓ Asignado a ${assignment.worker}</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                </details>
            </article>
        `;
        if (isDelivery) delCont.innerHTML += cardHTML;
        else locCont.innerHTML += cardHTML;
    });
}

// Filtro
function aplicarFiltro() {
    const search = document.getElementById('searchClient').value.toLowerCase();
    const startStr = document.getElementById('startDateFilter').value;
    const endStr = document.getElementById('endDateFilter').value;
    const sort = document.getElementById('sortOrder').value;

    let filtrados = allOrders.filter(p => {
        const matchesSearch = p.cliente.toLowerCase().includes(search);
        let matchesDate = true;
        if (startStr && endStr) {
            const startDate = new Date(startStr);
            const endDate = new Date(endStr);
            matchesDate = p.fechaCreacion >= startDate && p.fechaCreacion <= endDate;
        }
        return matchesSearch && matchesDate;
    });

    filtrados.sort((a, b) => {
        if (sort === 'newest') return b.fechaCreacion - a.fechaCreacion;
        if (sort === 'oldest') return a.fechaCreacion - b.fechaCreacion;
        if (sort === 'priceHigh') return b.totalMonto - a.totalMonto;
        if (sort === 'priceLow') return a.totalMonto - b.totalMonto;
    });

    renderizarPedidos(filtrados);
}

// Resumen
function actualizarResumen(pedidos) {
    const totalMonto = pedidos.reduce((sum, p) => sum + p.totalMonto, 0);
    const totalPaquetes = pedidos.reduce((sum, p) => sum + p.pedidos.reduce((sub, item) => sub + item.paquetes, 0), 0);
    const pendientes = pedidos.filter(p => !isOrderConfirmed(p.idKey)).length;

    const elMonto = document.getElementById('totalIngresos');
    const elPaquetes = document.getElementById('totalPaquetes');
    const elPendientes = document.getElementById('totalPendientes');

    if(elMonto) elMonto.textContent = `$${totalMonto.toFixed(2)}`;
    if(elPaquetes) elPaquetes.textContent = totalPaquetes;
    if(elPendientes) elPendientes.textContent = pendientes;
}

// Event Listeners
document.getElementById('startDateFilter').addEventListener('change', aplicarFiltro);
document.getElementById('endDateFilter').addEventListener('change', aplicarFiltro);
document.getElementById('searchClient').addEventListener('input', aplicarFiltro);
document.getElementById('sortOrder').addEventListener('change', aplicarFiltro);

// --- FACTURA DIARIA ---
function generarFacturaDiaria() {
    const assignments = JSON.parse(localStorage.getItem('deliveryAssignments') || '{}');
    
    const porDia = {};
    allOrders.forEach(p => {
        const dia = p.fechaCreacion.toLocaleDateString('es-ES');
        if (!porDia[dia]) porDia[dia] = { ingresos: 0, paquetes: 0, pedidos: 0, deliverys: 0 };
        porDia[dia].ingresos += p.totalMonto;
        porDia[dia].paquetes += p.pedidos.reduce((s, i) => s + i.paquetes, 0);
        porDia[dia].pedidos += 1;
        const asign = assignments[p.idKey];
        if (asign && asign.worker) porDia[dia].deliverys += asign.price;
    });

    const filas = Object.entries(porDia).map(([dia, datos]) => {
        const neto = datos.ingresos - datos.deliverys;
        return `<tr>
            <td style="padding:8px;border:1px solid #ccc;">${dia}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:center;">${datos.pedidos}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:center;">${datos.paquetes}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:right;">$${datos.ingresos.toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:right;">$${datos.deliverys.toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ccc;text-align:right;font-weight:bold;">$${neto.toFixed(2)}</td>
        </tr>`;
    }).join('');

    const totIng = Object.values(porDia).reduce((s, d) => s + d.ingresos, 0);
    const totPaq = Object.values(porDia).reduce((s, d) => s + d.paquetes, 0);
    const totDel = Object.values(porDia).reduce((s, d) => s + d.deliverys, 0);
    const totNet = totIng - totDel;

    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>Factura Diaria - SugarBread</title>
        <style>
            body { font-family: Arial, sans-serif; padding:30px; color:#333; }
            h1 { color:#ea580c; margin-bottom:5px; }
            h2 { color:#666; font-weight:normal; font-size:14px; margin-bottom:20px; }
            table { width:100%; border-collapse:collapse; }
            th { background:#ea580c; color:white; padding:10px 8px; text-align:left; }
            td { padding:8px; border-bottom:1px solid #ddd; }
            .trow td { font-weight:bold; background:#fff7ed; border-top:2px solid #ea580c; }
            .f { margin-top:20px; text-align:center; color:#999; font-size:12px; }
        </style></head>
        <body>
            <h1>🥖 SugarBread</h1>
            <h2>Resumen de Facturación Diaria</h2>
            <table>
                <thead><tr><th>Fecha</th><th>Pedidos</th><th>Paquetes</th><th>Ingresos</th><th>Delivery</th><th>Neto</th></tr></thead>
                <tbody>${filas}
                    <tr class="trow">
                        <td><strong>TOTAL</strong></td>
                        <td style="text-align:center;">${Object.keys(porDia).length} días</td>
                        <td style="text-align:center;">${totPaq}</td>
                        <td style="text-align:right;">$${totIng.toFixed(2)}</td>
                        <td style="text-align:right;">$${totDel.toFixed(2)}</td>
                        <td style="text-align:right;">$${totNet.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
            <div class="f">Generado el ${new Date().toLocaleString('es-ES')}</div>
            <script>window.print();<\/script>
        </body></html>
    `);
    win.document.close();
}

fetchFromGoogleSheets();
renderWorkers();
setInterval(fetchFromGoogleSheets, REFRESH_INTERVAL);
