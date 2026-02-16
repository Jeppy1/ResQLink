const express = require('express');
const http = require('http');
const net = require('net');
const Pusher = require('pusher');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json()); 

// --- 1. SESSION & AUTHENTICATION ---
app.use(session({
    secret: 'resqlink-secure-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login.html');
}

app.use(express.static(path.join(__dirname, 'public')));

// --- 2. MONGODB CONFIGURATION ---
const mongoURI = process.env.MONGODB_URL || "mongodb://mongo:qEtCfZOBIfeEtLRNyxWBhGnLDZFlUkGf@tramway.proxy.rlwy.net:41316/resqlink?authSource=admin";

async function connectToDatabase() {
    try {
        await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
        console.log("SUCCESS: Connected to MongoDB Database");
    } catch (err) {
        console.error("DATABASE CONNECTION ERROR:", err.message);
        setTimeout(connectToDatabase, 5000);
    }
}
connectToDatabase();

// UPDATED SCHEMA: Added isRegistered flag
const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String,
    lng: String,
    symbol: String,
    details: String,
    isRegistered: { type: Boolean, default: false }, // Filter Flag
    lastSeen: { type: Date, default: Date.now }
}, { bufferCommands: false });

const Tracker = mongoose.model('Tracker', trackerSchema);

// --- 3. PUSHER INITIALIZATION --- 
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// --- 4. API ENDPOINTS ---

app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'resqlink2026') {
        req.session.user = username;
        return res.json({ success: true });
    }
    res.status(401).json({ error: "Invalid Credentials" });
});

// UPDATED API: Only fetches registered trackers
app.get('/api/positions', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
    try {
        const positions = await Tracker.find({ isRegistered: true }); // THE FILTER
        res.json(positions);
    } catch (err) {
        res.status(500).send(err);
    }
});

// UPDATED REGISTRATION: Sets isRegistered to true
app.post('/api/register-station', async (req, res) => {
    try {
        const { callsign, lat, lng, details, symbol } = req.body;
        const updateData = {
            callsign: callsign.toUpperCase().trim(),
            lat: lat.toString(),
            lng: lng.toString(),
            symbol: symbol || "/-",
            details: details || "Manually Registered",
            isRegistered: true, // Mark as authorized
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
        res.status(500).json({ error: err.message });
    }
});

// --- 5. APRS-IS & DATA PROCESSING ---
const client = new net.Socket();
function connectAPRS() {
    client.connect(14580, "asia.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n");
        client.write("#filter p/DU/DW/DV/DY/DZ\n"); 
    });
}
connectAPRS();

client.on('data', async (data) => {
    if (mongoose.connection.readyState !== 1) return;
    const rawPacket = data.toString();
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);
    const symbolMatch = rawPacket.match(/([\/\\])(.)/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();

        // CHECK IF ALREADY REGISTERED: Only update if isRegistered is true
        const existing = await Tracker.findOne({ callsign: callsign });
        
        if (existing && existing.isRegistered) {
            const updateData = {
                lat: lat.toFixed(4),
                lng: lng.toFixed(4),
                symbol: symbolMatch ? symbolMatch[1] + symbolMatch[2] : "/>",
                lastSeen: new Date()
            };
            await Tracker.findOneAndUpdate({ callsign: callsign }, updateData);
            pusher.trigger("aprs-channel", "new-data", { ...updateData, callsign });
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server Live on port ${PORT}`));
