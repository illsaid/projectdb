import { MAX_PALETTE, type VisualPreset } from './inputs';
import { BURST_SLOTS } from './step';

export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
`;

const COMMON = `
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uFrame;
uniform vec4 uSeed;
uniform float uHue;
uniform float uScale;
uniform float uWarp;
uniform float uBloom;
uniform float uGrain;
uniform float uBursts[${BURST_SLOTS}];
uniform vec3 uPal[${MAX_PALETTE}];
uniform float uPalN;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float hash2(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)));
  return float(pcg(q.x ^ pcg(q.y + pcg(uint(uSeed.w * 1000.0))))) / 4294967295.0;
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Palette is ordered dark to light; t sweeps through it, uHue rotates the whole set.
vec3 pal(float t) {
  float n = max(uPalN, 2.0);
  float x = clamp(t, 0.0, 1.0) * (n - 1.0);
  int i = int(min(floor(x), n - 2.0));
  vec3 c = mix(uPal[i], uPal[i + 1], smoothstep(0.0, 1.0, x - float(i)));
  return max(hueShift(c, uHue * 6.2831853), 0.0);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 scene(vec2 uv, float t);

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 col = scene(uv, uTime);
  float l = luma(col);
  col += uBloom * (smoothstep(0.35, 1.0, l) * col * 1.6 + 0.08 * col);
  col *= 1.0 - 0.35 * dot(uv, uv);
  float px = min(uRes.x, uRes.y) / 1080.0;
  float g = hash2(floor(frag / max(1.0, px * 1.5)) + vec2(uFrame * 37.0, uFrame * 91.0)) - 0.5;
  col += g * uGrain * GRAIN_AMOUNT;
  col = col / (1.0 + col * 0.25);
  outColor = vec4(pow(max(col, 0.0), vec3(1.0 / 1.1)), 1.0);
}
`;

const DRIFT = `
vec3 scene(vec2 uv, float t) {
  vec2 p = uv * mix(0.8, 5.0, uScale) + uSeed.xy;
  float w = 0.5 + 4.0 * uWarp;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.3)), fbm(p + vec2(5.2, 1.3) - t * 0.2));
  vec2 r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + t * 0.15), fbm(p + w * q + vec2(8.3, 2.8) - t * 0.12));
  float f = fbm(p + w * r);
  vec3 col = pal(smoothstep(0.15, 0.95, f));
  col = mix(col, pal(1.0), smoothstep(0.55, 1.1, length(q) * f) * 0.5);
  return col * (0.35 + 0.9 * f);
}`;

const RINGS = `
vec3 scene(vec2 uv, float t) {
  vec2 wob = vec2(fbm(uv * 2.0 + uSeed.xy + t * 0.3), fbm(uv * 2.0 + uSeed.yz - t * 0.3)) - 0.5;
  float d = length(uv + wob * uWarp * 0.6);
  float freq = mix(6.0, 48.0, uScale);
  float rings = pow(0.5 + 0.5 * sin(d * freq - t * 5.0 + uSeed.z), 8.0);
  vec3 col = pal(0.45 + d * 0.35) * rings * exp(-d * 1.6) * 1.1;
  col += pal(0.0) * 0.8 * (1.0 - smoothstep(0.0, 1.4, d));
  float burst = 0.0;
  for (int i = 0; i < ${BURST_SLOTS}; i++) {
    float age = uBursts[i];
    if (age > 4.0) continue;
    float radius = age * 0.75;
    float width = 0.015 + age * 0.04;
    float x = (d - radius) / width;
    burst += exp(-x * x) * exp(-age * 1.3);
  }
  col += pal(1.0) * burst * 1.4;
  return col;
}`;

const FOG = `
vec3 scene(vec2 uv, float t) {
  float sc = mix(0.5, 3.0, uScale);
  vec2 drift = vec2(t * 0.12, t * 0.035);
  vec2 bend = uWarp * vec2(fbm(uv * 3.0 + uSeed.xy + t * 0.2), fbm(uv * 3.0 + uSeed.zw - t * 0.2));
  float fog = fbm(uv * sc + drift + uSeed.xy + bend * 1.5);
  float layer = fbm(uv * sc * 2.3 - drift * 1.7 + uSeed.zw);
  vec3 col = mix(pal(0.0) * 0.6, pal(0.5), smoothstep(0.2, 0.9, fog * 0.7 + layer * 0.45));
  float aspect = uRes.x / uRes.y;
  vec2 extent = vec2(max(aspect, 1.0), max(1.0 / aspect, 1.0)) * 0.55;
  vec2 a = vec2(sin(t * 0.21 + uSeed.x), cos(t * 0.17 + uSeed.y)) * extent;
  vec2 b = vec2(cos(t * 0.13 + uSeed.z), sin(t * 0.19 + uSeed.w)) * extent;
  col += pal(0.85) * exp(-length(uv - a) * 3.2) * 0.55;
  col += pal(1.0) * exp(-length(uv - b) * 4.5) * 0.4;
  col += vec3(0.04, 0.03, 0.02) * smoothstep(0.6, 1.0, layer);
  return col;
}`;

const INK = `
vec3 scene(vec2 uv, float t) {
  vec2 p = uv * mix(0.7, 3.2, uScale) + uSeed.xy;
  float w = 0.6 + 3.0 * uWarp;
  vec2 flow = vec2(t * 0.05, -t * 0.03);
  vec2 q = vec2(fbm(p + flow), fbm(p + vec2(3.1, 7.4) - flow));
  vec2 r = vec2(fbm(p + w * q + vec2(1.3, 4.9) + t * 0.07), fbm(p + w * q + vec2(6.2, 2.1) - t * 0.06));
  float f = fbm(p + w * r + 0.6 * vec2(-r.y, r.x));
  vec3 paper = mix(pal(1.0), vec3(0.92, 0.88, 0.8), 0.55);
  paper *= 0.93 + 0.07 * fbm(uv * 14.0 + uSeed.zw);
  vec3 ink = mix(pal(0.0), vec3(0.03, 0.035, 0.05), 0.5);
  vec3 col = mix(paper, mix(paper, pal(0.4), 0.4), smoothstep(0.34, 0.5, f) * 0.8);
  col = mix(col, ink, smoothstep(0.5, 0.62, f));
  float rim = smoothstep(0.45, 0.5, f) - smoothstep(0.5, 0.56, f);
  return mix(col, pal(0.55) * 0.55, rim * 0.45);
}`;

// Each onset sweeps every line field through a whole number of periods, so a finished jump is
// invisible and reusing its slot cannot pop; the ease keeps it well under the flash limit.
const INTERFERENCE = `
float lines(vec2 p, float ang, float freq, float ph) {
  return 0.5 + 0.5 * cos(dot(p, vec2(cos(ang), sin(ang))) * freq + ph);
}
vec3 scene(vec2 uv, float t) {
  vec2 bend = (vec2(fbm(uv * 1.5 + uSeed.xy + t * 0.1), fbm(uv * 1.5 + uSeed.zw - t * 0.1)) - 0.5) * uWarp * 0.5;
  vec2 p = uv + bend;
  float freq = mix(30.0, 140.0, uScale);
  float jump = 0.0;
  for (int i = 0; i < ${BURST_SLOTS}; i++) jump += smoothstep(0.0, 0.6, uBursts[i]);
  jump *= 6.2831853;
  float a = lines(p, uSeed.x + t * 0.11, freq, t * 0.6 + jump);
  float b = lines(p, uSeed.x + 0.06 - t * 0.07, freq * 1.03, -t * 0.4 - jump);
  float c = lines(p * (1.0 + 0.04 * sin(t * 0.13)), uSeed.x + 1.2 + t * 0.05, freq * 0.97, 2.0 * jump);
  float m = (a * b + b * c + c * a) / 3.0;
  vec3 col = mix(pal(0.0) * 0.5, pal(0.75), smoothstep(0.05, 0.6, m));
  return col + pal(1.0) * pow(a * b * c, 3.0) * 0.6;
}`;

const HORIZON = `
float terrain(vec2 p) {
  float h = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    h += a * noise(p);
    p = r * p * 2.1 + 3.7;
    a *= 0.5;
  }
  return h;
}
vec3 scene(vec2 uv, float t) {
  float amp = mix(0.4, 1.4, uWarp);
  float freq = mix(0.25, 0.9, uScale);
  float yaw = 0.25 * sin(t * 0.03 + uSeed.z);
  vec3 ro = vec3(uSeed.x + 2.0 * sin(t * 0.05), amp * 0.95 + 0.15, uSeed.y + t * 1.2);
  vec3 rd = normalize(vec3(uv.x, uv.y - 0.12, 1.0));
  rd.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * rd.xz;
  float d = 0.05;
  float hit = 0.0;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * d;
    float gap = p.y - amp * terrain(p.xz * freq);
    if (gap < 0.002 * d) { hit = 1.0; break; }
    d += max(0.01, gap * 0.5);
    if (d > 30.0) break;
  }
  vec3 sun = normalize(vec3(0.4 * sin(uSeed.w), 0.35, 1.0));
  vec3 sky = mix(pal(0.55), pal(0.9), smoothstep(-0.1, 0.5, rd.y));
  sky += pal(1.0) * pow(max(dot(rd, sun), 0.0), 8.0) * 0.5;
  if (hit < 0.5) return sky;
  vec3 p = ro + rd * d;
  vec2 e = vec2(0.02, 0.0);
  float h = amp * terrain(p.xz * freq);
  vec3 n = normalize(vec3(h - amp * terrain((p.xz + e.xy) * freq), e.x, h - amp * terrain((p.xz + e.yx) * freq)));
  vec3 ground = pal(0.1 + 0.35 * h / amp) * (0.35 + 0.65 * max(dot(n, sun), 0.0));
  float haze = 1.0 - exp(-d * 0.09);
  float bank = fbm(p.xz * 0.3 + vec2(t * 0.08, 0.0)) * (1.0 - smoothstep(0.0, amp * 0.5, p.y));
  return mix(ground, mix(sky, pal(0.7), 0.4), clamp(haze + bank * 0.5, 0.0, 1.0));
}`;

const build = (grain: number, scene: string) => `${HEADER}#define GRAIN_AMOUNT ${grain.toFixed(2)}\n${COMMON}${scene}`;

export const FRAGMENT_SHADERS: Record<VisualPreset, string> = {
  drift: build(0.22, DRIFT),
  rings: build(0.18, RINGS),
  fog: build(0.5, FOG),
  ink: build(0.3, INK),
  interference: build(0.12, INTERFERENCE),
  horizon: build(0.25, HORIZON),
};
