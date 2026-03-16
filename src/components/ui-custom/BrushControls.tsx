import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import type { BrushSettings } from '@/hooks/useWebGLPaint';

interface BrushControlsProps {
  brushSettings: BrushSettings;
  onBrushSettingsChange: (settings: BrushSettings) => void;
}

export const BrushControls: React.FC<BrushControlsProps> = ({
  brushSettings,
  onBrushSettingsChange,
}) => {
  const handleSizeChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, size: value[0] });
  };

  const handleHardnessChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, hardness: value[0] });
  };

  return (
    <div className="space-y-6 p-5 bg-[#09090b] rounded-xl border border-white/5 shadow-lg">
      <h3 className="text-zinc-100 font-semibold text-sm tracking-wide uppercase">Quick Settings</h3>
      
      {/* Brush Size */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-zinc-400 text-xs tracking-wide">SIZE</Label>
          <span className="text-zinc-500 font-mono text-[10px]">{brushSettings.size}PX</span>
        </div>
        <Slider
          value={[brushSettings.size]}
          onValueChange={handleSizeChange}
          min={1}
          max={100}
          step={1}
          className="w-full"
        />
      </div>

      {/* Brush Hardness */}
      <div className="space-y-4 pt-4 border-t border-white/10">
        <div className="flex justify-between items-center px-1">
          <span className="text-sm font-medium text-zinc-300">Hardness</span>
          <span className="text-sm text-zinc-500 w-12 text-right">
            {(brushSettings.hardness * 100).toFixed(0)}%
          </span>
        </div>
        <Slider
          value={[brushSettings.hardness]}
          onValueChange={handleHardnessChange}
          min={0.01}
          max={1}
          step={0.01}
          className="w-full"
        />
      </div>

      {/* Brush Spacing */}
      <div className="space-y-4 pt-4 border-t border-white/10">
        <div className="flex justify-between items-center px-1">
          <span className="text-sm font-medium text-zinc-300">Spacing</span>
          <span className="text-sm text-zinc-500 w-12 text-right">
            {(brushSettings.spacing * 100).toFixed(0)}%
          </span>
        </div>
        <Slider
          value={[brushSettings.spacing]}
          onValueChange={(val) => onBrushSettingsChange({ ...brushSettings, spacing: val[0] })}
          min={0.01}
          max={2}
          step={0.01}
          className="w-full"
        />
      </div>

      {/* Dynamics */}
      <div className="space-y-4 pt-4 border-t border-white/10">
        <Label className="text-zinc-400 text-xs tracking-wide">DYNAMICS</Label>
        <div className="flex items-center justify-between bg-zinc-900/50 p-2 rounded-lg border border-white/5">
          <span className="text-xs text-zinc-300">Follow Path (Rotation)</span>
          <button
            onClick={() => onBrushSettingsChange({ ...brushSettings, followPath: !brushSettings.followPath })}
            className={`w-10 h-5 rounded-full relative transition-colors ${brushSettings.followPath ? 'bg-emerald-500' : 'bg-zinc-700'}`}
          >
            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${brushSettings.followPath ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

      </div>
    </div>
  );
};
