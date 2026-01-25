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

// 3. Shared Update Function
function updateMapAndUI(data) {
    console.log("Processing Data:", data);
    
    // Ensure coordinates are numbers
    const { callsign, lat, lng, details } = data;
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const timestamp = new Date().toLocaleTimeString();

    if (isNaN(numLat) || isNaN(numLng)) return;

    // Update UI Elements
    const statusDot = document.getElementById("status-dot");
    if (statusDot) statusDot.style.color = "#28a745";
    
    const statusText = document.getElementById("status-text");
    if (statusText) statusText.innerText = `Live: ${callsign}`;
    
    const infoBox = document.getElementById("tracking-info");
    if (infoBox) infoBox.style.display = "block";
    
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-lat").innerText = numLat.toFixed(4);
    document.getElementById("info-lng").innerText = numLng.toFixed(4);
    document.getElementById("info-msg").innerText = details || "No extra details";

    // Update or Create Marker
    if (markers[callsign]) {
        markers[callsign].setLatLng([numLat, numLng]);
    } else {
        markers[callsign] = L.marker([numLat, numLng]).addTo(map)
            .bindPopup(`<b>${callsign}</b><br>${details}<br><small>${timestamp}</small>`);
    }

    // Add to History Table
    const historyBody = document.getElementById("history-body");
    if (historyBody) {
        const row = historyBody.insertRow(0);
        row.innerHTML = `<td>${callsign}</td><td>${timestamp}</td>`;
        if (historyBody.rows.length > 5) historyBody.deleteRow(5);
    }
}

// 4. Listeners
channel.bind('new-data', function(data) {
    updateMapAndUI(data);
});

const debugBtn = document.getElementById('debug-btn');
if (debugBtn) {
    debugBtn.addEventListener('click', () => {
        const testData = {
            callsign: "TEST-DRR",
            lat: 13.58,
            lng: 124.21,
            details: "Manual Debug Test"
        };
        updateMapAndUI(testData); 
    });
}