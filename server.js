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

// --- 1. SESSION & AUTHENTICATION ---
app.set('trust proxy', 1); 
app.use(session({
    secret: process.env.SESSION_SECRET || 'resqlink-secure-key-2026',
    resave: false,
    saveUninitialized: false, 
    cookie: { secure: true, sameSite: 'none', maxAge: 1000 * 60 * 60 * 24 }
}));

// --- 2. DUAL MONGODB CONFIGURATION ---
const uriResQLink = process.env.MONGODB_URL_RESQLINK;
const uriTest = process.env.MONGODB_URL_TEST;

const connResQLink = mongoose.createConnection(uriResQLink, { serverSelectionTimeoutMS: 5000 });
const connTest = mongoose.createConnection(uriTest, { serverSelectionTimeoutMS: 5000 });

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
const TrackerTest = connTest.model('Tracker', trackerSchema);

// --- 3. PUSHER INITIALIZATION --- 
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// --- 4. SECURE ROUTING & ROLE MIDDLEWARE ---

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: "Unauthorized" }); 
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.role === 'admin') return next();
    res.status(403).json({ error: "Access Denied: Admin privileges required." });
}

app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.get('/api/get-address', async (req, res) => {
    const { lat, lng } = req.query;
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
            headers: { 'User-Agent': 'ResQLink-Disaster-App' }
        });
        const data = await response.json();
        res.json({ address: data.display_name.split(',').slice(0, 3).join(',') });
    } catch (err) { res.status(500).json({ error: "Geocoding failed" }); }
});

app.use(express.static(path.join(__dirname, 'public')));

// --- API ENDPOINTS ---

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'resqlink2026') {
        req.session.user = username;
        req.session.role = 'admin';
        req.session.save(() => res.json({ success: true, role: 'admin' }));
    } 
    else if (username === 'staff' && password === 'staff2026') {
        req.session.user = username;
        req.session.role = 'viewer';
        req.session.save(() => res.json({ success: true, role: 'viewer' }));
    } 
    else {
        res.status(401).json({ error: "Invalid Credentials" });
    }
});

// FIXED LOGOUT ROUTE
app.get('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Could not log out" });
        }
        res.clearCookie('connect.sid'); // Clears the session cookie
        res.redirect('/'); // Redirects to handle re-authentication
    });
});

app.get('/api/positions', isAuthenticated, async (req, res) => {
    try {
        const positions = await TrackerResQLink.find({ isRegistered: true });
        res.json(Array.isArray(positions) ? positions : []); 
    } catch (err) { res.status(500).json([]); }
});

app.post('/api/register-station', isAuthenticated, async (req, res) => {
    try {
        const { callsign, lat, lng, details, symbol, ownerName, contactNum, emergencyName, emergencyNum } = req.body;
        const formattedCallsign = callsign.toUpperCase().trim();
        const existingStation = await TrackerResQLink.findOne({ callsign: formattedCallsign });
        
        if (existingStation && existingStation.isRegistered) {
            return res.status(400).json({ error: "This callsign is already registered." });
        }

        const updateData = {
            callsign: formattedCallsign, lat: lat.toString(), lng: lng.toString(),
            symbol: symbol || (existingStation ? existingStation.symbol : "/-"), 
            details: details || "Registered Responder",
            ownerName, contactNum, emergencyName, emergencyNum,
            isRegistered: true, lastSeen: new Date()
        };

        const newStation = await TrackerResQLink.findOneAndUpdate({ callsign: formattedCallsign }, updateData, { upsert: true, new: true });
        await TrackerTest.findOneAndUpdate({ callsign: formattedCallsign }, updateData, { upsert: true });

        pusher.trigger("aprs-channel", "new-data", newStation);
        res.status(200).json({ message: "Station Registered!", data: newStation });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/delete-station/:callsign', isAdmin, async (req, res) => {
    try {
        const callsign = req.params.callsign.toUpperCase().trim();
        await TrackerResQLink.findOneAndDelete({ callsign: callsign });
        await TrackerTest.findOneAndDelete({ callsign: callsign });
        
        pusher.trigger("aprs-channel", "delete-data", { callsign });
        res.status(200).json({ message: "Station deleted successfully." });
    } catch (err) { res.status(500).json({ error: "Failed to delete." }); }
});

// --- 5. APRS-IS & DATA PROCESSING ---
const client = new net.Socket();
function connectAPRS() {
    client.connect(14580, "asia.aprs2.net", () => {
        client.write("user GUEST pass -1 vers ResQLink 1.0\n#filter p/DU/DW/DV/DY/DZ\n");
        pusher.trigger("aprs-channel", "connection-status", { status: "Online" });
    });
}
connectAPRS();

client.on('data', async (data) => {
    if (connResQLink.readyState !== 1 || connTest.readyState !== 1) return;
    const rawPacket = data.toString();
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();
        const newCoords = [parseFloat(lat.toFixed(4)), parseFloat(lng.toFixed(4))];

        const existing = await TrackerResQLink.findOne({ callsign: callsign });
        if (existing && existing.isRegistered) {
            const updated = await TrackerResQLink.findOneAndUpdate(
                { callsign: callsign }, 
                { lat: lat.toFixed(4), lng: lng.toFixed(4), lastSeen: new Date(),
                  $push: { path: { $each: [newCoords], $slice: -5 } } },
                { new: true }
            );
            await TrackerTest.findOneAndUpdate({ callsign: callsign }, { lat: lat.toFixed(4), lng: lng.toFixed(4),
                  $push: { path: { $each: [newCoords], $slice: -5 } } });
            
            pusher.trigger("aprs-channel", "new-data", { ...updated.toObject(), callsign });
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server Live on port ${PORT}`));
