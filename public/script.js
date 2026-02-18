// 1. Initialize Pusher
const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

// 2. Map & State Setup
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var markers = {};
var trackPaths = {}; 
var trackCoords = {}; 
let pendingClearCallsign = null;
let stationToDelete = null; 
let userRole = ''; 

// --- 3. SYMBOL MAPPING ---
const symbolNames = { 
    '/[': 'Human', '/r': 'iGate', '/1': 'Digital Station', '/>': 'Vehicle', '/-': 'Home', '/A': 'Ambulance', '/f': 'Fire Truck' 
};

function getSymbolIcon(symbol) {
    const iconMapping = { 
        '/[': 'human.png', '/r': 'igate.png', '/1': 'station.png', '/>': 'car.png', '/-': 'house.png', '/a': 'ambulance.png', '/f': 'fire_truck.png' 
    };
    const fileName = iconMapping[symbol] || 'default-pin.png';
    return L.icon({ 
        iconUrl: `icons/${fileName}`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -15], symbolCode: symbol 
    });
}

// --- 4. MODAL UTILITIES ---
function showSuccess(title, message) {
    document.getElementById('successTitle').innerText = title;
    document.getElementById('successMessage').innerText = message;
    document.getElementById('successModal').style.display = 'flex';
}
function closeSuccessModal() { document.getElementById('successModal').style.display = 'none'; }

function openConfirmModal(callsign) {
    pendingClearCallsign = callsign;
    if (document.getElementById('confirmCallsign')) document.getElementById('confirmCallsign').innerText = callsign;
    document.getElementById('confirmModal').style.display = 'flex';
}
function closeConfirmModal() { document.getElementById('confirmModal').style.display = 'none'; }

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
    stationToDelete = null;
}

// --- UPDATED: REGISTERED CALLSIGNS LIST LOGIC ---
function updateRegisteredList(data) {
    const list = document.getElementById('registered-list');
    if (!list || !data.isRegistered) return;

    let existingItem = document.getElementById(`list-${data.callsign}`);
    
    // FIX: Convert DB lastSeen to Date object for accurate status check
    const lastSeenTime = data.lastSeen ? new Date(data.lastSeen) : null;
    const isOnline = lastSeenTime && (new Date() - lastSeenTime) < 600000; 
    const statusClass = isOnline ? 'online-dot' : 'offline-dot';

    const itemHTML = `
        <div class="station-item" id="list-${data.callsign}" onclick="focusStation('${data.callsign}')">
            <div>
                <b style="color: #38bdf8;">${data.callsign}</b><br>
                <span style="font-size: 10px; color: #94a3b8;">${data.ownerName || 'Custodian'}</span>
            </div>
            <span class="status-indicator ${statusClass}"></span>
        </div>
    `;

    if (existingItem) {
        existingItem.outerHTML = itemHTML;
    } else {
        list.insertAdjacentHTML('beforeend', itemHTML);
    }
}

function focusStation(callsign) {
    if (markers[callsign]) {
        map.setView(markers[callsign].getLatLng(), 15, { animate: true });
        markers[callsign].openPopup();
    }
}

