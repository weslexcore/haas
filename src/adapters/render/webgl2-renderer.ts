import { affineToMat3, cropOutputSize, cropToSourceAffine, fitWithin, type Size } from "../../core/develop/crop";
import { SHAPE_CODES, SHAPE_CODE_NONE, resampleBitmap, shapeParams, type MaskBitmaps } from "../../core/develop/masks";
import { computeHistogram, uniformsFor, type Histogram, type MaskUniforms } from "../../core/develop/pipeline";
import { DEFAULT_CROP, MAX_MASKS, type EditRecipe } from "../../core/develop/recipe";
import type { DevelopRenderer, RenderOptions } from "../../core/develop/renderer";
import { CURVE_ROWS, FRAGMENT, SHADER_MAX_MASKS, VERTEX } from "./shaders";

const HISTOGRAM_EDGE = 256;

type Canvas = HTMLCanvasElement | OffscreenCanvas;

const UNIFORMS = [
  "uUvTransform", "uImage", "uCurve", "uMaskBitmaps", "uOriginal", "uSliderA", "uSliderB", "uSliderC", "uVignette", "uVignetteRect", "uHsl",
  "uProfile", "uProfileAmount", "uMono", "uMonoMix", "uProfileSat", "uShadowTint", "uHighlightTint", "uToneBalance", "uFade", "uGrain", "uGrainCells",
  "uMaskCount", "uAspect", "uMaskInfo", "uMaskFlags", "uMaskP", "uMaskQ", "uMaskAdjA", "uMaskAdjB", "uMaskAdjC", "uMaskHsl", "uShowMask",
] as const;

/**
 * WebGL2 implementation of the develop renderer. Works on a regular canvas
 * (preview) or an OffscreenCanvas in a worker (export).
 */
