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
    '/[': 'Human/Personnel',
    '/r': 'iGate Receiver',
    '/1': 'Digital Station',
    '/>': 'Vehicle/Car',
    '/-': 'House/HQ',
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

function closeSuccessModal() {
    document.getElementById('successModal').style.display = 'none';
}

function openConfirmModal(callsign) {
    pendingClearCallsign = callsign;
    document.getElementById('confirmMessage').innerText = `Clear the pathing history for ${callsign}?`;
    document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    pendingClearCallsign = null;
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
channel.bind('connection-status', function(data) {
    if(data.status === "Online") {
        document.getElementById('status-text').innerText = "Connected to APRS-IS";
        document.getElementById('status-dot').style.color = "#22c55e"; 
    }
});

function updateRecentActivity(callsign, time) {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    const row = tbody.insertRow(0);
    row.innerHTML = `<td>${callsign}</td><td>${time}</td>`;
    if (tbody.rows.length > 5) tbody.deleteRow(5);
}

// 6. Logic Functions
async function getAddress(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        return data.display_name.split(',').slice(0, 3).join(',');
    } catch (e) { return "Location Found"; }
}

function trackCallsign() {
    const input = document.getElementById('callSign').value.toUpperCase().trim();
    if (markers[input]) {
        map.setView(markers[input].getLatLng(), 15, { animate: true });
        markers[input].openPopup();
    } else { alert("Not found."); }
}

function handleLogout() { window.location.href = '/api/logout'; }

function registerStation() {
    const callsign = document.getElementById('callSign').value.toUpperCase().trim();
    if (!callsign) return alert("Enter callsign first.");
    document.getElementById('modalCallsignDisplay').innerText = callsign;
    document.getElementById('regModal').style.display = 'flex'; 
}

function closeModal() { document.getElementById('regModal').style.display = 'none'; }

async function submitRegistration() {
    const callsign = document.getElementById('modalCallsignDisplay').innerText;
    const symbol = markers[callsign] ? markers[callsign].options.icon.options.symbolCode : '/[';

    const data = {
        callsign, symbol,
        lat: markers[callsign] ? markers[callsign].getLatLng().lat : 13.5857,
        lng: markers[callsign] ? markers[callsign].getLatLng().lng : 124.2160,
        ownerName: document.getElementById('ownerName').value,
        contactNum: document.getElementById('contactNum').value,
        emergencyName: document.getElementById('emergencyName').value,
        emergencyNum: document.getElementById('emergencyNum').value
    };

    try {
        const res = await fetch('/api/register-station', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            closeModal();
            showSuccess("Success", `${callsign} registered.`);
            setTimeout(() => location.reload(), 1500);
        }
    } catch (e) { console.error(e); }
}

// 7. Update UI
async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const pos = [numLat, numLng];

    if (isNaN(numLat) || isNaN(numLng)) return;

    // --- Pathing Logic ---
    if (!trackCoords[callsign]) trackCoords[callsign] = [];
    trackCoords[callsign].push(pos);
    if (trackCoords[callsign].length > 5) trackCoords[callsign].shift();

    if (trackPaths[callsign]) {
        trackPaths[callsign].setLatLngs(trackCoords[callsign]);
    } else {
        trackPaths[callsign] = L.polyline(trackCoords[callsign], {
            color: '#007bff',
            weight: 3,
            opacity: 0.6,
            dashArray: '5, 10'
        }).addTo(map);
    }

    const address = await getAddress(numLat, numLng);
    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const timeStr = new Date().toLocaleTimeString();

    updateRecentActivity(callsign, timeStr);

    const customIcon = getSymbolIcon(symbol);

    // --- RESTORED POPUP CONTENT ---
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
                <i class="fa-solid fa-location-dot"></i> ${address}
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
window.onload = async () => {
    const res = await fetch('/api/positions');
    if (res.status === 401) window.location.href = '/login.html';
    const history = await res.json();
    history.forEach(d => updateMapAndUI(d));
};

channel.bind('new-data', updateMapAndUI);
