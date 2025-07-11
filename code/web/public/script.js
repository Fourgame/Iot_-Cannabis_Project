// script.js
const socket = io();

// ========== 1) สร้าง Gauge Config ==========
const gaugeConfigs = (label, max) => ({
  type: 'doughnut',
  data: {
    labels: ['Remaining'],
    datasets: [{
      data: [0, max],
      backgroundColor: ['#66bb6a', '#c8e6c9'],
      borderWidth: 1
    }]
  },
  options: {
    responsive: false,
    cutout: '75%',
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    }
  },
  plugins: [{
    id: 'centerText',
    beforeDraw: (chart) => {
      const { width, height } = chart;
      const ctx = chart.ctx;
      ctx.restore();
      const value = chart.data.datasets[0].data[0];
      ctx.fillStyle = '#2e7d32';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      // ชื่อเซ็นเซอร์
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(label, width / 2, height / 2 - 15);

      // ค่าเซ็นเซอร์
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(
        value !== undefined ? value : '-',
        width / 2,
        height / 2 + 10
      );
      ctx.save();
    }
  }]
});

// ========== 2) สร้าง Gauges ทั้งหมด ==========
const gauges = {
  N: new Chart(document.getElementById('gauge-n'), gaugeConfigs('N (mg/L)', 500)),
  P: new Chart(document.getElementById('gauge-p'), gaugeConfigs('P (mg/L)', 500)),
  K: new Chart(document.getElementById('gauge-k'), gaugeConfigs('K (mg/L)', 500)),
  PH: new Chart(document.getElementById('gauge-ph'), gaugeConfigs('PH', 14)),
  EC: new Chart(document.getElementById('gauge-ec'), gaugeConfigs('EC (µS/cm)', 5000))  
};


const timeEl = document.getElementById('time');

// ========== 3) ฟัง event sensorData จาก server ==========
// เพิ่ม event listener สำหรับการอัปเดต gauge เมื่อได้รับข้อมูลใหม่จาก server
socket.on('sensorData', (data) => {
  // ปัดเศษค่าทุกตัวให้เป็นจำนวนเต็ม (ไม่มีทศนิยม)
  const N = Math.round(data.N);
  const P = Math.round(data.P);
  const K = Math.round(data.K);
  const PH = Math.round(data.PH);
  const moisture = Math.round(data.moisture);
  const temperature = Math.round(data.temperature);
  const EC = Math.round(data.EC);

  // อัปเดตค่า Gauges ด้วยข้อมูลจากเซ็นเซอร์ที่ปัดเศษแล้ว
  gauges.N.data.datasets[0].data[0] = N;
  gauges.N.data.datasets[0].data[1] = 500 - N;
  gauges.N.update();

  gauges.P.data.datasets[0].data[0] = P;
  gauges.P.data.datasets[0].data[1] = 500 - P;
  gauges.P.update();

  gauges.K.data.datasets[0].data[0] = K;
  gauges.K.data.datasets[0].data[1] = 500 - K;
  gauges.K.update();

  gauges.PH.data.datasets[0].data[0] = PH;
  gauges.PH.data.datasets[0].data[1] = 14 - PH;
  gauges.PH.update();

  gauges.EC.data.datasets[0].data[0] = EC;
  gauges.EC.data.datasets[0].data[1] = 5000 - EC;
  gauges.EC.update();

  // อัปเดตเวลา
  timeEl.textContent = 'Time: ' + new Date(data.timestamp).toLocaleString();

  // อัปเดตสถานะ Good/Bad
  const statusEl = document.getElementById('status');
  statusEl.textContent = data.ml_status;
  statusEl.style.color = (data.ml_status === 'Good') ? 'green' : 'red';
});


// ========== 4) Modal สำหรับ History ==========
const modal = document.getElementById('chartModal');
const closeModalBtn = document.getElementById('closeModal');
const popupCtx = document.getElementById('popupChart').getContext('2d');
const historyTitle = document.getElementById('historyTitle');
let popupChart = null;
let currentField = null;

// คลิกที่ gauge เพื่อขอดู History
Object.keys(gauges).forEach(key => {
  gauges[key].canvas.addEventListener('click', () => {
    currentField = key;
    socket.emit('getHistory', key);
    modal.style.display = 'block';
  });
});

