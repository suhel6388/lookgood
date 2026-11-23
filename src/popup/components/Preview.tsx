import { useEffect, useRef, useState } from 'react';
import { VideoPipeline } from '../../engine/pipeline';
import type { AiState } from '../../shared/messages';
import { usePopupStore } from '../store';

interface PreviewStats {
  fps: number;
  width: number;
  height: number;
  ai: AiState;
}

const EMPTY_STATS: PreviewStats = { fps: 0, width: 0, height: 0, ai: 'off' };

function describeState(
  enabled: boolean,
  starting: boolean,
  error: string | null,
  stats: PreviewStats,
): string {
  if (error) return 'Camera unavailable';
  if (starting) return 'Starting camera…';
  if (!enabled) return 'See the effects before you join';
  if (stats.ai === 'loading') return 'Loading AI models…';
  if (stats.ai === 'unavailable') return 'AI effects unavailable here';
  if (stats.width > 0) {
    const fps = stats.fps > 0 ? ` · ${Math.round(stats.fps)} fps` : '';
    const ai = stats.ai === 'ready' ? ' · AI' : '';
    return `${stats.width}×${stats.height}${fps}${ai}`;
  }
  return 'Warming up…';
}

/**
 * Popup-local camera preview. It runs the same VideoPipeline as the page hook,
 * but on a stream fetched by the popup itself, so the preview shows exactly
 * what the site would receive.
 */
export function Preview() {
  const enabled = usePopupStore((state) => state.previewEnabled);
  const togglePreview = usePopupStore((state) => state.togglePreview);
  const settings = usePopupStore((state) => state.settings);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipelineRef = useRef<VideoPipeline | null>(null);
  const [stats, setStats] = useState<PreviewStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let pipeline: VideoPipeline | null = null;
    setStarting(true);
    setError(null);
    setStats(EMPTY_STATS);

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        pipeline = new VideoPipeline({
          stream,
          settings: usePopupStore.getState().settings,
          assetBase: chrome.runtime.getURL(''),
          fps: 30,
          onChange: () => {
            if (cancelled || !pipeline) return;
            if (!pipeline.active) {
              setError(pipeline.error ?? 'The preview pipeline stopped.');
            }
            setStats({
              fps: pipeline.fps,
              width: pipeline.width,
              height: pipeline.height,
              ai: pipeline.ai,
            });
          },
        });
        await pipeline.start();
        if (cancelled) {
          pipeline.stop();
          return;
        }

        pipelineRef.current = pipeline;
        const video = videoRef.current;
        if (video) {
          video.srcObject = pipeline.outputStream;
          await video.play().catch(() => {});
        }
        setStats({
          fps: pipeline.fps,
          width: pipeline.width,
          height: pipeline.height,
          ai: pipeline.ai,
        });
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        usePopupStore.getState().togglePreview();
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      pipelineRef.current = null;
      pipeline?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled]);

  useEffect(() => {
    pipelineRef.current?.updateSettings(settings);
  }, [settings]);

  const detail = describeState(enabled, starting, error, stats);

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#101218]">
      <div
        className={`relative w-full overflow-hidden bg-[#05060a] ${
          enabled ? 'aspect-video' : 'h-[92px]'
        }`}
      >
        <video
          id="preview-video"
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
            enabled ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {!enabled ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6 text-zinc-700"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden
            >
              <rect x="2.5" y="6" width="13" height="12" rx="2.4" />
              <path d="m15.5 11 6-3v8l-6-3" />
            </svg>
            <p className="text-[10.5px] text-zinc-600">Camera off</p>
          </div>
        ) : null}

        {enabled && !starting && !error ? (
          <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-[3px] text-[9.5px] leading-none font-medium text-white/85">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Preview
          </span>
        ) : null}

        {enabled && stats.width > 0 && !error ? (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/55 px-1.5 py-1 font-mono text-[9px] leading-none text-white/75">
            {stats.width}×{stats.height}
            {stats.fps > 0 ? ` · ${Math.round(stats.fps)} fps` : ''}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-zinc-200">Live preview</p>
          <p
            id="preview-state"
            className={`truncate text-[10px] ${
              error ? 'text-amber-300/80' : 'text-zinc-500'
            }`}
            title={error ?? undefined}
          >
            {detail}
          </p>
        </div>
        <button
          id="preview-toggle"
          type="button"
          onClick={togglePreview}
          className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10.5px] font-medium transition-colors ${
            enabled
              ? 'border-white/10 bg-white/[0.06] text-zinc-200 hover:bg-white/[0.1]'
              : 'border-accent/25 bg-accent/15 text-accent hover:bg-accent/20'
          }`}
        >
          {enabled ? 'Stop' : 'Preview'}
        </button>
      </div>

      {error ? (
        <p className="border-t border-white/[0.05] px-3 py-2 text-[10px] leading-snug text-amber-300/75">
          {error}
        </p>
      ) : null}
    </section>
  );
}
