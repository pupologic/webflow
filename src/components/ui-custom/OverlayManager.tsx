import React, { useState, useRef } from 'react';
import { Image as ImageIcon, Maximize, Move, RotateCw, X } from 'lucide-react';

export interface OverlayData {
  id: string;
  type: 'reference' | 'stencil';
  imageUrl: string;
  x: number;
  y: number;
  scale: number;
  rotation: number; // in degrees
  opacity: number;
  visible: boolean;
}

interface OverlayManagerProps {
  overlays: OverlayData[];
  onUpdate: (id: string, updates: Partial<OverlayData>) => void;
  onRemove: (id: string) => void;
  onAdd: (type: 'reference' | 'stencil', file: File) => void;
}

export const OverlayManager: React.FC<OverlayManagerProps> = ({ overlays, onUpdate, onRemove, onAdd }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string, startX: number, startY: number, initialX: number, initialY: number, mode: 'move' | 'scale' | 'rotate' } | null>(null);

  const handlePointerDown = (e: React.PointerEvent, id: string, mode: 'move' | 'scale' | 'rotate') => {
    e.stopPropagation();
    setActiveId(id);
    const overlay = overlays.find(o => o.id === id);
    if (!overlay) return;

    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      initialX: overlay.x,
      initialY: overlay.y,
      mode
    };
    
    // Pointer capture allows dragging outside the element
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { id, startX, startY, initialX, initialY, mode } = dragRef.current;
    const overlay = overlays.find(o => o.id === id);
    if (!overlay) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (mode === 'move') {
      onUpdate(id, { x: initialX + dx, y: initialY + dy });
    } else if (mode === 'scale') {
      // Very basic uniform scaling based on horizontal mouse movement
      const newScale = Math.max(0.1, overlay.scale + (dx * 0.01));
      onUpdate(id, { scale: newScale });
      dragRef.current.startX = e.clientX; // reset to diff smoothly
    } else if (mode === 'rotate') {
      const newRot = overlay.rotation + (dx * 0.5);
      onUpdate(id, { rotation: newRot });
      dragRef.current.startX = e.clientX;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'reference' | 'stencil') => {
    const file = e.target.files?.[0];
    if (file) {
      onAdd(type, file);
    }
    e.target.value = ''; // Reset input
  };

  return (
    <>
      {/* RENDER FLOATING OVERLAYS */}
      {overlays.map(overlay => {
        if (!overlay.visible) return null;
        
        const isActive = activeId === overlay.id;
        
        return (
          <div
            key={overlay.id}
            className={`absolute pointer-events-auto ${isActive ? 'z-50' : 'z-40'}`}
            style={{
              left: `${overlay.x}px`,
              top: `${overlay.y}px`,
              // Transform origin center for scaling and rotation
              transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg) scale(${overlay.scale})`,
              transformOrigin: '50% 50%',
              opacity: overlay.opacity
            }}
            onPointerDown={() => setActiveId(overlay.id)}
          >
            {/* Outline on hover or active */}
            <div className={`relative group ${isActive ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-white/50'}`}>
              
              {/* Actual Image */}
              <img 
                src={overlay.imageUrl} 
                alt={overlay.type}
                className="select-none pointer-events-none max-w-[800px] max-h-[800px] object-contain"
                crossOrigin="anonymous" // Important for canvas color picking
                id={`overlay-img-${overlay.id}`}
              />

              {/* Controls (visible when active or hovering) */}
              <div className={`absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-900/90 backdrop-blur-md rounded-lg p-1 border border-white/10 flex items-center gap-1 opacity-0 transition-opacity whitespace-nowrap ${isActive ? 'opacity-100' : 'group-hover:opacity-100'}`}>
                
                {/* Drag Handle */}
                <div 
                  className="p-1.5 hover:bg-zinc-800 rounded cursor-move text-zinc-400 hover:text-white"
                  title="Move"
                  onPointerDown={(e) => handlePointerDown(e, overlay.id, 'move')}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <Move className="w-4 h-4" />
                </div>
                
                {/* Scale Handle */}
                <div 
                  className="p-1.5 hover:bg-zinc-800 rounded cursor-ew-resize text-zinc-400 hover:text-white"
                  title="Scale (Drag Horizontal)"
                  onPointerDown={(e) => handlePointerDown(e, overlay.id, 'scale')}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <Maximize className="w-4 h-4" />
                </div>

                {/* Rotate Handle */}
                <div 
                  className="p-1.5 hover:bg-zinc-800 rounded cursor-ew-resize text-zinc-400 hover:text-white"
                  title="Rotate (Drag Horizontal)"
                  onPointerDown={(e) => handlePointerDown(e, overlay.id, 'rotate')}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <RotateCw className="w-4 h-4" />
                </div>
                
                <div className="w-px h-4 bg-white/20 mx-1" />

                {/* Opacity slider inside controls */}
                <input 
                  type="range" 
                  min="0.1" max="1" step="0.05" 
                  value={overlay.opacity}
                  onChange={(e) => onUpdate(overlay.id, { opacity: parseFloat(e.target.value) })}
                  className="w-16 accent-zinc-400 mx-1"
                  title="Opacity"
                  onPointerDown={(e) => e.stopPropagation()} // Prevent picking up drag
                />

                <div className="w-px h-4 bg-white/20 mx-1" />

                <button 
                  className="p-1.5 hover:bg-red-500/80 rounded text-zinc-400 hover:text-white"
                  onClick={() => onRemove(overlay.id)}
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mode Badge */}
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-zinc-400 font-mono tracking-wider uppercase">
                {overlay.type}
              </div>
            </div>
          </div>
        );
      })}

      {/* RENDER CONTROL PANEL (DOCK) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-zinc-900/80 backdrop-blur-md rounded-xl p-2 border border-white/10 shadow-2xl pointer-events-auto z-50">
        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors text-xs font-semibold text-zinc-300 hover:text-white">
          <ImageIcon className="w-4 h-4" />
          <span>Add Reference</span>
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            onChange={(e) => handleFileChange(e, 'reference')} 
          />
        </label>

        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors text-xs font-semibold text-zinc-300 hover:text-white">
          <span className="w-4 h-4 border border-current rounded flex items-center justify-center p-0.5">S</span>
          <span>Add Stencil</span>
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            onChange={(e) => handleFileChange(e, 'stencil')} 
          />
        </label>

        {/* List of active overlays to toggle visibility */}
        {overlays.length > 0 && (
          <>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <div className="flex gap-1">
              {overlays.map((o) => (
                <button
                  key={o.id}
                  onClick={() => onUpdate(o.id, { visible: !o.visible })}
                  className={`w-8 h-8 rounded flex items-center justify-center ${o.visible ? 'bg-zinc-800 text-white' : 'bg-transparent text-zinc-500 hover:bg-zinc-800/50'}`}
                  title={o.type}
                >
                  {o.type === 'reference' ? <ImageIcon className="w-3 h-3" /> : 'S'}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
};
