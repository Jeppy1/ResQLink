// --- 0. INITIALIZATION ---
require('dotenv').config(); // MUST be the first line to load variables

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
    secret: process.env.SESSION_SECRET || 'resqlink-secure-key-2026', // Use env variable
    resave: false,
    saveUninitialized: false, 
    cookie: { 
        secure: true,        
        sameSite: 'none',    
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

// --- 2. MONGODB CONFIGURATION ---
// Removed hardcoded URL to prevent GitHub leaks
const mongoURI = process.env.MONGODB_URL; 

async function connectToDatabase() {
    if (!mongoURI) {
        console.error("FATAL ERROR: MONGODB_URL is not defined in environment variables.");
        return;
    }
    try {
        await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
        console.log("SUCCESS: Connected to MongoDB Database");
    } catch (err) {
        console.error("DATABASE CONNECTION ERROR:", err.message);
        setTimeout(connectToDatabase, 5000);
    }
}
connectToDatabase();

const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String,
    lng: String,
    symbol: String,
    details: String,
    ownerName: String,
    contactNum: String,
    emergencyName: String, 
    emergencyNum: String,  
    isRegistered: { type: Boolean, default: false },
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

// --- 4. SECURE ROUTING LOGIC ---

// Root Route: Explicitly decide which page to serve before static middleware
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

// Serve other static assets ONLY if they pass the logic above
app.use(express.static(path.join(__dirname, 'public')));

// --- API ENDPOINTS ---

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    // For production, consider moving these credentials to .env as well
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

app.get('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: "Could not log out" });
        res.clearCookie('connect.sid'); 
        res.redirect('/'); 
    });
});

app.get('/api/positions', isAuthenticated, async (req, res) => {
    try {
        const positions = await Tracker.find({ isRegistered: true });
        res.json(positions);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.post('/api/register-station', isAuthenticated, async (req, res) => {
    try {
        const { 
            callsign, lat, lng, details, symbol, 
            ownerName, contactNum, emergencyName, emergencyNum 
        } = req.body;

        const updateData = {
            callsign: callsign.toUpperCase().trim(),
            lat: lat.toString(),
            lng: lng.toString(),
            symbol: symbol || "/-",
            details: details || "Registered Responder",
            ownerName,
            contactNum,
            emergencyName,
            emergencyNum,
            isRegistered: true,
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

        const existing = await Tracker.findOne({ callsign: callsign });
        
        if (existing && existing.isRegistered) {
            const updateData = {
                lat: lat.toFixed(4),
                lng: lng.toFixed(4),
                symbol: symbolMatch ? symbolMatch[1] + symbolMatch[2] : "/>",
                lastSeen: new Date()
            };
            
            await Tracker.findOneAndUpdate({ callsign: callsign }, updateData);
            
            pusher.trigger("aprs-channel", "new-data", { 
                ...updateData, 
                callsign,
                ownerName: existing.ownerName,
                contactNum: existing.contactNum,
                emergencyName: existing.emergencyName,
                emergencyNum: existing.emergencyNum
            });
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server Live on port ${PORT}`));
