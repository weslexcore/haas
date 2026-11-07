/**
 * GLSL for the develop pipeline. Each step mirrors core/develop/pipeline.ts
 * (and core/develop/masks.ts for the mask shapes); keep them in sync (tests
 * compare GPU output with the CPU reference).
 */

/** Must match MAX_MASKS in core/develop/recipe.ts. */
export const SHADER_MAX_MASKS = 8;
/** Rows of the curve texture: the global curve (and profile channel curves) plus one per mask. */
export const CURVE_ROWS = 1 + SHADER_MAX_MASKS;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aUv;
uniform mat3 uUvTransform;
out vec2 vSrcUv;
out vec2 vUv;
void main() {
  vSrcUv = (uUvTransform * vec3(aUv, 1.0)).xy;
  vUv = aUv;
  // Output uv has y down; clip space has y up.
  gl_Position = vec4(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0, 0.0, 1.0);
}`;

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vSrcUv;
in vec2 vUv;
out vec4 outColor;

const int MAX_MASKS = ${SHADER_MAX_MASKS};
const float CURVE_ROWS = ${CURVE_ROWS}.0;

uniform sampler2D uImage;
// Row 0: the profile's R/G/B curves and, in .a, the master tone curve. Row 1 + i: mask i's curve in .a.
uniform sampler2D uCurve;
uniform sampler2DArray uMaskBitmaps;
uniform bool uOriginal;
// The Basic sliders in recipe units (pipeline.ts toneParams turns them into the pipeline's own units).
uniform vec4 uSliderA; // temperature, tint, exposure, contrast
uniform vec4 uSliderB; // highlights, shadows, whites, blacks
uniform vec2 uSliderC; // vibrance, saturation
uniform float uVignette;
// The crop rectangle within the rendered frame (x, y, w, h): the vignette is centred on it.
uniform vec4 uVignetteRect;
// Per band: hue shift (turns), saturation, luminance.
uniform vec4 uHsl[8];
// Profile stage (pipeline.ts profilePixel).
uniform bool uProfile;
uniform float uProfileAmount;
uniform bool uMono;
uniform vec3 uMonoMix;
uniform float uProfileSat;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uToneBalance;
uniform float uFade;
uniform float uGrain;
// Grain cells across the source image (x, y).
uniform vec2 uGrainCells;
// Masks (masks.ts maskWeight). Info: shape code, invert, bitmap layer, active. Flags: has curve, has HSL.
uniform int uMaskCount;
uniform float uAspect;
uniform vec4 uMaskInfo[MAX_MASKS];
uniform vec4 uMaskFlags[MAX_MASKS];
uniform vec4 uMaskP[MAX_MASKS];
uniform vec4 uMaskQ[MAX_MASKS];
uniform vec4 uMaskAdjA[MAX_MASKS];
uniform vec4 uMaskAdjB[MAX_MASKS];
uniform vec2 uMaskAdjC[MAX_MASKS];
uniform vec4 uMaskHsl[MAX_MASKS * 8];
// Index of the mask to paint over the image (its coverage in red), or -1.
uniform int uShowMask;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float VIGNETTE_START = 0.25;
const float CENTERS[8] = float[8](0.0, 30.0 / 360.0, 60.0 / 360.0, 120.0 / 360.0, 180.0 / 360.0, 240.0 / 360.0, 270.0 / 360.0, 300.0 / 360.0);

// Each mask's coverage of this pixel: raw (for the overlay) and effective (zero for inactive masks).
float gRaw[MAX_MASKS];
float gW[MAX_MASKS];

struct Tone {
  vec3 wb;
  float exposure;
  float blackPoint;
  float whitePoint;
  float shadows;
  float highlights;
  float contrast;
  float vibrance;
  float saturation;
};

Tone toneParams(vec4 a, vec4 b, vec2 c) {
  Tone t;
  float temp = a.x / 100.0;
  float tint = a.y / 100.0;
  vec3 raw = vec3(1.0 + 0.25 * temp, 1.0 - 0.2 * tint, 1.0 - 0.25 * temp);
  t.wb = raw / dot(raw, LUMA);
  t.exposure = exp2(a.z);
  t.blackPoint = (-b.w / 100.0) * 0.15;
  t.whitePoint = 1.0 - (b.z / 100.0) * 0.15;
  t.shadows = b.y / 100.0;
  t.highlights = b.x / 100.0;
  t.contrast = (a.w / 100.0) * 0.8;
  t.vibrance = c.x / 100.0;
  t.saturation = c.y / 100.0;
  return t;
}

float srgbToLinear(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float linearToSrgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }

float vignetteMask(vec2 uv) {
  float d = length((uv - 0.5) * 2.0) / sqrt(2.0);
  return smoothstep(VIGNETTE_START, 1.0, d);
}

vec4 curveRow(float x, float row) {
  return texture(uCurve, vec2((x * 255.0 + 0.5) / 256.0, (row + 0.5) / CURVE_ROWS));
}

vec4 curveAt(float x) {
  return curveRow(x, 0.0);
}

// The master curve, plus each covering mask's curve as an offset from the identity.
float curve(float x) {
  float y = curveAt(x).a;
  bool blended = false;
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= uMaskCount) break;
    if (gW[i] > 0.0 && uMaskFlags[i].x > 0.5) {
      y += gW[i] * (curveRow(x, float(i + 1)).a - x);
      blended = true;
    }
  }
  return blended ? clamp(y, 0.0, 1.0) : y;
}

float hash(uvec2 p) {
  uint h = (p.x * 0x27d4eb2du) ^ (p.y * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h ^= h >> 12u;
  h *= 0x297a2d39u;
  h ^= h >> 15u;
  return float(h) / 4294967296.0;
}

float grainNoise(vec2 uv) {
  vec2 g = uv * uGrainCells;
  vec2 i = floor(g);
  vec2 f = g - i;
  f = f * f * (3.0 - 2.0 * f);
  uvec2 c = uvec2(ivec2(i));
  float a = hash(c);
  float b = hash(c + uvec2(1u, 0u));
  float d0 = hash(c + uvec2(0u, 1u));
  float d1 = hash(c + uvec2(1u, 1u));
  return a + (b - a) * f.x + (d0 - a) * f.y + (a - b - d0 + d1) * f.x * f.y - 0.5;
}

vec3 profile(vec3 c, float noise) {
  vec3 p;
  if (uMono) {
    p = vec3(clamp(dot(c, uMonoMix), 0.0, 1.0));
  } else {
    float y = dot(c, LUMA);
    p = clamp(y + (c - y) * (1.0 + uProfileSat), 0.0, 1.0);
  }
  p = vec3(curveAt(p.r).r, curveAt(p.g).g, curveAt(p.b).b);
  float x = clamp(dot(p, LUMA) - uToneBalance * 0.5, 0.0, 1.0);
  p = uFade + clamp(p + uShadowTint * (1.0 - x) * (1.0 - x) + uHighlightTint * x * x, 0.0, 1.0) * (1.0 - uFade);
  if (uGrain > 0.0) {
    float l = dot(p, LUMA);
    p += noise * uGrain * 0.25 * (0.25 + 3.0 * l * (1.0 - l));
  }
  return clamp(c + (clamp(p, 0.0, 1.0) - c) * uProfileAmount, 0.0, 1.0);
}

float tone(float pl, Tone t) {
  float x = (pl - t.blackPoint) / (t.whitePoint - t.blackPoint);
  float xc = clamp(x, 0.0, 1.0);
  x += t.shadows * 1.2 * xc * (1.0 - xc) * (1.0 - xc);
  if (t.highlights < 0.0) {
    if (x > 0.5) x = 0.5 + (x - 0.5) / (1.0 + -t.highlights * 2.0 * (x - 0.5));
  } else {
    xc = clamp(x, 0.0, 1.0);
    x += t.highlights * 1.2 * xc * xc * (1.0 - xc);
  }
  xc = clamp(x, 0.0, 1.0);
  float e = 1.0 + t.contrast;
  float s = xc < 0.5 ? 0.5 * pow(2.0 * xc, e) : 1.0 - 0.5 * pow(2.0 * (1.0 - xc), e);
  x = s + (x - xc);
  xc = clamp(x, 0.0, 1.0);
  return curve(xc) + (x - xc);
}

vec3 rgbToHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float hueToRgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s < 1e-6) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hueToRgb(p, q, h + 1.0 / 3.0), hueToRgb(p, q, h), hueToRgb(p, q, h - 1.0 / 3.0));
}

// Band i's (hue, sat, lum) adjustment here: the global one plus the covering masks'.
vec3 hslBand(int i) {
  vec3 v = uHsl[i].xyz;
  for (int m = 0; m < MAX_MASKS; m++) {
    if (m >= uMaskCount) break;
    if (gW[m] > 0.0 && uMaskFlags[m].y > 0.5) v += gW[m] * uMaskHsl[m * 8 + i].xyz;
  }
  return v;
}

vec3 bandAdjust(float h) {
  for (int i = 0; i < 8; i++) {
    float a = CENTERS[i];
    float b = i == 7 ? 1.0 : CENTERS[i + 1];
    if (h >= a && h < b) {
      float t = (h - a) / (b - a);
      int j = (i + 1) % 8;
      return mix(hslBand(i), hslBand(j), t);
    }
  }
  return hslBand(0);
}

// Coverage of mask i at source uv for the original pixel c (masks.ts maskWeight).
float maskWeight(int i, vec2 uv, vec3 c) {
  vec4 info = uMaskInfo[i];
  vec4 P = uMaskP[i];
  vec4 Q = uMaskQ[i];
  int type = int(info.x + 0.5);
  float w = 0.0;
  if (type == 0) {
    vec2 a = vec2(P.x * uAspect, P.y);
    vec2 d = vec2(P.z * uAspect, P.w) - a;
    vec2 p = vec2(uv.x * uAspect, uv.y);
    w = 1.0 - clamp(dot(p - a, d) / max(dot(d, d), 1e-8), 0.0, 1.0);
  } else if (type == 1) {
    vec2 p = vec2((uv.x - P.x) * uAspect, uv.y - P.y);
    float cs = cos(Q.x);
    float sn = sin(Q.x);
    vec2 r = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
    float nd = length(vec2(r.x / (P.z * uAspect), r.y / P.w));
    w = 1.0 - smoothstep(1.0 - Q.y, 1.0, nd);
  } else if (type == 2) {
    float L = dot(c, LUMA);
    w = smoothstep(P.x - P.z, P.x, L) * (1.0 - smoothstep(P.y, P.y + P.z, L));
  } else if (type == 3) {
    vec3 hsl = rgbToHsl(c);
    float dh = abs(hsl.x - P.x);
    dh = min(dh, 1.0 - dh);
    w = (1.0 - smoothstep(P.y, P.y + P.z, dh)) * smoothstep(0.05, 0.3, hsl.y);
  } else if (type == 4) {
    w = texture(uMaskBitmaps, vec3(uv, info.z)).r;
  }
  return info.y > 0.5 ? 1.0 - w : w;
}

void main() {
  if (vSrcUv.x < 0.0 || vSrcUv.x > 1.0 || vSrcUv.y < 0.0 || vSrcUv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 c = texture(uImage, vSrcUv).rgb;
  if (uOriginal) {
    outColor = vec4(c, 1.0);
    return;
  }

  // Masks: coverage, then the Basic sliders shifted by the covering masks and clamped to their ranges.
  vec4 sa = uSliderA;
  vec4 sb = uSliderB;
  vec2 sc2 = uSliderC;
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= uMaskCount) break;
    gRaw[i] = maskWeight(i, vSrcUv, c);
    gW[i] = gRaw[i] * uMaskInfo[i].w;
    if (gW[i] > 0.0) {
      sa += gW[i] * uMaskAdjA[i];
      sb += gW[i] * uMaskAdjB[i];
      sc2 += gW[i] * uMaskAdjC[i];
    }
  }
  sa = clamp(sa, vec4(-100.0, -100.0, -5.0, -100.0), vec4(100.0, 100.0, 5.0, 100.0));
  sb = clamp(sb, vec4(-100.0), vec4(100.0));
  sc2 = clamp(sc2, vec2(-100.0), vec2(100.0));
  Tone t = toneParams(sa, sb, sc2);

  vec3 lin = vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)) * t.wb * t.exposure;
  float L = dot(lin, LUMA);
  float pl = pow(max(L, 0.0), 1.0 / 2.2);
  float L2 = pow(max(tone(pl, t), 0.0), 2.2);
  lin = L > 1e-5 ? lin * (L2 / L) : vec3(L2);

  vec3 sc = clamp(lin, 0.0, 1.0);
  float v = uVignette * vignetteMask((vUv - uVignetteRect.xy) / uVignetteRect.zw);
  if (v < 0.0) sc *= 1.0 + v;
  else if (v > 0.0) sc += (1.0 - sc) * v;
  sc = vec3(linearToSrgb(sc.r), linearToSrgb(sc.g), linearToSrgb(sc.b));
  if (uProfile) sc = profile(sc, uGrain > 0.0 ? grainNoise(vSrcUv) : 0.0);

  vec3 hsl = rgbToHsl(sc);
  vec3 adj = bandAdjust(hsl.x);
  float s0 = hsl.y;
  float h = hsl.x + adj.x;
  h -= floor(h);
  float s = hsl.y * (1.0 + adj.y);
  float l = hsl.z + adj.z * 0.3 * s0;
  s *= 1.0 + t.vibrance * (1.0 - clamp(s, 0.0, 1.0));
  s *= 1.0 + t.saturation;
  vec3 result = hslToRgb(vec3(h, clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0)));

  if (uShowMask >= 0 && uShowMask < uMaskCount) {
    float w = 0.0;
    for (int i = 0; i < MAX_MASKS; i++) if (i == uShowMask) w = gRaw[i];
    result = mix(result, vec3(1.0, 0.2, 0.15), w * 0.55);
  }
  outColor = vec4(result, 1.0);
}`;
