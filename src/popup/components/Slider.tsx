import type { CSSProperties } from 'react';

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ai?: boolean;
  hint?: string;
}

export function Slider({
  label,
  value,
  onChange,
  disabled,
  ai,
  hint,
}: SliderProps) {
  const id = `slider-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div
      className={`px-3.5 py-2.5 transition-opacity ${
        disabled ? 'opacity-45' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-200"
          title={hint}
        >
          {label}
          {ai ? (
            <span className="rounded border border-accent/25 px-[3px] py-px text-[9px] leading-none font-semibold text-accent/80">
              AI
            </span>
          ) : null}
        </label>
        <span
          className={`font-mono text-[10.5px] tabular-nums ${
            value === 0 ? 'text-zinc-600' : 'text-zinc-400'
          }`}
        >
          {value === 0 ? 'Off' : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="lg-range mt-2.5"
        style={{ '--fill': `${value}%` } as CSSProperties}
      />
    </div>
  );
}
