const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var markers = {};
var trackPaths = {};
var trackCoords = {};
let userRole = '';

function getSymbolIcon(symbol) {
    const iconMapping = { '/[': 'human.png', '/r': 'igate.png', '/1': 'station.png', '/>': 'car.png', '/-': 'house.png', '/a': 'ambulance.png', '/f': 'fire_truck.png' };
    const fileName = iconMapping[symbol] || 'default-pin.png';
    return L.icon({ iconUrl: `icons/${fileName}`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -15] });
}

function parseMongoDate(rawDate) {
    if (!rawDate) return null;
    if (typeof rawDate === 'object' && rawDate.$date) return new Date(rawDate.$date);
    const dateObj = new Date(rawDate);
    return isNaN(dateObj.getTime()) ? null : dateObj;
}

async function getAddress(lat, lng) {
    try {
        const res = await fetch(`/api/get-address?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.address || "Location Found";
    } catch (e) { return "Location Found"; }
}

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
    
    const itemHTML = `
        <div class="station-item" id="list-${data.callsign}" onclick="focusStation('${data.callsign}')">
            <div><b style="color:#38bdf8;">${data.callsign}</b><br><span style="font-size:10px; color:#94a3b8;">${hasSignal ? (data.ownerName || 'Custodian') : "Waiting..."}</span></div>
            <span class="status-indicator" style="width:8px; height:8px; border-radius:50%; background:${isOnline ? '#22c55e':'#64748b'};"></span>
        </div>`;
    if (existingItem) existingItem.outerHTML = itemHTML;
    else list.insertAdjacentHTML('beforeend', itemHTML);
}

function focusStation(callsign) {
    if (markers[callsign]) {
        map.setView(markers[callsign].getLatLng(), 15, { animate: true });
        markers[callsign].openPopup();
    }
}

async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, path, lastSeen, isRegistered } = data;
    updateRegisteredList(data);

    if (!lat || !lng || lat === "null" || lng === "null") return;
    const pos = [parseFloat(lat), parseFloat(lng)];

    trackCoords[callsign] = path || [];
    if (trackPaths[callsign]) trackPaths[callsign].setLatLngs(trackCoords[callsign]);
    else if (trackCoords[callsign].length > 0) trackPaths[callsign] = L.polyline(trackCoords[callsign], { color: '#007bff', weight: 3, opacity: 0.6 }).addTo(map);

    const currentAddr = await getAddress(pos[0], pos[1]);
    const timeStr = parseMongoDate(lastSeen) ? parseMongoDate(lastSeen).toLocaleTimeString() : "Receiving...";
    
    const tbody = document.getElementById('history-body');
    if (tbody) {
        let existingRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
        let targetRow = existingRow || tbody.insertRow(0);
        targetRow.innerHTML = `<td style="padding:5px;">${callsign}</td><td>${lat}</td><td>${lng}</td><td>${timeStr}</td>`;
    }

    const popupContent = `<div style="font-family:sans-serif; min-width:200px;"><h4 style="margin:0; color:#38bdf8;">${callsign}</h4><b>Custodian:</b> ${ownerName || 'N/A'}<br><b>📍 Address:</b> ${currentAddr}<br><b>🕒 Last Seen:</b> ${timeStr}</div>`;

    if (markers[callsign]) markers[callsign].setLatLng(pos).setPopupContent(popupContent);
    else markers[callsign] = L.marker(pos, { icon: getSymbolIcon(symbol) }).addTo(map).bindPopup(popupContent);
    
    document.getElementById('status-text').innerText = "Connected to APRS-IS";
    document.getElementById('status-dot').style.color = "#22c55e";
}

channel.bind('new-data', updateMapAndUI);

window.onload = async () => {
    userRole = localStorage.getItem('userRole') || 'viewer';
    const roleText = document.getElementById('role-text');
    if (roleText) roleText.innerText = (userRole === 'admin') ? "System Admin" : "Field Staff";

    const res = await fetch(`/api/positions?t=${Date.now()}`);
    if (res.status === 401) { window.location.href = '/'; return; }
    const history = await res.json();
    if (Array.isArray(history)) {
        document.getElementById('registered-header-count').innerText = `(${history.length})`;
        history.forEach(d => updateMapAndUI(d));
    }
};

function handleLogout() {
    localStorage.removeItem('userRole');
    window.location.href = '/api/logout';
}
