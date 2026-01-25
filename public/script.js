// 1. Initialize Pusher
Pusher.logToConsole = true; 
const pusher = new Pusher('899f970a7cf34c9a73a9', { 
    cluster: 'ap1' 
});
const channel = pusher.subscribe('aprs-channel');

// 2. Map Initialization
// Centered on Catanduanes/Bicol region
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

var markers = {};
var trackPaths = {}; // Stores the L.polyline objects
var trackCoords = {}; // Stores arrays of lat/lng points

// 3. Reverse Geocoding (Barangay & Street Level)
async function getAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
        const data = await response.json();
        const addr = data.address;

        // Extracts specific PH address components
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
        const position = marker.getLatLng();
        
        // Focus map on the tracker
        map.setView(position, 15, { animate: true, duration: 1.5 });
        marker.openPopup();
    } else {
        alert("Callsign not found on map.");
    }
}

// 5. Main Update Logic (Receives Pusher Data)
async function updateMapAndUI(data) {
    const { callsign, lat, lng, details } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const pos = [numLat, numLng];

    if (isNaN(numLat) || isNaN(numLng)) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const dateStr = now.toLocaleDateString();
    
    // Fetch detailed address
    const addressName = await getAddress(numLat, numLng);

    // --- Pathing / Track Line Logic ---
    if (!trackCoords[callsign]) {
        trackCoords[callsign] = [];
        trackPaths[callsign] = L.polyline([], {color: '#007bff', weight: 3, opacity: 0.5}).addTo(map);
    }
    trackCoords[callsign].push(pos);
    if (trackCoords[callsign].length > 30) trackCoords[callsign].shift();
    trackPaths[callsign].setLatLngs(trackCoords[callsign]);

    // --- Update Sidebar UI ---
    document.getElementById("status-dot").style.color = "#28a745";
    document.getElementById("status-text").innerText = `Live: ${callsign}`;
    document.getElementById("tracking-info").style.display = "block";
    
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-lat").innerText = `${numLat.toFixed(4)}°`;
    document.getElementById("info-lng").innerText = `${numLng.toFixed(4)}°`;
    document.getElementById("info-address").innerText = addressName;
    document.getElementById("info-date").innerText = `${dateStr} ${timeStr}`;
    document.getElementById("info-msg").innerText = details || "Active Station";

    // --- Update Marker and Detailed Popup ---
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 180px;">
            <h4 style="margin:0; color:#007bff;">${callsign}</h4>
            <b style="color: #d9534f;">📍 ${addressName}</b><br>
            <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <small>
                <b>Coords:</b> ${numLat.toFixed(4)}, ${numLng.toFixed(4)}<br>
                <b>Last Seen:</b> ${timeStr}<br>
                <b>Status:</b> ${details}
            </small>
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos).addTo(map).bindPopup(popupContent);
    }

    // --- Auto-Follow Logic ---
    // If the user is currently searching/tracking this callsign, auto-pan the map
    const activeSearch = document.getElementById('callSign').value.toUpperCase().trim();
    if (callsign === activeSearch) {
        map.panTo(pos);
    }

    // Update History Table
    const historyBody = document.getElementById("history-body");
    const row = historyBody.insertRow(0);
    row.innerHTML = `<td style="padding:5px;"><b>${callsign}</b></td><td style="padding:5px;">${timeStr}</td>`;
    if (historyBody.rows.length > 5) historyBody.deleteRow(5);
}

// 6. Listeners
channel.bind('new-data', updateMapAndUI);
