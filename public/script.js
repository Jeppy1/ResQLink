// 1. Initialize Pusher
const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

// 2. Map & State Setup
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

map.on('click', (e) => {
    // Only reset if the user clicks the background map, not a marker/popup
    if (e.originalEvent.target.id === 'map') {
        console.log("📍 Map background clicked: Resetting to Catanduanes weather");
        loadDefaultWeather(); 
    }
});

var markers = {};
var trackPaths = {}; 
var trackCoords = {}; 
var historyDots = {}; // Global storage for historical breadcrumbs
let pendingClearCallsign = null;
let stationToDelete = null; 
let userRole = ''; 

const symbolNames = { '/[': 'Human', '/r': 'iGate', '/1': 'Digital Station', '/>': 'Vehicle', '/-': 'Home', '/A': 'Ambulance', '/f': 'Fire Truck' };

function getSymbolIcon(symbol) {
    const iconMapping = { '/[': 'human.png', '/r': 'igate.png', '/1': 'station.png', '/>': 'car.png', '/-': 'house.png', '/a': 'ambulance.png', '/f': 'fire_truck.png' };
    const fileName = iconMapping[symbol] || 'default-pin.png';
    return L.icon({ iconUrl: `icons/${fileName}`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -15], symbolCode: symbol });
}

function parseMongoDate(rawDate) {
    if (!rawDate) return null;
    if (typeof rawDate === 'object' && rawDate.$date) return new Date(rawDate.$date);
    const dateObj = new Date(rawDate);
    return isNaN(dateObj.getTime()) ? null : dateObj;
}

// --- MODAL UTILITIES ---
function showSuccess(title, message) {
    document.getElementById('successTitle').innerText = title;
    document.getElementById('successMessage').innerText = message;
    document.getElementById('successModal').style.display = 'flex';
}
function closeSuccessModal() { document.getElementById('successModal').style.display = 'none'; }

function openConfirmModal(callsign) {
    pendingClearCallsign = callsign;
    if (document.getElementById('confirmCallsign')) document.getElementById('confirmCallsign').innerText = callsign;
    document.getElementById('confirmModal').style.display = 'flex';
}
function closeConfirmModal() { document.getElementById('confirmModal').style.display = 'none'; }

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
    stationToDelete = null;
}

// --- DYNAMIC REGISTRATION LOGIC ---
function toggleRegFields() {
    const type = document.getElementById('stationType').value;
    const ownerInput = document.getElementById('ownerName');
    const contactInput = document.getElementById('contactNum');
    const emergencyFields = document.getElementById('tracker-only-fields');
    const saveBtn = document.querySelector('#regModal .btn-confirm');

    if (type === 'igate') {
        ownerInput.placeholder = "Station Custodian (e.g. MDRRMO)";
        contactInput.placeholder = "Hotline / Office Number";
        emergencyFields.style.display = 'none';
        if (saveBtn) saveBtn.innerText = "Save Station";
    } else {
        ownerInput.placeholder = "Name of Owner/Responder";
        contactInput.placeholder = "Personal Contact Number";
        emergencyFields.style.display = 'block';
        if (saveBtn) saveBtn.innerText = "Save Tracker";
    }
}

async function registerStation() {
    const cs = document.getElementById('callSign').value.toUpperCase().trim();
    if (!cs) return alert("Please enter a callsign first.");

    if (markers[cs] && markers[cs].isRegistered) {
        return showSuccess("Already Registered", `Callsign ${cs} is already registered to ${markers[cs].ownerName || 'another responder'}.`);
    }

    try {
        const res = await fetch(`/api/check-callsign/${cs}`);
        const data = await res.json();
        if (data.exists) return showSuccess("Already Registered", `Callsign ${cs} is already registered to ${data.ownerName}.`);

        document.getElementById('modalCallsignDisplay').innerText = cs;
        document.getElementById('regModal').style.display = 'flex'; 
        toggleRegFields();
    } catch (e) {
        alert("Could not verify callsign availability.");
    }
}

function closeModal() { document.getElementById('regModal').style.display = 'none'; }

