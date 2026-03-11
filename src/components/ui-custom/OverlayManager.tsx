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
  applyMode?: 'alpha' | 'invert' | 'luminance';
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
  const [imageDims, setImageDims] = useState<Record<string, { w: number, h: number }>>({});

  const handleImageLoad = (id: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDims(prev => ({ ...prev, [id]: { w: img.naturalWidth, h: img.naturalHeight } }));
  };

  // Auto-activate newly added overlays
  const prevOverlaysRef = useRef(overlays);
  React.useEffect(() => {
    if (overlays.length > prevOverlaysRef.current.length) {
      // Find the new overlay
      const newOverlay = overlays.find(o => !prevOverlaysRef.current.some(prev => prev.id === o.id));
      if (newOverlay) {
        setActiveId(newOverlay.id);
      }
    }
    prevOverlaysRef.current = overlays;
  }, [overlays]);

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
            className={`absolute pointer-events-none ${isActive ? 'z-50' : 'z-40'}`}
            style={{
              left: `${overlay.x}px`,
              top: `${overlay.y}px`,
              transform: `translate(-50%, -50%)`,
              opacity: overlay.opacity
            }}
          >
            {/* Outline and Image Wrapper - Handles scale and rotation */}
            <div 
              className={`relative group ${isActive ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-white/50'}`}
              style={{
                transform: `rotate(${overlay.rotation}deg) scale(${overlay.scale})`,
                transformOrigin: 'center center',
              }}
            >
              {/* Actual Image */}
              <img 
                src={overlay.imageUrl} 
                alt={overlay.type}
                className={`select-none max-w-[70vw] max-h-[70vh] object-contain ${overlay.type === 'stencil' ? 'pointer-events-none' : 'pointer-events-auto'}`}
                crossOrigin="anonymous" 
                id={`overlay-img-${overlay.id}`}
                onLoad={(e) => handleImageLoad(overlay.id, e)}
                onPointerDown={() => {
                  if (overlay.type === 'reference') {
                    setActiveId(overlay.id);
                  }
                }}
              />
            </div>

            {/* Controls - Fixed size and horizontal orientation */}
            {(() => {
              // Calculate dynamic offset based on actual rendered dimensions
              const dims = imageDims[overlay.id] || { w: 800, h: 800 };
              const maxW = window.innerWidth * 0.7;
              const maxH = window.innerHeight * 0.7;
              
              let baseW = dims.w;
              let baseH = dims.h;
              if (baseW > maxW || baseH > maxH) {
                const scaleDown = Math.min(maxW / baseW, maxH / baseH);
                baseW *= scaleDown;
                baseH *= scaleDown;
              }
              
              const renderedHeight = baseH * overlay.scale;
              const offsetTop = -(renderedHeight / 2) - 30; // 30px gap above top edge

              return (
                <div 
                  className={`absolute left-1/2 bg-zinc-900/95 backdrop-blur-md rounded-lg p-1.5 border border-white/10 flex items-center gap-1 transition-all whitespace-nowrap pointer-events-auto shadow-2xl ${isActive ? 'opacity-100 z-50 scale-100' : 'opacity-0 -z-10 scale-95 pointer-events-none'}`}
                  style={{
                    top: '50%',
                    transform: `translate(-50%, calc(-50% + ${offsetTop}px))`
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setActiveId(overlay.id);
                  }}
                >
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

                  {overlay.type === 'stencil' && (
                    <>
                      <div className="w-px h-4 bg-white/20 mx-1" />
                      <button 
                        className="px-2 py-1 text-[10px] uppercase font-bold text-zinc-300 hover:text-white hover:bg-zinc-800 rounded transition-colors"
                        onClick={() => {
                          const nextMode = (!overlay.applyMode || overlay.applyMode === 'alpha') ? 'invert' : overlay.applyMode === 'invert' ? 'luminance' : 'alpha';
                          onUpdate(overlay.id, { applyMode: nextMode });
                        }}
                        title="Ciclar Modo de Máscara (Alpha, Invertido, Luminância)"
                      >
                        {overlay.applyMode || 'alpha'}
                      </button>
                    </>
                  )}

                  <div className="w-px h-4 bg-white/20 mx-1" />

                  <button 
                    className="p-1.5 hover:bg-red-500/80 rounded text-zinc-400 hover:text-white"
                    onClick={() => onRemove(overlay.id)}
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })()}

            {/* Mode Badge - Fixed size */}
            {(() => {
              const dims = imageDims[overlay.id] || { w: 800, h: 800 };
              const maxW = window.innerWidth * 0.7;
              const maxH = window.innerHeight * 0.7;

              let baseW = dims.w;
              let baseH = dims.h;
              if (baseW > maxW || baseH > maxH) {
                const scaleDown = Math.min(maxW / baseW, maxH / baseH);
                baseW *= scaleDown;
                baseH *= scaleDown;
              }

              const renderedHeight = baseH * overlay.scale;
              const offsetBottom = (renderedHeight / 2) + 20;

              return (
                <div 
                  className={`absolute left-1/2 bg-black/80 px-3 py-1 rounded-full text-[10px] text-zinc-300 font-mono tracking-wider uppercase pointer-events-none shadow-lg transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}
                  style={{
                    top: '50%',
                    transform: `translate(-50%, calc(-50% + ${offsetBottom}px))`
                  }}
                >
                  {overlay.type}
                </div>
              );
            })()}
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
                  onClick={() => {
                    if (activeId === o.id) {
                      onUpdate(o.id, { visible: !o.visible });
                    } else {
                      onUpdate(o.id, { visible: true });
                      setActiveId(o.id);
                    }
                  }}
                  className={`w-8 h-8 rounded flex items-center justify-center transition-all ${o.visible ? (activeId === o.id ? 'bg-blue-600 text-white shadow-lg scale-110' : 'bg-zinc-800 text-white') : 'bg-transparent text-zinc-500 hover:bg-zinc-800/50'}`}
                  title={`${o.type} (${o.visible ? 'Visible' : 'Hidden'})`}
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
