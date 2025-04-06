// Updates for src/App.tsx to include suspicious behavior alerts

import React, { useEffect, useRef, useState } from 'react';
import './App.css';

interface DetectionResult {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
}

interface Alert {
  id: string;
  type: string;
  details: string;
  timestamp: Date;
  isNew: boolean;
}

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [suspiciousBehaviorEnabled, setSuspiciousBehaviorEnabled] = useState(true);
  
  const streamInterval = useRef<number | null>(null);
  const fpsCounter = useRef({ count: 0, lastUpdate: Date.now() });
  const alertSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Create audio element for alerts
    alertSound.current = new Audio('/alert-sound.mp3'); // Add an alert sound file to your public folder
    
    // Initialize WebSocket for receiving behavior alerts (optional)
    const connectWebSocket = () => {
      const ws = new WebSocket('ws://localhost:8000/ws/alerts/');
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'behavior_alert') {
          addAlert(data.behavior, JSON.stringify(data.details));
        }
      };
      
      ws.onclose = () => {
        // Try to reconnect in 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
    };
    
    // Uncomment if you set up WebSockets in your Django app
    // connectWebSocket();
    
    return () => {
      // Cleanup
    };
  }, []);

  // Initialize webcam
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {

          if (videoRef.current && canvasRef.current) { // Check both refs
            videoRef.current.play();
            // Set canvas dimensions to match video
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
          }

        };
      }
    } catch (err) {
      setError(`Failed to access webcam: ${err}`);
      console.error("Error accessing webcam:", err);
    }
  };

  // Add a new alert
  const addAlert = (type: string, details: string) => {
    const newAlert: Alert = {
      id: Date.now().toString(),
      type,
      details,
      timestamp: new Date(),
      isNew: true
    };
    
    setAlerts(prevAlerts => [newAlert, ...prevAlerts].slice(0, 50)); // Keep last 50 alerts
    
    // Play sound
    if (alertSound.current) {
      alertSound.current.play().catch(err => console.error("Error playing alert sound:", err));
    }
    
    // Remove "new" highlight after 5 seconds
    setTimeout(() => {
      setAlerts(prevAlerts => 
        prevAlerts.map(alert => 
          alert.id === newAlert.id ? { ...alert, isNew: false } : alert
        )
      );
    }, 5000);
  };

  // Start streaming frames to server
  const startStreaming = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsStreaming(true);
    fpsCounter.current = { count: 0, lastUpdate: Date.now() };
    
    const sendFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || !video.videoWidth) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        
        try {
          // Create form data with the image
          const formData = new FormData();
          formData.append('image', blob, 'frame.jpg');
          
          // Add suspicious behavior flag to request
          if (suspiciousBehaviorEnabled) {
            formData.append('detect_behavior', 'true');
          }
          
          // Send to Django backend
          const response = await fetch('http://localhost:8000/api/detect/', {
            method: 'POST',
            body: formData,
          });
          
          if (!response.ok) throw new Error(`Server responded with ${response.status}`);
          
          const results = await response.json();
          setDetections(results.detections);
          
          // Check for alerts in response
          if (results.alerts && results.alerts.length > 0) {
            results.alerts.forEach((alert: any) => {
              addAlert(alert.behavior, JSON.stringify(alert.details));
            });
          }
          
          // Update FPS counter
          fpsCounter.current.count++;
          const now = Date.now();
          const elapsed = now - fpsCounter.current.lastUpdate;
          
          if (elapsed >= 1000) { // Update FPS every second
            setFps(Math.round((fpsCounter.current.count / elapsed) * 1000));
            fpsCounter.current = { count: 0, lastUpdate: now };
          }
          
          // Draw bounding boxes on detections
          drawDetections(ctx, results.detections);
          
        } catch (err) {
          console.error("Error sending frame:", err);
          if (err instanceof Error) setError(err.message);
        }
      }, 'image/jpeg', 0.8);
    };
    
    // Stream at approximately 10 FPS
    streamInterval.current = window.setInterval(sendFrame, 100);
  };

  // Stop streaming
  const stopStreaming = () => {
    if (streamInterval.current !== null) {
      clearInterval(streamInterval.current);
      streamInterval.current = null;
    }
    setIsStreaming(false);
  };

  // Draw bounding boxes for detected objects
  const drawDetections = (
    ctx: CanvasRenderingContext2D, 
    detections: DetectionResult[]
  ) => {
    // Clear previous drawings
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Redraw the video frame
    if (videoRef.current) {
      ctx.drawImage(
        videoRef.current, 
        0, 0, 
        ctx.canvas.width, 
        ctx.canvas.height
      );
    }
    
    // Draw each detection
    detections.forEach(detection => {
      const [x1, y1, x2, y2] = detection.bbox;
      const width = x2 - x1;
      const height = y2 - y1;
      
      // Draw rectangle
      ctx.strokeStyle = '#00FF00';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, width, height);
      
      // Draw label with confidence
      ctx.fillStyle = '#00FF00';
      ctx.font = '16px Arial';
      const label = `${detection.label} ${Math.round(detection.confidence * 100)}%`;
      const textWidth = ctx.measureText(label).width;
      
      ctx.fillRect(x1, y1 - 20, textWidth + 10, 20);
      ctx.fillStyle = '#000000';
      ctx.fillText(label, x1 + 5, y1 - 5);
    });
  };
  
  // Save webhook URL
  const saveSettings = () => {
    // You could send this to your backend to update the webhook URL
    fetch('http://localhost:8000/api/settings/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        webhook_url: webhookUrl,
        suspicious_behavior_enabled: suspiciousBehaviorEnabled
      }),
    }).then(response => {
      if (response.ok) {
        setShowSettings(false);
      }
    }).catch(err => {
      console.error("Error saving settings:", err);
    });
  };

  // Clear all alerts
  const clearAlerts = () => {
    setAlerts([]);
  };

  // Initialize webcam on component mount
  useEffect(() => {
    startWebcam();
    
    // Cleanup on unmount
    return () => {
      if (streamInterval.current) clearInterval(streamInterval.current);
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="app-container">
      <h1>Object Detection with Suspicious Behavior Monitoring</h1>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="video-container">
        <video 
          ref={videoRef} 
          className="video-element" 
          muted 
          style={{ display: 'none' }}
        />
        <canvas 
          ref={canvasRef} 
          className="canvas-element"
        />
      </div>
      
      <div className="controls">
        {!isStreaming ? (
          <button 
            onClick={startStreaming} 
            disabled={!!error}
            className="start-btn"
          >
            Start Detection
          </button>
        ) : (
          <button 
            onClick={stopStreaming}
            className="stop-btn"
          >
            Stop Detection
          </button>
        )}
        
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="settings-btn"
        >
          Settings
        </button>
      </div>
      
      {showSettings && (
        <div className="settings-panel">
          <h3>Settings</h3>
          
          <div className="setting-item">
            <label>
              <input
                type="checkbox"
                checked={suspiciousBehaviorEnabled}
                onChange={(e) => setSuspiciousBehaviorEnabled(e.target.checked)}
              />
              Enable Suspicious Behavior Detection
            </label>
          </div>
          
          <div className="setting-item">
            <label>Webhook URL:</label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-webhook-endpoint.com/alert"
              className="webhook-input"
            />
          </div>
          
          <div className="setting-actions">
            <button onClick={saveSettings}>Save</button>
            <button onClick={() => setShowSettings(false)}>Cancel</button>
          </div>
        </div>
      )}
      
      <div className="stats-alert-container">
        <div className="stats">
          <p>FPS: {fps}</p>
          <p>Detected Objects: {detections.length}</p>
          <ul className="detection-list">
            {detections.map((detection, index) => (
              <li key={index}>
                {detection.label}: {Math.round(detection.confidence * 100)}%
              </li>
            ))}
          </ul>
        </div>
        
        <div className="alerts-panel">
          <div className="alerts-header">
            <h3>Suspicious Behavior Alerts</h3>
            <button onClick={clearAlerts} className="clear-btn">Clear All</button>
          </div>
          
          {alerts.length === 0 ? (
            <p className="no-alerts">No alerts detected</p>
          ) : (
            <ul className="alerts-list">
              {alerts.map((alert) => (
                <li 
                  key={alert.id} 
                  className={`alert-item ${alert.isNew ? 'new-alert' : ''} ${alert.type.toLowerCase()}`}
                >
                  <div className="alert-time">
                    {alert.timestamp.toLocaleTimeString()}
                  </div>
                  <div className="alert-content">
                    <strong>{alert.type}</strong>: {alert.details}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;