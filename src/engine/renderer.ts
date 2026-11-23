import type { LookSettings } from '../shared/settings';
import type { PersonMask } from './ai';
import {
  BACKGROUND_BLUR_UV,
  SKIN_BLUR_UV,
  blurStep,
  texelSize,
  toEffectUniforms,
} from './params';
import {
  BLUR_FRAGMENT,
  DOWNSCALE_FRAGMENT,
  EFFECTS_FRAGMENT,
  VERTEX_SHADER,
} from './shaders';

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not allocate shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('could not allocate program');
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function configureTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface EffectLocations {
  frame: WebGLUniformLocation | null;
  skinBlur: WebGLUniformLocation | null;
  backgroundBlur: WebGLUniformLocation | null;
  personMask: WebGLUniformLocation | null;
  faceMask: WebGLUniformLocation | null;
  overlay: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  master: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  light: WebGLUniformLocation | null;
  sharpen: WebGLUniformLocation | null;
  skin: WebGLUniformLocation | null;
  portrait: WebGLUniformLocation | null;
  background: WebGLUniformLocation | null;
  hasPerson: WebGLUniformLocation | null;
  hasFace: WebGLUniformLocation | null;
  hasOverlay: WebGLUniformLocation | null;
}

interface BlurLocations {
  source: WebGLUniformLocation | null;
  step: WebGLUniformLocation | null;
}

interface DownscaleLocations {
  source: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
}

/**
 * WebGL2 renderer. The final effect shader is single-pass; two downsampled blur
 * chains (half resolution for skin, quarter resolution for the background) feed
 * it, and the MediaPipe masks are uploaded as textures. Every effect is a
 * uniform, so changing a slider never recompiles anything.
 */