async function submitRegistration() {
    const cs = document.getElementById('modalCallsignDisplay').innerText;
    if (markers[cs] && markers[cs].isRegistered) {
        alert("This callsign was just registered.");
        closeModal();
        return;
    }

    const type = document.getElementById('stationType').value;
    const data = {
        callsign: cs,
        lat: markers[cs] ? markers[cs].getLatLng().lat : null,
        lng: markers[cs] ? markers[cs].getLatLng().lng : null,
        ownerName: document.getElementById('ownerName').value,
        contactNum: document.getElementById('contactNum').value,
        emergencyName: (type === 'igate') ? "N/A" : document.getElementById('emergencyName').value,
        emergencyNum: (type === 'igate') ? "N/A" : document.getElementById('emergencyNum').value,
        symbol: (type === 'igate') ? '/r' : '/[',
        details: (type === 'igate') ? 'Stationary iGate' : 'Mobile Responder'
    };

    if (!data.ownerName || !data.contactNum) return alert("Required fields missing.");

    document.body.classList.add('loading-process');
    try {
        const res = await fetch('/api/register-station', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(data) 
        });
        if (res.ok) { 
            closeModal(); 
            showSuccess("Success", `${cs} registered successfully.`); 
        }
    } catch (e) { showSuccess("Error", "Server unreachable."); }
    finally { document.body.classList.remove('loading-process'); }
}

async function deleteStation(callsign) {
    stationToDelete = callsign.trim();
    document.getElementById('deleteCallsignDisplay').innerText = stationToDelete;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
    document.getElementById('confirmDeleteBtn').onclick = async () => {
        const target = stationToDelete;
        try {
            const response = await fetch(`/api/delete-station/${target}`, { method: 'DELETE' });
            if (response.ok) { closeDeleteModal(); showSuccess("Deleted", `${target} removed.`); }
        } catch (e) { console.error(e); }
    };
}

// --- UI UPDATES ---
function updateRegisteredList(data) {
    const list = document.getElementById('registered-list');
    const headerCount = document.getElementById('registered-header-count');
    if (!list || !data.isRegistered) return;

    if (data.totalRegistered !== undefined && headerCount) headerCount.innerText = `(${data.totalRegistered})`;

    let existingItem = document.getElementById(`list-${data.callsign}`);
    const lastSeenDate = parseMongoDate(data.lastSeen);
    const hasSignal = data.lat && data.lng && data.lat !== "null";
    const isOnline = hasSignal && lastSeenDate && (new Date() - lastSeenDate) < 600000; 
    
    const statusClass = isOnline ? 'online-dot' : 'offline-dot';
    const subText = hasSignal ? (data.ownerName || 'Custodian') : "Waiting for signal...";

    const itemHTML = `
        <div class="station-item" id="list-${data.callsign}" onclick="focusStation('${data.callsign}')">
            <div>
                <b style="color: #38bdf8;">${data.callsign}</b><br>
                <span style="font-size: 10px; color: #94a3b8;">${subText}</span>
            </div>
            <span class="status-indicator ${statusClass}"></span>
        </div>
    `;
    if (existingItem) existingItem.outerHTML = itemHTML;
    else list.insertAdjacentHTML('beforeend', itemHTML);
}

function updateFloatingWindow(data) {
    const container = document.getElementById('floating-items'); 
    if (!container || !data.isRegistered) return;
    let existing = document.getElementById(`float-${data.callsign}`);
    const itemHTML = `
        <div class="floating-item" id="float-${data.callsign}" onclick="focusStation('${data.callsign}')">
            <i class="fa-solid fa-location-dot" style="font-size: 9px; margin-right: 4px; color: #38bdf8; opacity: 0.7;"></i>
            ${data.callsign}
        </div>
    `;
    if (existing) existing.outerHTML = itemHTML;
    else container.insertAdjacentHTML('beforeend', itemHTML);
}

function focusStation(callsign) {
    if (markers[callsign]) {
        map.setView(markers[callsign].getLatLng(), 15, { animate: true });
        markers[callsign].openPopup();
        if (window.innerWidth <= 768) {
            const panel = document.querySelector('.side-panel');
            if (panel && !panel.classList.contains('minimized')) toggleSidebar();
        }
    } else showMiniAlert("No Signal", `${callsign} has not sent a signal yet.`);
}

