// API Base URL
const API_URL = 'http://localhost:3000/api';

// WebSocket connection
const socket = io('http://localhost:3000');

// Data storage
const chartData = {
    temperature: [],
    airHumidity: [],
    soilHumidity: [],
    timestamps: [],
    maxPoints: 20
};

let pumpState = false;
let valveState = false;
let relay1State = false;
let relay2State = false;

// Initialize Charts
const chartConfigs = {
    temperature: createChart('tempChart', 'rgba(239, 68, 68, 0.8)', 'rgba(239, 68, 68, 0.1)'),
    airHumidity: createChart('airHumChart', 'rgba(59, 130, 246, 0.8)', 'rgba(59, 130, 246, 0.1)'),
    soilHumidity: createChart('soilHumChart', 'rgba(34, 197, 94, 0.8)', 'rgba(34, 197, 94, 0.1)')
};

function createChart(canvasId, lineColor, fillColor) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, lineColor, fillColor, data: [] };
}

function drawChart(config) {
    const { canvas, ctx, lineColor, fillColor, data } = config;
    const width = canvas.width = canvas.offsetWidth * 2;
    const height = canvas.height = canvas.offsetHeight * 2;
    
    ctx.clearRect(0, 0, width, height);
    
    if (data.length < 2) return;

    const padding = 50;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const step = chartWidth / (data.length - 1);

    // Set font
    ctx.font = '20px Arial';
    ctx.fillStyle = '#6b7280';

    // Draw Y-axis labels (values)
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const value = min + (range / ySteps) * i;
        const y = padding + chartHeight - (i * chartHeight / ySteps);
        
        ctx.textAlign = 'right';
        ctx.fillText(value.toFixed(1), padding - 10, y + 5);
        
        // Draw grid line
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + chartWidth, y);
        ctx.stroke();
    }

    // Draw X-axis labels (time)
    const xSteps = Math.min(5, data.length - 1);
    const xInterval = Math.floor((data.length - 1) / xSteps);
    for (let i = 0; i <= xSteps; i++) {
        const index = Math.min(i * xInterval, data.length - 1);
        const x = padding + index * step;
        const timestamp = chartData.timestamps[index];
        
        if (timestamp) {
            const time = new Date(timestamp).toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            ctx.textAlign = 'center';
            ctx.fillText(time, x, height - 10);
        }
    }

    // Draw Y-axis line
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartHeight);
    ctx.stroke();

    // Draw X-axis line
    ctx.beginPath();
    ctx.moveTo(padding, padding + chartHeight);
    ctx.lineTo(padding + chartWidth, padding + chartHeight);
    ctx.stroke();

    // Draw filled area
    ctx.beginPath();
    ctx.moveTo(padding, padding + chartHeight);
    data.forEach((value, i) => {
        const x = padding + i * step;
        const y = padding + (1 - (value - min) / range) * chartHeight;
        ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + (data.length - 1) * step, padding + chartHeight);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    data.forEach((value, i) => {
        const x = padding + i * step;
        const y = padding + (1 - (value - min) / range) * chartHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw data points
    data.forEach((value, i) => {
        const x = padding + i * step;
        const y = padding + (1 - (value - min) / range) * chartHeight;
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
    });
}

function updateChartData(type, value) {
    const data = chartData[type];
    data.push(parseFloat(value));
    
    // Add timestamp
    chartData.timestamps.push(new Date());
    
    if (data.length > chartData.maxPoints) {
        data.shift();
        chartData.timestamps.shift();
    }
    
    const chartConfig = type === 'temperature' ? chartConfigs.temperature :
                       type === 'airHumidity' ? chartConfigs.airHumidity :
                       chartConfigs.soilHumidity;
    
    chartConfig.data = [...data];
    drawChart(chartConfig);
}

// WebSocket Event Handlers
socket.on('connect', () => {
    console.log('✅ Connected to server');
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
    updateConnectionStatus(false);
});

socket.on('initialData', (data) => {
    console.log('📊 Initial data received:', data);
    updateUIWithData(data);
});

socket.on('sensorUpdate', (data) => {
    console.log('📨 Sensor update:', data);
    
    const topicMap = {
        'esp32/air/temperature': { type: 'temperature', elementId: 'currentTemp' },
        'esp32/air/humidity': { type: 'airHumidity', elementId: 'currentAirHum' },
        'esp32/soil/percent': { type: 'soilHumidity', elementId: 'currentSoilHum' }
    };
    
    const mapping = topicMap[data.topic];
    if (mapping) {
        const value = parseFloat(data.value);
        document.getElementById(mapping.elementId).textContent = value.toFixed(1);
        updateChartData(mapping.type, value);
    }
});

socket.on('controlUpdate', (data) => {
    console.log('🎛️ Control update:', data);
    
    if (data.device === 'pump') {
        pumpState = data.status === '1';
        updatePumpUI(pumpState);
    } else if (data.device === 'valve') {
        valveState = data.status === '1';
        updateValveUI(valveState);
    } else if (data.device === 'relay1') {
        relay1State = data.status === '1'; // REVISI
        updateRelay1UI(relay1State);
    } else if (data.device === 'relay2') {
        relay2State = data.status === '1'; // REVISI
        updateRelay2UI(relay2State);
    }
});

socket.on('dataSaved', (data) => {
    console.log('💾 Data saved:', data.message);
    showNotification('Data berhasil disimpan ke database');
});

function updateUIWithData(data) {
    if (data.temperature !== null) {
        document.getElementById('currentTemp').textContent = data.temperature.toFixed(1);
        updateChartData('temperature', data.temperature);
    }
    if (data.airHumidity !== null) {
        document.getElementById('currentAirHum').textContent = data.airHumidity.toFixed(1);
        updateChartData('airHumidity', data.airHumidity);
    }
    if (data.soilHumidity !== null) {
        document.getElementById('currentSoilHum').textContent = data.soilHumidity.toFixed(1);
        updateChartData('soilHumidity', data.soilHumidity);
    }
    
    pumpState = data.pumpStatus === '1';
    valveState = data.valveStatus === '1';
    relay1State = data.relay1Status === '1';
    relay2State = data.relay2Status === '1';
    
    updatePumpUI(pumpState);
    updateValveUI(valveState);
    updateRelay1UI(relay1State);
    updateRelay2UI(relay2State);
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    
    if (connected) {
        dot.classList.add('connected');
        text.textContent = 'Terhubung';
    } else {
        dot.classList.remove('connected');
        text.textContent = 'Terputus';
    }
}

function updatePumpUI(isOn) {
    const toggle = document.getElementById('pumpToggle');
    const status = document.getElementById('pumpStatus');
    
    if (isOn) {
        toggle.classList.add('active');
        status.textContent = 'Status: ON';
    } else {
        toggle.classList.remove('active');
        status.textContent = 'Status: OFF';
    }
}

function updateValveUI(isOn) {
    const toggle = document.getElementById('valveToggle');
    const status = document.getElementById('valveStatus');
    
    if (isOn) {
        toggle.classList.add('active');
        status.textContent = 'Status: ON';
    } else {
        toggle.classList.remove('active');
        status.textContent = 'Status: OFF';
    }
}

function updateRelay1UI(isOn) {
    const toggle = document.getElementById('relay1Toggle');
    const status = document.getElementById('relay1Status');
    
    if (isOn) {
        toggle.classList.add('active');
        status.textContent = 'Status: ON';
    } else {
        toggle.classList.remove('active');
        status.textContent = 'Status: OFF';
    }
}

function updateRelay2UI(isOn) {
    const toggle = document.getElementById('relay2Toggle');
    const status = document.getElementById('relay2Status');
    
    if (isOn) {
        toggle.classList.add('active');
        status.textContent = 'Status: ON';
    } else {
        toggle.classList.remove('active');
        status.textContent = 'Status: OFF';
    }
}

// Control Functions
window.togglePump = async function() {
    const newState = !pumpState;
    
    try {
        const response = await fetch(`${API_URL}/control/pump`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newState ? '1' : '0' })
        });
        
        const result = await response.json();
        
        if (result.success) {
            pumpState = newState;
            updatePumpUI(pumpState);
            console.log('✅ Pump control:', result.message);
        } else {
            console.error('❌ Error:', result.error);
            alert('Gagal mengontrol pompa: ' + result.error);
        }
    } catch (error) {
        console.error('❌ Network error:', error);
        alert('Gagal terhubung ke server');
    }
};

