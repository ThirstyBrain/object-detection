from django.shortcuts import render

# Create your views here.
import time
import cv2
import numpy as np
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
import torch
from pathlib import Path

# Import YOLO model - using YOLOv5 in this example
# Make sure to install it: pip install ultralytics
from ultralytics import YOLO

# Load YOLO model
model = YOLO('yolov8n.pt')  # Use 'yolov8n.pt' for smaller model or 'yolov8x.pt' for larger

@api_view(['POST'])
def detect_objects(request):
    if 'image' not in request.FILES:
        return Response({'error': 'No image provided'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Save the uploaded image temporarily
        image_file = request.FILES['image']
        path = default_storage.save(f'temp/frame_{time.time()}.jpg', ContentFile(image_file.read()))
        temp_file_path = settings.MEDIA_ROOT / Path(path)
        
        # Run detection
        results = model(temp_file_path)
        
        # Process results
        detections = []
        for result in results:
            boxes = result.boxes
            for i, box in enumerate(boxes):
                # Get box coordinates
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                
                # Get class and confidence
                cls = int(box.cls[0].item())
                conf = box.conf[0].item()
                label = result.names[cls]
                
                detections.append({
                    'label': label,
                    'confidence': conf,
                    'bbox': [x1, y1, x2, y2]
                })
        
        # Clean up the temporary file
        default_storage.delete(path)
        
        return Response({
            'detections': detections,
            'count': len(detections)
        })
    
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# project/urls.py (main URLs file)
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('object_detection.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
"""