export class FrameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly effectsProgram: WebGLProgram;
  private readonly blurProgram: WebGLProgram;
  private readonly downscaleProgram: WebGLProgram;
  private readonly locations: EffectLocations;
  private readonly blurLocations: BlurLocations;
  private readonly downscaleLocations: DownscaleLocations;
  private readonly vao: WebGLVertexArrayObject;
  private readonly frameTexture: WebGLTexture;
  private readonly personMaskTexture: WebGLTexture;
  private readonly faceMaskTexture: WebGLTexture;
  private readonly overlayTexture: WebGLTexture;

  private skinA: RenderTarget | null = null;
  private skinB: RenderTarget | null = null;
  private backgroundA: RenderTarget | null = null;
  private backgroundB: RenderTarget | null = null;

  private hasPerson = false;
  private hasFace = false;
  private hasOverlay = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // canvas.captureStream() reads the drawing buffer after the frame.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this page');
    this.gl = gl;

    this.effectsProgram = link(gl, VERTEX_SHADER, EFFECTS_FRAGMENT);
    this.blurProgram = link(gl, VERTEX_SHADER, BLUR_FRAGMENT);
    this.downscaleProgram = link(gl, VERTEX_SHADER, DOWNSCALE_FRAGMENT);

    this.locations = {
      frame: gl.getUniformLocation(this.effectsProgram, 'uFrame'),
      skinBlur: gl.getUniformLocation(this.effectsProgram, 'uSkinBlur'),
      backgroundBlur: gl.getUniformLocation(this.effectsProgram, 'uBackgroundBlur'),
      personMask: gl.getUniformLocation(this.effectsProgram, 'uPersonMask'),
      faceMask: gl.getUniformLocation(this.effectsProgram, 'uFaceMask'),
      overlay: gl.getUniformLocation(this.effectsProgram, 'uOverlay'),
      texel: gl.getUniformLocation(this.effectsProgram, 'uTexel'),
      master: gl.getUniformLocation(this.effectsProgram, 'uMaster'),
      color: gl.getUniformLocation(this.effectsProgram, 'uColor'),
      light: gl.getUniformLocation(this.effectsProgram, 'uLight'),
      sharpen: gl.getUniformLocation(this.effectsProgram, 'uSharpen'),
      skin: gl.getUniformLocation(this.effectsProgram, 'uSkin'),
      portrait: gl.getUniformLocation(this.effectsProgram, 'uPortrait'),
      background: gl.getUniformLocation(this.effectsProgram, 'uBackground'),
      hasPerson: gl.getUniformLocation(this.effectsProgram, 'uHasPerson'),
      hasFace: gl.getUniformLocation(this.effectsProgram, 'uHasFace'),
      hasOverlay: gl.getUniformLocation(this.effectsProgram, 'uHasOverlay'),
    };
    this.blurLocations = {
      source: gl.getUniformLocation(this.blurProgram, 'uSource'),
      step: gl.getUniformLocation(this.blurProgram, 'uStep'),
    };
    this.downscaleLocations = {
      source: gl.getUniformLocation(this.downscaleProgram, 'uSource'),
      texel: gl.getUniformLocation(this.downscaleProgram, 'uTexel'),
    };

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    const frameTexture = gl.createTexture();
    const personMaskTexture = gl.createTexture();
    const faceMaskTexture = gl.createTexture();
    const overlayTexture = gl.createTexture();
    if (
      !vao ||
      !buffer ||
      !frameTexture ||
      !personMaskTexture ||
      !faceMaskTexture ||
      !overlayTexture
    ) {
      throw new Error('WebGL allocation failed');
    }
    this.vao = vao;
    this.frameTexture = frameTexture;
    this.personMaskTexture = personMaskTexture;
    this.faceMaskTexture = faceMaskTexture;
    this.overlayTexture = overlayTexture;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.effectsProgram, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Video frames, masks and the face canvas are all top-down; flipping every
    // upload keeps the textures aligned with each other.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    configureTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindTexture(gl.TEXTURE_2D, personMaskTexture);
    configureTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      1,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0]),
    );

    gl.bindTexture(gl.TEXTURE_2D, faceMaskTexture);
    configureTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );

    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    configureTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const gl = this.gl;
    const unchanged =
      this.canvas.width === width &&
      this.canvas.height === height &&
      this.skinA !== null &&
      this.backgroundA !== null;
    if (unchanged) {
      gl.viewport(0, 0, width, height);
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    gl.viewport(0, 0, width, height);

    this.disposeTargets();
    const halfWidth = Math.max(2, Math.round(width / 2));
    const halfHeight = Math.max(2, Math.round(height / 2));
    const quarterWidth = Math.max(2, Math.round(width / 4));
    const quarterHeight = Math.max(2, Math.round(height / 4));

    this.skinA = this.createTarget(halfWidth, halfHeight);
    this.skinB = this.createTarget(halfWidth, halfHeight);
    this.backgroundA = this.createTarget(quarterWidth, quarterHeight);
    this.backgroundB = this.createTarget(quarterWidth, quarterHeight);
  }

  setPersonMask(mask: PersonMask): void {
    if (this.disposed) return;
    const valid =
      mask.width > 0 &&
      mask.height > 0 &&
      mask.data.length >= mask.width * mask.height;
    this.hasPerson = valid;
    if (!valid) return;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.personMaskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      mask.width,
      mask.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      mask.data,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  setFaceMask(canvas: HTMLCanvasElement): void {
    if (this.disposed) return;
    this.hasFace = canvas.width > 0 && canvas.height > 0;
    if (!this.hasFace) return;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.faceMaskTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
  }

  setOverlay(canvas: HTMLCanvasElement | null): void {
    if (this.disposed) return;
    this.hasOverlay = canvas !== null && canvas.width > 0 && canvas.height > 0;
    if (!canvas || !this.hasOverlay) return;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
  }

  render(source: HTMLVideoElement, settings: LookSettings): void {
    if (this.disposed) return;
    const gl = this.gl;
    if (source.readyState < 2 || source.videoWidth === 0) return;

    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );

    const uniforms = toEffectUniforms(settings);
    const [tx, ty] = texelSize(this.canvas.width, this.canvas.height);

    let skinTexture = this.frameTexture;
    if (
      uniforms.skin > 0.001 &&
      this.hasFace &&
      this.skinA &&
      this.skinB
    ) {
      skinTexture = this.buildBlurChain(
        this.skinA,
        this.skinB,
        blurStep(uniforms.skin, SKIN_BLUR_UV),
      );
    }

    let backgroundTexture = this.frameTexture;
    if (
      uniforms.background > 0.001 &&
      this.hasPerson &&
      this.backgroundA &&
      this.backgroundB
    ) {
      backgroundTexture = this.buildBlurChain(
        this.backgroundA,
        this.backgroundB,
        blurStep(uniforms.background, BACKGROUND_BLUR_UV),
      );
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.effectsProgram);

    this.bindTexture(0, this.frameTexture);
    this.bindTexture(1, skinTexture);
    this.bindTexture(2, backgroundTexture);
    this.bindTexture(3, this.personMaskTexture);
    this.bindTexture(4, this.faceMaskTexture);
    this.bindTexture(5, this.overlayTexture);

    gl.uniform1i(this.locations.frame, 0);
    gl.uniform1i(this.locations.skinBlur, 1);
    gl.uniform1i(this.locations.backgroundBlur, 2);
    gl.uniform1i(this.locations.personMask, 3);
    gl.uniform1i(this.locations.faceMask, 4);
    gl.uniform1i(this.locations.overlay, 5);
    gl.uniform2f(this.locations.texel, tx, ty);
    gl.uniform1f(this.locations.master, uniforms.master);
    gl.uniform1f(this.locations.color, uniforms.color);
    gl.uniform1f(this.locations.light, uniforms.light);
    gl.uniform1f(this.locations.sharpen, uniforms.sharpen);
    gl.uniform1f(this.locations.skin, uniforms.skin);
    gl.uniform1f(this.locations.portrait, uniforms.portrait);
    gl.uniform1f(this.locations.background, uniforms.background);
    gl.uniform1f(this.locations.hasPerson, this.hasPerson ? 1 : 0);
    gl.uniform1f(this.locations.hasFace, this.hasFace ? 1 : 0);
    gl.uniform1f(this.locations.hasOverlay, this.hasOverlay ? 1 : 0);

    this.draw();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.disposeTargets();
    gl.deleteTexture(this.frameTexture);
    gl.deleteTexture(this.personMaskTexture);
    gl.deleteTexture(this.faceMaskTexture);
    gl.deleteTexture(this.overlayTexture);
    gl.deleteProgram(this.effectsProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.downscaleProgram);
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private createTarget(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('WebGL target allocation failed');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    configureTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`blur framebuffer is incomplete (0x${status.toString(16)})`);
    }
    return { texture, framebuffer, width, height };
  }

  private disposeTargets(): void {
    const gl = this.gl;
    for (const target of [
      this.skinA,
      this.skinB,
      this.backgroundA,
      this.backgroundB,
    ]) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.skinA = null;
    this.skinB = null;
    this.backgroundA = null;
    this.backgroundB = null;
  }

  /**
   * Downsamples the frame into `a`, then runs two separable Gaussian passes.
   * Returns the texture that holds the final blur.
   */
  private buildBlurChain(
    a: RenderTarget,
    b: RenderTarget,
    step: number,
  ): WebGLTexture {
    const gl = this.gl;
    const [sourceTexelX, sourceTexelY] = texelSize(
      this.canvas.width,
      this.canvas.height,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.viewport(0, 0, a.width, a.height);
    gl.useProgram(this.downscaleProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.uniform1i(this.downscaleLocations.source, 0);
    gl.uniform2f(this.downscaleLocations.texel, sourceTexelX, sourceTexelY);
    this.draw();

    const aspect = a.width / a.height;
    let source = a.texture;
    for (let pass = 0; pass < 2; pass += 1) {
      // Horizontal: a/b -> the other target.
      this.runBlur(b, source, step, 0);
      // Vertical: back into `a`.
      this.runBlur(a, b.texture, 0, step * aspect);
      source = a.texture;
    }

    return source;
  }

  private runBlur(
    target: RenderTarget,
    source: WebGLTexture,
    stepX: number,
    stepY: number,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(this.blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(this.blurLocations.source, 0);
    gl.uniform2f(this.blurLocations.step, stepX, stepY);
    this.draw();
  }

  private bindTexture(unit: number, texture: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  private draw(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
