const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const admin = require('firebase-admin');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Firebase Admin Initialization
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// MQTT Configuration
const mqttConfig = {
    host: 'e2270d29a68a45a89ae3d44cd781f1df.s1.eu.hivemq.cloud',
    port: 8883,
    username: '232410102005',
    password: 'Qwerty7890',
    protocol: 'mqtts'
};

// Sensor Data Storage
let sensorData = {
    temperature: null,
    airHumidity: null,
    soilHumidity: null,
    pumpStatus: '0',
    valveStatus: '0',
    relay1Status: '0', // REVISI
    relay2Status: '0', // REVISI
    lastUpdate: null
};

// Data untuk disimpan ke database (diambil setiap 30 detik)
let dataToSave = { ...sensorData };

// MQTT Topics
const topics = {
    temperature: 'esp32/air/temperature',
    airHumidity: 'esp32/air/humidity',
    soilHumidity: 'esp32/soil/percent',
    pump: 'esp32/control/pump',
    valve: 'esp32/control/solenoid',
    relay1: 'esp32/control/custom1',
    relay2: 'esp32/control/custom2'
};

// Connect to MQTT Broker
const mqttClient = mqtt.connect(`mqtts://${mqttConfig.host}:${mqttConfig.port}`, {
    username: mqttConfig.username,
    password: mqttConfig.password,
    rejectUnauthorized: false
});

mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT Broker');
    
    // Subscribe to all sensor topics
    Object.values(topics).forEach(topic => {
        if (!topic.includes('control')) {
            mqttClient.subscribe(topic, (err) => {
                if (!err) {
                    console.log(`📡 Subscribed to: ${topic}`);
                }
            });
        }
    });
});

mqttClient.on('message', (topic, message) => {
    const value = message.toString();
    console.log(`📨 Received: ${topic} = ${value}`);
    
    // Update sensor data
    switch(topic) {
        case topics.temperature:
            sensorData.temperature = parseFloat(value);
            break;
        case topics.airHumidity:
            sensorData.airHumidity = parseFloat(value);
            break;
        case topics.soilHumidity:
            sensorData.soilHumidity = parseFloat(value);
            break;
    }
    
    sensorData.lastUpdate = new Date().toISOString();
    
    // Broadcast to all connected clients via WebSocket
    io.emit('sensorUpdate', {
        topic: topic,
        value: value,
        timestamp: sensorData.lastUpdate
    });
});

mqttClient.on('error', (error) => {
    console.error('❌ MQTT Error:', error);
});

// Function to save data to Firebase
async function saveToFirebase(reason = 'scheduled') {
    if (sensorData.temperature !== null || sensorData.airHumidity !== null || sensorData.soilHumidity !== null) {
        try {
            const docData = {
                temperature: sensorData.temperature || 0,
                airHumidity: sensorData.airHumidity || 0,
                soilHumidity: sensorData.soilHumidity || 0,
                pumpStatus: sensorData.pumpStatus,
                valveStatus: sensorData.valveStatus,
                relay1Status: sensorData.relay1Status,
                relay2Status: sensorData.relay2Status,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };
            
            await db.collection('sensorData').add(docData);
            console.log(`💾 Data saved to Firebase (${reason}):`, docData);
            
            // Notify clients that data was saved
            io.emit('dataSaved', {
                message: `Data berhasil disimpan (${reason})`,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error saving to Firebase:', error);
        }
    }
}

// Save data to Firebase every 30 seconds (scheduled)
setInterval(() => {
    saveToFirebase('scheduled');
}, 30000); // 30 seconds

// REST API Endpoints

// Get current sensor data
app.get('/api/sensors/current', (req, res) => {
    res.json({
        success: true,
        data: sensorData
    });
});

// Get sensor history
app.get('/api/sensors/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const snapshot = await db.collection('sensorData')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        
        const history = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            history.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp?.toDate().toISOString() || null
            });
        });
        
        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Control pump
app.post('/api/control/pump', (req, res) => {
    const { status } = req.body; // '0' or '1'
    
    if (status !== '0' && status !== '1') {
        return res.status(400).json({
            success: false,
            error: 'Status must be "0" or "1"'
        });
    }
    
    mqttClient.publish(topics.pump, status, async (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        sensorData.pumpStatus = status;
        console.log(`💧 Pump ${status === '1' ? 'ON' : 'OFF'}`);
        
        // Broadcast to all clients
        io.emit('controlUpdate', {
            device: 'pump',
            status: status
        });
        
        // Save to database immediately on control action
        await saveToFirebase('pump_control');
        
        res.json({
            success: true,
            message: `Pump turned ${status === '1' ? 'ON' : 'OFF'}`
        });
    });
});

// Control valve
app.post('/api/control/valve', (req, res) => {
    const { status } = req.body; // '0' or '1'
    
    if (status !== '0' && status !== '1') {
        return res.status(400).json({
            success: false,
            error: 'Status must be "0" or "1"'
        });
    }
    
    mqttClient.publish(topics.valve, status, async (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        sensorData.valveStatus = status;
        console.log(`🚰 Valve ${status === '1' ? 'ON' : 'OFF'}`);
        
        // Broadcast to all clients
        io.emit('controlUpdate', {
            device: 'valve',
            status: status
        });
        
        // Save to database immediately on control action
        await saveToFirebase('valve_control');
        
        res.json({
            success: true,
            message: `Valve turned ${status === '1' ? 'ON' : 'OFF'}`
        });
    });
});

// Control Relay 1
app.post('/api/control/relay1', (req, res) => {
    const { status } = req.body; // '0' or '1'
    
    if (status !== '0' && status !== '1') {
        return res.status(400).json({
            success: false,
            error: 'Status must be "0" or "1"'
        });
    }
    
    mqttClient.publish(topics.relay1, status, async (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        sensorData.relay1Status = status;
        console.log(`🔌 Relay 1 ${status === '1' ? 'ON' : 'OFF'}`); // REVISI
        
        // Broadcast to all clients
        io.emit('controlUpdate', {
            device: 'relay1',
            status: status
        });
        
        // Save to database immediately on control action
        await saveToFirebase('relay1_control');
        
        res.json({
            success: true,
            message: `Relay 1 turned ${status === '1' ? 'ON' : 'OFF'}` // REVISI
        });
    });
});

// Control Relay 2
app.post('/api/control/relay2', (req, res) => {
    const { status } = req.body; // '0' or '1'
    
    if (status !== '0' && status !== '1') {
        return res.status(400).json({
            success: false,
            error: 'Status must be "0" or "1"'
        });
    }
    
    mqttClient.publish(topics.relay2, status, async (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        sensorData.relay2Status = status;
        console.log(`🔌 Relay 2 ${status === '1' ? 'ON' : 'OFF'}`); // REVISI
        
        // Broadcast to all clients
        io.emit('controlUpdate', {
            device: 'relay2',
            status: status
        });
        
        // Save to database immediately on control action
        await saveToFirebase('relay2_control');
        
        res.json({
            success: true,
            message: `Relay 2 turned ${status === '1' ? 'ON' : 'OFF'}` // REVISI
        });
    });
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('👤 Client connected:', socket.id);
    
    // Send current data to new client
    socket.emit('initialData', sensorData);
    
    socket.on('disconnect', () => {
        console.log('👤 Client disconnected:', socket.id);
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        mqttConnected: mqttClient.connected,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`💾 Data akan disimpan ke database setiap 30 detik`);
});