window.toggleValve = async function() {
    const newState = !valveState;
    
    try {
        const response = await fetch(`${API_URL}/control/valve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newState ? '1' : '0' })
        });
        
        const result = await response.json();
        
        if (result.success) {
            valveState = newState;
            updateValveUI(valveState);
            console.log('✅ Valve control:', result.message);
        } else {
            console.error('❌ Error:', result.error);
            alert('Gagal mengontrol valve: ' + result.error);
        }
    } catch (error) {
        console.error('❌ Network error:', error);
        alert('Gagal terhubung ke server');
    }
};

window.toggleRelay1 = async function() {
    const newState = !relay1State;
    
    try {
        const statusToSend = newState ? '1' : '0'; // REVISI
        
        const response = await fetch(`${API_URL}/control/relay1`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: statusToSend })
        });
        
        const result = await response.json();
        
        if (result.success) {
            relay1State = newState;
            updateRelay1UI(relay1State);
            console.log('✅ Relay 1 control:', result.message);
        } else {
            console.error('❌ Error:', result.error);
            alert('Gagal mengontrol Relay 1: ' + result.error);
        }
    } catch (error) {
        console.error('❌ Network error:', error);
        alert('Gagal terhubung ke server');
    }
};

window.toggleRelay2 = async function() {
    const newState = !relay2State;
    
    try {
        const statusToSend = newState ? '1' : '0'; // REVISI
        
        const response = await fetch(`${API_URL}/control/relay2`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: statusToSend })
        });
        
        const result = await response.json();
        
        if (result.success) {
            relay2State = newState;
            updateRelay2UI(relay2State);
            console.log('✅ Relay 2 control:', result.message);
        } else {
            console.error('❌ Error:', result.error);
            alert('Gagal mengontrol Relay 2: ' + result.error);
        }
    } catch (error) {
        console.error('❌ Network error:', error);
        alert('Gagal terhubung ke server');
    }
};

// Tab Switching
window.switchTab = function(tabName) {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');
};

// History Functions
window.loadHistory = async function(type) {
    const content = document.getElementById('historyContent');
    content.innerHTML = '<div class="loading">⏳ Memuat data...</div>';
    
    try {
        const response = await fetch(`${API_URL}/sensors/history?limit=50`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        const history = result.data;
        
        if (history.length === 0) {
            content.innerHTML = '<div class="empty-state"><p>Tidak ada data history</p></div>';
            return;
        }
        
        let html = '';
        history.forEach(data => {
            const date = new Date(data.timestamp);
            
            if (type === 'temperature') {
                // History Temperatur: Timestamp, Temperature, Pompa, Valve, Relay1, Relay2
                html += createHistoryItem(date, [
                    { label: 'Temperatur', value: `${data.temperature?.toFixed(1) || '--'}°C` },
                    { label: 'Pompa', value: data.pumpStatus === '1' ? 'ON' : 'OFF' },
                    { label: 'Valve', value: data.valveStatus === '1' ? 'ON' : 'OFF' },
                    { label: 'Relay 1', value: data.relay1Status === '1' ? 'ON' : 'OFF' }, //REVISI
                    { label: 'Relay 2', value: data.relay2Status === '1' ? 'ON' : 'OFF' }  //REVISI
                ]);
            } else {
                // History Kelembapan: Timestamp, Kelembapan Udara, Kelembapan Tanah, Pompa, Valve, Relay1, Relay2
                html += createHistoryItem(date, [
                    { label: 'Kelembapan Udara', value: `${data.airHumidity?.toFixed(1) || '--'}%` },
                    { label: 'Kelembapan Tanah', value: `${data.soilHumidity?.toFixed(1) || '--'}%` },
                    { label: 'Pompa', value: data.pumpStatus === '1' ? 'ON' : 'OFF' },
                    { label: 'Valve', value: data.valveStatus === '1' ? 'ON' : 'OFF' },
                    { label: 'Relay 1', value: data.relay1Status === '1' ? 'ON' : 'OFF' }, //REVISI
                    { label: 'Relay 2', value: data.relay2Status === '1' ? 'ON' : 'OFF' }  //REVISI
                ]);
            }
        });
        
        content.innerHTML = html;
    } catch (error) {
        console.error('Error loading history:', error);
        content.innerHTML = '<div class="empty-state"><p>Error memuat data</p></div>';
    }
};

function createHistoryItem(date, fields) {
    const timeStr = date.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    let fieldsHtml = fields.map(f => `
        <div class="history-field">
            <div class="history-field-label">${f.label}</div>
            <div class="history-field-value">${f.value}</div>
        </div>
    `).join('');
    
    return `
        <div class="history-item">
            <div class="history-time">📅 ${timeStr}</div>
            <div class="history-data">${fieldsHtml}</div>
        </div>
    `;
}

function showNotification(message) {
    // Simple notification - you can enhance this
    console.log('📢 Notification:', message);
}

// Fetch initial data on load
async function fetchInitialData() {
    try {
        const response = await fetch(`${API_URL}/sensors/current`);
        const result = await response.json();
        
        if (result.success) {
            updateUIWithData(result.data);
        }
    } catch (error) {
        console.error('Error fetching initial data:', error);
    }
}

// Initialize
fetchInitialData();