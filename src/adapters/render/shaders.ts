/**
 * GLSL for the develop pipeline. Each step mirrors core/develop/pipeline.ts;
 * keep them in sync (tests compare GPU output with the CPU reference).
 */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aUv;
uniform mat3 uUvTransform;
out vec2 vSrcUv;
void main() {
  vSrcUv = (uUvTransform * vec3(aUv, 1.0)).xy;
  // Output uv has y down; clip space has y up.
  gl_Position = vec4(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0, 0.0, 1.0);
}`;

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vSrcUv;
out vec4 outColor;

uniform sampler2D uImage;
uniform sampler2D uCurve;
uniform bool uOriginal;
uniform vec3 uWbGains;
uniform float uExposure;
uniform float uBlackPoint;
uniform float uWhitePoint;
uniform float uShadows;
uniform float uHighlights;
uniform float uContrast;
uniform float uVibrance;
uniform float uSaturation;
uniform float uHslHue[8];
uniform float uHslSat[8];
uniform float uHslLum[8];

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CENTERS[8] = float[8](0.0, 30.0 / 360.0, 60.0 / 360.0, 120.0 / 360.0, 180.0 / 360.0, 240.0 / 360.0, 270.0 / 360.0, 300.0 / 360.0);

float srgbToLinear(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float linearToSrgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }

float curve(float x) {
  return texture(uCurve, vec2((x * 255.0 + 0.5) / 256.0, 0.5)).r;
}

float tone(float pl) {
  float x = (pl - uBlackPoint) / (uWhitePoint - uBlackPoint);
  float xc = clamp(x, 0.0, 1.0);
  x += uShadows * 1.2 * xc * (1.0 - xc) * (1.0 - xc);
  if (uHighlights < 0.0) {
    if (x > 0.5) x = 0.5 + (x - 0.5) / (1.0 + -uHighlights * 2.0 * (x - 0.5));
  } else {
    xc = clamp(x, 0.0, 1.0);
    x += uHighlights * 1.2 * xc * xc * (1.0 - xc);
  }
  xc = clamp(x, 0.0, 1.0);
  float e = 1.0 + uContrast;
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

vec3 bandAdjust(float h) {
  for (int i = 0; i < 8; i++) {
    float a = CENTERS[i];
    float b = i == 7 ? 1.0 : CENTERS[i + 1];
    if (h >= a && h < b) {
      float t = (h - a) / (b - a);
      int j = (i + 1) % 8;
      return vec3(mix(uHslHue[i], uHslHue[j], t), mix(uHslSat[i], uHslSat[j], t), mix(uHslLum[i], uHslLum[j], t));
    }
  }
  return vec3(uHslHue[0], uHslSat[0], uHslLum[0]);
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

  vec3 lin = vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)) * uWbGains * uExposure;
  float L = dot(lin, LUMA);
  float pl = pow(max(L, 0.0), 1.0 / 2.2);
  float L2 = pow(max(tone(pl), 0.0), 2.2);
  lin = L > 1e-5 ? lin * (L2 / L) : vec3(L2);

  vec3 sc = clamp(lin, 0.0, 1.0);
  sc = vec3(linearToSrgb(sc.r), linearToSrgb(sc.g), linearToSrgb(sc.b));

  vec3 hsl = rgbToHsl(sc);
  vec3 adj = bandAdjust(hsl.x);
  float s0 = hsl.y;
  float h = hsl.x + adj.x;
  h -= floor(h);
  float s = hsl.y * (1.0 + adj.y);
  float l = hsl.z + adj.z * 0.3 * s0;
  s *= 1.0 + uVibrance * (1.0 - clamp(s, 0.0, 1.0));
  s *= 1.0 + uSaturation;
  outColor = vec4(hslToRgb(vec3(h, clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0))), 1.0);
}`;
