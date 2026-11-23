import type { AiState } from '../shared/messages';
import type { LookSettings } from '../shared/settings';

export interface OverlayStats {
  fps: number;
  width: number;
  height: number;
  ai: AiState;
}

const AI_LABEL: Record<AiState, string> = {
  off: '',
  loading: 'AI loading',
  ready: 'AI',
  unavailable: 'AI unavailable',
};

/**
 * Draws the optional watermark and stats readout into a transparent 2D canvas.
 * The renderer uploads that canvas as a texture and composites it over the
 * processed frame, so the overlay ends up inside the captured video track.
 */
export class OverlayRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.context = this.canvas.getContext('2d');
  }

  draw(settings: LookSettings, stats: OverlayStats): HTMLCanvasElement | null {
    if (!settings.masterEnabled) return null;
    if (!settings.watermark && !settings.showStats) return null;
    if (stats.width < 2 || stats.height < 2) return null;

    if (this.canvas.width !== stats.width || this.canvas.height !== stats.height) {
      this.canvas.width = stats.width;
      this.canvas.height = stats.height;
    }

    const ctx = this.context;
    if (!ctx) return null;
    ctx.clearRect(0, 0, stats.width, stats.height);

    // Keep the overlay legible from 480p up to 1080p without covering the frame.
    const scale = Math.max(0.75, Math.min(2, stats.height / 480));
    if (settings.showStats) this.drawStats(ctx, stats, scale);
    if (settings.watermark) this.drawWatermark(ctx, stats, scale);
    return this.canvas;
  }

  dispose(): void {
    // The canvas is garbage collected with the pipeline; drop the reference.
    this.canvas.width = 2;
    this.canvas.height = 2;
  }

  private drawStats(
    ctx: CanvasRenderingContext2D,
    stats: OverlayStats,
    scale: number,
  ): void {
    const fontSize = Math.round(12 * scale);
    const pad = Math.round(8 * scale);
    const ai = AI_LABEL[stats.ai];
    const label = `${stats.width}×${stats.height}  ${Math.round(stats.fps)} fps${
      ai ? `  ${ai}` : ''
    }`;

    ctx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const height = fontSize + pad * 1.6;
    const width = textWidth + pad * 2;
    const x = pad;
    const y = pad;

    ctx.fillStyle = 'rgba(8, 9, 12, 0.58)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(label, x + pad, y + height / 2);
  }

  private drawWatermark(
    ctx: CanvasRenderingContext2D,
    stats: OverlayStats,
    scale: number,
  ): void {
    const fontSize = Math.round(13 * scale);
    const padX = 10 * scale;
    const dot = 5 * scale;
    const gap = 7 * scale;
    const margin = 14 * scale;
    const text = 'LookGood';

    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(text).width;
    const height = fontSize + 11 * scale;
    const width = padX * 2 + dot + gap + textWidth;
    const x = stats.width - width - margin;
    const y = stats.height - height - margin;

    ctx.fillStyle = 'rgba(8, 9, 12, 0.58)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();

    ctx.fillStyle = '#ffb27a';
    ctx.beginPath();
    ctx.arc(x + padX + dot / 2, y + height / 2, dot / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(text, x + padX + dot + gap, y + height / 2);
  }
}
