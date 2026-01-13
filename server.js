const express = require('express');
const http = require('http');
const net = require('net');
const Pusher = require('pusher');
const path = require('path'); // Core Node module

const app = express();
const server = http.createServer(app);

// 1. Initialize Pusher with Environment Variables
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// 2. Serve static files from 'public' folder
// path.join(__dirname) ensures Vercel finds the folder correctly
app.use(express.static(path.join(__dirname, 'public')));

// 3. Fix "Cannot GET /" by explicitly serving index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. APRS-IS Connection Logic
const client = new net.Socket();

function connectAPRS() {
    client.connect(14580, "asia.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n");
        client.write("#filter p/DU/DW/DV/DY/DZ\n"); 
        console.log("Connected to APRS-IS. Bridging to Pusher...");
    });
}

connectAPRS();

client.on('error', (err) => {
    console.error("APRS Error:", err.message);
    setTimeout(connectAPRS, 5000);
});

client.on('close', () => {
    console.log("Connection closed. Reconnecting...");
    setTimeout(connectAPRS, 5000);
});

client.on('data', (data) => {
    const rawPacket = data.toString();
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0];
        const comment = rawPacket.split(/[:!]/).pop() || "No extra details";

        pusher.trigger("aprs-channel", "new-data", {
            callsign: callsign,
            lat: lat.toFixed(4),
            lng: lng.toFixed(4),
            rawLat: latMatch[0],
            rawLng: lngMatch[0],
            details: comment
        }).catch(err => console.error("Pusher Error:", err));
    }
});

// 5. Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ResQLink Server Live on port ${PORT}`);
});