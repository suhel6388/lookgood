import { PRESETS, type PresetId } from '../../shared/settings';

const LABELS: Record<PresetId, string> = {
  off: 'Off',
  natural: 'Natural',
  studio: 'Studio',
  soft: 'Soft',
};

interface PresetPickerProps {
  active: PresetId | null;
  onSelect: (preset: PresetId) => void;
}

export function PresetPicker({ active, onSelect }: PresetPickerProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {(Object.keys(PRESETS) as PresetId[]).map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onSelect(preset)}
          aria-pressed={active === preset}
          className={`rounded-lg border py-1.5 text-[11px] font-medium transition-colors ${
            active === preset
              ? 'border-accent/30 bg-accent/15 text-accent'
              : 'border-white/[0.06] bg-white/[0.03] text-zinc-400 hover:border-white/10 hover:text-zinc-200'
          }`}
        >
          {LABELS[preset]}
        </button>
      ))}
    </div>
  );
}
