// 1. Initialize Pusher (Same as before)
Pusher.logToConsole = true; 
const pusher = new Pusher('899f970a7cf34c9a73a9', { 
    cluster: 'ap1' 
});
const channel = pusher.subscribe('aprs-channel');

// 2. Map Initialization
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
var markers = {};

// 3. NEW: Reverse Geocoding Function
async function getAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        // Returns city/municipality and province
        return data.address.city || data.address.town || data.address.village || data.address.municipality || "Unknown Location";
    } catch (error) {
        console.error("Geocoding error:", error);
        return "Location unavailable";
    }
}

// 4. Main Update Function (Modified for Addresses)
async function updateMapAndUI(data) {
    console.log("Processing Data:", data);
    
    const { callsign, lat, lng, details } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    
    // Get Date/Time and Address
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const dateStr = now.toLocaleDateString();
    const addressName = await getAddress(numLat, numLng); // Get address name

    if (isNaN(numLat) || isNaN(numLng)) return;

    // Update Sidebar
    if (document.getElementById("status-dot")) document.getElementById("status-dot").style.color = "#28a745";
    document.getElementById("status-text").innerText = `Live: ${callsign}`;
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-lat").innerText = `${numLat.toFixed(4)}°`;
    document.getElementById("info-lng").innerText = `${numLng.toFixed(4)}°`;
    document.getElementById("info-date").innerText = `${dateStr} ${timeStr}`;
    document.getElementById("info-msg").innerText = details || "Active Tracker";
    
    // NEW: Update Address in Sidebar if you add the ID to HTML
    if (document.getElementById("info-address")) {
        document.getElementById("info-address").innerText = addressName;
    }

    // 5. Map Popup with Address
    const popupContent = `
        <div style="font-family: Arial, sans-serif; min-width: 180px;">
            <h4 style="margin:0 0 5px; color:#007bff;">${callsign}</h4>
            <b style="color: #dc3545;">📍 ${addressName}</b><br> <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <b>Coords:</b> ${numLat.toFixed(4)}, ${numLng.toFixed(4)}<br>
            <b>Time:</b> ${timeStr}<br>
            <b>Status:</b> ${details || "Online"}
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng([numLat, numLng]).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker([numLat, numLng]).addTo(map).bindPopup(popupContent);
    }

    // Update History Table
    const historyBody = document.getElementById("history-body");
    if (historyBody) {
        const row = historyBody.insertRow(0);
        row.innerHTML = `<td><b>${callsign}</b></td><td>${timeStr}</td>`;
        if (historyBody.rows.length > 5) historyBody.deleteRow(5);
    }
}

// 6. Listener
channel.bind('new-data', function(data) {
    updateMapAndUI(data);
});
