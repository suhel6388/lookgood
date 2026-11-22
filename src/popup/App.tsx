import { useEffect } from 'react';
import {
  AI_EFFECT_KEYS,
  matchPreset,
  type SliderKey,
} from '../shared/settings';
import { PresetPicker } from './components/PresetPicker';
import { Slider } from './components/Slider';
import { StatusBar } from './components/StatusBar';
import { Switch } from './components/Switch';
import { usePopupStore } from './store';

const EFFECTS: { key: SliderKey; label: string; hint: string }[] = [
  {
    key: 'skinSmoothing',
    label: 'Skin smoothing',
    hint: 'Softens skin texture while keeping facial edges crisp.',
  },
  {
    key: 'colorCorrection',
    label: 'Color',
    hint: 'Saturation and contrast, tuned for video calls.',
  },
  {
    key: 'lightCorrection',
    label: 'Light',
    hint: 'Lifts shadows and tames blown highlights.',
  },
  {
    key: 'sharpening',
    label: 'Sharpen',
    hint: 'A light unsharp mask for crisper detail.',
  },
  {
    key: 'portraitLighting',
    label: 'Portrait light',
    hint: 'Brightens you and gently dims the room behind you.',
  },
  {
    key: 'backgroundBlur',
    label: 'Background blur',
    hint: 'Blurs everything that is not a person.',
  },
];

function Logo() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#2a1b12] to-[#14161c] ring-1 ring-white/10">
      <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden>
        <defs>
          <linearGradient id="lg-lens" x1="4" y1="4" x2="20" y2="20">
            <stop offset="0%" stopColor="#ffe0c7" />
            <stop offset="100%" stopColor="#ff8f5c" />
          </linearGradient>
        </defs>
        <circle
          cx="12"
          cy="12"
          r="7.6"
          fill="none"
          stroke="url(#lg-lens)"
          strokeWidth="2.1"
        />
        <circle cx="12" cy="12" r="2.4" fill="#ffe6d3" />
        <circle cx="9.6" cy="9.4" r="0.9" fill="#fff" opacity="0.9" />
      </svg>
    </div>
  );
}

export default function App() {
  const settings = usePopupStore((state) => state.settings);
  const status = usePopupStore((state) => state.status);
  const supported = usePopupStore((state) => state.supported);
  const setSlider = usePopupStore((state) => state.setSlider);
  const setMaster = usePopupStore((state) => state.setMaster);
  const setPreset = usePopupStore((state) => state.setPreset);
  const reset = usePopupStore((state) => state.reset);
  const hydrate = usePopupStore((state) => state.hydrate);
  const refreshStatus = usePopupStore((state) => state.refreshStatus);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshStatus();
    }, 2000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const activePreset = matchPreset(settings);
  const disabled = !settings.masterEnabled;

  return (
    <div className="flex min-h-[420px] w-[360px] flex-col bg-[#0a0b0f]">
      <header className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="flex items-baseline gap-2">
            <h1 className="text-[14px] leading-none font-semibold tracking-[-0.01em] text-zinc-50">
              LookGood
            </h1>
            <span className="flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-[3px] text-[9.5px] leading-none font-medium text-accent/90">
              <span className="h-1 w-1 rounded-full bg-accent" />
              Live
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">
            {settings.masterEnabled ? 'On' : 'Off'}
          </span>
          <Switch
            checked={settings.masterEnabled}
            onChange={setMaster}
            label="Enable LookGood on this tab"
          />
        </div>
      </header>

      <main className="flex flex-col gap-3 px-4 pb-4">
        <StatusBar
          status={status}
          supported={supported}
          masterEnabled={settings.masterEnabled}
        />

        <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#101218]">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-3.5 py-2.5">
            <h2 className="text-[11px] font-medium text-zinc-400">Effects</h2>
            <button
              type="button"
              onClick={reset}
              className="text-[10.5px] text-zinc-600 transition-colors hover:text-zinc-300"
            >
              Reset all
            </button>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {EFFECTS.map((effect) => (
              <Slider
                key={effect.key}
                label={effect.label}
                hint={effect.hint}
                ai={AI_EFFECT_KEYS.includes(effect.key)}
                value={settings[effect.key]}
                disabled={disabled}
                onChange={(value) => setSlider(effect.key, value)}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-0.5 text-[11px] font-medium text-zinc-500">
            Presets
          </h2>
          <PresetPicker active={activePreset} onSelect={setPreset} />
        </section>

        <footer className="mt-1 flex items-center justify-between border-t border-white/[0.05] pt-3">
          <p className="flex items-center gap-1.5 text-[10.5px] text-zinc-600">
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden
            >
              <path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7" />
              <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.6" />
            </svg>
            Video never leaves your device
          </p>
          <span className="text-[10px] text-zinc-700">v0.1.0</span>
        </footer>
      </main>
    </div>
  );
}
