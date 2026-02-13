const express = require('express');
const http = require('http');
const net = require('net');
const Pusher = require('pusher');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. MONGODB CONFIGURATION ---
const mongoURI = process.env.MONGODB_URL || "mongodb://mongo:qEtCfZOBIfeEtLRNyxWBhGnLDZFlUkGf@tramway.proxy.rlwy.net:41316/resqlink?authSource=admin";

// ASYNC CONNECTION: Ensures the server waits for the DB
async function connectToDatabase() {
    try {
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 5000,
            bufferCommands: false // Keeps responses fast
        });
        console.log("SUCCESS: Connected to MongoDB Database");
    } catch (err) {
        console.error("DATABASE CONNECTION ERROR:", err.message);
        // Retry connection after 5 seconds
        setTimeout(connectToDatabase, 5000);
    }
}

connectToDatabase();

// Define Schema
const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String,
    lng: String,
    symbol: String,
    details: String,
    lastSeen: { type: Date, default: Date.now }
}, { bufferCommands: false });

const Tracker = mongoose.model('Tracker', trackerSchema);

// --- 2. PUSHER INITIALIZATION ---
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// --- 3. API ENDPOINTS ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fetch historical positions
app.get('/api/positions', async (req, res) => {
    // Check connection status before querying
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "Database not ready" });
    }
    try {
        const positions = await Tracker.find({});
        res.json(positions);
    } catch (err) {
        res.status(500).send(err);
    }
});

// Manual Registration Route
app.post('/api/register-station', async (req, res) => {
    // Ensure DB is connected before saving
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "Database not ready. Please try again in a moment." });
    }
    try {
        const { callsign, lat, lng, details, symbol } = req.body;
        
        const updateData = {
            callsign: callsign.toUpperCase().trim(),
            lat: lat.toString(),
            lng: lng.toString(),
            symbol: symbol || "/-",
            details: details || "Manually Registered",
            lastSeen: new Date()
        };

        const newStation = await Tracker.findOneAndUpdate(
            { callsign: updateData.callsign }, 
            updateData, 
            { upsert: true, new: true }
        );

        pusher.trigger("aprs-channel", "new-data", updateData);
        res.status(200).json({ message: "Station Registered!", data: newStation });
    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- 4. APRS-IS CONNECTION ---
const client = new net.Socket();

function connectAPRS() {
    console.log("Attempting to connect to APRS-IS..."); 
    client.connect(14580, "asia.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n");
        client.write("#filter p/DU/DW/DV/DY/DZ\n"); 
        console.log("SUCCESS: Connected to APRS-IS.");
    });
}

connectAPRS();

client.on('error', (err) => {
    console.error("APRS Socket Error:", err.message);
    setTimeout(connectAPRS, 5000);
});

client.on('close', () => {
    console.log("Connection closed. Retrying in 5s...");
    setTimeout(connectAPRS, 5000);
});

// --- 5. MAIN DATA PROCESSING ---
client.on('data', async (data) => {
    // Only process if DB is connected
    if (mongoose.connection.readyState !== 1) return;

    const rawPacket = data.toString();
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);
    const symbolMatch = rawPacket.match(/([\/\\])(.)/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const symbol = symbolMatch ? symbolMatch[1] + symbolMatch[2] : "/>"; 
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();
        const comment = rawPacket.split(/[:!]/).pop() || "Active Tracker";

        const updateData = {
            callsign: callsign,
            lat: lat.toFixed(4),
            lng: lng.toFixed(4),
            symbol: symbol, 
            details: comment,
            lastSeen: new Date()
        };

        try {
            await Tracker.findOneAndUpdate({ callsign: callsign }, updateData, { upsert: true });
            pusher.trigger("aprs-channel", "new-data", updateData);
        } catch (dbErr) {
            console.error("Failed to save to MongoDB:", dbErr);
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server Live on port ${PORT}`));