export class WebGL2Renderer implements DevelopRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private image: WebGLTexture;
  private curve: WebGLTexture;
  private bitmaps: WebGLTexture;
  /** Texture array layer of each uploaded mask bitmap, by mask id. */
  private bitmapLayers = new Map<string, number>();
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private fbo: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; size: Size } | null = null;
  private size: Size | null = null;
  private lastCurve = "";

  constructor(readonly canvas: Canvas) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    if (MAX_MASKS !== SHADER_MAX_MASKS) throw new Error("The shader's mask capacity doesn't match the recipe's.");
    this.program = link(gl, VERTEX, FRAGMENT);
    gl.useProgram(this.program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(this.program, "aUv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(this.program, name);

    this.image = gl.createTexture()!;
    this.curve = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curve);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // An empty (1×1, one layer) array so the sampler is always complete; setMaskBitmaps replaces it.
    this.bitmaps = this.createBitmapArray(1, 1, 1);
    gl.uniform1i(this.loc.uImage!, 0);
    gl.uniform1i(this.loc.uCurve!, 1);
    gl.uniform1i(this.loc.uMaskBitmaps!, 2);
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

  setMaskBitmaps(bitmaps: MaskBitmaps): void {
    const { gl } = this;
    const entries = Object.entries(bitmaps).slice(0, MAX_MASKS);
    gl.deleteTexture(this.bitmaps);
    this.bitmapLayers.clear();
    if (!entries.length) {
      this.bitmaps = this.createBitmapArray(1, 1, 1);
      return;
    }
    // One texture array, so every bitmap takes the first one's size.
    const { width, height } = entries[0]![1];
    this.bitmaps = this.createBitmapArray(width, height, entries.length);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    entries.forEach(([id, bitmap], layer) => {
      const b = resampleBitmap(bitmap, width, height);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RED, gl.UNSIGNED_BYTE, b.data);
      this.bitmapLayers.set(id, layer);
    });
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
    // The histogram describes the image, never the overlay.
    this.draw(recipe, { ...opts, showMask: undefined }, fbo.framebuffer, size);
    const pixels = readRgba(this.gl, size.width, size.height);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return computeHistogram(pixels);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteTexture(this.image);
    gl.deleteTexture(this.curve);
    gl.deleteTexture(this.bitmaps);
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo.framebuffer);
      gl.deleteTexture(this.fbo.texture);
    }
    gl.deleteProgram(this.program);
    // The context itself is kept: getContext() on the same canvas returns it again
    // (e.g. React remounting the component), and it must still be usable.
  }

  private createBitmapArray(width: number, height: number, layers: number): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, width, height, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
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
    const s = u.sliders;
    gl.uniform4f(loc.uSliderA!, s.temperature, s.tint, s.exposure, s.contrast);
    gl.uniform4f(loc.uSliderB!, s.highlights, s.shadows, s.whites, s.blacks);
    gl.uniform2f(loc.uSliderC!, s.vibrance, s.saturation);
    gl.uniform1f(loc.uVignette!, u.vignette);
    // With the crop ignored (crop tool) the frame is the whole image, so centre the vignette on the crop.
    const vr = opts.ignoreCrop && !opts.original ? recipe.crop : DEFAULT_CROP;
    gl.uniform4f(loc.uVignetteRect!, vr.x, vr.y, vr.width, vr.height);
    gl.uniform4fv(loc.uHsl!, hslVec4s(u.hslHue, u.hslSat, u.hslLum));

    const p = u.profile;
    gl.uniform1i(loc.uProfile!, p ? 1 : 0);
    if (p) {
      gl.uniform1f(loc.uProfileAmount!, p.amount);
      gl.uniform1i(loc.uMono!, p.mono ? 1 : 0);
      gl.uniform3fv(loc.uMonoMix!, p.mono ?? [0, 0, 0]);
      gl.uniform1f(loc.uProfileSat!, p.saturation);
      gl.uniform3fv(loc.uShadowTint!, p.shadowTint);
      gl.uniform3fv(loc.uHighlightTint!, p.highlightTint);
      gl.uniform1f(loc.uToneBalance!, p.balance);
      gl.uniform1f(loc.uFade!, p.fade);
      gl.uniform1f(loc.uGrain!, p.grain);
      const aspect = this.size.width / this.size.height;
      gl.uniform2f(loc.uGrainCells!, p.grainCells * Math.min(1, aspect), p.grainCells * Math.min(1, 1 / aspect));
    }

    this.uploadMasks(u.masks, opts.showMask);

    // Row 0: R, G, B the profile's channel curves, A the master tone curve. Row 1 + i: mask i's curve in A.
    const curveKey = JSON.stringify([recipe.toneCurve, recipe.profile?.look.curves, u.masks.map((m) => m.mask.adjustments.toneCurve)]);
    if (curveKey !== this.lastCurve) {
      const lut = new Uint8Array(256 * 4 * CURVE_ROWS);
      for (let i = 0; i < 256; i++) {
        lut[i * 4] = p ? p.curves[0][i]! : i;
        lut[i * 4 + 1] = p ? p.curves[1][i]! : i;
        lut[i * 4 + 2] = p ? p.curves[2][i]! : i;
        lut[i * 4 + 3] = u.curve[i]!;
      }
      u.masks.forEach((m, row) => {
        const base = (row + 1) * 256 * 4;
        for (let i = 0; i < 256; i++) lut[base + i * 4 + 3] = m.curve ? m.curve[i]! : i;
      });
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curve);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, CURVE_ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
      this.lastCurve = curveKey;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.bitmaps);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private uploadMasks(masks: MaskUniforms[], showMask: string | undefined): void {
    const { gl, loc } = this;
    const n = Math.min(masks.length, MAX_MASKS);
    const info = new Float32Array(MAX_MASKS * 4);
    const flags = new Float32Array(MAX_MASKS * 4);
    const P = new Float32Array(MAX_MASKS * 4);
    const Q = new Float32Array(MAX_MASKS * 4);
    const adjA = new Float32Array(MAX_MASKS * 4);
    const adjB = new Float32Array(MAX_MASKS * 4);
    const adjC = new Float32Array(MAX_MASKS * 2);
    const hsl = new Float32Array(MAX_MASKS * 8 * 4);
    let show = -1;
    for (let i = 0; i < n; i++) {
      const m = masks[i]!;
      const { mask } = m;
      if (mask.id === showMask) show = i;
      const layer = mask.shape.type === "segment" ? this.bitmapLayers.get(mask.id) : undefined;
      const code = mask.shape.type === "segment" && layer === undefined ? SHAPE_CODE_NONE : SHAPE_CODES[mask.shape.type];
      info.set([code, mask.invert ? 1 : 0, layer ?? 0, m.active ? 1 : 0], i * 4);
      flags.set([m.curve ? 1 : 0, m.hsl ? 1 : 0, 0, 0], i * 4);
      const { p, q } = shapeParams(mask.shape);
      P.set(p, i * 4);
      Q.set(q, i * 4);
      const s = m.sliders;
      adjA.set([s.temperature, s.tint, s.exposure, s.contrast], i * 4);
      adjB.set([s.highlights, s.shadows, s.whites, s.blacks], i * 4);
      adjC.set([s.vibrance, s.saturation], i * 2);
      if (m.hsl) hsl.set(hslVec4s(m.hsl.hue, m.hsl.sat, m.hsl.lum), i * 32);
    }
    gl.uniform1i(loc.uMaskCount!, n);
    gl.uniform1f(loc.uAspect!, this.size!.width / this.size!.height);
    gl.uniform4fv(loc.uMaskInfo!, info);
    gl.uniform4fv(loc.uMaskFlags!, flags);
    gl.uniform4fv(loc.uMaskP!, P);
    gl.uniform4fv(loc.uMaskQ!, Q);
    gl.uniform4fv(loc.uMaskAdjA!, adjA);
    gl.uniform4fv(loc.uMaskAdjB!, adjB);
    gl.uniform2fv(loc.uMaskAdjC!, adjC);
    gl.uniform4fv(loc.uMaskHsl!, hsl);
    gl.uniform1i(loc.uShowMask!, show);
  }

  private histogramTarget(size: Size) {
    const { gl } = this;
    if (this.fbo && this.fbo.size.width === size.width && this.fbo.size.height === size.height) return this.fbo;
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo.framebuffer);
      gl.deleteTexture(this.fbo.texture);
    }
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE3);
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

/** Eight (hue, sat, lum, 0) vec4s. */
function hslVec4s(hue: number[], sat: number[], lum: number[]): Float32Array {
  const out = new Float32Array(32);
  for (let i = 0; i < 8; i++) out.set([hue[i]!, sat[i]!, lum[i]!, 0], i * 4);
  return out;
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
