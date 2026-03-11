import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Pipette, Plus, History, LayoutGrid, CircleDot, SlidersHorizontal, Trash2 } from 'lucide-react';

declare global {
  interface EyeDropper {
    open(): Promise<{ sRGBHex: string }>;
  }
  interface Window {
    EyeDropper: {
      new (): EyeDropper;
    };
  }
}

type PickerTab = 'disc' | 'classic' | 'palettes';

interface ColorPickerProps {
  color: string;
  onColorChange: (color: string) => void;
  recentColors?: string[];
}

// Helper functions for color conversion
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number) {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  color,
  onColorChange,
  recentColors = []
}) => {
  const [hsv, setHsv] = useState(() => {
    const rgb = hexToRgb(color);
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });

  const [activeTab, setActiveTab] = useState<PickerTab>('disc');
  const [palette, setPalette] = useState<string[]>(() => {
    const saved = localStorage.getItem('painter_color_palette');
    return saved ? JSON.parse(saved) : ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  });

  const svRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const isDraggingSV = useRef(false);
  const isDraggingWheel = useRef(false);

  // Sync palette to localStorage
  useEffect(() => {
    localStorage.setItem('painter_color_palette', JSON.stringify(palette));
  }, [palette]);

  const saveToPalette = () => {
    if (!palette.includes(color)) {
      setPalette(prev => [color, ...prev].slice(0, 24));
    }
  };

  const removeFromPalette = (e: React.MouseEvent, c: string) => {
    e.stopPropagation();
    setPalette(prev => prev.filter(item => item !== c));
  };

  // Update HSV when external color prop changes (e.g. from preset)
  useEffect(() => {
    const rgb = hexToRgb(color);
    const newHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    // Only update if it's significantly different to avoid feedback loops
    const currentHex = rgbToHex(...Object.values(hsvToRgb(hsv.h, hsv.s, hsv.v)) as [number, number, number]);
    if (color.toLowerCase() !== currentHex.toLowerCase()) {
      setHsv(newHsv);
    }
  }, [color]);

  const updateColor = useCallback((newHsv: { h: number; s: number; v: number }) => {
    setHsv(newHsv);
    const rgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
    const newHex = rgbToHex(rgb.r, rgb.g, rgb.b);
    onColorChange(newHex);
  }, [onColorChange]);

  const handleSVMouse = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!svRef.current) return;
    const rect = svRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    updateColor({ ...hsv, s: x, v: y });
  }, [hsv, updateColor]);

  const handleWheelMouse = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = e.clientX - rect.left - centerX;
    const y = e.clientY - rect.top - centerY;
    
    const angle = Math.atan2(y, x);
    let hue = (angle / (2 * Math.PI)) + 0.25;
    if (hue < 0) hue += 1;
    if (hue > 1) hue -= 1;
    
    updateColor({ ...hsv, h: hue });
  }, [hsv, updateColor]);




  useEffect(() => {
    const handlePointerUp = () => {
      isDraggingSV.current = false;
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (isDraggingSV.current) handleSVMouse(e as any);
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [handleSVMouse]);

  // Pure CSS background for the Hue slider
  const hueBackground = 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  
  // Base color for the SV square (full saturation/value for current hue)
  const baseRgb = hsvToRgb(hsv.h, 1, 1);
  const baseHex = rgbToHex(baseRgb.r, baseRgb.g, baseRgb.b);

  const handleEyeDropper = async () => {
    if (!window.EyeDropper) {
      alert("Seu navegador não suporta o conta-gotas.");
      return;
    }

    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      const newHex = result.sRGBHex;
      onColorChange(newHex);
    } catch (e) {
      console.log("EyeDropper cancelled or failed", e);
    }
  };

  return (
    <div className="space-y-4 p-4 bg-[#0c0c0e] rounded-2xl border border-white/10 shadow-2xl w-72 select-none overflow-hidden">
      <div className="flex justify-between items-center mb-2 px-1">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 shadow-lg" style={{ backgroundColor: color }} />
          <div className="flex flex-col">
             <span className="text-zinc-500 font-mono text-[10px] uppercase leading-none mb-1">{color}</span>
             <Label className="text-zinc-100 text-[11px] uppercase tracking-wider font-bold leading-none">Colors</Label>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-white/5 rounded-full p-1">
          {window.EyeDropper && (
            <button
              onClick={handleEyeDropper}
              className="p-1.5 hover:bg-white/10 rounded-full transition-all text-zinc-400 hover:text-white"
              title="Conta-gotas"
            >
              <Pipette className="w-4 h-4" />
            </button>
          )}
          <button 
            onClick={saveToPalette}
            className="p-1.5 hover:bg-white/10 rounded-full transition-all text-zinc-400 hover:text-white"
            title="Salvar na Paleta"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TABS CONTENT */}
      <div className="min-h-[220px] flex items-center justify-center py-2">
        {activeTab === 'disc' && (
          <div className="relative w-full aspect-square flex items-center justify-center">
            {/* Color Wheel Background - No border/shadow to avoid artifacts */}
            <div 
              ref={wheelRef}
              className="relative w-48 h-48 rounded-full cursor-crosshair touch-none"
              style={{ 
                background: `conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)` 
              }}
              onPointerDown={(e) => {
                isDraggingWheel.current = true;
                handleWheelMouse(e);
                const move = (me: PointerEvent) => handleWheelMouse(me as any);
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              {/* Inner Saturation/Value Circle */}
              <div 
                ref={svRef}
                className="absolute inset-8 rounded-full overflow-hidden border border-white/10 shadow-lg"
                style={{ backgroundColor: baseHex }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  isDraggingSV.current = true;
                  handleSVMouse(e);
                  const move = (me: PointerEvent) => handleSVMouse(me as any);
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
                
                {/* SV Cursor */}
                <div 
                  className="absolute w-4 h-4 -ml-2 -mb-2 border-2 border-white rounded-full shadow-lg pointer-events-none"
                  style={{ 
                    left: `${hsv.s * 100}%`, 
                    bottom: `${hsv.v * 100}%`,
                    backgroundColor: color 
                  }}
                />
              </div>

              {/* Hue Indicator on Wheel */}
              <div 
                className="absolute w-5 h-5 -ml-2.5 -mt-2.5 bg-white rounded-full border-2 border-[#121214] shadow-xl pointer-events-none"
                style={{ 
                  left: `${50 + 45 * Math.cos((hsv.h - 0.25) * 2 * Math.PI)}%`,
                  top: `${50 + 45 * Math.sin((hsv.h - 0.25) * 2 * Math.PI)}%`
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'classic' && (
          <div className="w-full space-y-4">
            <div 
              ref={svRef}
              className="relative w-full h-40 rounded-xl overflow-hidden cursor-crosshair touch-none shadow-lg"
              style={{ backgroundColor: baseHex }}
              onPointerDown={(e) => {
                isDraggingSV.current = true;
                handleSVMouse(e);
                const move = (me: PointerEvent) => handleSVMouse(me as any);
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
              <div 
                className="absolute w-5 h-5 -ml-2.5 -mb-2.5 border-2 border-white rounded-full shadow-xl pointer-events-none"
                style={{ left: `${hsv.s * 100}%`, bottom: `${hsv.v * 100}%`, backgroundColor: color }}
              />
            </div>

            <div className="space-y-3 px-1">
              {/* HUE */}
              <div 
                className="relative h-4 w-full rounded-full cursor-pointer shadow-sm touch-none"
                style={{ background: hueBackground }}
                onPointerDown={(e) => {
                   const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                   const updateHue = (clientX: number) => {
                     const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                     updateColor({ ...hsv, h: x });
                   };
                   
                   updateHue(e.clientX);

                   const move = (me: PointerEvent) => updateHue(me.clientX);
                   const up = () => {
                     window.removeEventListener('pointermove', move);
                     window.removeEventListener('pointerup', up);
                   };
                   window.addEventListener('pointermove', move);
                   window.addEventListener('pointerup', up);
                }}
              >
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 bg-white rounded-full shadow-md border border-zinc-200 pointer-events-none"
                  style={{ left: `${hsv.h * 100}%` }}
                />
              </div>

              {/* SATURATION */}
              <div 
                className="relative h-4 w-full rounded-full cursor-pointer shadow-sm overflow-hidden"
                style={{ background: `linear-gradient(to right, #808080, ${baseHex})` }}
                onPointerDown={(e) => {
                   const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                   const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                   updateColor({ ...hsv, s: x });

                   const move = (me: PointerEvent) => {
                     const nx = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
                     updateColor({ ...hsv, s: nx });
                   };
                   const up = () => {
                     window.removeEventListener('pointermove', move);
                     window.removeEventListener('pointerup', up);
                   };
                   window.addEventListener('pointermove', move);
                   window.addEventListener('pointerup', up);
                }}
              >
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 bg-white rounded-full shadow-xl border border-zinc-300 pointer-events-none"
                  style={{ left: `${hsv.s * 100}%` }}
                />
              </div>

              {/* VALUE */}
              <div 
                className="relative h-4 w-full rounded-full cursor-pointer shadow-sm overflow-hidden"
                style={{ background: `linear-gradient(to right, #000000, ${baseHex})` }}
                onPointerDown={(e) => {
                   const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                   const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                   updateColor({ ...hsv, v: x });

                   const move = (me: PointerEvent) => {
                     const nx = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
                     updateColor({ ...hsv, v: nx });
                   };
                   const up = () => {
                     window.removeEventListener('pointermove', move);
                     window.removeEventListener('pointerup', up);
                   };
                   window.addEventListener('pointermove', move);
                   window.addEventListener('pointerup', up);
                }}
              >
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 bg-white rounded-full shadow-xl border border-zinc-300 pointer-events-none"
                  style={{ left: `${hsv.v * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'palettes' && (
          <div className="w-full h-48 overflow-y-auto pr-1 flex flex-col gap-4">
             <div className="space-y-2">
                <Label className="text-[9px] text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                   <Plus className="w-3 h-3" /> Saved Palette
                </Label>
                <div className="grid grid-cols-6 gap-2">
                  {palette.map((c, i) => (
                    <div key={i} className="relative group">
                       <button
                        className="w-full aspect-square rounded-lg border border-white/10 shadow-md transform hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }}
                        onClick={() => onColorChange(c)}
                      />
                      <button 
                        onClick={(e) => removeFromPalette(e, c)}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                         <Trash2 className="w-2 h-2" />
                      </button>
                    </div>
                  ))}
                  {palette.length < 24 && (
                    <button 
                      onClick={saveToPalette}
                      className="w-full aspect-square rounded-lg border border-dashed border-white/20 flex items-center justify-center text-zinc-600 hover:text-zinc-400 hover:border-white/40 transition-all"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
             </div>
          </div>
        )}
      </div>

      {/* HISTORY BAR */}
      <div className="pt-2 border-t border-white/5">
        <div className="flex justify-between items-center mb-2 px-1">
          <Label className="text-[9px] text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
             <History className="w-3 h-3" /> Recent History
          </Label>
        </div>
        <div className="flex gap-1 overflow-x-hidden pb-1">
          {!recentColors || recentColors.length === 0 ? (
            <span className="text-[10px] text-zinc-600 italic">No history yet...</span>
          ) : (
            recentColors.map((c: string, i: number) => (
              <button
                key={i}
                className="flex-shrink-0 w-[22px] h-[22px] rounded-md border border-white/10 shadow-sm transition-transform hover:scale-110 active:scale-95"
                style={{ backgroundColor: c }}
                onClick={() => onColorChange(c)}
                title={c}
              />
            ))
          )}
        </div>
      </div>

      {/* BOTTOM NAV TABS */}
      <div className="flex items-center justify-around pt-3 border-t border-white/10">
        <button 
          onClick={() => setActiveTab('disc')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'disc' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <CircleDot className="w-4 h-4" />
          <span className="text-[8px] uppercase font-bold tracking-tighter">Disc</span>
        </button>
        <button 
          onClick={() => setActiveTab('classic')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'classic' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-[8px] uppercase font-bold tracking-tighter">Classic</span>
        </button>
        <button 
          onClick={() => setActiveTab('palettes')}
          className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'palettes' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span className="text-[8px] uppercase font-bold tracking-tighter">Palettes</span>
        </button>
      </div>
    </div>
  );
};
