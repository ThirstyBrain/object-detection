import json
import requests
import numpy as np
import cv2
from collections import deque
import threading
import time
from pathlib import Path
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from ultralytics import YOLO

# Load YOLOv8 model
model = YOLO('yolov8n.pt')  # Using nano model for better performance

# Configuration for suspicious behavior detection
SUSPICIOUS_CONFIG = {
    'theft': {
        'objects': ['person', 'backpack', 'handbag', 'suitcase', 'cell phone', 'laptop'],
        'confidence_threshold': 0.6,
        'time_threshold': 3,  # seconds of continuous detection
    },
    'fight': {
        'objects': ['person'],
        'min_persons': 2,
        'proximity_threshold': 100,  # pixels
        'motion_threshold': 30,  # pixels per frame
        'time_threshold': 2,  # seconds of continuous detection
    },
    'loitering': {
        'objects': ['person'],
        'time_threshold': 10,  # seconds of continuous presence
        'movement_threshold': 50,  # maximum movement in pixels
    },
    'unattended_object': {
        'objects': ['backpack', 'handbag', 'suitcase'],
        'person_distance_threshold': 150,  # pixels
        'time_threshold': 5,  # seconds
    }
}

# Webhook configuration
WEBHOOK_URL = "https://your-webhook-endpoint.com/alert"  # Change this to your actual webhook URL
WEBHOOK_COOLDOWN = 30  # seconds between webhook calls for the same behavior

class ObjectTracker:
    def __init__(self, max_history=30):
        self.tracked_objects = {}
        self.behavior_states = {}
        self.last_webhook_time = {}
        self.frame_history = deque(maxlen=max_history)
        self.lock = threading.Lock()
        self.alerts = []
    
    def update(self, frame, detections):
        with self.lock:
            self.frame_history.append((frame.copy(), detections, time.time()))
            
            current_objects = {}
            
            for detection in detections:
                label = detection['label']
                bbox = detection['bbox']
                confidence = detection['confidence']
                
                center_x = (bbox[0] + bbox[2]) / 2
                center_y = (bbox[1] + bbox[3]) / 2
                obj_id = f"{label}_{int(center_x)}_{int(center_y)}"
                
                if obj_id not in self.tracked_objects:
                    self.tracked_objects[obj_id] = {
                        'label': label,
                        'first_seen': time.time(),
                        'last_seen': time.time(),
                        'positions': [(center_x, center_y)],
                        'confidence': confidence,
                        'consecutive_detections': 1
                    }
                else:
                    self.tracked_objects[obj_id]['last_seen'] = time.time()
                    self.tracked_objects[obj_id]['positions'].append((center_x, center_y))
                    self.tracked_objects[obj_id]['confidence'] = confidence
                    self.tracked_objects[obj_id]['consecutive_detections'] += 1
                
                current_objects[obj_id] = True
            
            for obj_id in list(self.tracked_objects.keys()):
                if obj_id not in current_objects:
                    if time.time() - self.tracked_objects[obj_id]['last_seen'] > 5:
                        del self.tracked_objects[obj_id]
                    else:
                        self.tracked_objects[obj_id]['consecutive_detections'] = 0
            
            self.alerts = []
            self._detect_theft()
            self._detect_fight()
            self._detect_loitering()
            self._detect_unattended_object()
            
            return self.alerts
    
    def _detect_theft(self):
        config = SUSPICIOUS_CONFIG['theft']
        
        for obj_id, obj_data in self.tracked_objects.items():
            if obj_data['label'] in config['objects'] and obj_data['label'] != 'person':
                if obj_data['consecutive_detections'] == 0 and time.time() - obj_data['last_seen'] < 3:
                    duration = obj_data['last_seen'] - obj_data['first_seen']
                    
                    if duration > config['time_threshold']:
                        for person_id, person_data in self.tracked_objects.items():
                            if person_data['label'] == 'person':
                                if self._is_nearby(obj_data, person_data, 100):
                                    self._trigger_alert('theft', {
                                        'item': obj_data['label'],
                                        'duration_visible': duration,
                                        'confidence': obj_data['confidence']
                                    })
                                    break
    
    def _detect_fight(self):
        config = SUSPICIOUS_CONFIG['fight']
        
        people = [obj for obj_id, obj in self.tracked_objects.items() 
                 if obj['label'] == 'person' and obj['consecutive_detections'] > 0]
        
        if len(people) >= config['min_persons']:
            for i in range(len(people)):
                for j in range(i+1, len(people)):
                    person1 = people[i]
                    person2 = people[j]
                    
                    if self._calculate_distance(person1, person2) < config['proximity_threshold']:
                        motion1 = self._calculate_motion(person1)
                        motion2 = self._calculate_motion(person2)
                        
                        if motion1 > config['motion_threshold'] and motion2 > config['motion_threshold']:
                            if (min(time.time() - person1['first_seen'], 
                                   time.time() - person2['first_seen']) > config['time_threshold']):
                                self._trigger_alert('fight', {
                                    'people_count': len(people),
                                    'movement_speed': max(motion1, motion2),
                                    'duration': min(time.time() - person1['first_seen'], 
                                                  time.time() - person2['first_seen'])
                                })
                                return
    
    def _detect_loitering(self):
        config = SUSPICIOUS_CONFIG['loitering']
        
        for obj_id, obj_data in self.tracked_objects.items():
            if obj_data['label'] == 'person':
                duration = time.time() - obj_data['first_seen']
                
                if duration > config['time_threshold'] and obj_data['consecutive_detections'] > 0:
                    if len(obj_data['positions']) > 5:
                        movement = self._calculate_total_movement(obj_data)
                        
                        if movement < config['movement_threshold']:
                            self._trigger_alert('loitering', {
                                'duration': duration,
                                'movement': movement
                            })
    
    def _detect_unattended_object(self):
        config = SUSPICIOUS_CONFIG['unattended_object']
        
        for obj_id, obj_data in self.tracked_objects.items():
            if obj_data['label'] in config['objects'] and obj_data['consecutive_detections'] > 0:
                duration = time.time() - obj_data['first_seen']
                
                if duration > config['time_threshold']:
                    person_nearby = False
                    
                    for person_id, person_data in self.tracked_objects.items():
                        if person_data['label'] == 'person' and person_data['consecutive_detections'] > 0:
                            if self._is_nearby(obj_data, person_data, config['person_distance_threshold']):
                                person_nearby = True
                                break
                    
                    if not person_nearby:
                        self._trigger_alert('unattended_object', {
                            'object': obj_data['label'],
                            'duration': duration,
                            'confidence': obj_data['confidence']
                        })
    
    def _calculate_distance(self, obj1, obj2):
        pos1 = obj1['positions'][-1]
        pos2 = obj2['positions'][-1]
        return np.sqrt((pos1[0] - pos2[0])**2 + (pos1[1] - pos2[1])**2)
    
    def _is_nearby(self, obj1, obj2, threshold):
        return self._calculate_distance(obj1, obj2) < threshold
    
    def _calculate_motion(self, obj):
        if len(obj['positions']) < 2:
            return 0
        
        motions = []
        for i in range(1, min(5, len(obj['positions']))):
            prev_pos = obj['positions'][-i-1]
            curr_pos = obj['positions'][-i]
            motion = np.sqrt((prev_pos[0] - curr_pos[0])**2 + (prev_pos[1] - curr_pos[1])**2)
            motions.append(motion)
        
        return np.mean(motions) if motions else 0
    
    def _calculate_total_movement(self, obj):
        if len(obj['positions']) < 2:
            return 0
        
        min_x = min(pos[0] for pos in obj['positions'])
        max_x = max(pos[0] for pos in obj['positions'])
        min_y = min(pos[1] for pos in obj['positions'])
        max_y = max(pos[1] for pos in obj['positions'])
        
        return max(max_x - min_x, max_y - min_y)
    
    def _trigger_alert(self, behavior_type, details):
        current_time = time.time()
        if behavior_type in self.last_webhook_time and current_time - self.last_webhook_time[behavior_type] < WEBHOOK_COOLDOWN:
            return
        
        self.last_webhook_time[behavior_type] = current_time
        
        alert_data = {
            'behavior': behavior_type,
            'timestamp': current_time,
            'details': details
        }
        
        self.alerts.append(alert_data)
        
        try:
            threading.Thread(target=self._send_webhook, args=(alert_data,)).start()
        except Exception as e:
            print(f"Error sending webhook: {e}")
    
    def _send_webhook(self, data):
        try:
            response = requests.post(
                WEBHOOK_URL,
                json=data,
                headers={'Content-Type': 'application/json'},
                timeout=5
            )
            print(f"Webhook sent for {data['behavior']}: {response.status_code}")
        except Exception as e:
            print(f"Webhook error: {e}")

