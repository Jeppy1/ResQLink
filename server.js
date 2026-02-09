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
    
    /** * UPDATED REGEX:
     * Captures Lat ($1,$2,$3), Table ID ($4), Lng ($5,$6,$7), and Symbol Code ($8)
     */
    const packetRegex = /([0-8]\d)([0-5]\d\.\d+)([NS])([\/\\])([0-1]\d\d)([0-5]\d\.\d+)([EW])(.)/;
    const match = rawPacket.match(packetRegex);

    if (match) {
        // Calculate Decimal Degrees
        const lat = (parseInt(match[1]) + parseFloat(match[2]) / 60) * (match[3] === 'S' ? -1 : 1);
        const lng = (parseInt(match[5]) + parseFloat(match[6]) / 60) * (match[7] === 'W' ? -1 : 1);
        
        // Extract Symbol Components
        const tableId = match[4];   // Primary (/) or Alternate (\)
        const symbolCode = match[8]; // Icon identifier (e.g., '>', '[')
        const symbol = tableId + symbolCode; // e.g., "/>" for Car

        const callsign = rawPacket.split('>')[0];
        const comment = rawPacket.split(/[:!]/).pop() || "Active Tracker";

        // Trigger event with the new 'symbol' property
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
