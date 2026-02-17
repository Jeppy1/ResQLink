// 1. Initialize Pusher
const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

// 2. Map Setup
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var markers = {};
var trackPaths = {};
var trackCoords = {};

// --- 3. COMPREHENSIVE SYMBOL MAPPING ---
const symbolNames = {
    '/[': 'Human/Personnel',
    '/r': 'iGate Receiver',
    '/1': 'Digital Station',
    '/>': 'Vehicle/Car',
    '/-': 'House/HQ',
    '/A': 'Ambulance',
    '/W': 'Weather Station',
    '//': 'Emergency Point'
};

function getSymbolIcon(symbol) {
    const iconMapping = {
        '/[': 'human.png',
        '/r': 'igate.png',
        '/1': 'station.png',
        '/>': 'car.png',
        '/-': 'house.png',
        '/a': 'ambulance.png',
        '/f': 'fire_truck.png',
        '/u': 'truck.png'
    };
    const fileName = iconMapping[symbol] || 'default-pin.png';
    return L.icon({
        iconUrl: `icons/${fileName}`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -15],
        symbolCode: symbol // Store symbol for registration reference
    });
}

// --- 4. NEW: CONNECTION STATUS LISTENER ---
channel.bind('connection-status', function(data) {
    const statusText = document.querySelector('.status-box span');
    const statusDot = document.getElementById('status-dot');
    
    if(data.status === "Online") {
        statusText.innerText = "Connected to APRS-IS";
        statusDot.style.color = "#22c55e"; // Success Green
    }
});

// --- 5. NEW: RECENT ACTIVITY UPDATER ---
function updateRecentActivity(callsign, time) {
    const table = document.querySelector('.activity-table'); 
    if (!table) return;

    // Insert a new row at the top (under the header)
    const row = table.insertRow(1); 
    row.innerHTML = `<td>${callsign}</td><td>${time}</td>`;

    // Limit to the most recent 5 entries to keep side panel clean
    if (table.rows.length > 6) {
        table.deleteRow(6);
    }
}

// 6. Reverse Geocoding
async function getAddress(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
        const data = await res.json();
        const a = data.address;
        return `${a.road || ""} Brgy. ${a.village || a.suburb || a.neighbourhood || ""}, ${a.city || a.town || a.municipality || ""}`;
    } catch (e) { return "Detecting Location..."; }
}

// 7. Search/Pan Function
function trackCallsign() {
    const searchInput = document.getElementById('callSign').value.toUpperCase().trim();
    if (searchInput && markers[searchInput]) {
        map.setView(markers[searchInput].getLatLng(), 15, { animate: true });
        markers[searchInput].openPopup();
    } else { alert("Callsign not found."); }
}

function handleLogout() { window.location.href = '/api/logout'; }

// --- MODAL CONTROL FUNCTIONS ---
function registerStation() {
    const callsign = document.getElementById('callSign').value.toUpperCase().trim();
    if (!callsign) return alert("Please enter a callsign first.");
    
    document.getElementById('modalCallsignDisplay').innerText = callsign;
    document.getElementById('regModal').style.display = 'flex'; 
}

function closeModal() {
    document.getElementById('regModal').style.display = 'none';
}

// --- SUBMIT REGISTRATION ---
async function submitRegistration() {
    const callsign = document.getElementById('modalCallsignDisplay').innerText;
    
    // Grab the existing symbol if the marker already exists
    const existingSymbol = markers[callsign] ? markers[callsign].options.icon.options.symbolCode : '/['; 

    const data = {
        callsign: callsign,
        lat: markers[callsign] ? markers[callsign].getLatLng().lat : 13.5857,
        lng: markers[callsign] ? markers[callsign].getLatLng().lng : 124.2160,
        ownerName: document.getElementById('ownerName').value,
        contactNum: document.getElementById('contactNum').value,
        emergencyName: document.getElementById('emergencyName').value,
        emergencyNum: document.getElementById('emergencyNum').value,
        symbol: existingSymbol, 
        details: "Registered Responder"
    };

    if (!data.ownerName || !data.contactNum) return alert("Owner and Contact are required.");

    try {
        const response = await fetch('/api/register-station', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert(`Station ${callsign} registered successfully!`);
            closeModal();
            location.reload(); 
        } else if (response.status === 401) {
            window.location.href = '/login.html';
        } else {
            const err = await response.json();
            alert("Error: " + err.error);
        }
    } catch (e) { console.error("Registration failed:", e); }
}

// 8. MAIN UPDATE LOGIC
async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const pos = [numLat, numLng];

    if (isNaN(numLat) || isNaN(numLng)) return;

    const address = await getAddress(numLat, numLng);
    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const timeStr = new Date().toLocaleTimeString();

    // Trigger sidebar activity update
    updateRecentActivity(callsign, timeStr);

    const customIcon = getSymbolIcon(symbol);
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 220px;">
            <h4 style="margin:0; color:#007bff; border-bottom: 1px solid #ccc; padding-bottom:5px;">${callsign}</h4>
            <p style="margin: 10px 0 5px 0; font-size: 13px;">
                <b><i class="fa-solid fa-user"></i> Owner:</b> ${ownerName || 'N/A'}<br>
                <b><i class="fa-solid fa-phone"></i> Contact:</b> ${contactNum || 'N/A'}<br>
                <b><i class="fa-solid fa-hospital-user"></i> Emergency:</b> ${emergencyName || 'N/A'}<br>
                <b><i class="fa-solid fa-phone-flip"></i> Emergency #:</b> ${emergencyNum || 'N/A'}
            </p>
            <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <b style="color: #d9534f; font-size: 12px;">📍 ${address}</b><br>
            <p style="margin: 5px 0; font-size: 12px; color: #555;">
                <b>Type:</b> ${typeName}<br>
                <b>🕒 Last Seen:</b> ${timeStr}
            </p>
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
    }
}

// Load historical data
window.onload = async () => {
    try {
        const response = await fetch('/api/positions');
        if (response.status === 401) { window.location.href = '/login.html'; return; }
        const history = await response.json();
        history.forEach(data => { updateMapAndUI(data); });
    } catch (err) { console.error("Error loading historical data:", err); }
};

channel.bind('new-data', updateMapAndUI);