function updateRecentActivity(callsign, lat, lng, fullTimeStr, weather = "N/A") {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    
    let existingRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
    if (existingRow) existingRow.remove();

    let targetRow = tbody.insertRow(0);
    
    // Formatting the coordinates and environmental data
    const coordsHTML = `
        <span style="color:#38bdf8; font-size:11px;">${parseFloat(lat).toFixed(4)}</span><br>
        <span style="color:#38bdf8; font-size:11px;">${parseFloat(lng).toFixed(4)}</span>
    `;

    const statusHTML = `
        <div style="font-size: 10px; line-height: 1.2;">
            <span style="color: #f1f5f9;">${fullTimeStr}</span><br>
            <span style="color: #22c55e; font-weight: bold;">${weather}</span>
        </div>
    `;

    targetRow.innerHTML = `
        <td style="vertical-align: middle; font-weight: bold;">${callsign}</td>
        <td>${coordsHTML}</td>
        <td>${statusHTML}</td>
    `;
    
    const maxRows = (window.innerWidth < 600) ? 5 : 10;
    while (tbody.rows.length > maxRows) tbody.deleteRow(maxRows);
    targetRow.classList.add('row-update');
}

// --- DATA & EXPORT ---
function downloadAllPaths() {
    let csvContent = "data:text/csv;charset=utf-8,Callsign,Latitude,Longitude,Date,Time,Weather,Wind,Temp\n";  
    Object.keys(trackCoords).forEach(callsign => {
        trackCoords[callsign].forEach(point => {
            const dt = new Date(point.timestamp);
            csvContent += `${callsign},${point.lat},${point.lng},${dt.toLocaleDateString()},${dt.toLocaleTimeString()},${point.weather || 'N/A'},${point.wind || 'N/A'},${point.temp || 'N/A'}\n`;
        });
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `ResQLink_History_${new Date().toLocaleDateString()}.csv`);
    link.click();
}

function executeClear() {
    if (pendingClearCallsign) {
        const cs = pendingClearCallsign;
        if (trackPaths[cs]) map.removeLayer(trackPaths[cs]);
        if (historyDots[cs]) {
            historyDots[cs].forEach(dot => map.removeLayer(dot));
            historyDots[cs] = [];
        }
        delete trackPaths[cs];
        trackCoords[cs] = [];
        closeConfirmModal();
        showSuccess("Cleared", `History for ${cs} reset.`);
    }
}

// --- CORE MAP PROCESSING ---
async function updateMapAndUI(data) {
    console.log("📥 Received Data from Pusher:", data); // DEBUG 3
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen, isRegistered } = data;
    
    updateRegisteredList(data);
    if (window.innerWidth <= 768) updateFloatingWindow(data);

    if (!lat || !lng || lat === "null" || lng === "null") return;
    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    // --- 1. WEATHER OVERLAY LOGIC (NEW) ---
    // Extract the latest point from the path to get current weather
    if (path && path.length > 0) {
        const latestPoint = path[path.length - 1];
        const weatherDesc = document.getElementById('map-weather-desc');
        const weatherDetails = document.getElementById('map-weather-details');
        const weatherIcon = document.getElementById('weather-icon-container');
        console.log("🔍 [Weather Debug] Checking latestPoint:", latestPoint);
        console.log("🔍 [Weather Debug] weatherDesc exists?", !!weatherDesc);
        console.log("🔍 [Weather Debug] latestPoint.weather value:", latestPoint.weather);

        if (weatherDesc && latestPoint.weather) {
            weatherDesc.innerText = latestPoint.weather;
            weatherDetails.innerText = `${latestPoint.temp || '--'} | Wind: ${latestPoint.wind || '--'}`;
            
            // Update icon if icon code exists (e.g., "01d")
            if (latestPoint.icon && weatherIcon) {
                weatherIcon.innerHTML = `<img src="https://openweathermap.org/img/wn/${latestPoint.icon}.png" style="width:40px; filter: drop-shadow(0 0 5px rgba(56, 189, 248, 0.5));">`;
            }
        }
    }

    // --- 2. BACKTRACKING LOGIC ---
    trackCoords[callsign] = path || [];
    if (historyDots[callsign]) historyDots[callsign].forEach(dot => map.removeLayer(dot));
    historyDots[callsign] = [];

    const polylinePoints = trackCoords[callsign].map(point => {
        const pt = [point.lat, point.lng];
        const dot = L.circleMarker(pt, { radius: 4, fillColor: "#38bdf8", color: "#0f172a", weight: 1, fillOpacity: 0.8 }).addTo(map);
        
        const dateObj = new Date(point.timestamp);
        dot.bindTooltip(`
            <div style="font-size:11px;">
                <b>${callsign} History</b><br>
                📅 ${dateObj.toLocaleDateString()}<br>
                🕒 ${dateObj.toLocaleTimeString()}<br>
                ☁️ ${point.weather || 'N/A'}<br>
                💨 Wind: ${point.wind || 'N/A'}<br>
                🌡️ Temp: ${point.temp || 'N/A'}
            </div>
        `);
        historyDots[callsign].push(dot);
        return pt;
    });

    if (trackPaths[callsign]) trackPaths[callsign].setLatLngs(polylinePoints);
    else if (polylinePoints.length > 0) {
        trackPaths[callsign] = L.polyline(polylinePoints, { color: '#007bff', weight: 3, opacity: 0.6 }).addTo(map);
    }

    // --- 3. TABLE UPDATE ---
    const dateObj = parseMongoDate(lastSeen);
    const fullTimeStr = dateObj ? `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : "Receiving...";
    updateRecentActivity(callsign, lat, lng, fullTimeStr);

    // --- 4. LIVE MARKER & POPUP ---
    const currentAddr = await getAddress(pos[0], pos[1]);
    const customIcon = getSymbolIcon(symbol);
    const deleteBtn = userRole === 'admin' ? `<button onclick="deleteStation('${callsign}')" style="flex:1; background:#ef4444; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;"><i class="fa-solid fa-trash"></i> Delete</button>` : '';
    const isIGate = symbol === '/r';
    const emergencySection = !isIGate ? `<b>Emergency:</b> ${emergencyName || 'N/A'}<br><b>Emergency #:</b> ${emergencyNum || 'N/A'}` : '';
    
    // Added weather info into the marker popup for consistency
    const latestWeather = (path && path.length > 0) ? path[path.length-1] : {};

    const popupContent = `
        <div style="font-family: sans-serif; min-width: 230px; line-height: 1.4;">
            <h4 style="margin:0 0 8px 0; color:#38bdf8; border-bottom: 1px solid #334155; padding-bottom:5px;">${callsign}</h4>
            <div style="font-size: 13px; margin-bottom: 8px;">
                <b>${isIGate ? 'Custodian' : 'Owner'}:</b> ${ownerName || 'N/A'}<br>
                <b>Contact:</b> ${contactNum || 'N/A'}<br>
                ${emergencySection}
            </div>
            <div style="font-size: 12px; color: #38bdf8; margin-bottom: 5px;">
                ☁️ ${latestWeather.weather || 'N/A'} (${latestWeather.temp || '--'})
            </div>
            <div style="font-size: 12px; color: #ef4444; margin-bottom: 8px; font-weight: bold;">📍 ${currentAddr}</div>
            <div style="font-size: 11px; color: #6f7278; background: #e2e8f0; padding: 5px; border-radius: 4px; margin-bottom: 10px;">
                <b>🕒 Last Seen:</b> ${fullTimeStr}
            </div>
            <div style="display: flex; gap: 5px;">
                <button onclick="openConfirmModal('${callsign}')" style="flex: 1; background: #0284c7; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">Clear Path</button>
                ${deleteBtn}
            </div>
        </div>`;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
    }
    markers[callsign].on('click', () => {
        if (path && path.length > 0) {
            const latest = path[path.length - 1];
            const weatherDesc = document.getElementById('map-weather-desc');
            const weatherDetails = document.getElementById('map-weather-details');
            const weatherIcon = document.getElementById('weather-icon-container');

            if (weatherDesc) {
                // Update the overlay to show THIS specific tracker's weather
                weatherDesc.innerText = `${callsign}: ${latest.weather || 'Unknown'}`;
                weatherDetails.innerText = `${latest.temp || '--'} | Wind: ${latest.wind || '--'}`;
                
                if (latest.icon && weatherIcon) {
                    weatherIcon.innerHTML = `<img src="https://openweathermap.org/img/wn/${latest.icon}.png" style="width:40px;">`;
                }
            }
        }
    });
    markers[callsign].isRegistered = isRegistered;
}

