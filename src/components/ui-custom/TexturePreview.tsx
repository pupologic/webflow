import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Download, Trash2, FolderOpen } from 'lucide-react';

interface TexturePreviewProps {
  texture: THREE.Texture | null;
  previewCanvas: HTMLCanvasElement | null;
  onClear: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  resolution: number;
  onResolutionChange: (res: number) => void;
}

export const TexturePreview: React.FC<TexturePreviewProps> = ({
  previewCanvas,
  onClear,
  onExport,
  onImport,
  resolution,
  onResolutionChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (canvasRef.current && previewCanvas) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear canvas
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw texture preview from the provided preview canvas
        const scale = Math.min(
          canvas.width / previewCanvas.width,
          canvas.height / previewCanvas.height
        );
        const x = (canvas.width - previewCanvas.width * scale) / 2;
        const y = (canvas.height - previewCanvas.height * scale) / 2;
        
        ctx.drawImage(previewCanvas, x, y, previewCanvas.width * scale, previewCanvas.height * scale);
      }
    }
  }, [previewCanvas]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-6 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Texture</h3>
        <select 
          className="bg-transparent border border-white/10 focus:ring-1 focus:ring-zinc-600 rounded text-[10px] text-zinc-400 uppercase font-mono px-2 py-1"
          value={resolution.toString()}
          onChange={(e) => onResolutionChange(parseInt(e.target.value, 10))}
        >
          <option value="512">512x512</option>
          <option value="1024">1024x1024</option>
          <option value="2048">2048x2048</option>
          <option value="4096">4096x4096</option>
        </select>
      </div>
      
      {/* Texture Preview Canvas */}
      <div className="bg-zinc-900/40 rounded-xl p-2 border border-white/5">
        <canvas
          ref={canvasRef}
          width={256}
          height={256}
          className="w-full h-auto rounded-lg border border-white/10 seamless-checkerboard"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          className="bg-transparent hover:bg-zinc-800 text-zinc-300 border-white/10 text-[10px] uppercase tracking-wider py-5"
        >
          <Download className="w-3.5 h-3.5 mr-1 text-zinc-500" />
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleImportClick}
          className="bg-transparent hover:bg-zinc-800 text-zinc-300 border-white/10 text-[10px] uppercase tracking-wider py-5"
        >
          <FolderOpen className="w-3.5 h-3.5 mr-1 text-zinc-500" />
          Load
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          className="bg-transparent hover:bg-red-950/50 hover:text-red-300 text-zinc-300 border-white/10 hover:border-red-900/50 text-[10px] uppercase tracking-wider py-5"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1 text-red-500/70" />
          Drop
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
};
