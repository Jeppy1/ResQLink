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

// --- 3. PUSHER & CACHE --- 
const pusher = new Pusher({ appId: process.env.PUSHER_APP_ID, key: process.env.PUSHER_KEY, secret: process.env.PUSHER_SECRET, cluster: process.env.PUSHER_CLUSTER, useTLS: true });
const addressCache = {}; 

// --- 4. ROUTES & STATIC FILES ---
function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: "Unauthorized" }); 
}

// CRUCIAL FIX: Define the static folder first
app.use(express.static(path.join(__dirname, 'public')));

// CRUCIAL FIX: Explicitly handle the root "/" route
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if ((username === 'admin' && password === 'resqlink2026') || (username === 'staff' && password === 'resqlink2026')) {
        req.session.user = username;
        req.session.role = (username === 'admin') ? 'admin' : 'staff';
        return req.session.save(() => res.json({ success: true, role: req.session.role }));
    } 
    res.status(401).json({ error: "Invalid Credentials" });
});

// ... [Rest of your APRS logic and API endpoints remain the same]

// Start Server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server fully live on port ${PORT}`));
