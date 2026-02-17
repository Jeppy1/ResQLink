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
    cookie: { 
        secure: true,        
        sameSite: 'none',    
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

// --- 2. DUAL MONGODB CONFIGURATION ---
const uriResQLink = process.env.MONGODB_URL_RESQLINK;
const uriTest = process.env.MONGODB_URL_TEST;

const connResQLink = mongoose.createConnection(uriResQLink, { serverSelectionTimeoutMS: 5000 });
const connTest = mongoose.createConnection(uriTest, { serverSelectionTimeoutMS: 5000 });

const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String,
    lng: String,
    symbol: String,
    // NEW: Path array to store last 5 coordinates
    path: { type: [[Number]], default: [] },
    details: String,
    ownerName: String,
    contactNum: String,
    emergencyName: String, 
    emergencyNum: String,  
    isRegistered: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
});

const TrackerResQLink = connResQLink.model('Tracker', trackerSchema);
const TrackerTest = connTest.model('Tracker', trackerSchema);

connResQLink.on('connected', () => console.log("Connected to ResQLink DB"));
connTest.on('connected', () => console.log("Connected to Test DB"));

// --- 3. PUSHER INITIALIZATION --- 
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// --- 4. SECURE ROUTING LOGIC ---
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: "Unauthorized" }); 
}

app.use(express.static(path.join(__dirname, 'public')));

// --- API ENDPOINTS ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'resqlink2026') {
        req.session.user = username;
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: "Session save failed" });
            return res.json({ success: true });
        });
    } else {
        res.status(401).json({ error: "Invalid Credentials" });
    }
});

app.get('/api/positions', isAuthenticated, async (req, res) => {
    try {
        const positions = await TrackerResQLink.find({ isRegistered: true });
        res.json(positions);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.post('/api/register-station', isAuthenticated, async (req, res) => {
    try {
        const { callsign, lat, lng, details, symbol, ownerName, contactNum, emergencyName, emergencyNum } = req.body;
        const formattedCallsign = callsign.toUpperCase().trim();

        const existingStation = await TrackerResQLink.findOne({ callsign: formattedCallsign });
        const finalSymbol = symbol || (existingStation ? existingStation.symbol : "/-");

        const updateData = {
            callsign: formattedCallsign,
            lat: lat.toString(),
            lng: lng.toString(),
            symbol: finalSymbol,
            details: details || "Registered Responder",
            ownerName,
            contactNum,
            emergencyName,
            emergencyNum,
            isRegistered: true,
            lastSeen: new Date()
        };

        const newStation = await TrackerResQLink.findOneAndUpdate({ callsign: formattedCallsign }, updateData, { upsert: true, new: true });
        await TrackerTest.findOneAndUpdate({ callsign: formattedCallsign }, updateData, { upsert: true });

        pusher.trigger("aprs-channel", "new-data", newStation);
        res.status(200).json({ message: "Station Registered in both DBs!", data: newStation });
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
        console.log("SUCCESS: APRS-IS Network Connected");
        pusher.trigger("aprs-channel", "connection-status", { status: "Online" });
    });
}
connectAPRS();

client.on('data', async (data) => {
    if (connResQLink.readyState !== 1 || connTest.readyState !== 1) return;

    const rawPacket = data.toString();
    const latMatch = rawPacket.match(/([0-8]\d)([0-5]\d\.\d+)([NS])/);
    const lngMatch = rawPacket.match(/([0-1]\d\d)([0-5]\d\.\d+)([EW])/);
    const symbolMatch = rawPacket.match(/([\/\\])(.)/);

    if (latMatch && lngMatch) {
        const lat = (parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60) * (latMatch[3] === 'S' ? -1 : 1);
        const lng = (parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60) * (lngMatch[3] === 'W' ? -1 : 1);
        const callsign = rawPacket.split('>')[0].toUpperCase().trim();
        const newCoords = [parseFloat(lat.toFixed(4)), parseFloat(lng.toFixed(4))];

        const existing = await TrackerResQLink.findOne({ callsign: callsign });
        
        if (existing && existing.isRegistered) {
            let finalSymbol = existing.symbol || "/-"; 
            if (symbolMatch) {
                finalSymbol = symbolMatch[1] + symbolMatch[2]; 
            }

            const updateData = {
                lat: lat.toFixed(4),
                lng: lng.toFixed(4),
                symbol: finalSymbol, 
                lastSeen: new Date()
            };
            
            // Use $push with $slice to keep only the last 5 points in history
            const updated = await TrackerResQLink.findOneAndUpdate(
                { callsign: callsign }, 
                { 
                    ...updateData,
                    $push: { path: { $each: [newCoords], $slice: -5 } } 
                },
                { new: true }
            );
            
            await TrackerTest.findOneAndUpdate(
                { callsign: callsign }, 
                { 
                    ...updateData,
                    $push: { path: { $each: [newCoords], $slice: -5 } } 
                }
            );
            
            pusher.trigger("aprs-channel", "new-data", { 
                ...updated.toObject(),
                callsign
            });
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server Live on port ${PORT}`));
