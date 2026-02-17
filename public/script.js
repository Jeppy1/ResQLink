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
let userRole = ''; // Global variable to store the role

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

function executeClear() {
    if (pendingClearCallsign) {
        if (trackPaths[pendingClearCallsign]) map.removeLayer(trackPaths[pendingClearCallsign]);
        delete trackPaths[pendingClearCallsign];
        trackCoords[pendingClearCallsign] = [];
        closeConfirmModal();
        showSuccess("Cleared", `History for ${pendingClearCallsign} reset.`);
    }
}

// --- ADMIN DELETE FUNCTION ---
async function deleteStation(callsign) {
    if (!confirm(`Permanently remove ${callsign} from the database?`)) return;
    try {
        const response = await fetch(`/api/delete-station/${callsign}`, { method: 'DELETE' });
        if (response.ok) {
            showSuccess("Deleted", `${callsign} has been removed.`);
        } else {
            const err = await response.json();
            alert(err.error || "You do not have permission to delete this.");
        }
    } catch (e) { console.error("Network error during deletion:", e); }
}

// --- 5. DASHBOARD LISTENERS ---
channel.bind('connection-status', (data) => {
    if(data.status === "Online") {
        document.getElementById('status-text').innerText = "Connected to APRS-IS";
        document.getElementById('status-dot').style.color = "#22c55e"; 
    }
});

// Listener for real-time deletion
channel.bind('delete-data', (data) => {
    const { callsign } = data;
    if (markers[callsign]) {
        map.removeLayer(markers[callsign]);
        if (trackPaths[callsign]) map.removeLayer(trackPaths[callsign]);
        delete markers[callsign];
        delete trackPaths[callsign];
        const tbody = document.getElementById('history-body');
        const targetRow = Array.from(tbody.rows).find(r => r.cells[0].innerText === callsign);
        if (targetRow) targetRow.remove();
    }
});

function updateRecentActivity(callsign, lat, lng, time) {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    let existingRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
    if (existingRow) {
        existingRow.cells[1].innerHTML = `<span style="color: #666; font-size: 11px;">${lat}</span>`;
        existingRow.cells[2].innerHTML = `<span style="color: #666; font-size: 11px;">${lng}</span>`;
        existingRow.cells[3].innerText = time;
        tbody.prepend(existingRow);
    } else {
        const row = tbody.insertRow(0);
        row.innerHTML = `<td>${callsign}</td><td><span style="color: #666; font-size: 11px;">${lat}</span></td><td><span style="color: #666; font-size: 11px;">${lng}</span></td><td>${time}</td>`;
    }
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

function handleLogout() { window.location.href = '/api/logout'; }

function registerStation() {
    const cs = document.getElementById('callSign').value.toUpperCase().trim();
    if (!cs) return alert("Enter callsign.");
    const existingMarker = markers[cs];
    if (existingMarker && existingMarker.isRegistered) {
        showSuccess("Already Registered", `${cs} is already in the ResQLink database.`);
        return; 
    }
    document.getElementById('modalCallsignDisplay').innerText = cs;
    document.getElementById('regModal').style.display = 'flex'; 
}

function closeModal() { document.getElementById('regModal').style.display = 'none'; }

async function submitRegistration() {
    const cs = document.getElementById('modalCallsignDisplay').innerText;
    const data = {
        callsign: cs, lat: markers[cs] ? markers[cs].getLatLng().lat : 13.5857, lng: markers[cs] ? markers[cs].getLatLng().lng : 124.2160,
        ownerName: document.getElementById('ownerName').value, contactNum: document.getElementById('contactNum').value,
        emergencyName: document.getElementById('emergencyName').value, emergencyNum: document.getElementById('emergencyNum').value,
        symbol: markers[cs] ? markers[cs].options.icon.options.symbolCode : '/[', details: "Registered Responder"
    };
    if (!data.ownerName || !data.contactNum) return alert("Required fields missing.");
    try {
        const res = await fetch('/api/register-station', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (res.ok) { closeModal(); showSuccess("Success", `${cs} registered.`); setTimeout(() => location.reload(), 1500); }
    } catch (e) { showSuccess("Error", "Server unreachable."); }
}

// 7. Persistent UI Logic
async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen, isRegistered } = data;
    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    trackCoords[callsign] = path || [];
    if (trackPaths[callsign]) {
        trackPaths[callsign].setLatLngs(trackCoords[callsign]);
    } else if (trackCoords[callsign].length > 0) {
        trackPaths[callsign] = L.polyline(trackCoords[callsign], { color: '#007bff', weight: 3, dashArray: '5, 10', opacity: 0.6 }).addTo(map);
    }

    const currentAddr = await getAddress(pos[0], pos[1]);
    const timeStr = lastSeen ? new Date(lastSeen).toLocaleTimeString() : new Date().toLocaleTimeString();
    updateRecentActivity(callsign, lat, lng, timeStr);

    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const customIcon = getSymbolIcon(symbol);

    // Only show delete button if user is Admin
    const deleteBtn = userRole === 'admin' ? `
        <button onclick="deleteStation('${callsign}')" 
                style="flex: 1; background: #111827; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">
            <i class="fa-solid fa-trash"></i> Delete
        </button>` : '';

    const popupContent = `
        <div style="font-family: sans-serif; min-width: 230px; line-height: 1.4;">
            <h4 style="margin:0 0 8px 0; color:#007bff; border-bottom: 1px solid #eee; padding-bottom:5px;">${callsign}</h4>
            <div style="font-size: 13px; margin-bottom: 8px;">
                <b>Owner:</b> ${ownerName || 'N/A'}<br>
                <b>Contact:</b> ${contactNum || 'N/A'}<br>
                <b>Emergency:</b> ${emergencyName || 'N/A'}<br>
                <b>Emergency #:</b> ${emergencyNum || 'N/A'}
            </div>
            <div style="font-size: 12px; color: #d9534f; margin-bottom: 8px; font-weight: bold;">📍 ${currentAddr}</div>
            <div style="font-size: 11px; color: #666; background: #f9f9f9; padding: 5px; border-radius: 4px; margin-bottom: 10px;">
                <b>Type:</b> ${typeName}<br><b>🕒 Last Seen:</b> ${timeStr}
            </div>
            <div style="display: flex; gap: 5px;">
                <button onclick="openConfirmModal('${callsign}')" style="flex: 1; background: #3b82f6; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">Clear Path</button>
                ${deleteBtn}
            </div>
        </div>
    `;

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
        // Retrieve role from localStorage (saved during login)
        userRole = localStorage.getItem('userRole') || 'viewer'; 
        
        const res = await fetch('/api/positions');
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const history = await res.json();
        if (Array.isArray(history)) {
            history.sort((a, b) => new Date(a.lastSeen) - new Date(b.lastSeen));
            history.forEach(d => updateMapAndUI(d));
        }
    } catch (err) { console.error("History failed:", err); }
};

channel.bind('new-data', updateMapAndUI);
