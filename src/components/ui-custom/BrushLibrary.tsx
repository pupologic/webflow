import React, { useState } from 'react';
import { Search, Plus, Settings, Copy, Type, Trash2 } from 'lucide-react';
import type { BrushSettings } from '@/hooks/useWebGLPaint';
import { BrushStrokePreview } from './BrushStrokePreview';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import pencil1 from '@/brushes/pencil_1.png';
import grunge from '@/brushes/grunge.png';
import spray from '@/brushes/spray.png';

interface BrushLibraryProps {
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
  onOpenStudio: () => void;
  customPresets?: BrushSettings[];
  onDuplicateBrush?: (brush: BrushSettings) => void;
  onRenameBrush?: (brushId: string, newName: string) => void;
  onRemoveBrush?: (brushId: string) => void;
}

const CATEGORIES = ['Recent', 'Basics', 'Pencils', 'Markers', 'Spray', 'Artistic', 'Custom'];

const BASE_PRESETS: BrushSettings[] = [
  {
    id: 'round-hard',
    name: 'Hard Round',
    category: 'Basics',
    type: 'circle',
    size: 15,
    opacity: 1,
    hardness: 1.0,
    spacing: 0.1,
    color: '#ffffff',
    mode: 'paint',
    usePressureSize: true,
    usePressureOpacity: false,
    pressureCurve: 1.0
  },
  {
    id: 'round-soft',
    name: 'Soft Round',
    category: 'Basics',
    type: 'circle',
    size: 40,
    opacity: 0.5,
    hardness: 0.3,
    spacing: 0.25,
    color: '#ffffff',
    mode: 'paint',
    usePressureSize: true,
    usePressureOpacity: true,
    pressureCurve: 1.0
  },
  {
    id: 'flat-liner',
    name: 'Flat Liner',
    category: 'Basics',
    type: 'square',
    size: 10,
    opacity: 1,
    hardness: 1.0,
    spacing: 0.05,
    color: '#ffffff',
    mode: 'paint',
    usePressureSize: true,
    usePressureOpacity: false,
    pressureCurve: 1.2
  },
  {
    id: 'tech-pencil',
    name: 'Technical Pencil',
    category: 'Pencils',
    type: 'texture',
    textureId: pencil1,
    size: 8,
    opacity: 0.8,
    hardness: 0.8,
    spacing: 0.1,
    color: '#ffffff',
    mode: 'paint',
    usePressureSize: false,
    usePressureOpacity: true,
    pressureCurve: 0.8
  },
  {
    id: 'spray-can',
    name: 'Spray Can',
    category: 'Spray',
    type: 'texture',
    textureId: spray,
    size: 60,
    opacity: 0.4,
    hardness: 0.5,
    spacing: 0.5,
    color: '#ffffff',
    mode: 'paint',
    usePressureSize: true,
    usePressureOpacity: true,
    pressureCurve: 1.0
  },
  {
    id: 'grunge-texture',
    name: 'Grunge',
    category: 'Artistic',
    type: 'texture',
    textureId: grunge,
    size: 50,
    opacity: 0.7,
    hardness: 0.8,
    spacing: 0.4,
    color: '#ffffff',
    mode: 'paint',
    usePressureSize: true,
    usePressureOpacity: true,
    pressureCurve: 1.0
  }
];

export const BrushLibrary: React.FC<BrushLibraryProps> = ({
  brushSettings,
  onBrushSettingsChange,
  onOpenStudio,
  customPresets,
  onDuplicateBrush,
  onRenameBrush,
  onRemoveBrush
}) => {
  const [activeCategory, setActiveCategory] = useState('Basics');
  const [search, setSearch] = useState('');

  const filteredPresets = [...BASE_PRESETS, ...(customPresets || [])].filter(p => {
    if (activeCategory === 'Custom') return (customPresets || []).includes(p);
    if (activeCategory === 'Recent') return false; // Placeholder
    return p.category === activeCategory && p.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex h-[500px] w-full bg-[#09090b] rounded-xl border border-white/5 overflow-hidden shadow-2xl">
      {/* Categories Sidebar */}
      <div className="w-32 bg-zinc-900/50 border-r border-white/5 flex flex-col pt-4">
        <ScrollArea className="flex-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full text-left px-4 py-2 text-[11px] font-medium transition-colors ${
                activeCategory === cat ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
              }`}
            >
              {cat}
            </button>
          ))}
        </ScrollArea>
        <div className="p-3 border-t border-white/5">
          <button 
            onClick={onOpenStudio}
            className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md text-[10px] flex items-center justify-center gap-1 transition-all"
          >
            <Plus className="w-3 h-3" />
            STUDIO
          </button>
        </div>
      </div>

      {/* Preset List */}
      <div className="flex-1 flex flex-col bg-[#09090b]">
        <div className="p-3 border-b border-white/5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1.5 w-3 h-3 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search brushes..."
              className="w-full bg-zinc-900 border-white/5 text-[11px] pl-7 pr-2 py-1.5 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-zinc-300"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="grid grid-cols-1 gap-1 p-2 pr-4">
            {filteredPresets.map(preset => (
              <button
                key={preset.id}
                onClick={() => {
                  const { color, mode, ...settings } = preset;
                  onBrushSettingsChange({ ...brushSettings, ...settings });
                }}
                className={`flex flex-col p-2 rounded-lg transition-all border ${
                  brushSettings.id === preset.id 
                    ? 'bg-blue-600/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                    : 'bg-zinc-900/30 border-transparent hover:border-white/10 hover:bg-white/5'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={`text-[11px] font-medium ${brushSettings.id === preset.id ? 'text-blue-300' : 'text-zinc-300'}`}>
                    {preset.name}
                  </span>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button className="p-1 hover:bg-white/10 rounded transition-colors text-zinc-500 hover:text-zinc-300">
                        <Settings className="w-3 h-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-zinc-900 border-white/10 text-zinc-300">
                      <DropdownMenuItem 
                        onClick={(e) => { e.stopPropagation(); onDuplicateBrush?.(preset); }}
                        className="text-[11px] flex items-center gap-2 cursor-pointer hover:bg-blue-600 focus:bg-blue-600"
                      >
                        <Copy className="w-3 h-3" /> Duplicate
                      </DropdownMenuItem>
                      
                      {customPresets?.some(cp => cp.id === preset.id) && (
                        <>
                          <DropdownMenuItem 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              const name = window.prompt('Rename Brush:', preset.name);
                              if (name) onRenameBrush?.(preset.id, name);
                            }}
                            className="text-[11px] flex items-center gap-2 cursor-pointer hover:bg-blue-600 focus:bg-blue-600"
                          >
                            <Type className="w-3 h-3" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              if (window.confirm(`Remove "${preset.name}"?`)) onRemoveBrush?.(preset.id);
                            }}
                            className="text-[11px] flex items-center gap-2 cursor-pointer text-red-400 hover:bg-red-600 hover:text-white focus:bg-red-600 focus:text-white"
                          >
                            <Trash2 className="w-3 h-3" /> Remove
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <BrushStrokePreview brush={preset} width={220} height={40} />
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
