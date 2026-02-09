// 1. Initialize Pusher
Pusher.logToConsole = true; 
const pusher = new Pusher('899f970a7cf34c9a73a9', { 
    cluster: 'ap1' 
});
const channel = pusher.subscribe('aprs-channel');

// 2. Map Initialization
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

var markers = {};
var trackPaths = {}; 
var trackCoords = {}; 

// --- NEW: Icon Mapping Logic ---
function getSymbolIcon(symbol) {
    // Define which image to use for each APRS code
    const iconMapping = {
        '/>': 'car.png',       // Car
        '/[': 'human.png',    // Human/Person
        '/-': 'house.png',     // House/HQ
        '/a': 'ambulance.png', // Ambulance
        '/f': 'fire.png',      // Fire Truck
        '/u': 'truck.png',     // Truck
        '/v': 'van.png',       // Van
        '/X': 'helo.png'       // Helicopter
    };

    const fileName = iconMapping[symbol] || 'default-pin.png';

    return L.icon({
        iconUrl: `icons/${fileName}`, // Assumes images are in public/icons/
        iconSize: [32, 32],           // Size of the icon
        iconAnchor: [16, 16],         // Point of the icon which corresponds to marker's location
        popupAnchor: [0, -15]         // Point from which the popup should open relative to the iconAnchor
    });
}

// 3. Reverse Geocoding
async function getAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
        const data = await response.json();
        const addr = data.address;
        const street = addr.road || "";
        const barangay = addr.village || addr.suburb || addr.neighbourhood || "";
        const townCity = addr.city || addr.town || addr.municipality || "";

        let fullAddr = "";
        if (street) fullAddr += street + ", ";
        if (barangay) fullAddr += "Brgy. " + barangay + ", ";
        if (townCity) fullAddr += townCity;

        return fullAddr || "Location Name Unavailable";
    } catch (error) {
        return "Detecting Location...";
    }
}

// 4. Search and Pan Functionality
function trackCallsign() {
    const searchInput = document.getElementById('callSign').value.toUpperCase().trim();
    if (markers[searchInput]) {
        const marker = markers[searchInput];
        map.setView(marker.getLatLng(), 15, { animate: true, duration: 1.5 });
        marker.openPopup();
    } else {
        alert("Callsign not found on map.");
    }
}

// 5. Main Update Logic
async function updateMapAndUI(data) {
    // Note: data.symbol is now being sent from your updated server.js
    const { callsign, lat, lng, details, symbol } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const pos = [numLat, numLng];

    if (isNaN(numLat) || isNaN(numLng)) return;

    const addressName = await getAddress(numLat, numLng);
    const timeStr = new Date().toLocaleTimeString();

    // --- Pathing Logic ---
    if (!trackCoords[callsign]) {
        trackCoords[callsign] = [];
        trackPaths[callsign] = L.polyline([], {color: '#007bff', weight: 3, opacity: 0.5}).addTo(map);
    }
    trackCoords[callsign].push(pos);
    if (trackCoords[callsign].length > 30) trackCoords[callsign].shift();
    trackPaths[callsign].setLatLngs(trackCoords[callsign]);

    // --- Update Sidebar ---
    document.getElementById("status-dot").style.color = "#28a745";
    document.getElementById("status-text").innerText = `Live: ${callsign}`;
    document.getElementById("tracking-info").style.display = "block";
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-address").innerText = addressName;
    document.getElementById("info-lat").innerText = `${numLat.toFixed(4)}°`;
    document.getElementById("info-lng").innerText = `${numLng.toFixed(4)}°`;
    document.getElementById("info-date").innerText = `${new Date().toLocaleDateString()} ${timeStr}`;
    document.getElementById("info-msg").innerText = details || "Active Station";

    // --- NEW: Marker Icon Logic ---
    const customIcon = getSymbolIcon(symbol);
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 180px;">
            <h4 style="margin:0; color:#007bff;">${callsign}</h4>
            <b style="color: #d9534f;">📍 ${addressName}</b><br>
            <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <small><b>Type:</b> ${symbol}<br><b>Time:</b> ${timeStr}</small>
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
    }

    // Auto-Follow
    if (callsign === document.getElementById('callSign').value.toUpperCase().trim()) {
        map.panTo(pos);
    }

    // History Table
    const historyBody = document.getElementById("history-body");
    const row = historyBody.insertRow(0);
    row.innerHTML = `<td style="padding:5px;"><b>${callsign}</b></td><td style="padding:5px;">${timeStr}</td>`;
    if (historyBody.rows.length > 5) historyBody.deleteRow(5);
}

channel.bind('new-data', updateMapAndUI);
