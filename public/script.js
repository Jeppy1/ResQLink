// 1. Initialize Pusher
const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

// 2. Map & State Setup
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var markers = {};
var trackPaths = {}; 
var trackCoords = {}; 
let userRole = ''; 

const symbolNames = { '/[': 'Human', '/r': 'iGate', '/1': 'Digital Station', '/>': 'Vehicle', '/-': 'Home', '/A': 'Ambulance', '/f': 'Fire Truck' };

function getSymbolIcon(symbol) {
    const iconMapping = { '/[': 'human.png', '/r': 'igate.png', '/1': 'station.png', '/>': 'car.png', '/-': 'house.png', '/a': 'ambulance.png', '/f': 'fire_truck.png' };
    const fileName = iconMapping[symbol] || 'default-pin.png';
    return L.icon({ iconUrl: `icons/${fileName}`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -15], symbolCode: symbol });
}

function parseMongoDate(rawDate) {
    if (!rawDate) return null;
    if (typeof rawDate === 'object' && rawDate.$date) return new Date(rawDate.$date);
    const dateObj = new Date(rawDate);
    return isNaN(dateObj.getTime()) ? null : dateObj;
}

// RESTORED: Geolocation logic to fix the crash
async function getAddress(lat, lng) {
    try {
        const res = await fetch(`/api/get-address?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.address || "Location Found";
    } catch (e) { return "Location Found"; }
}

// UI UPDATES
function updateRegisteredList(data) {
    const list = document.getElementById('registered-list');
    const headerCount = document.getElementById('registered-header-count');
    if (!list || !data.isRegistered) return;

    if (data.totalRegistered !== undefined && headerCount) {
        headerCount.innerText = `(${data.totalRegistered})`;
    }

    let existingItem = document.getElementById(`list-${data.callsign}`);
    const lastSeenDate = parseMongoDate(data.lastSeen);
    const hasSignal = data.lat && data.lng && data.lat !== "null";
    const isOnline = hasSignal && lastSeenDate && (new Date() - lastSeenDate) < 600000; 
    const statusClass = isOnline ? 'online-dot' : 'offline-dot';
    const subText = hasSignal ? (data.ownerName || 'Custodian') : "Waiting for signal...";

    const itemHTML = `
        <div class="station-item" id="list-${data.callsign}" onclick="focusStation('${data.callsign}')">
            <div>
                <b style="color: #38bdf8;">${data.callsign}</b><br>
                <span style="font-size: 10px; color: #94a3b8;">${subText}</span>
            </div>
            <span class="status-indicator ${statusClass}"></span>
        </div>`;
    if (existingItem) existingItem.outerHTML = itemHTML;
    else list.insertAdjacentHTML('beforeend', itemHTML);
}

function focusStation(callsign) {
    if (markers[callsign]) {
        map.setView(markers[callsign].getLatLng(), 15, { animate: true });
        markers[callsign].openPopup();
    } else { alert(`${callsign} has not sent a signal yet.`); }
}

// CORE UPDATE LOGIC
async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen, isRegistered } = data;
    updateRegisteredList(data); 

    if (!lat || !lng || lat === "null" || lng === "null") return;
    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    trackCoords[callsign] = path || [];
    if (trackPaths[callsign]) { trackPaths[callsign].setLatLngs(trackCoords[callsign]); } 
    else if (trackCoords[callsign].length > 0) { trackPaths[callsign] = L.polyline(trackCoords[callsign], { color: '#007bff', weight: 3, opacity: 0.6 }).addTo(map); }

    const currentAddr = await getAddress(pos[0], pos[1]);
    const timeStr = parseMongoDate(lastSeen) ? parseMongoDate(lastSeen).toLocaleTimeString() : "Receiving...";
    
    // RESTORED: Popup content
    const ownerLabel = symbol === '/r' ? 'Station Custodian' : 'Owner/Responder';
    const emergencySection = symbol !== '/r' ? `<b>Emergency:</b> ${emergencyName || 'N/A'}<br><b>Contact:</b> ${emergencyNum || 'N/A'}` : '';
    const popupContent = `<div style="font-family:sans-serif; min-width:200px;"><h4 style="margin:0 0 5px 0; color:#38bdf8;">${callsign}</h4><div style="font-size:12px; line-height:1.4;"><b>${ownerLabel}:</b> ${ownerName || 'N/A'}<br><b>Contact:</b> ${contactNum || 'N/A'}<br>${emergencySection}<hr style="margin:8px 0; opacity:0.2;"><b>📍 Address:</b> ${currentAddr}<br><b>🕒 Last Seen:</b> ${timeStr}</div></div>`;

    // Activity Table
    const tbody = document.getElementById('history-body');
    if (tbody) {
        let existingRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
        let targetRow = existingRow || tbody.insertRow(0);
        targetRow.innerHTML = `<td>${callsign}</td><td>${lat}</td><td>${lng}</td><td>${timeStr}</td>`;
    }

    // Status UI
    document.getElementById('status-text').innerText = "Connected to APRS-IS";
    document.getElementById('status-dot').style.color = "#22c55e";

    const customIcon = getSymbolIcon(symbol);
    if (markers[callsign]) { 
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent); 
    } else { 
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent); 
    }
}

channel.bind('new-data', updateMapAndUI);

window.onload = async () => {
    try {
        userRole = localStorage.getItem('userRole') || 'viewer'; 
        const roleText = document.getElementById('role-text');
        const roleBadge = document.getElementById('role-badge');
        if (roleText) {
            roleText.innerText = (userRole === 'admin') ? "System Admin" : "Field Staff";
            roleBadge.classList.add(userRole === 'admin' ? 'role-admin' : 'role-viewer');
        }
        const res = await fetch(`/api/positions?t=${Date.now()}`);
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const history = await res.json();
        if (Array.isArray(history)) {
            const headerCount = document.getElementById('registered-header-count');
            if (headerCount) headerCount.innerText = `(${history.length})`;
            history.forEach(d => updateMapAndUI(d));
        }
    } catch (err) { console.error("Initialization failed:", err); }
};

// Functions for Export, Register, Clear and Logout...
function handleLogout() { localStorage.removeItem('userRole'); window.location.href = '/api/logout'; }
function downloadAllPaths() { /* logic */ }
function trackCallsign() { /* logic */ }
function submitRegistration() { /* logic */ }
