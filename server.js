// --- 0. INITIALIZATION ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const net = require('net');
const Pusher = require('pusher');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
app.use(express.json()); 

// --- 1. SESSION ---
app.set('trust proxy', 1); 
app.use(session({
    secret: process.env.SESSION_SECRET || 'resqlink-secure-key-2026',
    resave: false,
    saveUninitialized: false, 
    cookie: { secure: true, sameSite: 'none', maxAge: 1000 * 60 * 60 * 24 }
}));

// --- 2. DATABASE ---
const uriResQLink = process.env.MONGODB_URL_RESQLINK;
const connResQLink = mongoose.createConnection(uriResQLink, { 
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000 
});

const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String, lng: String, symbol: String,
    path: { type: [[Number]], default: [] },
    details: String, ownerName: String, contactNum: String,
    emergencyName: String, emergencyNum: String,  
    isRegistered: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
});

const TrackerResQLink = connResQLink.model('Tracker', trackerSchema);

// --- 3. PUSHER --- 
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// --- 4. ROUTES ---
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: "Unauthorized" }); 
}

app.get('/', (req, res) => {
    if (req.session && req.session.user) res.sendFile(path.join(__dirname, 'public', 'index.html'));
    else res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/positions', isAuthenticated, async (req, res) => {
    try {
        const positions = await TrackerResQLink.find({ isRegistered: true });
        res.json(positions); 
    } catch (err) { res.status(500).json([]); }
});

app.post('/api/register-station', isAuthenticated, async (req, res) => {
    try {
        const { callsign, lat, lng, details, symbol, ownerName, contactNum, emergencyName, emergencyNum } = req.body;
        const formattedCallsign = callsign.toUpperCase().trim();
        const updateData = {
            callsign: formattedCallsign, lat: lat.toString(), lng: lng.toString(),
            symbol: symbol || "/-", details: details || "Registered Responder",
            ownerName, contactNum, emergencyName, emergencyNum,
            isRegistered: true, lastSeen: new Date()
        };
        const newStation = await TrackerResQLink.findOneAndUpdate({ callsign: formattedCallsign }, updateData, { upsert: true, new: true });
        pusher.trigger("aprs-channel", "new-data", newStation);
        res.status(200).json({ message: "Registered!", data: newStation });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. APRS LOGIC ---
const client = new net.Socket();
function connectAPRS() {
    client.connect(14580, "rotate.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n#filter p/DU/DW/DV/DY/DZ\n");
        console.log("Connected to rotate.aprs2.net");
    });
}
connectAPRS();

client.on('close', () => { setTimeout(connectAPRS, 5000); });

client.on('data', async (data) => {
    const rawPacket = data.toString();
    if (rawPacket.startsWith('#')) return; 
    console.log("RX:", rawPacket.trim());

    if (connResQLink.readyState !== 1) return;

    // --- 🛡️ BLOCKER REMOVED PER REQUEST ---
    // Pushes EVERYTHING that matches a registered callsign

    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();

        const existing = await TrackerResQLink.findOne({ callsign: callsign });
        
        if (existing && existing.isRegistered) {
            console.log(`MATCH FOUND: Pushing update for ${callsign}`);
            
            // Ensure coordinates are saved as clean strings but used as floats in the path
            const cleanLat = parseFloat(lat.toFixed(4));
            const cleanLng = parseFloat(lng.toFixed(4));

            const updated = await TrackerResQLink.findOneAndUpdate(
                { callsign: callsign }, 
                { 
                    lat: cleanLat.toString(), 
                    lng: cleanLng.toString(),
                    lastSeen: new Date(),
                    $push: { path: { $each: [[cleanLat, cleanLng]], $slice: -20 } } 
                },
                { new: true }
            );

            // Push the fully updated document to Pusher
            pusher.trigger("aprs-channel", "new-data", updated.toObject()); 
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server fully live on port ${PORT}`));
