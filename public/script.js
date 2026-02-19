// 1. Initialize Pusher
const pusher = new Pusher('899f970a7cf34c9a73a9', { cluster: 'ap1' });
const channel = pusher.subscribe('aprs-channel');

// 2. Map & State Setup
var map = L.map('map').setView([13.5857, 124.2160], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var markers = {};
var trackPaths = {}; 
var trackCoords = {}; 
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

    // 1. LOCAL CHECK: Immediate check against stations already on your map
    if (markers[cs] && markers[cs].isRegistered) {
        return showSuccess("Already Registered", `Callsign ${cs} is already registered to ${markers[cs].ownerName || 'another responder'}.`);
    }

    // 2. SERVER CHECK: Verify with the database for real-time accuracy
    try {
        const res = await fetch(`/api/check-callsign/${cs}`);
        const data = await res.json();

        if (data.exists) {
            // If the server confirms it exists, stop here
            return showSuccess("Already Registered", `Callsign ${cs} is already registered to ${data.ownerName}.`);
        }

        // 3. PROCEED: Only show the modal if the callsign is truly available
        document.getElementById('modalCallsignDisplay').innerText = cs;
        document.getElementById('regModal').style.display = 'flex'; 
        toggleRegFields();

    } catch (e) {
        console.error("Validation error:", e);
        alert("Could not verify callsign availability. Please try again.");
    }
}

function closeModal() { document.getElementById('regModal').style.display = 'none'; }

async function submitRegistration() {
    const cs = document.getElementById('modalCallsignDisplay').innerText;

    // DOUBLE CHECK: Ensure it wasn't added while the modal was open
    if (markers[cs] && markers[cs].isRegistered) {
        alert("This callsign was just registered by another session.");
        closeModal();
        return;
    }

    const type = document.getElementById('stationType').value;
    const symbol = (type === 'igate') ? '/r' : '/[';
    const details = (type === 'igate') ? 'Stationary iGate' : 'Mobile Responder';

    const data = {
        callsign: cs,
        lat: markers[cs] ? markers[cs].getLatLng().lat : null,
        lng: markers[cs] ? markers[cs].getLatLng().lng : null,
        ownerName: document.getElementById('ownerName').value,
        contactNum: document.getElementById('contactNum').value,
        emergencyName: (type === 'igate') ? "N/A" : document.getElementById('emergencyName').value,
        emergencyNum: (type === 'igate') ? "N/A" : document.getElementById('emergencyNum').value,
        symbol: symbol,
        details: details
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
        } else {
            const errData = await res.json();
            alert(errData.error || "Registration failed.");
        }
    } catch (e) { showSuccess("Error", "Server unreachable."); }
    finally { document.body.classList.remove('loading-process'); }
}

// --- STATION DELETION ---
async function deleteStation(callsign) {
    stationToDelete = callsign.trim();
    document.getElementById('deleteCallsignDisplay').innerText = stationToDelete;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
    
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.onclick = null; 

    confirmBtn.onclick = async () => {
        if (!stationToDelete) return;
        const target = stationToDelete;

        document.body.classList.add('loading-process');
        try {
            const response = await fetch(`/api/delete-station/${target}`, { method: 'DELETE' });
            if (response.ok) { 
                closeDeleteModal(); 
                showSuccess("Deleted", `${target} removed.`); 
            } else {
                alert("Delete failed on server.");
            }
        } catch (e) { console.error(e); }
        finally { document.body.classList.remove('loading-process'); }
    };
}

