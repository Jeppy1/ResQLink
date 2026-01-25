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

// 3. UPDATED: Specific Reverse Geocoding (Barangay Level)
async function getAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
        const data = await response.json();
        const addr = data.address;

        // Extracting components for a Philippine address
        const street = addr.road || "";
        const barangay = addr.village || addr.suburb || addr.neighbourhood || addr.quarter || "";
        const townCity = addr.city || addr.town || addr.municipality || "";
        const province = addr.province || addr.state || "";

        // Combine them into a clean string
        let fullAddr = "";
        if (street) fullAddr += street + ", ";
        if (barangay) fullAddr += "Brgy. " + barangay + ", ";
        if (townCity) fullAddr += townCity;
        if (province && !townCity.includes(province)) fullAddr += ", " + province;

        return fullAddr || "Location Name Unavailable";
    } catch (error) {
        return "Detecting Location...";
    }
}

// 4. Main Update Logic
async function updateMapAndUI(data) {
    const { callsign, lat, lng, details } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const pos = [numLat, numLng];

    if (isNaN(numLat) || isNaN(numLng)) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const dateStr = now.toLocaleDateString();
    
    // Fetch the specific Barangay-level address
    const addressName = await getAddress(numLat, numLng);

    // Pathing Logic
    if (!trackCoords[callsign]) {
        trackCoords[callsign] = [];
        trackPaths[callsign] = L.polyline([], {color: '#007bff', weight: 3, opacity: 0.5}).addTo(map);
    }
    trackCoords[callsign].push(pos);
    if (trackCoords[callsign].length > 30) trackCoords[callsign].shift();
    trackPaths[callsign].setLatLngs(trackCoords[callsign]);

    // Update Sidebar
    document.getElementById("status-dot").style.color = "#28a745";
    document.getElementById("status-text").innerText = `Live: ${callsign}`;
    document.getElementById("tracking-info").style.display = "block";
    
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-lat").innerText = `${numLat.toFixed(4)}°`;
    document.getElementById("info-lng").innerText = `${numLng.toFixed(4)}°`;
    document.getElementById("info-address").innerText = addressName; // Shows Barangay
    document.getElementById("info-date").innerText = `${dateStr} ${timeStr}`;
    document.getElementById("info-msg").innerText = details || "Active Radio Station";

    // Map Popup
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 180px;">
            <h4 style="margin:0; color:#007bff;">${callsign}</h4>
            <b style="color: #d9534f;">📍 ${addressName}</b><br>
            <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <small>
                <b>Time:</b> ${timeStr}<br>
                <b>Status:</b> ${details}
            </small>
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos).addTo(map).bindPopup(popupContent);
    }

    // History Table
    const historyBody = document.getElementById("history-body");
    const row = historyBody.insertRow(0);
    row.innerHTML = `<td style="padding:5px;"><b>${callsign}</b></td><td style="padding:5px;">${timeStr}</td>`;
    if (historyBody.rows.length > 5) historyBody.deleteRow(5);
}

channel.bind('new-data', updateMapAndUI);
