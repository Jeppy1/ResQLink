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

// Using Global Connect for better stability and login handling
mongoose.connect(uriResQLink, { 
    serverSelectionTimeoutMS: 5000 
}).then(() => {
    console.log("✅ Connected to MongoDB");
    // Only start server once DB is ready to handle logins
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server fully live on port ${PORT}`));
}).catch(err => console.error("❌ DB Connection Failed:", err));

const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String, lng: String, symbol: String,
    path: { type: [[Number]], default: [] },
    details: String, ownerName: String, contactNum: String,
    emergencyName: String, emergencyNum: String,  
    isRegistered: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
});

const TrackerResQLink = mongoose.model('Tracker', trackerSchema);

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

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'resqlink2026') {
        req.session.user = username;
        req.session.role = 'admin';
        return req.session.save(() => res.json({ success: true, role: 'admin' }));
    } 
    res.status(401).json({ error: "Invalid Credentials" });
});

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

    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();

        const existing = await TrackerResQLink.findOne({ callsign: callsign });
        
        if (existing && existing.isRegistered) {
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

            pusher.trigger("aprs-channel", "new-data", updated.toObject()); 
        }
    }
});
