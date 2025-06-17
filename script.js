import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase, ref, onValue, set, push
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// Konfigurasi Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBtGBU74bUbAy0lL-2wrFN_BY7_FBWF-Vw",
  databaseURL: "https://salt-26008-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Elemen DOM (for index.html)
const suhuEl = document.getElementById("suhu");
const kelembabanEl = document.getElementById("kelembaban");
const waterEl = document.getElementById("water");
const pesanEl = document.getElementById("pesan");

const kipasSwitch = document.getElementById("kipasSwitch");
const ledSwitch = document.getElementById("ledSwitch");
const modeSwitch = document.getElementById("modeSwitch");
const modeStatusLabel = document.getElementById("modeStatusLabel");

// Visual Bars
const suhuBarFill = document.getElementById('suhuBarFill');
const suhuBarValue = document.getElementById('suhuBarValue');
const kelembabanBarFill = document.getElementById('kelembabanBarFill');
const kelembabanBarValue = document.getElementById('kelembabanBarValue');

// Data grafik
const waktuLog = [];
const suhuLog = [];
const kelembabanLog = [];

let chart = null; // Initialize chart as null, will be assigned when context is available

let kipasStateLast = null;
let ledStateLast = null;
let modeOtomatis = true;

// --- Functions for Visual Bars ---
function updateVisualBar(value, fillElement, valueElement, minVal, maxVal, unit) {
    if (!fillElement || !valueElement) return; // Ensure elements exist

    let percentage = ((value - minVal) / (maxVal - minVal)) * 100;
    if (percentage < 0) percentage = 0;
    if (percentage > 100) percentage = 100;

    fillElement.style.width = `${percentage}%`;
    valueElement.textContent = `${value}${unit}`;

    // Position the value text
    // We need to ensure fillElement's parent (visual-bar-track) is mounted to get width
    const trackElement = fillElement.parentElement;
    if (trackElement) {
        const parentWidth = trackElement.offsetWidth;
        const valueTextWidth = valueElement.offsetWidth;
        let textPosition = (percentage / 100) * parentWidth;

        // Adjust position to keep text within bounds
        if (textPosition < valueTextWidth / 2) {
            textPosition = valueTextWidth / 2;
        } else if (textPosition > parentWidth - valueTextWidth / 2) {
            textPosition = parentWidth - valueTextWidth / 2;
        }
        valueElement.style.left = `${textPosition}px`;
        valueElement.style.transform = `translateX(-50%)`;
    }
}


// --- Realtime Firebase updates (for index.html and shared) ---
// These listeners run regardless of the page, but UI updates are conditional
onValue(ref(db, '/sensor/suhu'), (snap) => {
    const suhu = snap.val();
    if (suhuEl) suhuEl.textContent = `${suhu} °C`;
    updateLatestData('suhu', suhu);
    if (suhuBarFill && suhuBarValue) { // Check if elements exist on current page
        updateVisualBar(suhu, suhuBarFill, suhuBarValue, 0, 50, '°C'); // Assuming 0-50 for temperature
    }
});

onValue(ref(db, '/sensor/kelembaban_udara'), (snap) => {
    const kelembaban = snap.val();
    if (kelembabanEl) kelembabanEl.textContent = `${kelembaban} %`;
    updateLatestData('kelembaban', kelembaban);
    if (kelembabanBarFill && kelembabanBarValue) { // Check if elements exist on current page
        updateVisualBar(kelembaban, kelembabanBarFill, kelembabanBarValue, 0, 100, '%'); // Assuming 0-100 for humidity
    }
});

onValue(ref(db, '/sensor/water_level'), (snap) => {
    if (waterEl) waterEl.textContent = snap.val() ? "TERDETEKSI" : "NORMAL";
});

onValue(ref(db, '/sensor/pesan_esp32cam'), (snap) => {
    const pesan = snap.val();
    if (pesanEl) pesanEl.textContent = pesan;
    saveEsp32CamMessage(pesan); // Save unique messages
});

onValue(ref(db, '/sensor/status_relay_kipas'), (snap) => {
    kipasStateLast = snap.val();
    if (kipasSwitch) kipasSwitch.checked = kipasStateLast;
});

onValue(ref(db, '/sensor/status_relay_led'), (snap) => {
    ledStateLast = snap.val();
    if (ledSwitch) ledSwitch.checked = ledStateLast;
});

onValue(ref(db, '/kontrol/mode_otomatis'), (snap) => {
    modeOtomatis = snap.val();
    if (modeSwitch) {
        modeSwitch.checked = modeOtomatis;
        modeStatusLabel.textContent = `${modeOtomatis ? 'Otomatis' : 'Manual'}`;
        // Disable manual controls if in automatic mode
        if (kipasSwitch) kipasSwitch.disabled = modeOtomatis;
        if (ledSwitch) ledSwitch.disabled = modeOtomatis;
    }
});


