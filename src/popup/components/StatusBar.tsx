import type { EngineStatus } from '../../shared/messages';

interface StatusBarProps {
  status: EngineStatus;
  supported: boolean;
  masterEnabled: boolean;
}

function describe(
  status: EngineStatus,
  supported: boolean,
  masterEnabled: boolean,
): { tone: 'live' | 'idle' | 'warn' | 'off'; title: string; detail: string } {
  if (!supported) {
    return {
      tone: 'off',
      title: 'Not available on this page',
      detail: 'Open Meet, Zoom, Teams or Discord to go live.',
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
    };
  }
  if (status.state === 'active') {
    const size =
      status.width > 0 && status.height > 0
        ? `${status.width}×${status.height}`
        : '';
    const parts = [size, status.fps > 0 ? `${Math.round(status.fps)} fps` : '']
      .filter(Boolean)
      .join(' · ');
    return {
      tone: 'live',
      title: 'Live on this tab',
      detail: parts || status.deviceLabel || 'Enhancing your camera',
    };
  }
  if (status.state === 'bypassed') {
    return {
      tone: 'idle',
      title: 'Waiting for an effect',
      detail: 'Turn a slider up to start processing.',
    };
  }
  return {
    tone: 'idle',
    title: 'Ready when you are',
    detail: 'Join a call and turn your camera on.',
  };
}

const TONE_STYLES: Record<string, string> = {
  live: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]',
  idle: 'bg-zinc-500',
  warn: 'bg-red-400 shadow-[0_0_0_3px_rgba(248,113,113,0.14)]',
  off: 'bg-zinc-600',
};

export function StatusBar({ status, supported, masterEnabled }: StatusBarProps) {
  const { tone, title, detail } = describe(status, supported, masterEnabled);
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
      </div>
    </div>
  );
}
