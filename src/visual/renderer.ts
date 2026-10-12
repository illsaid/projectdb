import type { VisualPreset } from './inputs';
import { FRAGMENT_SHADERS, VERTEX_SHADER } from './shaders';
import type { VisualFrame } from './step';

const UNIFORMS = ['uRes', 'uTime', 'uFrame', 'uSeed', 'uHue', 'uScale', 'uWarp', 'uBloom', 'uGrain', 'uBursts', 'uPal', 'uPalN'] as const;
type UniformName = (typeof UNIFORMS)[number];

const MIN_BLEND = 0.004;

interface Program {
  program: WebGLProgram;
  loc: Record<UniformName, WebGLUniformLocation | null>;
}

/** Draws a VisualFrame as a full-screen fragment shader onto an on- or off-screen canvas. */
export class VisualRenderer {
  private gl: WebGL2RenderingContext;
  private programs = new Map<VisualPreset, Program>();
  private vao: WebGLVertexArrayObject | null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('This browser does not support WebGL2, which the visuals need.');
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
  }

  render(frame: VisualFrame, width: number, height: number) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    this.draw(frame.preset, frame, width, height);
    if (frame.blend.amount < MIN_BLEND) return;
    gl.enable(gl.BLEND);
    gl.blendColor(0, 0, 0, frame.blend.amount);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    this.draw(frame.blend.preset, frame, width, height);
    gl.disable(gl.BLEND);
  }

  private draw(preset: VisualPreset, frame: VisualFrame, width: number, height: number) {
    const gl = this.gl;
    const { program, loc } = this.program(preset);
    gl.useProgram(program);
    gl.uniform2f(loc.uRes, width, height);
    gl.uniform1f(loc.uTime, frame.time);
    gl.uniform1f(loc.uFrame, frame.frame % 100000);
    gl.uniform4fv(loc.uSeed, frame.seed);
    gl.uniform1f(loc.uHue, frame.values.hue);
    gl.uniform1f(loc.uScale, frame.values.scale);
    gl.uniform1f(loc.uWarp, frame.values.warp);
    gl.uniform1f(loc.uBloom, frame.values.bloom);
    gl.uniform1f(loc.uGrain, frame.values.grain);
    gl.uniform1fv(loc.uBursts, frame.bursts);
    gl.uniform3fv(loc.uPal, frame.palette);
    gl.uniform1f(loc.uPalN, frame.paletteSize);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** RGBA bytes of the last rendered frame, bottom row first. */
  readPixels(width: number, height: number, out: Uint8Array) {
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
  }

  /** Frees the GPU objects; the context itself stays usable, so a new renderer can take over the canvas. */
  dispose() {
    for (const { program } of this.programs.values()) this.gl.deleteProgram(program);
    this.programs.clear();
    this.gl.deleteVertexArray(this.vao);
    this.vao = null;
  }

  /**
   * Disposes and hands the context back to the browser at once. Browsers cap live WebGL contexts
   * (Safari at a handful), so canvases that are going away should not wait for garbage collection.
   */
  release() {
    this.dispose();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private program(preset: VisualPreset): Program {
    const cached = this.programs.get(preset);
    if (cached) return cached;
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create a WebGL program.');
    const vertex = this.shader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADERS[preset]);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    // The linked program keeps what it needs; flagging the shaders lets them go with it.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '';
      gl.deleteProgram(program);
      throw new Error(`Visual shader failed to link: ${log}`);
    }
    const loc = Object.fromEntries(UNIFORMS.map((u) => [u, gl.getUniformLocation(program, u)])) as Program['loc'];
    const entry = { program, loc };
    this.programs.set(preset, entry);
    return entry;
  }

  private shader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create a WebGL shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? '';
      gl.deleteShader(shader);
      throw new Error(`Visual shader failed to compile: ${log}`);
    }
    return shader;
  }
}