async function loadDefaultWeather() {
    const lat = 13.58; // Virac Latitude
    const lng = 124.23; // Virac Longitude
    const apiKey = '07fad6d47f1b08704087b169d65b9d4a';
    
    try {
        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`);
        const data = await res.json();
        
        document.getElementById('map-weather-desc').innerText = `Catanduanes: ${data.weather[0].description}`;
        document.getElementById('map-weather-details').innerText = `${Math.round(data.main.temp)}°C | Wind: ${data.wind.speed} m/s`;
        document.getElementById('weather-icon-container').innerHTML = 
            `<img src="https://openweathermap.org/img/wn/${data.weather[0].icon}.png" style="width:40px;">`;
    } catch (err) {
        console.error("Default weather failed", err);
    }
}

// --- OTHER UTILS ---
async function getAddress(lat, lng) {
    try {
        const res = await fetch(`/api/get-address?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.address || "Location Found";
    } catch (e) { return "Location Found"; }
}

function trackCallsign() {
    const input = document.getElementById('callSign').value.toUpperCase().trim();
    if (!input) return showMiniAlert("Input Required", "Please enter a callsign.");
    if (markers[input]) {
        map.setView(markers[input].getLatLng(), 15, { animate: true });
        markers[input].openPopup();
        if (window.innerWidth <= 768) toggleSidebar();
    } else showMiniAlert("Offline", `${input} is offline.`);
}

