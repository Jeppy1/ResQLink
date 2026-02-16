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
    '/A': 'Ambulance (Tactical A)',
    '/W': 'Weather Station (Tactical W)',
    '//': 'Red Dot / Emergency Point',
    '/ ': 'Small Circle / Generic Station',
    '/0': 'Home Station (Tactical 0)',
    '/1': 'Digital Station (Tactical 1)',
    '/_': 'Weather Station',
    '\\_': 'Weather Station (Alt)',
    '/)': 'Fire Station',
    '/$': 'Phone Station',
    '/y': 'Yacht/Sailboat',
    '/I': 'Island Station',
    '/<': 'Motorcycle',
    '/>': 'Car',
    '/[': 'Human/Person',
    '/-': 'House/HQ',
    '/a': 'Ambulance',
    '/f': 'Fire Truck',
    '/r': 'iGate Receiver',
    '/v': 'Van',
    '/u': 'Truck',
    '/X': 'Helicopter',
    '/s': 'Ship/Boat',
    '/b': 'Bicycle',
    '/H': 'Hospital'
};

function getSymbolIcon(symbol) {
    const iconMapping = {
        '/A': 'ambulance.png',
        '/W': 'weather.png',
        '//': 'default-pin.png', 
        '/ ': 'default-pin.png', 
        '/0': 'house.png',
        '/1': 'station.png',
        '/_': 'weather.png',
        '\\_': 'weather.png',
        '/)': 'fire_station.png',
        '/<': 'motorcycle.png',
        '/>': 'car.png',
        '/[': 'human.png',
        '/-': 'house.png',
        '/a': 'ambulance.png',
        '/f': 'fire_truck.png',
        '/r': 'igate.png',
        '/v': 'van.png',
        '/u': 'truck.png',
        '/X': 'helo.png'
    };

    const fileName = iconMapping[symbol] || 'default-pin.png';

    return L.icon({
        iconUrl: `icons/${fileName}`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -15]
    });
}

// 4. Reverse Geocoding
async function getAddress(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
        const data = await res.json();
        const a = data.address;
        const street = a.road || "";
        const barangay = a.village || a.suburb || a.neighbourhood || "";
        const townCity = a.city || a.town || a.municipality || "";
        return `${street ? street + ', ' : ''}Brgy. ${barangay}, ${townCity}`;
    } catch (e) { return "Detecting Location..."; }
}

// 5. Search/Pan Function
function trackCallsign() {
    const searchInput = document.getElementById('callSign').value.toUpperCase().trim();
    if (markers[searchInput]) {
        map.setView(markers[searchInput].getLatLng(), 15, { animate: true });
        markers[searchInput].openPopup();
    } else {
        alert("Callsign not found.");
    }
}

// --- NEW: LOGOUT FUNCTION ---
function handleLogout() {
    window.location.href = '/api/logout';
}

// --- MANUAL REGISTRATION FUNCTION ---
async function registerStation() {
    const callsign = document.getElementById('callSign').value.toUpperCase().trim();
    if (!callsign) {
        alert("Please enter a callsign first.");
        return;
    }

    const data = {
        callsign: callsign,
        lat: 13.5857, 
        lng: 124.2160,
        symbol: '/-', 
        details: "Manually Registered Station"
    };

    try {
        const response = await fetch('/api/register-station', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert(`Station ${callsign} registered successfully!`);
        } else if (response.status === 401) {
            window.location.href = '/login.html'; // Redirect if session expired
        } else {
            const err = await response.json();
            alert("Error: " + err.error);
        }
    } catch (e) {
        console.error("Registration failed:", e);
    }
}

// 6. MAIN UPDATE LOGIC
async function updateMapAndUI(data) {
    const { callsign, lat, lng, details, symbol } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const pos = [numLat, numLng];

    if (isNaN(numLat) || isNaN(numLng)) return;

    // Update Connection Status
    const statusText = document.getElementById("status-text");
    const statusDot = document.getElementById("status-dot");
    if (statusText) statusText.innerText = "Connected to APRS-IS";
    if (statusDot) statusDot.style.color = "#28a745"; 

    const address = await getAddress(numLat, numLng);
    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const timeStr = new Date().toLocaleTimeString();

    // --- Pathing Logic ---
    if (!trackCoords[callsign]) {
        trackCoords[callsign] = [];
        trackPaths[callsign] = L.polyline([], {color: '#007bff', weight: 3, opacity: 0.5}).addTo(map);
    }
    trackCoords[callsign].push(pos);
    if (trackCoords[callsign].length > 30) trackCoords[callsign].shift();
    trackPaths[callsign].setLatLngs(trackCoords[callsign]);

    // --- Sidebar Update ---
    document.getElementById("tracking-info").style.display = "block";
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-address").innerText = address;
    document.getElementById("info-lat").innerText = numLat.toFixed(4);
    document.getElementById("info-lng").innerText = numLng.toFixed(4);
    document.getElementById("info-date").innerText = `${new Date().toLocaleDateString()} ${timeStr}`;
    document.getElementById("info-msg").innerText = details || "Active Station";

    // --- Marker & Popup Update ---
    const customIcon = getSymbolIcon(symbol);
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 180px;">
            <h4 style="margin:0; color:#007bff;">${callsign}</h4>
            <b style="color: #d9534f;">📍 ${address}</b><br>
            <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <p style="margin: 5px 0; font-size: 13px;">
                <b>Type:</b> ${typeName}<br>
                <b>Coords:</b> ${numLat.toFixed(4)}, ${numLng.toFixed(4)}<br>
                <b style="color: #555;">🕒 Last Seen: ${timeStr}</b><br>
                <b>Status:</b> ${details}
            </p>
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
    }

    // Auto-Follow
    const currentSearch = document.getElementById('callSign').value.toUpperCase().trim();
    if (callsign === currentSearch) {
        map.panTo(pos);
    }

    // History Table
    const historyBody = document.getElementById("history-body");
    const row = historyBody.insertRow(0);
    row.innerHTML = `<td style="padding:5px;"><b>${callsign}</b></td><td style="padding:5px;">${timeStr}</td>`;
    if (historyBody.rows.length > 5) historyBody.deleteRow(5);
}

// Load historical data
window.onload = async () => {
    if (map) {
        try {
            const response = await fetch('/api/positions');
            
            if (response.status === 401) {
                window.location.href = '/login.html'; // Redirect unauthorized users
                return;
            }

            const history = await response.json();
            history.forEach(data => { updateMapAndUI(data); });
            console.log("SUCCESS: Loaded LKP data for " + history.length + " stations.");
        } catch (err) {
            console.error("Error loading historical data:", err);
        }
    }
};

channel.bind('new-data', updateMapAndUI);
