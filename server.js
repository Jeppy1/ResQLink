const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// This tells the server to look into the public folder for your files
app.use(express.static('public'));

// const MY_CALLSIGNS = ["DW4AMU-10"]; 
const MY_CALLSIGNS = ["*"];
const client = new net.Socket();

// client.connect(14580, "rotate.aprs2.net", () => {
//     client.write(`user GUEST pass -1 filter b/${MY_CALLSIGNS.join('/')}\n`);
//     console.log("Connected to APRS-IS");
// });

client.connect(14580, "rotate.aprs2.net", () => {
    // 1. Send the login line first
    client.write("user GUEST pass -1 vers ResQLink 1.0\n");
    
    // 2. Send the filter as a separate command
    // This filter looks for any Philippines callsigns (DU, DW, DV, DY, DZ)
    client.write("#filter p/DU/DW/DV/DY/DZ\n"); 
    
    console.log("Login sent. Requesting Philippines regional data...");
});

// client.on('data', (data) => {
//     const rawPacket = data.toString();
//     const latMatch = rawPacket.match(/(\d{2})(\d{2}\.\d{2})([NS])/);
//     const lngMatch = rawPacket.match(/(\d{3})(\d{2}\.\d{2})([EW])/);

//     if (latMatch && lngMatch) {
//         const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
//         const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
//         const callsign = rawPacket.split('>')[0];
//         io.emit('aprs-data', { callsign, lat, lng });
//     }
// });

// client.on('data', (data) => {
//     const rawPacket = data.toString();
//     console.log("Incoming Packet:", rawPacket); // Check your terminal for this!

//     // Regex for both standard and some alternative APRS position formats
//     const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
//     const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);

//     if (latMatch && lngMatch) {
//         const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
//         const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
//         const callsign = rawPacket.split('>')[0];

//         console.log(`Found Coordinates: ${callsign} at ${lat}, ${lng}`);
//         io.emit('aprs-data', { callsign, lat, lng });
//     }
// });

client.on('data', (data) => {
    const rawPacket = data.toString();
    
    // Regex to capture Lat, Lng, and the "Comment" section (where Name/Status often lives)
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        
        const callsign = rawPacket.split('>')[0];
        
        // Everything after the '/' or '\' symbol in the coordinates is usually the comment/name
        const comment = rawPacket.split(/[\/\\]/).pop() || "No extra details";

        io.emit('aprs-data', { 
            callsign: callsign, 
            lat: lat.toFixed(4), 
            lng: lng.toFixed(4), 
            rawLat: latMatch[0], 
            rawLng: lngMatch[0],
            details: comment 
        });
    }
});

// IMPORTANT: Use server.listen, not app.listen
server.listen(3000, () => {
    console.log('Server is running at http://localhost:3000');
});
// // Test: This sends a fake marker to your map every 10 seconds
// setInterval(() => {
//     io.emit('aprs-data', { 
//         callsign: "TEST-STATION", 
//         lat: 13.58, 
//         lng: 124.21, 
//         type: "Position" 
//     });
// }, 10000);