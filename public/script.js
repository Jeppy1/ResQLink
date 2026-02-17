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

// --- 3. SYMBOL MAPPING ---
const symbolNames = { 
    '/[': 'Human', 
    '/r': 'iGate', 
    '/1': 'Digital Station', 
    '/>': 'Vehicle', 
    '/-': 'Home', 
    '/A': 'Ambulance', 
    '/f': 'Fire Truck' 
};

function getSymbolIcon(symbol) {
    const iconMapping = { 
        '/[': 'human.png', 
        '/r': 'igate.png', 
        '/1': 'station.png', 
        '/>': 'car.png', 
        '/-': 'house.png', 
        '/a': 'ambulance.png', 
        '/f': 'fire_truck.png' 
    };
    const fileName = iconMapping[symbol] || 'default-pin.png';
    return L.icon({ 
        iconUrl: `icons/${fileName}`, 
        iconSize: [32, 32], 
        iconAnchor: [16, 16], 
        popupAnchor: [0, -15], 
        symbolCode: symbol 
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

// --- 5. DASHBOARD LISTENERS ---
channel.bind('connection-status', (data) => {
    if(data.status === "Online") {
        document.getElementById('status-text').innerText = "Connected to APRS-IS";
        document.getElementById('status-dot').style.color = "#22c55e"; 
    }
});

function updateRecentActivity(callsign, lat, lng, time) {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    const row = tbody.insertRow(0);
    row.innerHTML = `
        <td>${callsign}</td>
        <td style="color: #666; font-size: 11px;">${lat}</td>
        <td style="color: #666; font-size: 11px;">${lng}</td>
        <td>${time}</td>
    `;
    if (tbody.rows.length > 5) tbody.deleteRow(5);
}

// 6. Proxy Address Logic (Bypasses CORS)
async function getAddress(lat, lng) {
    try {
        const res = await fetch(`/api/get-address?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.address || "Location Found";
    } catch (e) { return "Location Found"; }
}

function trackCallsign() {
    const input = document.getElementById('callSign').value.toUpperCase().trim();
    if (markers[input]) { 
        map.setView(markers[input].getLatLng(), 15, { animate: true }); 
        markers[input].openPopup(); 
    }
}

function handleLogout() { window.location.href = '/api/logout'; }
function registerStation() {
    const cs = document.getElementById('callSign').value.toUpperCase().trim();
    if (!cs) return alert("Enter callsign.");
    document.getElementById('modalCallsignDisplay').innerText = cs;
    document.getElementById('regModal').style.display = 'flex'; 
}
function closeModal() { document.getElementById('regModal').style.display = 'none'; }

async function submitRegistration() {
    const cs = document.getElementById('modalCallsignDisplay').innerText;
    const data = {
        callsign: cs, 
        lat: markers[cs] ? markers[cs].getLatLng().lat : 13.5857, 
        lng: markers[cs] ? markers[cs].getLatLng().lng : 124.2160,
        ownerName: document.getElementById('ownerName').value, 
        contactNum: document.getElementById('contactNum').value,
        emergencyName: document.getElementById('emergencyName').value, 
        emergencyNum: document.getElementById('emergencyNum').value,
        symbol: markers[cs] ? markers[cs].options.icon.options.symbolCode : '/[', 
        details: "Registered Responder"
    };
    if (!data.ownerName || !data.contactNum) return alert("Required fields missing.");
    try {
        const res = await fetch('/api/register-station', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(data) 
        });
        if (res.ok) { 
            closeModal(); 
            showSuccess("Success", `${cs} registered.`); 
            setTimeout(() => location.reload(), 1500); 
        }
    } catch (e) { showSuccess("Error", "Server unreachable."); }
}

// 7. Persistent UI Logic
async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen } = data;
    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    // Load pathing from DB
    trackCoords[callsign] = path || [];
    if (trackPaths[callsign]) {
        trackPaths[callsign].setLatLngs(trackCoords[callsign]);
    } else if (trackCoords[callsign].length > 0) {
        trackPaths[callsign] = L.polyline(trackCoords[callsign], { color: '#007bff', weight: 3, dashArray: '5, 10' }).addTo(map);
    }

    // Fetch address
    const currentAddr = await getAddress(pos[0], pos[1]);
    
    // UPDATED: Use the database timestamp if available
    const timeStr = lastSeen ? new Date(lastSeen).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    // Populate the activity table
    updateRecentActivity(callsign, lat, lng, timeStr);

    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const customIcon = getSymbolIcon(symbol);

    const popupContent = `
        <div style="font-family: sans-serif; min-width: 230px; line-height: 1.4;">
            <h4 style="margin:0 0 8px 0; color:#007bff; border-bottom: 1px solid #eee; padding-bottom:5px;">${callsign}</h4>
            <div style="font-size: 13px; margin-bottom: 8px;">
                <b><i class="fa-solid fa-user"></i> Owner:</b> ${ownerName || 'N/A'}<br>
                <b><i class="fa-solid fa-phone"></i> Contact:</b> ${contactNum || 'N/A'}<br>
                <b><i class="fa-solid fa-hospital-user"></i> Emergency:</b> ${emergencyName || 'N/A'}<br>
                <b><i class="fa-solid fa-phone-flip"></i> Emergency #:</b> ${emergencyNum || 'N/A'}
            </div>
            <div style="font-size: 12px; color: #d9534f; margin-bottom: 8px; font-weight: bold;">
                <i class="fa-solid fa-location-dot"></i> ${currentAddr}
            </div>
            <div style="font-size: 11px; color: #666; background: #f9f9f9; padding: 5px; border-radius: 4px; margin-bottom: 10px;">
                <b>Type:</b> ${typeName}<br>
                <b>🕒 Last Seen:</b> ${timeStr}
            </div>
            <button onclick="openConfirmModal('${callsign}')" 
                    style="width: 100%; background: #ef4444; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; transition: 0.2s;">
                <i class="fa-solid fa-eraser"></i> Clear Path
            </button>
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
    }
}

// UPDATED: Sorted loading to ensure table persistence
window.onload = async () => {
    try {
        const res = await fetch('/api/positions');
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const history = await res.json();
        if (Array.isArray(history)) {
            // Sort by time (oldest first) so they stack correctly in the 'insertRow(0)' table
            history.sort((a, b) => new Date(a.lastSeen) - new Date(b.lastSeen));
            history.forEach(d => updateMapAndUI(d));
        }
    } catch (err) { console.error("History failed:", err); }
};

channel.bind('new-data', updateMapAndUI);
