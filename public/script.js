// 1. Initialize Pusher
Pusher.logToConsole = true; 
const pusher = new Pusher('899f970a7cf34c9a73a9', { 
    cluster: 'ap1' 
});

const channel = pusher.subscribe('aprs-channel');

// 2. Map Initialization
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
var markers = {};

// 3. Main Update Function
function updateMapAndUI(data) {
    console.log("Processing Data:", data);
    
    const { callsign, lat, lng, details } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    
    // Create Date and Time
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const dateStr = now.toLocaleDateString();
    const fullTimestamp = `${dateStr} ${timeStr}`;

    if (isNaN(numLat) || isNaN(numLng)) return;

    // Update Sidebar Elements
    const statusDot = document.getElementById("status-dot");
    if (statusDot) statusDot.style.color = "#28a745";
    
    const statusText = document.getElementById("status-text");
    if (statusText) statusText.innerText = `Live: ${callsign}`;
    
    const infoBox = document.getElementById("tracking-info");
    if (infoBox) infoBox.style.display = "block";
    
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-lat").innerText = `${numLat.toFixed(4)}°`;
    document.getElementById("info-lng").innerText = `${numLng.toFixed(4)}°`;
    document.getElementById("info-date").innerText = fullTimestamp; // Updated
    document.getElementById("info-msg").innerText = details || "Active Tracker";

    // 4. Enhanced Map Popup
    const popupContent = `
        <div style="font-family: Arial, sans-serif; min-width: 160px;">
            <h4 style="margin:0 0 5px; color:#007bff;">${callsign}</h4>
            <hr style="margin:5px 0; border:0; border-top:1px solid #eee;">
            <b>Loc:</b> ${numLat.toFixed(4)}, ${numLng.toFixed(4)}<br>
            <b>Date:</b> ${dateStr}<br>
            <b>Time:</b> ${timeStr}<br>
            <b>Status:</b> ${details || "Online"}
        </div>
    `;

    if (markers[callsign]) {
        markers[callsign].setLatLng([numLat, numLng]).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker([numLat, numLng]).addTo(map)
            .bindPopup(popupContent);
    }

    // 5. Update History Table
    const historyBody = document.getElementById("history-body");
    if (historyBody) {
        const row = historyBody.insertRow(0);
        row.innerHTML = `<td><b>${callsign}</b></td><td>${timeStr}</td>`;
        if (historyBody.rows.length > 5) historyBody.deleteRow(5);
    }
}

// Listeners
channel.bind('new-data', function(data) {
    updateMapAndUI(data);
});
