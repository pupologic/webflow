import React, { useEffect, useRef } from 'react';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

interface BrushStrokePreviewProps {
  brush: BrushSettings;
  width?: number;
  height?: number;
  color?: string;
}

export const BrushStrokePreview: React.FC<BrushStrokePreviewProps> = ({
  brush,
  width = 160,
  height = 40,
  color = '#ffffff'
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Render "S" shape stroke
    // Calculate total length of "S" curve (roughly)
    const curveLength = width; 
    const stepDist = Math.max(1, brush.size * brush.spacing);
    const steps = Math.floor(curveLength / stepDist);
    
    ctx.save();
    
    // We'll simulate drawing stamps
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        
        // "S" curve path
        const x = 10 + t * (width - 20);
        const y = height / 2 + Math.sin(t * Math.PI * 2) * (height / 4);
        
        // Pressure simulation (0 at ends, 1 in middle)
        let pressure = Math.sin(t * Math.PI);
        const curve = brush.pressureCurve || 1.0;
        pressure = Math.pow(pressure, curve);

        const size = brush.usePressureSize ? brush.size * pressure : brush.size;
        const opacity = brush.usePressureOpacity ? brush.opacity * pressure : brush.opacity;

        // Draw stamp
        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;

        if (brush.type === 'circle') {
            ctx.beginPath();
            ctx.arc(x, y, size / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (brush.type === 'square') {
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        } else if (brush.type === 'texture' && brush.textureId) {
            // For texture, we'd need to load the image. For preview, we'll use a soft circle if image not loaded
            // In a real app, we'd preload these.
            ctx.beginPath();
            ctx.arc(x, y, size / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    ctx.restore();
  }, [brush, width, height, color]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      className="rounded-md overflow-hidden bg-zinc-900/30"
    />
  );
};