function toggleSidebar() {
    const panel = document.querySelector('.side-panel');
    const btn = document.getElementById('mobile-sidebar-toggle');
    if (!panel || !btn) return;
    panel.classList.toggle('minimized');
    btn.innerHTML = panel.classList.contains('minimized') ? '<i class="fa-solid fa-chevron-right"></i>' : '<i class="fa-solid fa-chevron-left"></i>';
}

function showMiniAlert(title, message) {
    document.getElementById('miniAlertTitle').innerText = title;
    document.getElementById('miniAlertMessage').innerText = message;
    document.getElementById('miniAlertModal').style.display = 'flex';
}
function closeMiniAlert() { document.getElementById('miniAlertModal').style.display = 'none'; }

function handleLogout() { localStorage.clear(); window.location.href = '/api/logout'; }

// --- LISTENERS ---
channel.bind('connection-status', (data) => {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    text.innerText = data.status === "Online" ? "Connected to APRS-IS" : "Connection Lost";
    dot.style.color = data.status === "Online" ? "#22c55e" : "#ef4444";
});

channel.bind('delete-data', (data) => {
    const { callsign, totalRegistered } = data;
    if (document.getElementById('registered-header-count')) document.getElementById('registered-header-count').innerText = `(${totalRegistered})`;
    if (markers[callsign]) {
        map.removeLayer(markers[callsign]);
        if (trackPaths[callsign]) map.removeLayer(trackPaths[callsign]);
        if (historyDots[callsign]) historyDots[callsign].forEach(d => map.removeLayer(d));
        delete markers[callsign]; delete trackPaths[callsign];
        const row = Array.from(document.getElementById('history-body').rows).find(r => r.cells[0].innerText === callsign);
        if (row) row.remove();
        const item = document.getElementById(`list-${callsign}`);
        if (item) item.remove();
    }
});

channel.bind('new-data', updateMapAndUI);

window.onload = async () => {
    loadDefaultWeather();
    try {
        userRole = localStorage.getItem('userRole') || 'viewer'; 
        if (document.getElementById('role-text')) {
            document.getElementById('role-text').innerText = userRole === 'admin' ? "System Admin" : "Field Staff";
            document.getElementById('role-badge').classList.add(userRole === 'admin' ? 'role-admin' : 'role-viewer');
        }
        const res = await fetch(`/api/positions?t=${Date.now()}`);
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const history = await res.json();
        if (Array.isArray(history)) {
            if (document.getElementById('registered-header-count')) document.getElementById('registered-header-count').innerText = `(${history.length})`;
            history.sort((a, b) => (parseMongoDate(a.lastSeen) || 0) - (parseMongoDate(b.lastSeen) || 0));
            history.forEach(d => updateMapAndUI(d));
        }
        // Inside window.onload, after history.forEach(d => updateMapAndUI(d));
        if (history.length > 0) {
            // Show the weather for the most recently active station on load
            updateMapAndUI(history[history.length - 1]);
        }
    } catch (err) { console.error("Init failed:", err); }
};