// --- Switch Event Listeners (only for index.html or pages with controls) ---
// Add event listeners within DOMContentLoaded for safety and to ensure elements exist
document.addEventListener("DOMContentLoaded", () => {
    if (modeSwitch) {
        modeSwitch.addEventListener("change", () => {
            const modeBaru = modeSwitch.checked;
            set(ref(db, "/kontrol/mode_otomatis"), modeBaru);
        });
    }

    if (kipasSwitch) {
        kipasSwitch.addEventListener("change", () => {
            if (!modeOtomatis) { // Only allow manual control if mode is not automatic
                set(ref(db, '/kontrol/kipas'), kipasSwitch.checked);
                push(ref(db, '/log/kontrol_kipas'), { waktu: Date.now(), status: kipasSwitch.checked });
            } else {
                // If user tries to toggle in auto mode, revert the switch
                kipasSwitch.checked = kipasStateLast; 
                alert("Cannot control manually when in Automatic mode.");
            }
        });
    }

    if (ledSwitch) {
        ledSwitch.addEventListener("change", () => {
            if (!modeOtomatis) { // Only allow manual control if mode is not automatic
                set(ref(db, '/kontrol/led'), ledSwitch.checked);
                push(ref(db, '/log/kontrol_led'), { waktu: Date.now(), status: ledSwitch.checked });
            } else {
                // If user tries to toggle in auto mode, revert the switch
                ledSwitch.checked = ledStateLast;
                alert("Cannot control manually when in Automatic mode.");
            }
        });
    }
});


// --- Logic for ESP32-CAM Message Storage ---
let lastStoredEsp32CamMessage = null; // Keep track of the last stored message

function saveEsp32CamMessage(message) {
    if (message && message.trim() !== "" && message !== lastStoredEsp32CamMessage) {
        const messages = JSON.parse(localStorage.getItem("esp32camMessages")) || [];
        const timestamp = new Date().toLocaleString();
        messages.push({ timestamp: timestamp, message: message });
        localStorage.setItem("esp32camMessages", JSON.stringify(messages));
        lastStoredEsp32CamMessage = message; // Update the last stored message
        console.log("New ESP32-CAM message saved:", { timestamp: timestamp, message: message });
        
        // If on the ESP32-CAM data page, refresh display
        if (window.location.pathname.includes('esp32cam_data.html')) {
            displayEsp32CamMessages();
        }
    }
}

function displayEsp32CamMessages() {
    const messagesContainer = document.getElementById("esp32camMessages");
    if (!messagesContainer) return;

    const messages = JSON.parse(localStorage.getItem("esp32camMessages")) || [];
    messagesContainer.innerHTML = ''; // Clear previous messages

    if (messages.length === 0) {
        messagesContainer.innerHTML = '<p>No messages recorded yet.</p>';
        return;
    }

    // Display newest first
    messages.slice().reverse().forEach(entry => { 
        const p = document.createElement('p');
        p.innerHTML = `<span class="timestamp">[${entry.timestamp}]</span> ${entry.message}`;
        messagesContainer.appendChild(p);
    });
}

function clearAllEsp32CamMessages() {
    localStorage.removeItem("esp32camMessages");
    displayEsp32CamMessages(); // Refresh display
    console.log("All ESP32-CAM messages cleared from localStorage.");
}

// Event listener for clearing ESP32-CAM data (only for esp32cam_data.html)
if (window.location.pathname.includes('esp32cam_data.html')) {
    const clearButton = document.getElementById("clearEsp32CamData");
    if (clearButton) {
        clearButton.addEventListener("click", () => {
            if (confirm("Are you sure you want to delete all stored ESP32-CAM messages?")) {
                clearAllEsp32CamMessages();
            }
        });
    }
}


// --- Chart Data Handling (shared, and now also for index.html) ---
// Store data in localStorage with a 1-minute interval
let lastSuhu = null;
let lastKelembaban = null;

function updateLatestData(type, value) {
  if (type === 'suhu') lastSuhu = value;
  if (type === 'kelembaban') lastKelembaban = value;
}

// Save sensor data to localStorage every minute
setInterval(() => {
  if (lastSuhu !== null && lastKelembaban !== null) {
    simpanSatuSample(lastSuhu, lastKelembaban);
  }
}, 60000); // Save every 60 seconds (1 minute)

function simpanSatuSample(suhu, kelembaban) {
  const now = Date.now();
  const logs = JSON.parse(localStorage.getItem("sensorLogs")) || [];
  const entry = {
    timestamp: now,
    suhu: suhu,
    kelembaban: kelembaban
  };
  logs.push(entry);
  localStorage.setItem("sensorLogs", JSON.stringify(logs));
  console.log("Data sample saved to localStorage:", entry);
  
  // Refresh chart if it's currently displayed on either page
  if (chart) { // Check if chart object has been initialized
    const rangeSelector = document.getElementById("rangeSelector");
    if (rangeSelector) { // Ensure range selector exists on the current page
        const hari = parseInt(rangeSelector.value);
        tampilkanDataChart(ambilDataDenganRentang(hari));
    }
  }
}