object_tracker = ObjectTracker()

@api_view(['POST'])
def detect_objects(request):
    if 'image' not in request.FILES:
        return Response({'error': 'No image provided'}, status=status.HTTP_400_BAD_REQUEST)
    
    detect_behavior = request.POST.get('detect_behavior', 'false').lower() == 'true'
    
    try:
        # Save the uploaded image temporarily
        image_file = request.FILES['image']
        path = default_storage.save(f'temp/frame_{time.time()}.jpg', ContentFile(image_file.read()))
        temp_file_path = settings.MEDIA_ROOT / Path(path)
        
        # Read the image
        frame = cv2.imread(str(temp_file_path))
        if frame is None:
            raise ValueError("Could not read image file")
        
        # Run YOLOv8 detection
        results = model.predict(source=str(temp_file_path), save=False)
        
        # Process results
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # Get coordinates (x1,y1,x2,y2)
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                # Get confidence and class
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                label = model.names[cls]
                
                detections.append({
                    'label': label,
                    'confidence': conf,
                    'bbox': [x1, y1, x2, y2]
                })
        
        # Update object tracker and get alerts if behavior detection is enabled
        alerts = []
        if detect_behavior:
            alerts = object_tracker.update(frame, detections)
        
        # Clean up the temporary file
        default_storage.delete(path)
        
        response_data = {
            'detections': detections,
            'count': len(detections)
        }
        
        if detect_behavior and alerts:
            response_data['alerts'] = alerts
            
        return Response(response_data)
    
    except Exception as e:
        print(f"Detection error: {str(e)}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
def update_settings(request):
    try:
        data = json.loads(request.body)
        global WEBHOOK_URL
        WEBHOOK_URL = data.get('webhook_url', WEBHOOK_URL)
        return Response({'status': 'Settings updated'})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
