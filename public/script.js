// const socket = io();
// const statusDot = document.getElementById("status-dot");
// const statusText = document.getElementById("status-text");
// const historyBody = document.getElementById("history-body");

// // Initialize map immediately so it shows even if data hasn't arrived
// var map = L.map("map").setView([13.585759, 124.216009], 13);
// L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
//     maxZoom: 19,
// }).addTo(map);

// var markers = {};

// socket.on('aprs-data', (data) => {
//     const { callsign, lat, lng, rawLat, rawLng, details } = data;
//     const timestamp = new Date().toLocaleTimeString();

//     // Update Status
//     if(statusDot) statusDot.style.color = "#28a745";
//     if(statusText) statusText.innerText = "Receiving Data";

//     // Update Side Panel (Safety check to prevent crash)
//     const infoBox = document.getElementById("tracking-info");
//     if (infoBox) {
//         infoBox.style.display = "block";
//         document.getElementById("info-callsign").innerText = callsign;
//         document.getElementById("info-lat").innerText = lat;
//         document.getElementById("info-lng").innerText = lng;
//         document.getElementById("info-msg").innerText = details || "No details";
//     }

//     // Update Map
//     const popupContent = `
//         <div style="font-family: sans-serif; min-width: 150px;">
//             <b style="color: #007bff;">${callsign}</b><br>
//             <b>Lat:</b> ${lat} <small>(${rawLat})</small><br>
//             <b>Lng:</b> ${lng} <small>(${rawLng})</small><br>
//             <small>Updated: ${timestamp}</small>
//         </div>`;

//     if (markers[callsign]) {
//         markers[callsign].setLatLng([lat, lng]).getPopup().setContent(popupContent);
//     } else {
//         markers[callsign] = L.marker([lat, lng]).addTo(map).bindPopup(popupContent).openPopup();
//     }

//     // Update History
//     if (historyBody) {
//         const row = historyBody.insertRow(0);
//         row.innerHTML = `<td>${callsign}</td><td>${timestamp}</td>`;
//         if (historyBody.rows.length > 5) historyBody.deleteRow(5);
//     }
//     // Add this at the end of the socket.on function
// const currentSearch = document.getElementById("callSign").value.toUpperCase().trim();
// if (callsign === currentSearch) {
//     map.panTo([lat, lng]);
// }
// });
// // Function to jump the map to a specific callsign
// function trackCallsign() {
//     const input = document.getElementById("callSign").value.toUpperCase().trim();
    
//     if (markers[input]) {
//         // Move the map to the marker's location
//         map.setView(markers[input].getLatLng(), 15);
//         // Open the detailed popup we created
//         markers[input].openPopup();
//     } else {
//         alert("No live data received for " + input + " yet. Please wait for a packet.");
//     }
// }
// // Function to get Address from Coordinates
// async function getAddress(lat, lng) {
//     try {
//         const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
//         const data = await response.json();
//         return data.display_name || "Address not found";
//     } catch (error) {
//         return "Error loading address";
//     }
// }

// socket.on('aprs-data', async (data) => {
//     const { callsign, lat, lng, details } = data;
//     const timestamp = new Date().toLocaleTimeString();

//     // Fetch the address (Reverse Geocoding)
//     const address = await getAddress(lat, lng);

//     const popupContent = `
//         <div style="font-family: sans-serif; min-width: 180px;">
//             <b style="color: #007bff;">${callsign}</b><br>
//             <hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;">
//             <b>Address:</b> <span style="font-size: 11px;">${address}</span><br>
//             <b>Lat/Lng:</b> ${lat}, ${lng}<br>
//             <small>Updated: ${timestamp}</small>
//         </div>`;

//     // Update Side Panel Info
//     const infoBox = document.getElementById("tracking-info");
//     if (infoBox) {
//         infoBox.style.display = "block";
//         document.getElementById("info-callsign").innerText = callsign;
//         document.getElementById("info-lat").innerText = lat;
//         document.getElementById("info-lng").innerText = lng;
//         // Display address in the message/details area
//         document.getElementById("info-msg").innerText = address;
//     }

