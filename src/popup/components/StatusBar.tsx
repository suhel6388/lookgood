import type { EngineStatus } from '../../shared/messages';

interface StatusBarProps {
  status: EngineStatus;
  supported: boolean;
  masterEnabled: boolean;
  aiNeeded: boolean;
}

interface Description {
  tone: 'live' | 'idle' | 'warn' | 'off';
  title: string;
  detail: string;
  note?: string;
}

function aiNote(
  status: EngineStatus,
  supported: boolean,
  masterEnabled: boolean,
  aiNeeded: boolean,
): string | undefined {
  if (!supported || !masterEnabled || !aiNeeded) return undefined;
  if (status.ai === 'unavailable') {
    return 'AI effects are unavailable on this page. Color, light and sharpen still work.';
  }
  if (status.ai === 'loading') return 'Loading the on-device AI models…';
  return undefined;
}

function describe(
  status: EngineStatus,
  supported: boolean,
  masterEnabled: boolean,
  aiNeeded: boolean,
): Description {
  const note = aiNote(status, supported, masterEnabled, aiNeeded);
  if (!supported) {
    return {
      tone: 'off',
      title: 'Not available on this page',
      detail: 'Preview works here; effects apply on Meet, Zoom, Teams or Discord.',
    };
  }
  if (!masterEnabled) {
    return {
      tone: 'off',
      title: 'Paused',
      detail: 'Your camera is passed through untouched.',
    };
  }
  if (status.state === 'error') {
    return {
      tone: 'warn',
      title: 'Falling back to your raw camera',
      detail: status.error ?? 'The effect pipeline could not start.',
      note,
    };
  }
  if (status.state === 'active') {
    const size =
      status.width > 0 && status.height > 0
        ? `${status.width}×${status.height}`
        : '';
    const ai =
      status.ai === 'ready'
        ? 'AI ready'
        : status.ai === 'loading'
          ? 'AI loading'
          : status.ai === 'unavailable'
            ? 'AI off'
            : '';
    const parts = [
      size,
      status.fps > 0 ? `${Math.round(status.fps)} fps` : '',
      ai,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      tone: 'live',
      title: 'Live on this tab',
      detail: parts || status.deviceLabel || 'Enhancing your camera',
      note,
    };
  }
  if (status.state === 'bypassed') {
    return {
      tone: 'idle',
      title: 'Waiting for an effect',
      detail: 'Turn a slider up to start processing.',
      note,
    };
  }
  return {
    tone: 'idle',
    title: 'Ready when you are',
    detail: 'Join a call and turn your camera on.',
    note,
  };
}

const TONE_STYLES: Record<string, string> = {
  live: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]',
  idle: 'bg-zinc-500',
  warn: 'bg-red-400 shadow-[0_0_0_3px_rgba(248,113,113,0.14)]',
  off: 'bg-zinc-600',
};

export function StatusBar({
  status,
  supported,
  masterEnabled,
  aiNeeded,
}: StatusBarProps) {
  const { tone, title, detail, note } = describe(
    status,
    supported,
    masterEnabled,
    aiNeeded,
  );
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <span
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${TONE_STYLES[tone]}`}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-[12px] leading-tight font-medium text-zinc-200">
          {title}
        </p>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-zinc-500">
          {detail}
        </p>
        {note ? (
          <p className="mt-1 text-[10px] leading-snug text-amber-300/75">{note}</p>
        ) : null}
      </div>
    </div>
  );
}
