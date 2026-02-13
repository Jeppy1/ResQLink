const express = require('express');
const http = require('http');
const net = require('net');
const Pusher = require('pusher');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 1. Initialize Pusher with Railway Environment Variables
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. APRS-IS Connection Logic
const client = new net.Socket();

function connectAPRS() {
    console.log("Connecting to APRS-IS...");
    client.connect(14580, "asia.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n");
        client.write("#filter p/DU/DW/DV/DY/DZ\n"); 
        console.log("Connected. Bridging packets to Pusher...");
    });
}

connectAPRS();

// Reconnection logic for stability
client.on('error', (err) => {
    console.error("APRS Socket Error:", err.message);
    setTimeout(connectAPRS, 5000);
});

client.on('close', () => {
    console.log("Connection closed. Retrying in 5s...");
    setTimeout(connectAPRS, 5000);
});

client.on('data', (data) => {
    const rawPacket = data.toString();
    
    // 1. Loose matches for Latitude and Longitude
    // These find the coordinates anywhere in the packet, even if they aren't together.
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);
    
    // 2. Separate match for the Symbol (Table ID + Symbol Code)
    const symbolMatch = rawPacket.match(/([\/\\])(.)/);

    if (latMatch && lngMatch) {
        // Calculate decimal degrees
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        
        // Use the found symbol or default to a standard car if not detected
        const symbol = symbolMatch ? symbolMatch[1] + symbolMatch[2] : "/>"; 

        const callsign = rawPacket.split('>')[0];
        const comment = rawPacket.split(/[:!]/).pop() || "Active Tracker";

        pusher.trigger("aprs-channel", "new-data", {
            callsign: callsign,
            lat: lat.toFixed(4),
            lng: lng.toFixed(4),
            symbol: symbol, 
            details: comment
        }).catch(err => console.error("Pusher Error:", err));
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Live on port ${PORT}`));
