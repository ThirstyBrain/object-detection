// src/App.tsx

import React, { useEffect, useRef, useState } from 'react';
import './App.css';

interface DetectionResult {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
}

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const streamInterval = useRef<number | null>(null);
  const fpsCounter = useRef({ count: 0, lastUpdate: Date.now() });

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
      
      // Draw current video frame to canvas (for processing)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        
        try {
          // Create form data with the image
          const formData = new FormData();
          formData.append('image', blob, 'frame.jpg');
          
          // Send to Django backend
          const response = await fetch('http://localhost:8000/api/detect/', {
            method: 'POST',
            body: formData,
          });
          
          if (!response.ok) throw new Error(`Server responded with ${response.status}`);
          
          const results = await response.json();
          setDetections(results.detections);
          
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
    // Clear previous drawings (canvas will only show overlay, not video)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
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
      <h1>Object Detection with YOLO</h1>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="video-container" style={{ position: 'relative' }}>
        <video 
          ref={videoRef} 
          className="video-element" 
          muted 
          style={{ width: '640px', height: '480px' }} // Make video visible
        />
        <canvas 
          ref={canvasRef} 
          className="canvas-element"
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '640px', 
            height: '480px',
            pointerEvents: 'none' // Allows interaction with video underneath
          }}
        />
      </div>
      
      <div className="controls">
        {!isStreaming ? (
          <button onClick={startStreaming} disabled={!!error}>
            Start Detection
          </button>
        ) : (
          <button onClick={stopStreaming}>
            Stop Detection
          </button>
        )}
      </div>
      
      {isStreaming && (
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
      )}
    </div>
  );
};

export default App;