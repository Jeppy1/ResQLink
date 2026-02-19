// 1. Initialize Pusher
const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

// 2. Map Setup
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

// --- CORE UI UPDATES ---
function updateRegisteredList(data) {
    const list = document.getElementById('registered-list');
    const headerCount = document.getElementById('registered-header-count');
    
    if (!list || !data.isRegistered) return;

    // Update real-time headcount
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
        </div>
    `;
    if (existingItem) existingItem.outerHTML = itemHTML;
    else list.insertAdjacentHTML('beforeend', itemHTML);
}

// ... (keep your submitRegistration and deleteStation functions)

async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen, isRegistered } = data;
    updateRegisteredList(data); 

    if (!lat || !lng || lat === "null" || lng === "null") return;
    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    trackCoords[callsign] = path || [];
    if (trackPaths[callsign]) { trackPaths[callsign].setLatLngs(trackCoords[callsign]); } 
    else if (trackCoords[callsign].length > 0) { trackPaths[callsign] = L.polyline(trackCoords[callsign], { color: '#007bff', weight: 3, dashArray: '5, 10', opacity: 0.6 }).addTo(map); }

    const currentAddr = await getAddress(pos[0], pos[1]);
    const timeStr = parseMongoDate(lastSeen) ? parseMongoDate(lastSeen).toLocaleTimeString() : "Receiving...";
    
    // Status UI Updates
    document.getElementById('status-text').innerText = "Connected to APRS-IS";
    document.getElementById('status-dot').style.color = "#22c55e";

    const customIcon = getSymbolIcon(symbol);
    if (markers[callsign]) { markers[callsign].setLatLng(pos).setIcon(customIcon); } 
    else { markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map); }
    markers[callsign].isRegistered = isRegistered;
}

channel.bind('new-data', updateMapAndUI);

window.onload = async () => {
    try {
        // 1. Restore Role Badge immediately
        userRole = localStorage.getItem('userRole') || 'viewer'; 
        const roleText = document.getElementById('role-text');
        const roleBadge = document.getElementById('role-badge');
        
        if (roleText) {
            roleText.innerText = (userRole === 'admin') ? "System Admin" : "Field Staff";
            roleBadge.classList.add(userRole === 'admin' ? 'role-admin' : 'role-viewer');
        }

        // 2. Fetch Initial Positions
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
