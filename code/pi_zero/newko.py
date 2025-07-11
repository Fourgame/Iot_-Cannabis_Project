from flask import Flask, render_template, Response, jsonify
import cv2
import time
import serial
import threading
import RPi.GPIO as GPIO
import paho.mqtt.client as mqtt
import json
from tensorflow.keras.models import load_model
import numpy as np


# Flask app setup
app = Flask(__name__)

# Camera setup (Video stream)
camera = cv2.VideoCapture(0)
camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
camera.set(cv2.CAP_PROP_FPS, 30)

if not camera.isOpened():
    print("เปิดกล้องล้มเหลว!")
    exit()

# MQTT setup
mqtt_broker = "10.64.194.92"  # Replace with your MQTT broker IP
mqtt_port = 1883  # Default MQTT port
mqtt_topic = "sensor_iot"  # Topic for all sensor data

client = mqtt.Client()

# Initialize the values for pump and light
pump_value = "Unknown"
light_value = "Unknown"
pui_value = "Unknown"
ya_value = "Unknown"


# GPIO setup
GPIO.setwarnings(False)
GPIO.setmode(GPIO.BOARD)

# Setting up GPIO pins for relays
PUMP_PIN = 11     # GPIO 17 for pump relay
LIGHT_PIN = 13    # GPIO 27 for light relay
PUI_PIN = 15      # GPIO 22 for pui relay
YA_PIN = 16       # GPIO 23 for ya relay

# Setup the GPIO pins as output
GPIO.setup(PUMP_PIN, GPIO.OUT)
GPIO.setup(LIGHT_PIN, GPIO.OUT)
GPIO.setup(PUI_PIN, GPIO.OUT)
GPIO.setup(YA_PIN, GPIO.OUT)

# MQTT connect callback
def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT broker with result code {rc}")
    client.subscribe("pump")
    client.subscribe("light")
    client.subscribe("pui")
    client.subscribe("ya")

client.on_connect = on_connect

# MQTT message callback
def on_message(client, userdata, msg):
    global pump_value, light_value, pui_value, ya_value
    print(f"Received message on topic {msg.topic}: {msg.payload.decode()}")
    if msg.topic == "pump":
        pump_value = msg.payload.decode()
        if pump_value == "on":
            GPIO.output(PUMP_PIN, GPIO.LOW)  # Turn on pump relay
        else:
            GPIO.output(PUMP_PIN, GPIO.HIGH)   # Turn off pump relay
    elif msg.topic == "light":
        light_value = msg.payload.decode()
        if light_value == "on":
            GPIO.output(LIGHT_PIN, GPIO.LOW)  # Turn on light relay
        else:
            GPIO.output(LIGHT_PIN, GPIO.HIGH)   # Turn off light relay
    elif msg.topic == "pui":
        pui_value = msg.payload.decode()
        if pui_value == "on":
            GPIO.output(PUI_PIN, GPIO.LOW)   # Turn on pui relay
        else:
            GPIO.output(PUI_PIN, GPIO.HIGH)    # Turn off pui relay
    elif msg.topic == "ya":
        ya_value = msg.payload.decode()
        if ya_value == "on":
            GPIO.output(YA_PIN, GPIO.LOW)    # Turn on ya relay
        else:
            GPIO.output(YA_PIN, GPIO.HIGH)     # Turn off ya relay

client.on_message = on_message
client.connect(mqtt_broker, mqtt_port, 60)

# Serial setup
ser = serial.Serial("/dev/ttyUSB0", baudrate=4800, timeout=10.0)
ser.close()
ser.open()

# Helper functions for serial communication
RxData = []
max_index = 19

def send():
   txData=(0x01,0x03,0x00,0x00,0x00,0x07,0x04,0x08)
   ser.write(txData)


def publish_to_mqtt(topic, value):
    """Publish the given value to the given topic"""
    print(f"Publishing to topic {topic}: {value}")
    result = client.publish(topic, value)
    if result.rc == mqtt.MQTT_ERR_SUCCESS:
        print(f"Published {value} to {topic}")
    else:
        print(f"Failed to publish to {topic}: {result.rc}")

