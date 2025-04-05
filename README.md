# Project Setup Instructions

#UI Project 
# Install dependencies
npm install axios cors


# Start the React development server
npm start


#Backend Project 
# Install dependencies
pip install django djangorestframework django-cors-headers pillow ultralytics opencv-python numpy torch


# Start the Django development server
python manage.py runserver

# 3. Install YOLO model
# The model will be downloaded automatically when first used,
# or you can download it manually:
# Download from https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt
# and place it in the Django project directory

# 4. Testing the System
# 1. Start both servers (React and Django)
# 2. Open the React app in your browser (usually at http://localhost:3000)
# 3. Allow webcam access
# 4. Click "Start Detection" to begin object detection