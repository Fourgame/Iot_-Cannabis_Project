// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const { MongoClient } = require('mongodb');
const path = require('path');

// ================== CONFIG ==================
const MONGO_URL = 'mongodb+srv://for_iot:RKJudREwmUsRl8Nu@cluster0.hqpxerp.mongodb.net/iot';
const DB_NAME = 'iot';
const MQTT_BROKER = 'mqtt://10.64.194.92';
const PORT = 8080;
// ===========================================

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let collection = null;

// ===== 1) CONNECT MONGODB =====
MongoClient.connect(MONGO_URL, { useUnifiedTopology: true })
  .then(client => {
    console.log('✅ MongoDB Connected');
    const db = client.db(DB_NAME);
    collection = db.collection('sensor_iot');
  })
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ===== 2) SERVE STATIC FILES =====
app.use(express.static(path.join(__dirname, 'public')));
app.use('/picture', express.static(path.join(__dirname, 'picture')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== 3) CONNECT MQTT =====
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT Broker');
  mqttClient.subscribe('sensor_iot');
  mqttClient.subscribe('pump');
  mqttClient.subscribe('light');
  mqttClient.subscribe('ya');
  mqttClient.subscribe('pui');
  mqttClient.subscribe('mll');
});
// เพิ่มตัวแปร global เก็บสถานะล่าสุด
let latestPumpStatus = 'off';
let latestLightStatus = 'off';
let latestpuiStatus = 'off';
let latestyaStatus = 'off';
mqttClient.on('message', async (topic, message) => {
  try {
    const msg = message.toString();
    
    if (topic === 'pump') {
      latestPumpStatus = msg;
      console.log("Pump status:", latestPumpStatus);  
      io.emit('pumpstatus', msg); // ส่งสถานะไปที่ client
      return;
    }
    
    if (topic === 'light') {
      latestLightStatus = msg;
      io.emit('lightstatus', msg); // ส่งสถานะไปที่ client
      return;
    }
    
    if (topic === 'pui') {
      latestPuiStatus = msg;
      io.emit('puistatus', msg); // ส่งสถานะไปที่ client
      return;
    }
    
    if (topic === 'ya') {
      latestYaStatus = msg;
      io.emit('yastatus', msg); // ส่งสถานะไปที่ client
      return;
    }
    
    // สำหรับข้อความใน Topic ml
    if (topic === 'mll') {
      console.log('ML Status:', msg); 
      io.emit('sensorStatus', msg);
      return;
    }
    
    

    // เซ็นเซอร์: ลองแปลงเป็น JSON เฉพาะในกรณีที่ข้อมูลเป็น JSON จริง ๆ
    let data;
    try {
      data = JSON.parse(msg);
    } catch (error) {
      console.log('❌ Invalid JSON message:', msg); // ข้ามข้อความที่ไม่ใช่ JSON
      return;
    }

    data.timestamp = new Date();
    if (collection) await collection.insertOne(data);
    io.emit('sensorData', data);



  } catch (error) {
    console.error('❌ MQTT Message Error:', error);
  }
});







// ===== 4) SOCKET.IO EVENTS =====
io.on('connection', socket => {
  console.log('🟢 Client connected');

  socket.on('togglePump', status => {
    mqttClient.publish('pump', status);  // publish ไปยัง topic pump
  });

  socket.on('toggleLight', status => {
    mqttClient.publish('light', status); // publish ไปยัง topic light
  });

  socket.on('togglePui', status => {  // รับคำสั่งปุ๋ย
    mqttClient.publish('pui', status);  // publish ไปยัง topic pui
  });

  socket.on('toggleYa', status => {   // รับคำสั่งยา
    mqttClient.publish('ya', status);  // publish ไปยัง topic ya
  });

  socket.on('getHistory', async (field) => {
    if (!collection) return;
    const docs = await collection.find({}, {
      projection: { [field]: 1, timestamp: 1, _id: 0 }
    }).toArray();
    socket.emit('historyData', { field, data: docs });
  });
  
});


// ===== START SERVER =====
server.listen(PORT, () => {
  console.log(`🌐 Server running on http://localhost:${PORT}`);
});