//     if (markers[callsign]) {
//         markers[callsign].setLatLng([lat, lng]).getPopup().setContent(popupContent);
//     } else {
//         markers[callsign] = L.marker([lat, lng]).addTo(map).bindPopup(popupContent).openPopup();
//     }
    
//     // Auto-update history table
//     const row = historyBody.insertRow(0);
//     row.innerHTML = `<td>${callsign}</td><td>${timestamp}</td>`;
//     if (historyBody.rows.length > 5) historyBody.deleteRow(5);
// });

// // Placeholder for your registration logic
// function registerAccount() {
//     const input = document.getElementById("callSign").value.toUpperCase().trim();
//     if (!input) {
//         alert("Please enter a callsign to register.");
//         return;
//     }
//     alert("Callsign " + input + " has been added to your local tracking list!");
//     // In the future, we can make this save to a database or file
// }

const socket = io();
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const historyBody = document.getElementById("history-body");

// Initialize map immediately
var map = L.map("map").setView([13.585759, 124.216009], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
}).addTo(map);

var markers = {};

// Function to get Address from Coordinates (Reverse Geocoding)
async function getAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        return data.display_name || "Address not found";
    } catch (error) {
        return "Error loading address";
    }
}

// MAIN DATA LISTENER
socket.on('aprs-data', async (data) => {
    const { callsign, lat, lng, rawLat, rawLng, details } = data;
    const timestamp = new Date().toLocaleTimeString();
    
    // 1. Update Connection Status
    if(statusDot) statusDot.style.color = "#28a745";
    if(statusText) statusText.innerText = "Receiving Data";

    // 2. Get Address
    const address = await getAddress(lat, lng);

    // 3. Update Side Panel Info
    const infoBox = document.getElementById("tracking-info");
    if (infoBox) {
        infoBox.style.display = "block";
        document.getElementById("info-callsign").innerText = callsign;
        document.getElementById("info-lat").innerText = lat;
        document.getElementById("info-lng").innerText = lng;
        document.getElementById("info-msg").innerText = address;
    }

    // 4. Update Map Marker (NO AUTO-PANNING/AUTO-POPUP)
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 180px;">
            <b style="color: #007bff;">${callsign}</b><br>
            <hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;">
            <b>Address:</b> <span style="font-size: 11px;">${address}</span><br>
            <b>Lat/Lng:</b> ${lat}, ${lng}<br>
            <small>Updated: ${timestamp}</small>
        </div>`;

    if (markers[callsign]) {
        // Just move the marker and update its internal content
        markers[callsign].setLatLng([lat, lng]).getPopup().setContent(popupContent);
    } else {
        // Create new marker. Removed .openPopup() so it stays quiet
        markers[callsign] = L.marker([lat, lng]).addTo(map).bindPopup(popupContent);
    }

    // 5. Update History Table
    if (historyBody) {
        const row = historyBody.insertRow(0);
        row.innerHTML = `<td>${callsign}</td><td>${timestamp}</td>`;
        if (historyBody.rows.length > 5) historyBody.deleteRow(5);
    }

    /* AUTO-PANNING REMOVED: 
       We removed map.panTo() and map.setView() from here so the map stays still 
       unless you click the "Track" button manually.
    */
});

// BUTTON FUNCTIONS
function trackCallsign() {
    const input = document.getElementById("callSign").value.toUpperCase().trim();
    if (markers[input]) {
        // Manual panning only happens here when you click the button
        map.setView(markers[input].getLatLng(), 16);
        markers[input].openPopup();
    } else {
        alert("No live data received for " + input + " yet.");
    }
}

function registerAccount() {
    const input = document.getElementById("callSign").value.toUpperCase().trim();
    if (!input) {
        alert("Please enter a callsign to register.");
        return;
    }
    alert("Callsign " + input + " registered for monitoring.");
}