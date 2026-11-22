import type { LookSettings } from '../shared/settings';
import { texelSize, toEffectUniforms } from './params';
import { EFFECTS_FRAGMENT, VERTEX_SHADER } from './shaders';

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

interface EffectLocations {
  frame: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  master: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  light: WebGLUniformLocation | null;
  sharpen: WebGLUniformLocation | null;
}

/**
 * WebGL2 renderer. One fullscreen triangle, one fragment shader; every effect
 * is a uniform, so changing a slider never recompiles anything.
 */
export class FrameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly locations: EffectLocations;
  private readonly vao: WebGLVertexArrayObject;
  private readonly frameTexture: WebGLTexture;
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

    this.program = link(gl, VERTEX_SHADER, EFFECTS_FRAGMENT);
    this.locations = {
      frame: gl.getUniformLocation(this.program, 'uFrame'),
      texel: gl.getUniformLocation(this.program, 'uTexel'),
      master: gl.getUniformLocation(this.program, 'uMaster'),
      color: gl.getUniformLocation(this.program, 'uColor'),
      light: gl.getUniformLocation(this.program, 'uLight'),
      sharpen: gl.getUniformLocation(this.program, 'uSharpen'),
    };

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    if (!vao || !buffer || !texture) throw new Error('WebGL allocation failed');
    this.vao = vao;
    this.frameTexture = texture;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Video frames are top-down; upload flipped so the canvas is upright.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(source: HTMLVideoElement, settings: LookSettings): void {
    if (this.disposed) return;
    const gl = this.gl;
    if (source.readyState < 2) return;

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

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.uniform1i(this.locations.frame, 0);
    gl.uniform2f(this.locations.texel, tx, ty);
    gl.uniform1f(this.locations.master, uniforms.master);
    gl.uniform1f(this.locations.color, uniforms.color);
    gl.uniform1f(this.locations.light, uniforms.light);
    gl.uniform1f(this.locations.sharpen, uniforms.sharpen);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.frameTexture);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
