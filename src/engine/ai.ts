import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';
import type { AiState } from '../shared/messages';
import {
  needsFaceLandmarks,
  needsSegmentation,
  type LookSettings,
} from '../shared/settings';

/**
 * MediaPipe Tasks Vision wrapper.
 *
 * Both models are loaded lazily, only when an effect that needs them is turned
 * up, and inference is throttled independently of the render loop. The person
 * mask is returned as an R8 byte buffer; the face mask is a feathered canvas
 * built from the face-oval landmarks.
 */

/** The 36 face-oval landmarks, in clockwise order starting at the forehead. */
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

const FACE_MASK_WIDTH = 192;
const FACE_OVAL_SCALE = 1.07;

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface PersonMask {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface AiFrame {
  person?: PersonMask;
  face?: HTMLCanvasElement;
}

export class AiProcessor {
  private readonly assetBase: string;
  private readonly onStateChange: () => void;
  private state: AiState = 'off';
  private error: string | undefined;
  private failed = false;

  private filesetPromise: Promise<WasmFileset> | null = null;
  private segmenter: ImageSegmenter | null = null;
  private landmarker: FaceLandmarker | null = null;
  private loading: Promise<void> | null = null;

  private personMask: Uint8Array = new Uint8Array(0);
  private personWidth = 0;
  private personHeight = 0;

  private faceCanvas: HTMLCanvasElement | null = null;
  private faceContext: CanvasRenderingContext2D | null = null;

  private lastSegmentAt = 0;
  private lastFaceAt = 0;
  private lastTimestamp = 0;
  private disposed = false;

  constructor(assetBase: string, onStateChange: () => void) {
    this.assetBase = assetBase;
    this.onStateChange = onStateChange;
  }

  get status(): AiState {
    return this.state;
  }

  get lastError(): string | undefined {
    return this.error;
  }

  /** Loads whatever the current settings need. Safe to call repeatedly. */
  ensure(settings: LookSettings): Promise<void> {
    if (this.disposed || this.failed || !this.assetBase) return Promise.resolve();

    const wantSegmenter = needsSegmentation(settings);
    const wantLandmarker = needsFaceLandmarks(settings);
    if (!wantSegmenter && !wantLandmarker) {
      this.setState('off');
      return Promise.resolve();
    }
    if (
      (wantSegmenter ? this.segmenter !== null : true) &&
      (wantLandmarker ? this.landmarker !== null : true)
    ) {
      this.setState('ready');
      return Promise.resolve();
    }
    if (this.loading) return this.loading;

    this.setState('loading');
    this.loading = this.load(wantSegmenter, wantLandmarker).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /**
   * Runs inference when due and returns fresh masks. Returns null when there is
   * nothing new to upload this frame.
   */
  tick(video: HTMLVideoElement, settings: LookSettings, now: number): AiFrame | null {
    if (this.state !== 'ready' || this.disposed) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    const interval = 1000 / Math.max(1, settings.aiFps);
    const frame: AiFrame = {};
    let produced = false;

    if (this.segmenter && needsSegmentation(settings) && now - this.lastSegmentAt >= interval) {
      this.lastSegmentAt = now;
      const mask = this.segment(video, now);
      if (mask) {
        frame.person = mask;
        produced = true;
      }
    }

    if (this.landmarker && needsFaceLandmarks(settings) && now - this.lastFaceAt >= interval) {
      this.lastFaceAt = now;
      const canvas = this.detectFace(video, now);
      if (canvas) {
        frame.face = canvas;
        produced = true;
      }
    }

    return produced ? frame : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.segmenter?.close();
    } catch {
      /* already closed */
    }
    try {
      this.landmarker?.close();
    } catch {
      /* already closed */
    }
    this.segmenter = null;
    this.landmarker = null;
    this.setState('off');
  }

  private async load(wantSegmenter: boolean, wantLandmarker: boolean): Promise<void> {
    try {
      this.filesetPromise ??= FilesetResolver.forVisionTasks(
        `${this.assetBase}mediapipe/wasm`,
        false,
      );
      const fileset = await this.filesetPromise;

      if (wantSegmenter && !this.segmenter) {
        this.segmenter = await this.createSegmenter(fileset);
      }
      if (wantLandmarker && !this.landmarker) {
        this.landmarker = await this.createLandmarker(fileset);
      }
      if (this.disposed) return;
      this.error = undefined;
      this.setState('ready');
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.failed = true;
      this.setState('unavailable');
    }
  }

  private async createSegmenter(fileset: WasmFileset): Promise<ImageSegmenter> {
    const options = {
      baseOptions: {
        modelAssetPath: `${this.assetBase}models/selfie_segmenter.tflite`,
      },
      runningMode: 'VIDEO' as const,
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    };
    try {
      return await ImageSegmenter.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' as const },
      });
    } catch {
      return ImageSegmenter.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
      });
    }
  }

  private async createLandmarker(fileset: WasmFileset): Promise<FaceLandmarker> {
    const options = {
      baseOptions: {
        modelAssetPath: `${this.assetBase}models/face_landmarker.task`,
      },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
    };
    try {
      return await FaceLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' as const },
      });
    } catch {
      return FaceLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
      });
    }
  }

  private timestamp(now: number): number {
    // MediaPipe requires strictly increasing timestamps per video stream.
    this.lastTimestamp = Math.max(Math.round(now), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  private segment(video: HTMLVideoElement, now: number): PersonMask | null {
    if (!this.segmenter) return null;
    let result;
    try {
      result = this.segmenter.segmentForVideo(video, this.timestamp(now));
    } catch (error) {
      this.fail(error);
      return null;
    }

    const masks = result.confidenceMasks;
    // The binary selfie model exposes one mask (person). The multiclass model
    // exposes background first and person last.
    const mask = masks && masks.length > 0 ? masks[masks.length - 1] : undefined;
    if (!mask) return null;

    try {
      const width = mask.width;
      const height = mask.height;
      const values = mask.getAsFloat32Array();
      if (this.personMask.length !== width * height) {
        this.personMask = new Uint8Array(width * height);
      }
      for (let i = 0; i < values.length; i += 1) {
        const value = values[i] ?? 0;
        this.personMask[i] = Math.round(Math.min(1, Math.max(0, value)) * 255);
      }
      this.personWidth = width;
      this.personHeight = height;
      return {
        data: this.personMask,
        width: this.personWidth,
        height: this.personHeight,
      };
    } finally {
      mask.close();
    }
  }

  private detectFace(video: HTMLVideoElement, now: number): HTMLCanvasElement | null {
    if (!this.landmarker) return null;
    let result;
    try {
      result = this.landmarker.detectForVideo(video, this.timestamp(now));
    } catch (error) {
      this.fail(error);
      return null;
    }

    const canvas = this.ensureFaceCanvas(video);
    const context = this.faceContext;
    if (!canvas || !context) return null;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const landmarks = result.faceLandmarks?.[0];
    if (!landmarks || landmarks.length === 0) return canvas;

    let cx = 0;
    let cy = 0;
    const points: [number, number][] = [];
    for (const index of FACE_OVAL) {
      const point = landmarks[index];
      if (!point) continue;
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      points.push([x, y]);
      cx += x;
      cy += y;
    }
    if (points.length < 3) return canvas;
    cx /= points.length;
    cy /= points.length;

    context.save();
    context.filter = 'blur(5px)';
    context.fillStyle = '#fff';
    context.beginPath();
    points.forEach(([x, y], index) => {
      const px = cx + (x - cx) * FACE_OVAL_SCALE;
      const py = cy + (y - cy) * FACE_OVAL_SCALE;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.closePath();
    context.fill();
    context.restore();
    return canvas;
  }

  private ensureFaceCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
    const aspect = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.75;
    const height = Math.max(32, Math.round(FACE_MASK_WIDTH * aspect));
    if (
      !this.faceCanvas ||
      this.faceCanvas.height !== height ||
      this.faceCanvas.width !== FACE_MASK_WIDTH
    ) {
      this.faceCanvas = document.createElement('canvas');
      this.faceCanvas.width = FACE_MASK_WIDTH;
      this.faceCanvas.height = height;
      this.faceContext = this.faceCanvas.getContext('2d');
    }
    return this.faceCanvas;
  }

  private fail(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    this.failed = true;
    this.setState('unavailable');
  }

  private setState(state: AiState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange();
  }
}