function ambilDataDenganRentang(hari) {
  const logs = JSON.parse(localStorage.getItem("sensorLogs")) || [];
  if (!logs.length) return [];
  const batas = Date.now() - (hari * 24 * 60 * 60 * 1000); // Calculate time threshold
  return logs.filter(entry => entry.timestamp >= batas);
}

function tampilkanDataChart(logs) {
    waktuLog.length = 0;
    suhuLog.length = 0;
    kelembabanLog.length = 0;
    
    logs.forEach(e => {
        const d = new Date(e.timestamp);
        // Format for Chart.js X-axis: DD/MM HH:mm
        const label = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth()+1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        waktuLog.push(label);
        suhuLog.push(e.suhu);
        kelembabanLog.push(e.kelembaban);
    });
    
    if (chart) { // Only update if chart exists
        chart.update();
    }
}

// --- Initial Load Logic and Chart Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    // Highlight active nav link
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.navbar a');
    navLinks.forEach(link => {
        // Adjust for root path (e.g., / vs /index.html)
        if (link.getAttribute('href') === currentPath || 
            (currentPath === '/' && link.getAttribute('href').includes('index.html')) ||
            (currentPath.includes('index.html') && link.getAttribute('href').includes('index.html'))) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Initialize components based on the current page
    const chartCanvas = document.getElementById("chart");
    const rangeSelector = document.getElementById("rangeSelector");
    const resetButton = document.getElementById("resetButton");

    if (window.location.pathname === '/' || window.location.pathname.includes('index.html') || window.location.pathname.includes('chart.html')) {
        // Chart initialization for both index.html and chart.html
        if (chartCanvas && rangeSelector && resetButton) { // Ensure all chart-related elements exist
            const chartContext = chartCanvas.getContext('2d');

            const suhuGradient = chartContext.createLinearGradient(0, 0, 0, 300);
            suhuGradient.addColorStop(0, 'rgba(243, 156, 18, 0.6)');
            suhuGradient.addColorStop(1, 'rgba(243, 156, 18, 0.05)');

            const kelembabanGradient = chartContext.createLinearGradient(0, 0, 0, 300);
            kelembabanGradient.addColorStop(0, 'rgba(52, 152, 219, 0.6)');
            kelembabanGradient.addColorStop(1, 'rgba(52, 152, 219, 0.05)');

            chart = new Chart(chartContext, {
                type: 'line',
                data: {
                    labels: waktuLog,
                    datasets: [
                        {
                            label: 'Suhu (°C)',
                            data: suhuLog,
                            borderColor: '#f39c12',
                            backgroundColor: suhuGradient,
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: '#f39c12',
                            pointBorderColor: '#fff',
                            pointHoverRadius: 7
                        },
                        {
                            label: 'Kelembaban (%)',
                            data: kelembabanLog,
                            borderColor: '#3498db',
                            backgroundColor: kelembabanGradient,
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: '#3498db',
                            pointBorderColor: '#fff',
                            pointHoverRadius: 7
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { 
                            title: { display: true, text: 'Waktu', color: '#c2d2e8' },
                            ticks: { color: '#c2d2e8' },
                            grid: { color: 'rgba(255,255,255,0.1)' }
                        },
                        y: { 
                            beginAtZero: true,
                            ticks: { color: '#c2d2e8' },
                            grid: { color: 'rgba(255,255,255,0.1)' }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: {
                                color: '#c2d2e8'
                            }
                        }
                    }
                }
            });

            // Initial chart data load
            const initialDays = parseInt(rangeSelector.value);
            tampilkanDataChart(ambilDataDenganRentang(initialDays));

            // Add event listeners for chart controls
            rangeSelector.addEventListener("change", () => {
                const hari = parseInt(rangeSelector.value);
                const filtered = ambilDataDenganRentang(hari);
                tampilkanDataChart(filtered);
            });

            resetButton.addEventListener("click", () => {
                if (confirm("Are you sure you want to delete all local chart data?")) {
                    localStorage.removeItem("sensorLogs");
                    tampilkanDataChart([]);
                }
            });
        }
    } else if (window.location.pathname.includes('esp32cam_data.html')) {
        // Initial load for ESP32-CAM data page
        displayEsp32CamMessages();
    }

    // Always send client time to Firebase
    kirimWaktuRealtimeKeFirebase();
});


// Interval Functions
function kirimWaktuRealtimeKeFirebase() {
  set(ref(db, '/kontrol/waktu_client'), { timestamp: Date.now() })
    .catch((err) => console.error('Failed to send time:', err));
}

// Send time to Firebase every 10 minutes
setInterval(kirimWaktuRealtimeKeFirebase, 600000);