// --- CORE MAP LOGIC ---
function updateRegisteredList(data) {
    const list = document.getElementById('registered-list');
    const headerCount = document.getElementById('registered-header-count');
    if (!list || !data.isRegistered) return;

    // Update global headcount if provided
    if (data.totalRegistered !== undefined && headerCount) {
        headerCount.innerText = `(${data.totalRegistered})`;
    }

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

// --- UPDATED: Map Interaction Functions ---
function focusStation(callsign) {
    if (markers[callsign]) {
        map.setView(markers[callsign].getLatLng(), 15, { animate: true });
        markers[callsign].openPopup();
        // NEW: Auto-minimize on mobile to show the map
        if (window.innerWidth <= 768) {
            const panel = document.querySelector('.side-panel');
            if (!panel.classList.contains('minimized')) {
                toggleSidebar();
            }
        }
    } else {
        // Aesthetic replacement for browser alert
        showMiniAlert("No Signal", `${callsign} has not sent a signal yet.`);
    }
}

// --- CSV DOWNLOAD LOGIC UPDATE ---
function downloadAllPaths() {
    let csvContent = "data:text/csv;charset=utf-8,Callsign,Latitude,Longitude,Date,Time\n";  
    Object.keys(trackCoords).forEach(callsign => {
        // trackCoords now contains the objects from the database path array
        trackCoords[callsign].forEach(point => {
            // point.timestamp is the actual uplink time from the database
            const uplinkDate = new Date(point.timestamp);
            const dateStr = uplinkDate.toLocaleDateString();
            const timeStr = uplinkDate.toLocaleTimeString();
            csvContent += `${callsign},${point.lat},${point.lng},${dateStr},${timeStr}\n`;
        });
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ResQLink_Full_History_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function executeClear() {
    if (pendingClearCallsign) {
        if (trackPaths[pendingClearCallsign]) map.removeLayer(trackPaths[pendingClearCallsign]);
        delete trackPaths[pendingClearCallsign];
        trackCoords[pendingClearCallsign] = [];
        closeConfirmModal();
        showSuccess("Cleared", `History for ${pendingClearCallsign} reset.`);
    }
}

// FIXED: Properly appends multiple callsigns to the table
function updateRecentActivity(callsign, lat, lng, time) {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    
    // Move existing row to top if it exists, otherwise create new
    let existingRow = Array.from(tbody.rows).find(row => row.cells[0].innerText === callsign);
    if (existingRow) existingRow.remove();

    let targetRow = tbody.insertRow(0);
    targetRow.innerHTML = `<td>${callsign}</td><td><span style="color:#94a3b8;font-size:11px;">${lat}</span></td><td><span style="color:#94a3b8;font-size:11px;">${lng}</span></td><td>${time}</td>`;
    
    // Maintain a clean UI (limit to latest 10)
    if (tbody.rows.length > 10) tbody.deleteRow(10);
    
    targetRow.classList.add('row-update');

    const maxRows = (window.innerWidth < 600) ? 5 : 10;
    if (tbody.rows.length > maxRows) tbody.deleteRow(maxRows);
}

async function getAddress(lat, lng) {
    try {
        const res = await fetch(`/api/get-address?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        return data.address || "Location Found";
    } catch (e) { return "Location Found"; }
}

function trackCallsign() {
    const input = document.getElementById('callSign').value.toUpperCase().trim();
    if (!input) {
        showMiniAlert("Input Required", "Please enter a callsign to track.");
        return;
    }
    
    if (markers[input]) {
        map.setView(markers[input].getLatLng(), 15, { animate: true });
        markers[input].openPopup()
            // NEW: Auto-minimize on mobile
        if (window.innerWidth <= 768) {
            toggleSidebar();
        };
    } else {
        // Aesthetic replacement for browser alert
        showMiniAlert("Offline", `${input} is currently offline or not found.`);
    }
}

// --- NEW: Custom Mini Alert Utility ---
function showMiniAlert(title, message) {
    document.getElementById('miniAlertTitle').innerText = title;
    document.getElementById('miniAlertMessage').innerText = message;
    document.getElementById('miniAlertModal').style.display = 'flex';
}

function closeMiniAlert() {
    document.getElementById('miniAlertModal').style.display = 'none';
}

// FIXED: Clears local session role before redirecting to logout route
function handleLogout() { 
    localStorage.clear(); 
    window.location.href = '/api/logout'; 
}

async function updateMapAndUI(data) {
    const { callsign, lat, lng, symbol, ownerName, contactNum, emergencyName, emergencyNum, path, lastSeen, isRegistered } = data;
    updateRegisteredList(data);
    if (window.innerWidth <= 768) {
        updateFloatingWindow(data); // Populate the floating window on mobile
    }

    if (!lat || !lng || lat === "null" || lng === "null") return;

    const pos = [parseFloat(lat), parseFloat(lng)];
    if (isNaN(pos[0])) return;

    // UPDATED: Store the full path objects (with timestamps) in trackCoords for CSV export
    trackCoords[callsign] = path || [];
    
    // NEW: Extract only [lat, lng] into a simple array for Leaflet polyline drawing
    const polylinePoints = trackCoords[callsign].map(point => [point.lat, point.lng]);

    // Path drawing logic using the extracted polylinePoints
    if (trackPaths[callsign]) {
        trackPaths[callsign].setLatLngs(polylinePoints);
    } else if (polylinePoints.length > 0) {
        trackPaths[callsign] = L.polyline(polylinePoints, { 
            color: '#007bff', 
            weight: 3, 
            opacity: 0.6 
        }).addTo(map);
    }

    // Toggle Sidebar Function
function toggleSidebar() {
    const panel = document.querySelector('.side-panel');
    const btn = document.getElementById('mobile-sidebar-toggle');
    
    if (!panel) return;

    // Force the toggle
    panel.classList.toggle('minimized');
    
    // Update button icon for user guidance
    if (btn) {
        btn.innerHTML = panel.classList.contains('minimized') 
            ? '<i class="fa-solid fa-chevron-right"></i>' 
            : '<i class="fa-solid fa-chevron-left"></i>';
    }
}

// Update the Floating Window
function updateFloatingWindow(data) {
    const container = document.getElementById('floating-items');
    if (!container || !data.isRegistered) return;

    let existing = document.getElementById(`float-${data.callsign}`);
    const itemHTML = `
        <div class="floating-item" id="float-${data.callsign}" onclick="focusStation('${data.callsign}')">
            ${data.callsign}
        </div>
    `;

    if (existing) existing.outerHTML = itemHTML;
    else container.insertAdjacentHTML('beforeend', itemHTML);
}

    const currentAddr = await getAddress(pos[0], pos[1]);
    const dateObj = parseMongoDate(lastSeen);
    const timeStr = dateObj ? dateObj.toLocaleTimeString() : "Receiving...";
    updateRecentActivity(callsign, lat, lng, timeStr);

    const typeName = symbolNames[symbol] || `Other Tracker (${symbol})`;
    const customIcon = getSymbolIcon(symbol);
    const deleteBtn = userRole === 'admin' ? `<button onclick="deleteStation('${callsign}')" style="flex:1; background:#ef4444; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;"><i class="fa-solid fa-trash"></i> Delete</button>` : '';
    const isIGate = symbol === '/r';
    const ownerLabel = isIGate ? 'Station Custodian' : 'Owner/Responder';
    const emergencySection = !isIGate ? `<b>Emergency:</b> ${emergencyName || 'N/A'}<br><b>Emergency #:</b> ${emergencyNum || 'N/A'}` : '';
    
    const popupContent = `
        <div style="font-family: sans-serif; min-width: 230px; line-height: 1.4;">
            <h4 style="margin:0 0 8px 0; color:#38bdf8; border-bottom: 1px solid #334155; padding-bottom:5px;">${callsign}</h4>
            <div style="font-size: 13px; margin-bottom: 8px;">
                <b>${ownerLabel}:</b> ${ownerName || 'N/A'}<br>
                <b>Contact:</b> ${contactNum || 'N/A'}<br>
                ${emergencySection}
            </div>
            <div style="font-size: 12px; color: #ef4444; margin-bottom: 8px; font-weight: bold;">📍 ${currentAddr}</div>
            <div style="font-size: 11px; color: #6f7278; background: #dcdde0; padding: 5px; border-radius: 4px; margin-bottom: 10px;">
                <b>Type:</b> ${typeName}<br>
                <b>🕒 Last Seen:</b> ${timeStr}
            </div>
            <div style="display: flex; gap: 5px;">
                <button onclick="openConfirmModal('${callsign}')" style="flex: 1; background: #0284c7; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">Clear Path</button>
                ${deleteBtn}
            </div>
        </div>`;

    if (markers[callsign]) {
        markers[callsign].setLatLng(pos).setIcon(customIcon).setPopupContent(popupContent);
        markers[callsign].isRegistered = isRegistered;
    } else {
        markers[callsign] = L.marker(pos, { icon: customIcon }).addTo(map).bindPopup(popupContent);
        markers[callsign].isRegistered = isRegistered;
    }
}

// --- PUSHER LISTENERS ---
channel.bind('connection-status', (data) => {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (data.status === "Online") { 
        text.innerText = "Connected to APRS-IS"; 
        dot.style.color = "#22c55e"; 
    } else { 
        text.innerText = "Connection Lost"; 
        dot.style.color = "#ef4444"; 
    }
});

channel.bind('delete-data', (data) => {
    const { callsign, totalRegistered } = data;
    // Update headcount UI on deletion
    if (document.getElementById('registered-header-count')) {
        document.getElementById('registered-header-count').innerText = `(${totalRegistered})`;
    }
    if (markers[callsign]) {
        map.removeLayer(markers[callsign]);
        if (trackPaths[callsign]) map.removeLayer(trackPaths[callsign]);
        delete markers[callsign]; 
        delete trackPaths[callsign];
        const row = Array.from(document.getElementById('history-body').rows).find(r => r.cells[0].innerText === callsign);
        if (row) row.remove();
        const item = document.getElementById(`list-${callsign}`);
        if (item) item.remove();
    }
});

channel.bind('new-data', updateMapAndUI);

window.onload = async () => {
    try {
        userRole = localStorage.getItem('userRole') || 'viewer'; 
        if (document.getElementById('role-text')) {
            document.getElementById('role-text').innerText = userRole === 'admin' ? "System Admin" : "Field Staff";
            document.getElementById('role-badge').classList.add(userRole === 'admin' ? 'role-admin' : 'role-viewer');
        }
        
        const res = await fetch(`/api/positions?t=${Date.now()}`);
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        
        if (res.ok) { 
            document.getElementById('status-text').innerText = "Connected to APRS-IS"; 
            document.getElementById('status-dot').style.color = "#22c55e"; 
        }
        
        const history = await res.json();
        if (Array.isArray(history)) {
            // Update initial headcount
            if (document.getElementById('registered-header-count')) {
                document.getElementById('registered-header-count').innerText = `(${history.length})`;
            }
            history.sort((a, b) => (parseMongoDate(a.lastSeen) || 0) - (parseMongoDate(b.lastSeen) || 0));
            history.forEach(d => updateMapAndUI(d));
        }
    } catch (err) { console.error("Initialization failed:", err); }
};