# Helper function to create JSON payload for all sensor data
def create_json_payload(N, P, K, PH, EC, time_value):
    data = {
        "N": int(N),
        "P": int(P),
        "K": int(K),
        "PH": int(PH),
        "EC": int(EC),
        "time": time_value
    }
    return json.dumps(data)

# Disease labels (Output of ML)
disease_labels = ['Healthy', 'Malnutrition', 'Red spider mites', 'Bacterial spot', 'High temperature stress']

# Load the pre-trained ML model
model = load_model('/home/cannabis/cnn/our3_90_224_m.h5') 

# Function to preprocess the image before feeding it into the model
def preprocess_image(image):
    image = cv2.resize(image, (224, 224))
    image = np.expand_dims(image, axis=0)
    image = image.astype("float32") / 255.0
    return image

# Frame lock and frame handling
frame_lock = threading.Lock()
latest_frame = None
frame_ready = False

# Variable to store the last update timestamp
last_update_time = time.time()

# Function to predict and send output to MQTT
def predict_and_publish():
    global last_update_time
    while True:
        current_time = time.time()
        if current_time - last_update_time >= 3:  # 3 seconds
            with frame_lock:
                if latest_frame is not None:
                    frame = latest_frame
                else:
                    continue

            # Preprocess the image and make a prediction
            processed_image = preprocess_image(frame)
            prediction = model.predict(processed_image)

            # Get the predicted class index
            predicted_class_idx = np.argmax(prediction, axis=1)

            # Get the corresponding disease label
            predicted_disease = disease_labels[predicted_class_idx[0]]

            # Publish the result to the 'ml' topic
            publish_to_mqtt("mll", predicted_disease)
            print(f"Prediction: {predicted_disease}")

            # Update last_update_time to the current time
            last_update_time = current_time

        time.sleep(0.1)  # Adjust sleep time for better performance

def capture_frames():
    global frame_ready, latest_frame
    while True:
        success, frame = camera.read()
        if not success:
            print("Failed to capture image.")
            continue

        with frame_lock:
            latest_frame = frame
            frame_ready = True

        time.sleep(0.01)  # ลดเวลาหยุดระหว่างการจับภาพให้น้อยที่สุด

def gen_frames():
    global latest_frame, frame_ready
    while True:
        if frame_ready:
            with frame_lock:
                frame = latest_frame
                frame_ready = False

            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                frame = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                
            # เร่งให้การแสดงภาพเร็วขึ้นโดยการลดการหยุด
            time.sleep(0.02)

@app.route('/')
def index():
    return render_template('index.html', pump_value=pump_value, light_value=light_value, pui_value=pui_value, ya_value=ya_value)

@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

def read_sensor_data():
    while True:
        send()
        RxData = ser.read(size=max_index)
        if len(RxData) >= max_index:
            N = ((RxData[11] << 8) + RxData[12]) 
            P = ((RxData[13] << 8) + RxData[14])
            K = ((RxData[15] << 8) + RxData[16])
            EC = ((RxData[7] << 8) + RxData[8])
            PH =  ((RxData[9] << 8) + RxData[10]) / 10.0

            time_value = int(time.time())

            json_payload = create_json_payload(N, P, K, PH, EC, time_value)
            publish_to_mqtt(mqtt_topic, json_payload)

        time.sleep(5)

if __name__ == '__main__':
    mqtt_thread = threading.Thread(target=client.loop_forever)
    mqtt_thread.daemon = True
    mqtt_thread.start()

    capture_thread = threading.Thread(target=capture_frames)
    capture_thread.daemon = True
    capture_thread.start()

    sensor_thread = threading.Thread(target=read_sensor_data)
    sensor_thread.daemon = True
    sensor_thread.start()

    ml_thread = threading.Thread(target=predict_and_publish)
    ml_thread.daemon = True
    ml_thread.start()
    
    app.run(host='0.0.0.0', port=8081)
