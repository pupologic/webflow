import React from 'react';
import { Button } from '@/components/ui/button';
import { Box, PencilLine } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface MeshSelectorProps {
  modelName: string;
  onNameChange: (name: string) => void;
  onObjUpload?: (file: File) => void;
  showWireframe?: boolean;
  setShowWireframe?: (show: boolean) => void;
  flatShading?: boolean;
  setFlatShading?: (flat: boolean) => void;
  modelParts?: any[];
  activePartId?: string | null;
  onSetActivePart?: (id: string) => void;
  onTogglePartVisibility?: (id: string) => void;
  onUpdatePartTransform?: (id: string, transformType: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number) => void;
}

export const MeshSelector: React.FC<MeshSelectorProps> = ({
  modelName,
  onNameChange,
  onObjUpload,
  showWireframe = false,
  setShowWireframe,
  flatShading = false,
  setFlatShading,
  modelParts = [],
  activePartId,
  onSetActivePart,
  onTogglePartVisibility,
  onUpdatePartTransform,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onObjUpload) {
      onObjUpload(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">MODEL</h3>
      
      <div className="relative">
        <Input 
          type="text"
          value={modelName}
          onChange={(e) => onNameChange(e.target.value)}
          className="bg-zinc-900 border-white/10 text-zinc-100 text-sm font-semibold pr-10 focus-visible:ring-1 focus-visible:ring-zinc-600 rounded-lg"
        />
        <PencilLine className="w-4 h-4 text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      
      {setShowWireframe && setFlatShading && (
        <div className="flex items-center gap-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="wireframe-toggle"
              checked={showWireframe} 
              onChange={(e) => setShowWireframe(e.target.checked)} 
              className="accent-zinc-500 w-3.5 h-3.5"
            />
            <label htmlFor="wireframe-toggle" className="text-zinc-400 text-xs flex items-center gap-1 cursor-pointer hover:text-zinc-200 transition-colors">
              <Box className="w-3.5 h-3.5" />
              Wire
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="flatshading-toggle"
              checked={flatShading} 
              onChange={(e) => setFlatShading(e.target.checked)} 
              className="accent-zinc-500 w-3.5 h-3.5"
            />
            <label htmlFor="flatshading-toggle" className="text-zinc-400 text-xs flex items-center gap-1 cursor-pointer hover:text-zinc-200 transition-colors">
              <Box className="w-3.5 h-3.5" />
              Flat
            </label>
          </div>
        </div>
      )}

      {modelParts.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-white/10">
          <h4 className="text-zinc-400 text-xs tracking-wide">MODEL PARTS</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
            {modelParts.map((part) => (
              <div 
                key={part.id} 
                className={`p-2 rounded-lg border flex flex-col gap-2 transition-colors ${
                  activePartId === part.id ? 'bg-zinc-800 border-zinc-500' : 'bg-zinc-900 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div 
                    className="flex items-center gap-2 flex-1 cursor-pointer"
                    onClick={() => onSetActivePart?.(part.id)}
                  >
                    <input 
                      type="radio" 
                      readOnly 
                      checked={activePartId === part.id}
                      className="accent-zinc-400 w-3 h-3"
                    />
                    <span className="text-xs text-zinc-300 truncate w-32" title={part.name}>{part.name}</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={part.visible}
                    onChange={() => onTogglePartVisibility?.(part.id)}
                    className="accent-zinc-500 w-3.5 h-3.5"
                    title="Toggle Visibility"
                  />
                </div>

                {activePartId === part.id && onUpdatePartTransform && (
                  <div className="pl-5 space-y-3 pt-2 border-t border-white/5 mt-1">
                    {/* Position */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-zinc-500 font-medium">Position</span>
                      <div className="grid grid-cols-3 gap-1">
                        {['X', 'Y', 'Z'].map((axisLabel, i) => (
                          <div key={`pos-${i}`} className="relative flex items-center">
                            <span className="absolute left-1.5 text-[9px] text-zinc-600 font-mono">{axisLabel}</span>
                            <Input 
                              type="number" 
                              step="0.1"
                              value={part.position[i]}
                              onChange={(e) => onUpdatePartTransform(part.id, 'position', i as 0|1|2, parseFloat(e.target.value) || 0)}
                              className="h-6 text-[10px] pl-4 pr-1 bg-black/40 border-white/10 focus-visible:ring-1 focus-visible:ring-zinc-600 font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Rotation */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-zinc-500 font-medium">Rotation</span>
                      <div className="grid grid-cols-3 gap-1">
                        {['X', 'Y', 'Z'].map((axisLabel, i) => (
                          <div key={`rot-${i}`} className="relative flex items-center">
                            <span className="absolute left-1.5 text-[9px] text-zinc-600 font-mono">{axisLabel}</span>
                            <Input 
                              type="number" 
                              step="0.1"
                              value={part.rotation[i]}
                              onChange={(e) => onUpdatePartTransform(part.id, 'rotation', i as 0|1|2, parseFloat(e.target.value) || 0)}
                              className="h-6 text-[10px] pl-4 pr-1 bg-black/40 border-white/10 focus-visible:ring-1 focus-visible:ring-zinc-600 font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Scale */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-zinc-500 font-medium">Scale</span>
                      <div className="grid grid-cols-3 gap-1">
                        {['X', 'Y', 'Z'].map((axisLabel, i) => (
                          <div key={`scl-${i}`} className="relative flex items-center">
                            <span className="absolute left-1.5 text-[9px] text-zinc-600 font-mono">{axisLabel}</span>
                            <Input 
                              type="number" 
                              step="0.1"
                              value={part.scale[i]}
                              onChange={(e) => onUpdatePartTransform(part.id, 'scale', i as 0|1|2, parseFloat(e.target.value) || 0)}
                              className="h-6 text-[10px] pl-4 pr-1 bg-black/40 border-white/10 focus-visible:ring-1 focus-visible:ring-zinc-600 font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-6 border bg-zinc-800 border-zinc-500 text-zinc-100 shadow-md hover:bg-zinc-700"
        >
          <Box className="w-4 h-4" />
          <span className="text-xs font-medium tracking-wide">UPLOAD NEW OBJ</span>
        </Button>
        <input
          type="file"
          accept=".obj"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
};
