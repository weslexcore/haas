import { affineToMat3, cropOutputSize, cropToSourceAffine, fitWithin, type Size } from "../../core/develop/crop";
import { computeHistogram, uniformsFor, type Histogram } from "../../core/develop/pipeline";
import { DEFAULT_CROP, type EditRecipe } from "../../core/develop/recipe";
import type { DevelopRenderer, RenderOptions } from "../../core/develop/renderer";
import { FRAGMENT, VERTEX } from "./shaders";

const HISTOGRAM_EDGE = 256;

type Canvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * WebGL2 implementation of the develop renderer. Works on a regular canvas
 * (preview) or an OffscreenCanvas in a worker (export).
 */
export class WebGL2Renderer implements DevelopRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private image: WebGLTexture;
  private curve: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private fbo: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; size: Size } | null = null;
  private size: Size | null = null;
  private lastCurve = "";

  constructor(readonly canvas: Canvas) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    this.program = link(gl, VERTEX, FRAGMENT);
    gl.useProgram(this.program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(this.program, "aUv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    for (const name of [
      "uUvTransform", "uImage", "uCurve", "uOriginal", "uWbGains", "uExposure", "uBlackPoint", "uWhitePoint",
      "uShadows", "uHighlights", "uContrast", "uVibrance", "uSaturation", "uVignette", "uVignetteRect",
      "uHslHue", "uHslSat", "uHslLum",
    ]) {
      this.loc[name] = gl.getUniformLocation(this.program, name);
    }

    this.image = gl.createTexture()!;
    this.curve = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curve);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.loc.uImage!, 0);
    gl.uniform1i(this.loc.uCurve!, 1);
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  get sourceSize(): Size | null {
    return this.size;
  }

  setSource(image: TexImageSource, size: Size): void {
    const { gl } = this;
    if (Math.max(size.width, size.height) > this.maxTextureSize) {
      throw new Error(`Image is larger than this GPU supports (${this.maxTextureSize}px).`);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.size = { ...size };
  }

  /** Output size for a recipe at full source resolution. */
  outputSize(recipe: EditRecipe, opts: RenderOptions = {}): Size {
    if (!this.size) throw new Error("No image loaded.");
    const crop = opts.original || opts.ignoreCrop ? { ...DEFAULT_CROP, angle: opts.ignoreCrop && !opts.original ? recipe.crop.angle : 0 } : recipe.crop;
    return cropOutputSize(this.size, crop);
  }

  render(recipe: EditRecipe, opts: RenderOptions = {}): Size {
    const out = opts.width && opts.height ? { width: opts.width, height: opts.height } : this.outputSize(recipe, opts);
    if (this.canvas.width !== out.width) this.canvas.width = out.width;
    if (this.canvas.height !== out.height) this.canvas.height = out.height;
    this.draw(recipe, opts, null, out);
    return out;
  }

  readPixels(): Uint8Array {
    const { gl } = this;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return flipRows(readRgba(gl, w, h), w, h);
  }

  histogram(recipe: EditRecipe, opts: RenderOptions = {}): Histogram {
    const size = fitWithin(this.outputSize(recipe, opts), HISTOGRAM_EDGE);
    const fbo = this.histogramTarget(size);
    this.draw(recipe, opts, fbo.framebuffer, size);
    const pixels = readRgba(this.gl, size.width, size.height);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return computeHistogram(pixels);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteTexture(this.image);
    gl.deleteTexture(this.curve);
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo.framebuffer);
      gl.deleteTexture(this.fbo.texture);
    }
    gl.deleteProgram(this.program);
    // The context itself is kept: getContext() on the same canvas returns it again
    // (e.g. React remounting the component), and it must still be usable.
  }

  private draw(recipe: EditRecipe, opts: RenderOptions, target: WebGLFramebuffer | null, out: Size): void {
    const { gl, loc } = this;
    if (!this.size) throw new Error("No image loaded.");
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(this.program);

    const crop = opts.original
      ? DEFAULT_CROP
      : opts.ignoreCrop
        ? { ...DEFAULT_CROP, angle: recipe.crop.angle }
        : recipe.crop;
    gl.uniformMatrix3fv(loc.uUvTransform!, false, affineToMat3(cropToSourceAffine(this.size, crop)));
    gl.uniform1i(loc.uOriginal!, opts.original ? 1 : 0);

    const u = uniformsFor(recipe);
    gl.uniform3fv(loc.uWbGains!, u.wbGains);
    gl.uniform1f(loc.uExposure!, u.exposure);
    gl.uniform1f(loc.uBlackPoint!, u.blackPoint);
    gl.uniform1f(loc.uWhitePoint!, u.whitePoint);
    gl.uniform1f(loc.uShadows!, u.shadows);
    gl.uniform1f(loc.uHighlights!, u.highlights);
    gl.uniform1f(loc.uContrast!, u.contrast);
    gl.uniform1f(loc.uVibrance!, u.vibrance);
    gl.uniform1f(loc.uSaturation!, u.saturation);
    gl.uniform1f(loc.uVignette!, u.vignette);
    // With the crop ignored (crop tool) the frame is the whole image, so centre the vignette on the crop.
    const vr = opts.ignoreCrop && !opts.original ? recipe.crop : DEFAULT_CROP;
    gl.uniform4f(loc.uVignetteRect!, vr.x, vr.y, vr.width, vr.height);
    gl.uniform1fv(loc.uHslHue!, u.hslHue);
    gl.uniform1fv(loc.uHslSat!, u.hslSat);
    gl.uniform1fv(loc.uHslLum!, u.hslLum);

    const curveKey = JSON.stringify(recipe.toneCurve);
    if (curveKey !== this.lastCurve) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curve);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, u.curve);
      this.lastCurve = curveKey;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private histogramTarget(size: Size) {
    const { gl } = this;
    if (this.fbo && this.fbo.size.width === size.width && this.fbo.size.height === size.height) return this.fbo;
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo.framebuffer);
      gl.deleteTexture(this.fbo.texture);
    }
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size.width, size.height);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbo = { framebuffer, texture, size };
    return this.fbo;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  return program;
}

function readRgba(gl: WebGL2RenderingContext, w: number, h: number): Uint8Array {
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** GL reads bottom row first; flip to top-first. */
function flipRows(pixels: Uint8Array, w: number, h: number): Uint8Array {
  const row = w * 4;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < h; y++) out.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}