// --- ORGANIZED DOWNLOAD LOGIC ---
function downloadAllPaths() {
    let csvContent = "data:text/csv;charset=utf-8,";
    Object.keys(trackCoords).forEach(callsign => {
        csvContent += `\n--- HISTORY FOR: ${callsign} ---\n`;
        csvContent += "Latitude,Longitude,Date,Time\n";
        trackCoords[callsign].forEach(coord => {
            const dateObj = new Date(); // Ideally, capture timestamp per coord in DB
            csvContent += `${coord[0]},${coord[1]},${dateObj.toLocaleDateString()},${dateObj.toLocaleTimeString()}\n`;
        });
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ResQLink_Report_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function deleteStation(callsign) {
    stationToDelete = callsign;
    document.getElementById('deleteCallsignDisplay').innerText = callsign;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.onclick = async () => {
        if (!stationToDelete) return;
        const deletedCallsign = stationToDelete; 
        document.body.classList.add('loading-process');
        try {
            const response = await fetch(`/api/delete-station/${deletedCallsign}`, { method: 'DELETE' });
            if (response.ok) {
                closeDeleteModal();
                showSuccess("Deleted", `${deletedCallsign} has been removed.`); 
            } else {
                const err = await response.json();
                alert(err.error || "Permission Denied.");
            }
        } catch (e) { console.error("Network error:", e); }
        finally { document.body.classList.remove('loading-process'); }
    };
}

function executeClear() {
    if (pendingClearCallsign) {
        if (trackPaths[pendingClearCallsign]) map.removeLayer(trackPaths[pendingClearCallsign]);
        delete trackPaths[pendingClearCallsign];
        trackCoords[pendingClearCallsign] = [];
        closeConfirmModal();
        showSuccess("Cleared", `History for ${pendingClearCallsign} reset.`);
    }
}

// --- 5. DASHBOARD LISTENERS ---
channel.bind('connection-status', (data) => {
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    if (data.status === "Online") {
        if (statusText) statusText.innerText = "Connected to APRS-IS";
        if (statusDot) statusDot.style.color = "#22c55e"; 
    } else {
        if (statusText) statusText.innerText = "Connection Lost";
        if (statusDot) statusDot.style.color = "#ef4444"; 
    }
});

channel.bind('delete-data', (data) => {
    const { callsign } = data;
    if (markers[callsign]) {
        map.removeLayer(markers[callsign]);
        if (trackPaths[callsign]) map.removeLayer(trackPaths[callsign]);
        delete markers[callsign];
        delete trackPaths[callsign];
        const tbody = document.getElementById('history-body');
        const targetRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
        if (targetRow) targetRow.remove();
        const listItem = document.getElementById(`list-${callsign}`);
        if (listItem) listItem.remove();
    }
});

function updateRecentActivity(callsign, lat, lng, time) {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    let existingRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
    let targetRow;
    if (existingRow) {
        existingRow.cells[1].innerHTML = `<span style="color: #666; font-size: 11px;">${lat}</span>`;
        existingRow.cells[2].innerHTML = `<span style="color: #666; font-size: 11px;">${lng}</span>`;
        existingRow.cells[3].innerText = time;
        tbody.prepend(existingRow);
        targetRow = existingRow;
    } else {
        targetRow = tbody.insertRow(0);
        targetRow.innerHTML = `<td>${callsign}</td><td><span style="color: #666; font-size: 11px;">${lat}</span></td><td><span style="color: #666; font-size: 11px;">${lng}</span></td><td>${time}</td>`;
    }
    targetRow.classList.remove('row-update');
    void targetRow.offsetWidth; 
    targetRow.classList.add('row-update');
}

async function getAddress(lat, lng) {
    try {
        const res = await fetch(`/api/get-address?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.address || "Location Found";
    } catch (e) { return "Location Found"; }
}

function trackCallsign() {
    const input = document.getElementById('callSign').value.toUpperCase().trim();
    if (markers[input]) { map.setView(markers[input].getLatLng(), 15, { animate: true }); markers[input].openPopup(); }
}

function handleLogout() { 
    localStorage.removeItem('userRole'); 
    window.location.href = '/api/logout'; 
}

function registerStation() {
    const cs = document.getElementById('callSign').value.toUpperCase().trim();
    if (!cs) return alert("Enter callsign.");
    const existingMarker = markers[cs];
    if (existingMarker && existingMarker.isRegistered) {
        showSuccess("Already Registered", `${cs} is already in the ResQLink database.`);
        return; 
    }
    const isIGate = existingMarker && existingMarker.options.icon.options.symbolCode === '/r';
    const ownerInput = document.getElementById('ownerName');
    if (ownerInput) ownerInput.placeholder = isIGate ? "Name of Station Custodian" : "Name of Owner/Responder";
    const emergencyFields = [document.getElementById('emergencyName').parentElement, document.getElementById('emergencyNum').parentElement];
    emergencyFields.forEach(container => { if (container) container.style.display = isIGate ? 'none' : 'flex'; });
    document.getElementById('modalCallsignDisplay').innerText = cs;
    document.getElementById('regModal').style.display = 'flex'; 
}

function closeModal() { document.getElementById('regModal').style.display = 'none'; }

async function submitRegistration() {
    const cs = document.getElementById('modalCallsignDisplay').innerText;
    const isIGate = markers[cs] && markers[cs].options.icon.options.symbolCode === '/r';
    const data = {
        callsign: cs, lat: markers[cs] ? markers[cs].getLatLng().lat : 13.5857, lng: markers[cs] ? markers[cs].getLatLng().lng : 124.2160,
        ownerName: document.getElementById('ownerName').value, contactNum: document.getElementById('contactNum').value,
        emergencyName: isIGate ? "N/A" : document.getElementById('emergencyName').value, emergencyNum: isIGate ? "N/A" : document.getElementById('emergencyNum').value,
        symbol: markers[cs] ? markers[cs].options.icon.options.symbolCode : '/[', details: isIGate ? "Stationary iGate" : "Registered Responder"
    };
    if (!data.ownerName || !data.contactNum) return alert("Required fields missing.");
    document.body.classList.add('loading-process');
    try {
        const res = await fetch('/api/register-station', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (res.ok) { closeModal(); showSuccess("Success", `${cs} registered successfully.`); }
    } catch (e) { showSuccess("Error", "Server unreachable."); }
    finally { document.body.classList.remove('loading-process'); }
}

async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen, isRegistered } = data;
    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    trackCoords[callsign] = path || [];
    if (trackCoords[callsign].length > 20) trackCoords[callsign] = trackCoords[callsign].slice(-20);

    if (trackPaths[callsign]) {
        trackPaths[callsign].setLatLngs(trackCoords[callsign]);
    } else if (trackCoords[callsign].length > 0) {
        trackPaths[callsign] = L.polyline(trackCoords[callsign], { color: '#007bff', weight: 3, dashArray: '5, 10', opacity: 0.6 }).addTo(map);
    }

    const currentAddr = await getAddress(pos[0], pos[1]);
    
    // FIX: Only use current time if lastSeen is missing, otherwise use DB time
    const timeStr = lastSeen ? new Date(lastSeen).toLocaleTimeString() : "No Signal";
    
    updateRecentActivity(callsign, lat, lng, timeStr);
    updateRegisteredList(data); 

    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const customIcon = getSymbolIcon(symbol);
    const deleteBtn = userRole === 'admin' ? `<button onclick="deleteStation('${callsign}')" style="flex:1; background:#111827; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;"><i class="fa-solid fa-trash"></i> Delete</button>` : '';
    const isIGate = symbol === '/r';
    const ownerLabel = isIGate ? 'Station Custodian' : 'Owner/Responder';
    const showEmergencyInfo = !isIGate;
    const emergencySection = showEmergencyInfo ? `<b>Emergency:</b> ${emergencyName || 'N/A'}<br><b>Emergency #:</b> ${emergencyNum || 'N/A'}` : '';
    
    const popupContent = `<div style="font-family: sans-serif; min-width: 230px; line-height: 1.4;"><h4 style="margin:0 0 8px 0; color:#007bff; border-bottom: 1px solid #eee; padding-bottom:5px;">${callsign}</h4><div style="font-size: 13px; margin-bottom: 8px;"><b>${ownerLabel}:</b> ${ownerName || 'N/A'}<br><b>Contact:</b> ${contactNum || 'N/A'}<br>${emergencySection}</div><div style="font-size: 12px; color: #d9534f; margin-bottom: 8px; font-weight: bold;">📍 ${currentAddr}</div><div style="font-size: 11px; color: #666; background: #f9f9f9; padding: 5px; border-radius: 4px; margin-bottom: 10px;"><b>Type:</b> ${typeName}<br><b>🕒 Last Seen:</b> ${timeStr}</div><div style="display: flex; gap: 5px;"><button onclick="openConfirmModal('${callsign}')" style="flex: 1; background: #3b82f6; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">Clear Path</button>${deleteBtn}</div></div>`;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
        markers[callsign].isRegistered = isRegistered;
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
        markers[callsign].isRegistered = isRegistered;
    }
}

window.onload = async () => {
    try {
        userRole = localStorage.getItem('userRole') || 'viewer'; 
        const roleText = document.getElementById('role-text');
        const roleBadge = document.getElementById('role-badge');
        if (roleText && roleBadge) {
            roleText.innerText = userRole === 'admin' ? "System Admin" : "Field Staff";
            roleBadge.classList.add(userRole === 'admin' ? 'role-admin' : 'role-viewer');
        }
        const res = await fetch('/api/positions');
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        
        // FIX: Update status bar to 'Connected' once data is fetched
        if (res.ok) {
            document.getElementById('status-text').innerText = "Connected to APRS-IS";
            document.getElementById('status-dot').style.color = "#22c55e";
        }

        const history = await res.json();
        if (Array.isArray(history)) {
            history.sort((a, b) => new Date(a.lastSeen) - new Date(b.lastSeen));
            history.forEach(d => updateMapAndUI(d));
        }
    } catch (err) { console.error("Dashboard initialization failed:", err); }
};

channel.bind('new-data', updateMapAndUI);
