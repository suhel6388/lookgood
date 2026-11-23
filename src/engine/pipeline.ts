import type { AiState } from '../shared/messages';
import type { LookSettings } from '../shared/settings';
import { AiProcessor } from './ai';
import { OverlayRenderer } from './overlay';
import { FrameRenderer } from './renderer';

export interface PipelineOptions {
  stream: MediaStream;
  settings: LookSettings;
  assetBase: string;
  fps?: number;
  onChange?: () => void;
  onDispose?: () => void;
}

const MAX_DIMENSION = 1920;
const METADATA_TIMEOUT_MS = 8000;

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Turns a raw camera stream into a processed one.
 *
 * The raw video track feeds a hidden <video>; every presented frame is drawn to
 * a WebGL canvas, and canvas.captureStream() becomes the track the site sees.
 * Audio tracks are handed through untouched.
 */
export class VideoPipeline {
  private readonly rawStream: MediaStream;
  private readonly rawVideoTrack: MediaStreamTrack | null;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: FrameRenderer | null = null;
  private aiProcessor: AiProcessor | null = null;
  private overlay: OverlayRenderer | null = null;
  private output: MediaStream | null = null;
  private settings: LookSettings;
  private readonly assetBase: string;
  private readonly captureFps: number;
  private readonly onChange?: () => void;
  private readonly onDispose?: () => void;

  private running = false;
  private disposed = false;
  private videoFrameCallback: number | null = null;
  private animationFrame: number | null = null;
  private frameCount = 0;
  private fpsWindowStart = 0;
  private measuredFps = 0;
  private errorMessage: string | undefined;

  constructor(options: PipelineOptions) {
    this.rawStream = options.stream;
    this.rawVideoTrack = options.stream.getVideoTracks()[0] ?? null;
    this.settings = options.settings;
    this.assetBase = options.assetBase;
    this.captureFps = Math.min(60, Math.max(5, options.fps ?? options.settings.targetFps));
    this.onChange = options.onChange;
    this.onDispose = options.onDispose;

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.setAttribute('aria-hidden', 'true');
    this.video.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    this.video.srcObject = options.stream;

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.width = 2;
    this.canvas.height = 2;
  }

  get outputStream(): MediaStream {
    if (!this.output) throw new Error('pipeline has not started');
    return this.output;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  get fps(): number {
    return this.measuredFps;
  }

  get ai(): AiState {
    return this.aiProcessor?.status ?? 'off';
  }

  get deviceLabel(): string {
    return this.rawVideoTrack?.label ?? '';
  }

  get error(): string | undefined {
    return this.errorMessage;
  }

  get active(): boolean {
    return this.running;
  }

  get currentSettings(): LookSettings {
    return this.settings;
  }

  async start(): Promise<void> {
    if (!this.rawVideoTrack) throw new Error('stream has no video track');

    await this.waitForMetadata();

    const sourceWidth = this.video.videoWidth || 1280;
    const sourceHeight = this.video.videoHeight || 720;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = even(sourceWidth * scale);
    const height = even(sourceHeight * scale);

    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new FrameRenderer(this.canvas);
    this.renderer.resize(width, height);

    this.aiProcessor = new AiProcessor(this.assetBase, () => this.onChange?.());
    void this.aiProcessor.ensure(this.settings);
    this.overlay = new OverlayRenderer();

    const captured = this.canvas.captureStream(this.captureFps);
    const track = captured.getVideoTracks()[0];
    if (!track) throw new Error('canvas.captureStream() produced no video track');
    track.contentHint = 'motion';

    this.decorateTrack(track, this.rawVideoTrack);

    const audio = this.rawStream.getAudioTracks();
    this.output = new MediaStream([track, ...audio]);

    this.rawVideoTrack.addEventListener('ended', this.handleRawEnded);
    this.video.addEventListener('resize', this.handleResize);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);

    this.running = true;
    this.fpsWindowStart = performance.now();
    this.renderFrame();
    this.schedule();
    this.onChange?.();
  }

  updateSettings(settings: LookSettings): void {
    this.settings = settings;
    void this.aiProcessor?.ensure(settings);
    this.onChange?.();
  }

  /** Stops the video side only; audio tracks stay with the site. */
  stop(): void {
    this.teardown(true);
  }

  /**
   * Releases our resources but leaves the raw camera running, so the caller can
   * still hand the untouched stream to the site after a failed start.
   */
  abort(): void {
    this.teardown(false);
  }

  private teardown(stopRaw: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;

    if (this.videoFrameCallback !== null) {
      this.video.cancelVideoFrameCallback?.(this.videoFrameCallback);
      this.videoFrameCallback = null;
    }
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.rawVideoTrack?.removeEventListener('ended', this.handleRawEnded);
    this.video.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);

