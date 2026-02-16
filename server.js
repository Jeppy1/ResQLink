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
app.set('trust proxy', 1); 

app.use(session({
    secret: 'resqlink-secure-key-2026',
    resave: false,
    saveUninitialized: false, 
    cookie: { 
        secure: true,        
        sameSite: 'none',    
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ error: "Unauthorized" }); 
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

// UPDATED SCHEMA: Added personnel details
const trackerSchema = new mongoose.Schema({
    callsign: { type: String, unique: true },
    lat: String,
    lng: String,
    symbol: String,
    details: String,
    ownerName: String,       // NEW
    contactNum: String,      // NEW
    emergencyContact: String, // NEW
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

// --- 4. API ENDPOINTS ---

app.get('/', (req, res) => {
    if (req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body
