// 1. Initialize Pusher with logging enabled for debugging
Pusher.logToConsole = true; 
const pusher = new Pusher('YOUR_PUSHER_KEY', {
  cluster: 'ap1'
});

const channel = pusher.subscribe('aprs-channel');

// 2. Map Initialization
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
var markers = {};

// 3. Listener (Updated to match your server's Pusher trigger)
channel.bind('new-data', async function(data) {
    console.log("Data received from Pusher:", data);
    
    // Extract variables
    const { callsign, lat, lng, details } = data;
    const timestamp = new Date().toLocaleTimeString();

    // Update UI Elements
    document.getElementById("status-dot").style.color = "#28a745";
    document.getElementById("status-text").innerText = `Live: ${callsign}`;
    
    const infoBox = document.getElementById("tracking-info");
    infoBox.style.display = "block";
    document.getElementById("info-callsign").innerText = callsign;
    document.getElementById("info-lat").innerText = lat;
    document.getElementById("info-lng").innerText = lng;
    document.getElementById("info-msg").innerText = details;

    // Update or Create Marker
    if (markers[callsign]) {
        markers[callsign].setLatLng([lat, lng]);
    } else {
        markers[callsign] = L.marker([lat, lng]).addTo(map)
            .bindPopup(`<b>${callsign}</b><br>${details}<br><small>${timestamp}</small>`);
    }

    // Add to History Table
    const historyBody = document.getElementById("history-body");
    const row = historyBody.insertRow(0);
    row.innerHTML = `<td>${callsign}</td><td>${timestamp}</td>`;
    if (historyBody.rows.length > 5) historyBody.deleteRow(5);
});