    this.renderer?.dispose();
    this.renderer = null;
    this.aiProcessor?.dispose();
    this.aiProcessor = null;
    this.overlay?.dispose();
    this.overlay = null;

    if (stopRaw) {
      try {
        this.rawVideoTrack?.stop();
      } catch {
        /* already stopped */
      }
    }
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
    this.onDispose?.();
    this.onChange?.();
  }

  private waitForMetadata(): Promise<void> {
    const video = this.video;
    void video.play().catch(() => {});
    if (video.videoWidth > 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('camera did not produce frames in time'));
      }, METADATA_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('resize', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        if (video.videoWidth === 0) return;
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('the camera stream could not be decoded'));
      };

      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('resize', onReady);
      video.addEventListener('error', onError);
      video.play().catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private schedule(): void {
    if (!this.running) return;
    const video = this.video;
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.videoFrameCallback = video.requestVideoFrameCallback(() => {
        this.videoFrameCallback = null;
        this.renderFrame();
        this.schedule();
      });
    } else {
      this.animationFrame = requestAnimationFrame(() => {
        this.animationFrame = null;
        this.renderFrame();
        this.schedule();
      });
    }
  }

  private renderFrame(): void {
    if (!this.running || !this.renderer) return;
    const now = performance.now();
    try {
      const aiFrame = this.aiProcessor?.tick(this.video, this.settings, now);
      if (aiFrame?.person) this.renderer.setPersonMask(aiFrame.person);
      if (aiFrame?.face) this.renderer.setFaceMask(aiFrame.face);
      const overlay =
        this.overlay?.draw(this.settings, {
          fps: this.measuredFps,
          width: this.canvas.width,
          height: this.canvas.height,
          ai: this.ai,
        }) ?? null;
      this.renderer.setOverlay(overlay);
      this.renderer.render(this.video, this.settings);
    } catch (error) {
      this.fail(error);
      return;
    }

    this.frameCount += 1;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.measuredFps = (this.frameCount * 1000) / elapsed;
      this.frameCount = 0;
      this.fpsWindowStart = now;
      this.onChange?.();
    }
  }

  private fail(error: unknown): void {
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.stop();
  }

  private handleRawEnded = (): void => {
    this.stop();
  };

  private handleResize = (): void => {
    if (!this.renderer) return;
    const width = even(this.video.videoWidth);
    const height = even(this.video.videoHeight);
    if (width < 2 || height < 2) return;
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.renderer.resize(width, height);
    this.onChange?.();
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.fail(new Error('the GPU context was lost'));
  };

  private decorateTrack(
    processed: MediaStreamTrack,
    raw: MediaStreamTrack,
  ): void {
    const rawSettings = raw.getSettings();
    const originalGetSettings = processed.getSettings.bind(processed);
    processed.getSettings = () => ({
      ...rawSettings,
      ...originalGetSettings(),
      width: this.canvas.width,
      height: this.canvas.height,
      frameRate: this.captureFps,
      deviceId: rawSettings.deviceId,
      facingMode: rawSettings.facingMode,
    });

    if (typeof processed.getCapabilities === 'function') {
      const originalGetCapabilities = processed.getCapabilities.bind(processed);
      processed.getCapabilities = () => ({
        ...(originalGetCapabilities() ?? {}),
        ...(raw.getCapabilities?.() ?? {}),
      });
    }

    const originalGetConstraints = processed.getConstraints.bind(processed);
    processed.getConstraints = () => {
      try {
        return raw.getConstraints();
      } catch {
        return originalGetConstraints();
      }
    };

    const originalApply = processed.applyConstraints.bind(processed);
    processed.applyConstraints = async (constraints?: MediaTrackConstraints) => {
      const requested = constraints ?? {};
      if (requested.deviceId !== undefined) {
        await raw.applyConstraints({ deviceId: requested.deviceId });
      }
      if (typeof requested.width === 'number' || typeof requested.height === 'number') {
        const width =
          typeof requested.width === 'number' ? requested.width : this.canvas.width;
        const height =
          typeof requested.height === 'number'
            ? requested.height
            : this.canvas.height;
        this.renderer?.resize(even(width), even(height));
      }
      // Resolution changes to the canvas track itself are not supported by
      // every browser; the resize above is what actually takes effect.
      await originalApply({}).catch(() => {});
      this.onChange?.();
    };

    const originalStop = processed.stop.bind(processed);
    processed.stop = () => {
      this.stop();
      originalStop();
    };

    try {
      Object.defineProperty(processed, 'label', {
        configurable: true,
        get: () => raw.label,
      });
    } catch {
      /* label is informational only */
    }
  }
}
