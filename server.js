// --- INITIALIZATION ---
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

// --- SESSION ---
app.set('trust proxy', 1); 
app.use(session({
    secret: process.env.SESSION_SECRET || 'resqlink-secure-key-2026',
    resave: false,
    saveUninitialized: false, 
    cookie: { secure: true, sameSite: 'none', maxAge: 1000 * 60 * 60 * 24 }
}));

// --- DATABASE ---
const uriResQLink = process.env.MONGODB_URL_RESQLINK;
mongoose.connect(uriResQLink, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 });

const TrackerResQLink = mongoose.model('Tracker', new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String, lng: String, symbol: String,
    path: { type: [[Number]], default: [] },
    details: String, ownerName: String, contactNum: String,
    emergencyName: String, emergencyNum: String,  
    isRegistered: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
}));

const pusher = new Pusher({ appId: process.env.PUSHER_APP_ID, key: process.env.PUSHER_KEY, secret: process.env.PUSHER_SECRET, cluster: process.env.PUSHER_CLUSTER, useTLS: true });

// --- ROUTES ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    if (req.session && req.session.user) res.sendFile(path.join(__dirname, 'public', 'index.html'));
    else res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (password === 'resqlink2026' && (username === 'admin' || username === 'staff')) {
        req.session.user = username;
        req.session.role = (username === 'admin') ? 'admin' : 'viewer';
        return req.session.save(() => res.json({ success: true, role: req.session.role }));
    } 
    res.status(401).json({ error: "Invalid Credentials" });
});

// RESTORED: LOGOUT ROUTE (Fixes the GET /api/logout error)
app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/api/positions', async (req, res) => {
    try {
        const positions = await TrackerResQLink.find({ isRegistered: true });
        res.json(positions); 
    } catch (err) { res.status(500).json([]); }
});

// --- APRS LOGIC ---
const client = new net.Socket();
function connectAPRS() {
    client.connect(14580, "rotate.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n#filter p/DU/DW/DV/DY/DZ\n");
    });
}
connectAPRS();

client.on('data', async (data) => {
    const rawPacket = data.toString();
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);
    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();
        const existing = await TrackerResQLink.findOne({ callsign: callsign });
        if (existing && existing.isRegistered) {
            const updated = await TrackerResQLink.findOneAndUpdate(
                { callsign: callsign }, 
                { lat: lat.toFixed(4), lng: lng.toFixed(4), lastSeen: new Date(), $push: { path: { $each: [[lat, lng]], $slice: -20 } } },
                { new: true }
            );
            const totalCount = await TrackerResQLink.countDocuments({ isRegistered: true });
            pusher.trigger("aprs-channel", "new-data", { ...updated.toObject(), totalRegistered: totalCount }); 
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server live on ${PORT}`));