// ฟัง History Data กลับจากเซิร์ฟเวอร์
socket.on('historyData', ({ field, data }) => {
  if (popupChart) popupChart.destroy();

  const labels = data.map(d => new Date(d.timestamp).toLocaleTimeString());
  const values = data.map(d => d[field]);

  popupChart = new Chart(popupCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: field,
        data: values,
        fill: true,
        borderColor: '#2e7d32',
        backgroundColor: 'rgba(46,125,50,0.1)',
        tension: 0.4,
        borderWidth: 3,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `History of ${field}`,
          color: '#2e7d32',
          font: { size: 20 }
        }
      }
    }
  });
});

// ปิด Modal
closeModalBtn.onclick = () => {
  modal.style.display = 'none';
  currentField = null;
};

window.onclick = (event) => {
  if (event.target === modal) {
    modal.style.display = 'none';
    currentField = null;
  }
};

// เพิ่มการ toggle สำหรับการควบคุมปุ๋ยและยา
let controlState = {
  light: false,
  water: false,
  pui: false,  // เพิ่มสถานะสำหรับปุ๋ย
  ya: false    // เพิ่มสถานะสำหรับยา
};
// ฟังสถานะจาก server
socket.on('pumpstatus', (status) => {
  controlState.water = status === 'on';
  updateControlButton('water');
});

socket.on('lightstatus', (status) => {
  controlState.light = status === 'on';
  updateControlButton('light');
});

socket.on('puistatus', (status) => {  // ฟังสถานะของปุ๋ย
  controlState.pui = status === 'on';
  updateControlButton('pui');
});

socket.on('yastatus', (status) => {  // ฟังสถานะของยา
  controlState.ya = status === 'on';
  updateControlButton('ya');
});

let lastMlStatus = 'Good';  // ตั้งค่าค่าล่าสุดเริ่มต้นเป็น 'Good' หรือค่าที่คุณต้องการ

socket.on('sensorStatus', (status) => {
  const statusEl = document.getElementById('status');
  
  // ตรวจสอบว่าค่าสถานะใหม่แตกต่างจากสถานะเดิมหรือไม่
  if (status !== lastMlStatus) {
    lastMlStatus = status;  // อัปเดตสถานะล่าสุด
    statusEl.textContent = status;  // อัปเดตข้อความสถานะ
    statusEl.style.color = (status === 'Healthy') ? 'green' : 'red';  // เปลี่ยนสีตามสถานะ
  } else {
    // หากไม่มีข้อมูลใหม่ให้ใช้สถานะล่าสุดที่เก็บไว้
    statusEl.textContent = lastMlStatus;
    statusEl.style.color = (lastMlStatus === 'Healthy') ? 'green' : 'red';  // เปลี่ยนสีตามสถานะ
  }
});





// อัปเดตสถานะของปุ่ม
function updateControlButton(type) {
  const btn = document.getElementById(type + 'Btn');
  if (controlState[type]) {
    btn.classList.remove('off');
    btn.classList.add('on');
    btn.innerHTML = type === 'light' ? '💡 แสงไฟ: เปิด' : 
                    type === 'water' ? '💧 น้ำ: เปิด' :
                    type === 'pui' ? '🌱 ปุ๋ย: เปิด' : 
                    '💊 ยา: เปิด';
  } else {
    btn.classList.remove('on');
    btn.classList.add('off');
    btn.innerHTML = type === 'light' ? '💡 แสงไฟ: ปิด' : 
                    type === 'water' ? '💧 น้ำ: ปิด' : 
                    type === 'pui' ? '🌱 ปุ๋ย: ปิด' : 
                    '💊 ยา: ปิด';
  }
}

function toggleControl(type) {
  controlState[type] = !controlState[type];
  updateControlButton(type);

  const newStatus = controlState[type] ? 'on' : 'off';
  if (type === 'light') {
    socket.emit('toggleLight', newStatus);
  } else if (type === 'water') {
    socket.emit('togglePump', newStatus);
  } else if (type === 'pui') {
    socket.emit('togglePui', newStatus);  // ส่งสถานะของปุ๋ยไปที่ server
  } else if (type === 'ya') {
    socket.emit('toggleYa', newStatus);   // ส่งสถานะของยาไปที่ server
  }
}
