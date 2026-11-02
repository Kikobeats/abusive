struct Params {
  resolution: vec2f,
  dpr: f32,
  time: f32,
  lens: vec4f,
  theme: f32,
  fontSize: f32,
  scrim: vec2f,
  reveal: f32,
  drift: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlasSampler: sampler;
@group(0) @binding(3) var lines: texture_2d<u32>;

const ATLAS_SIZE = vec2f(368.0, 240.0);
const ATLAS_CELL = vec2f(23.0, 40.0);
const ATLAS_COLUMNS = 16u;
const ATLAS_TEXELS_PER_EM = 25.0;
const ATLAS_PAD = 4.0;
const ATLAS_ASCENT_EM = 0.95;
const ATLAS_SPREAD = 4.0;

const CELL_EM = vec2f(0.6, 1.62);
const BASELINE_EM = 1.08;
const BLOCK_CELLS = 46;
const TEXT_CELLS = 36;
const FIELD_COUNT = 16u;
const KEY_END_TEXEL = 36;
const LINE_LENGTH_TEXEL = 37;
const TAG_MIN_CHARS = 2;
const TAG_SPAN_CHARS = 5u;
const PLUS = 43u;


const KIND_NONE = 0u;
const KIND_KEY = 1u;
const KIND_CIPHER = 2u;
const KIND_FRAME = 3u;

const LENS_CXY = 24.0;
const RING_OUTER = 24.0;
const RING_INNER = 15.8;
const HANDLE_FROM = 20.0;
const HANDLE_TO = 46.0;
const HANDLE_HALF = 4.0;
const HANDLE_ANGLE = radians(45.0);
const HANDLE_CORNER = 0.6;
const MARK_CENTER = vec2f(30.0, 30.0);
const LENS_CENTER = vec2f(LENS_CXY, LENS_CXY);
const LENS_ZOOM = 1.9;
const LENS_PINCUSHION = 0.3;
const LENS_DISPERSION = 0.012;

const SLAB_CORE = 1.35;
const INNER_GLOW_REACH = 3.0;
const BEVEL = 1.2;
const GLASS_IOR = 1.5;
const GLASS_DISPERSION = 0.05;
const TEXT_PLANE_DEPTH = 5.0;
const INNER_STEPS = 12;
const BOUNCES = 2;
const REFRACT_MAX_PX = 44.0;
const BACK_FACE_PARALLAX = vec2f(-0.75, 1.2);

const SCRIM_FLOOR = 0.1;
const SCRIM_RAMP_PX = 140.0;
const MOBILE_SCRIM_RAMP_PX = 80.0;
const FOCUS_REACH_UNITS = 11.0;
const FOCUS_RADIUS_UNITS = 64.0;
const EDGE_FALLOFF_PX = 230.0;
const LOCAL_VIGNETTE_PX = 120.0;
const BEHIND_GLASS_FOCUS = 0.3;
const DARK_BEHIND_GAIN = 1.3;

const TO_LIGHT_2D = vec2f(-0.2588, -0.9659);
const SHADOW_OFFSET_UNITS = vec2f(1.8, 3.9);
const COOL_WHITE = vec3f(0.94, 0.97, 1.0);
const CONTACT_OFFSET_PX = 8.0;
const CONTACT_FALLOFF_PX = 4.0;
const CONTACT_TINT = vec3f(0.66, 0.72, 0.8);
const LIGHT_CAUSTIC = vec3f(0.86, 0.93, 1.0);
const LIGHT_BEVEL_SHADE = vec3f(0.72, 0.78, 0.86);
const LIGHT_BEHIND_FOCUS = 0.7;
const LIGHT_BEHIND_GAIN = 1.25;
const LIGHT_LOCAL_SHADE = 0.05;
const LIGHT_BODY_TINT = vec3f(0.955, 0.97, 0.99);
const DARK_BODY_TINT = vec3f(0.86, 0.92, 1.0);
const DARK_FIELD_TINT = vec3f(0.9, 0.95, 1.0);
const DARK_GLASS_TINT = vec3f(0.88, 0.94, 1.0);
const LIGHT_GLASS_TINT = vec3f(0.965, 0.98, 1.0);
const DARK_SKY = vec3f(0.4, 0.46, 0.56);
const LIGHT_SKY_TINT = vec3f(0.88, 0.92, 0.97);
const DARK_RIM = vec3f(0.6, 0.8, 1.0);

const DARK_BG = vec3f(0.047, 0.059, 0.078);
const DARK_TEXT = vec3f(0.91, 0.925, 0.953);
const DARK_MUTED = vec3f(0.639, 0.671, 0.722);
const DARK_ACCENT = vec3f(0.302, 0.639, 1.0);
const LIGHT_BG = vec3f(0.973, 0.98, 0.992);
const LIGHT_TEXT = vec3f(0.063, 0.078, 0.11);
const LIGHT_MUTED = vec3f(0.325, 0.361, 0.42);
const LIGHT_ACCENT = vec3f(0.043, 0.357, 0.827);

struct Palette {
  bg: vec3f,
  text: vec3f,
  muted: vec3f,
  accent: vec3f,
}

struct Glyph {
  code: u32,
  kind: u32,
}

struct Lens {
  center: vec2f,
  scale: f32,
  angle: f32,
}

fn palette() -> Palette {
  let t = params.theme;
  return Palette(
    mix(DARK_BG, LIGHT_BG, t),
    mix(DARK_TEXT, LIGHT_TEXT, t),
    mix(DARK_MUTED, LIGHT_MUTED, t),
    mix(DARK_ACCENT, LIGHT_ACCENT, t),
  );
}

fn currentLens() -> Lens {
  return Lens(params.lens.xy, params.lens.z * mix(0.94, 1.0, params.reveal), params.lens.w);
}

fn hashU(value: u32) -> u32 {
  var state = value * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn hash2(a: i32, b: i32) -> u32 {
  return hashU(bitcast<u32>(a) ^ hashU(bitcast<u32>(b) + 0x9e3779b9u));
}

fn unitHash(value: u32) -> f32 {
  return f32(value & 0xffffu) / 65535.0;
}

fn valueNoise(p: vec2f) -> f32 {
  let cell = floor(p);
  let f = p - cell;
  let u = f * f * (3.0 - 2.0 * f);
  let c = vec2i(cell);
  let a = unitHash(hash2(c.x, c.y));
  let b = unitHash(hash2(c.x + 1, c.y));
  let d = unitHash(hash2(c.x, c.y + 1));
  let e = unitHash(hash2(c.x + 1, c.y + 1));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

fn tagCode(index: u32) -> u32 {
  let k = index % 36u;
  if (k < 26u) { return 97u + k; }
  return 48u + k - 26u;
}

fn lineTexel(column: i32, row: u32) -> u32 {
  return textureLoad(lines, vec2i(column, i32(row)), 0).r;
}

fn rotate(v: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

fn toMarkSpace(position: vec2f, lens: Lens) -> vec2f {
  return rotate(position - lens.center, -lens.angle) / lens.scale + MARK_CENTER;
}

fn fieldGlyph(cell: vec2i) -> Glyph {
  let shift = i32(hashU(bitcast<u32>(cell.y) * 3u + 17u) % u32(BLOCK_CELLS));
  let shifted = cell.x + shift;
  let block = i32(floor(f32(shifted) / f32(BLOCK_CELLS)));
  let column = shifted - block * BLOCK_CELLS;
  if (column >= TEXT_CELLS) { return Glyph(32u, KIND_NONE); }

  let lineSeed = hash2(block, cell.y);
  let line = lineSeed % FIELD_COUNT;
  let localEnd = i32(lineTexel(KEY_END_TEXEL, line));
  if (column < localEnd) { return Glyph(lineTexel(column, line), KIND_KEY); }

  let offset = column - localEnd;
  if (offset == 0) { return Glyph(PLUS, KIND_CIPHER); }
  let tagEnd = 1 + TAG_MIN_CHARS + i32((lineSeed >> 9u) % TAG_SPAN_CHARS);
  if (offset < tagEnd) {
    let cellSeed = hash2(cell.x * 7 + 3, cell.y * 13 + 5);
    let rate = 0.08 + 0.3 * unitHash(cellSeed >> 3u);
    let epoch = u32(floor(params.time * rate + unitHash(cellSeed >> 11u) * 9.0));
    return Glyph(tagCode(hashU(cellSeed ^ (epoch * 0x85ebca6bu))), KIND_CIPHER);
  }
  let index = localEnd + offset - tagEnd;
  if (index < i32(lineTexel(LINE_LENGTH_TEXEL, line))) { return Glyph(lineTexel(index, line), KIND_FRAME); }
  return Glyph(32u, KIND_NONE);
}

fn glyphSdf(code: u32, emX: f32, emUp: f32) -> f32 {
  let index = min(max(code, 32u), 126u) - 32u;
  let origin = vec2f(f32(index % ATLAS_COLUMNS), f32(index / ATLAS_COLUMNS)) * ATLAS_CELL;
  let local = vec2f(ATLAS_PAD + emX * ATLAS_TEXELS_PER_EM, ATLAS_PAD + (ATLAS_ASCENT_EM - emUp) * ATLAS_TEXELS_PER_EM);
  let texel = origin + clamp(local, vec2f(0.5), ATLAS_CELL - vec2f(0.5));
  return textureSampleLevel(atlas, atlasSampler, texel / ATLAS_SIZE, 0.0).r;
}

fn glyphCoverage(code: u32, emX: f32, emUp: f32, fontSize: f32, softness: f32) -> vec2f {
  let sdf = glyphSdf(code, emX, emUp);
  let texelsPerPixel = ATLAS_TEXELS_PER_EM / (fontSize * params.dpr);
  let width = (0.5 / ATLAS_SPREAD) * texelsPerPixel * 0.75 + softness;
  return vec2f(smoothstep(0.5 - width, 0.5 + width, sdf), smoothstep(0.08, 0.5, sdf));
}

struct FieldSample {
  coverage: f32,
  kind: u32,
  shade: f32,
}

fn sampleField(position: vec2f, fontSize: f32, scroll: f32, softness: f32) -> FieldSample {
  let cellSize = CELL_EM * fontSize;
  let scrolled = position + vec2f(0.0, scroll);
  let cellF = floor(scrolled / cellSize);
  let cell = vec2i(cellF);
  let glyph = fieldGlyph(cell);
  if (glyph.kind == KIND_NONE) { return FieldSample(0.0, KIND_NONE, 0.0); }

  let local = (scrolled - cellF * cellSize) / fontSize;
  let seed = hash2(cell.x * 31 + 7, cell.y * 17 + 11);
  let jitter = (unitHash(seed) - 0.5) * 0.12;
  let shade = 0.55 + 0.45 * unitHash(seed >> 5u);
  let coverage = glyphCoverage(glyph.code, local.x, BASELINE_EM - local.y - jitter, fontSize, softness);
  return FieldSample(coverage.x, glyph.kind, shade);
}

fn sdBox(p: vec2f, lo: vec2f, hi: vec2f, corner: f32) -> f32 {
  let center = (lo + hi) * 0.5;
  let half = (hi - lo) * 0.5 - vec2f(corner);
  let q = abs(p - center) - half;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - corner;
}

fn sdRing(p: vec2f) -> f32 {
  let mid = (RING_OUTER + RING_INNER) * 0.5;
  let half = (RING_OUTER - RING_INNER) * 0.5;
  return abs(length(p - LENS_CENTER) - mid) - half;
}

fn sdHandle(p: vec2f) -> f32 {
  let local = rotate(p - LENS_CENTER, -HANDLE_ANGLE);
  return sdBox(local, vec2f(HANDLE_FROM, -HANDLE_HALF), vec2f(HANDLE_TO, HANDLE_HALF), HANDLE_CORNER);
}

fn sdMark(p: vec2f) -> f32 {
  return min(sdRing(p), sdHandle(p));
}

fn lensDistance(p: vec2f) -> f32 {
  return length(p - LENS_CENTER) - RING_INNER;
}

fn markGradient(p: vec2f, d: f32) -> vec2f {
  let e = 0.03;
  let g = vec2f(sdMark(p + vec2f(e, 0.0)) - d, sdMark(p + vec2f(0.0, e)) - d) / e;
  return g / max(length(g), 1e-4);
}

fn slabDistance(p: vec3f) -> f32 {
  let w = vec2f(sdMark(p.xy) + BEVEL, abs(p.z) - SLAB_CORE);
  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0))) - BEVEL;
}

fn slabNormal(p: vec3f) -> vec3f {
  let e = vec2f(1.0, -1.0) * 0.012;
  return normalize(
    e.xyy * slabDistance(p + e.xyy) +
    e.yyx * slabDistance(p + e.yyx) +
    e.yxy * slabDistance(p + e.yxy) +
    e.xxx * slabDistance(p + e.xxx)
  );
}

fn fieldWeight(position: vec2f, markPoint: vec2f, markDistance: f32, lens: Lens) -> vec3f {
  var scrim = 1.0;
  if (params.scrim.x > 0.0) {
    scrim = mix(SCRIM_FLOOR, 1.0, smoothstep(params.scrim.x, params.scrim.x + SCRIM_RAMP_PX, position.x));
  }
  if (params.scrim.y > 0.0) {
    scrim = min(scrim, mix(SCRIM_FLOOR, 1.0, smoothstep(params.scrim.y, params.scrim.y + MOBILE_SCRIM_RAMP_PX, position.y)));
  }
  let reach = max(markDistance, 0.0) / FOCUS_REACH_UNITS;
  let fromCenter = length(markPoint - MARK_CENTER) / FOCUS_RADIUS_UNITS;
  let focus = exp(-reach * reach) * exp(-fromCenter * fromCenter);
  let size = params.resolution / params.dpr;
  let edge = min(min(position.x, size.x - position.x), min(position.y, size.y - position.y));
  let vignette = smoothstep(0.0, EDGE_FALLOFF_PX, edge);
  return vec3f(scrim * focus * vignette, focus, scrim);
}

fn perpendicular(v: vec2f) -> vec2f {
  return vec2f(-v.y, v.x);
}

fn lensWorld(lens: Lens) -> vec2f {
  return lens.center + rotate((LENS_CENTER - MARK_CENTER) * lens.scale, lens.angle);
}

fn outsideInk(kind: u32, colors: Palette) -> vec4f {
  let light = params.theme;
  if (kind == KIND_KEY) { return vec4f(colors.muted, mix(0.32, 0.24, light)); }
  if (kind == KIND_FRAME) { return vec4f(colors.muted, mix(0.19, 0.13, light)); }
  return vec4f(mix(colors.muted, colors.accent, 0.35), mix(0.26, 0.16, light));
}

fn fieldColor(position: vec2f, colors: Palette, strength: f32, focus: f32, gain: f32) -> vec3f {
  let color = colors.bg;
  if (strength < 0.01) { return color; }
  let defocus = (1.0 - focus) * 0.1;
  let front = sampleField(position, params.fontSize, params.drift, defocus);
  if (front.kind == KIND_NONE) { return color; }
  let ink = outsideInk(front.kind, colors);
  return mix(color, ink.rgb, clamp(front.coverage * front.shade * ink.a * strength * gain, 0.0, 1.0));
}

fn fresnel(cosine: f32) -> f32 {
  return 0.04 + 0.96 * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

fn environment(direction: vec3f, colors: Palette, toLight: vec3f) -> vec3f {
  let alignment = max(dot(direction, toLight), 0.0);
  let horizon = 1.0 - abs(direction.z);
  let darkSky = colors.bg * 0.5 + DARK_SKY * pow(horizon, 3.0) + COOL_WHITE * (pow(alignment, 30.0) * 1.6 + pow(alignment, 5.0) * 0.14);
  let lightSky = mix(colors.bg * LIGHT_SKY_TINT, colors.text, 0.05 + 0.38 * pow(horizon, 2.0)) + vec3f(pow(alignment, 30.0) * 0.6);
  return mix(darkSky, lightSky, params.theme);
}

struct GlassExit {
  shift: vec2f,
  shiftRed: vec2f,
  shiftBlue: vec2f,
  path: f32,
  trapped: f32,
}

fn exitShift(position: vec3f, direction: vec3f) -> vec2f {
  let floorZ = -(SLAB_CORE + BEVEL) - TEXT_PLANE_DEPTH;
  let travel = (floorZ - position.z) / min(direction.z, -0.05);
  return position.xy + direction.xy * travel;
}

fn traceGlass(entry: vec3f, normal: vec3f) -> GlassExit {
  var direction = refract(vec3f(0.0, 0.0, -1.0), normal, 1.0 / GLASS_IOR);
  var position = entry + direction * 0.01;
  var path = 0.0;
  var trapped = 0.0;
  for (var bounce = 0; bounce < BOUNCES; bounce += 1) {
    var travel = 0.0;
    for (var step = 0; step < INNER_STEPS; step += 1) {
      let distance = -slabDistance(position + direction * travel);
      if (distance < 0.003) { break; }
      travel += max(distance, 0.02);
    }
    path += travel;
    position += direction * travel;
    let exitNormal = -slabNormal(position);
    let green = refract(direction, exitNormal, GLASS_IOR);
    if (dot(green, green) < 0.5) {
      direction = reflect(direction, exitNormal);
      position += direction * 0.01;
      trapped += 1.0;
      continue;
    }
    let red = refract(direction, exitNormal, GLASS_IOR - GLASS_DISPERSION);
    let blue = refract(direction, exitNormal, GLASS_IOR + GLASS_DISPERSION);
    return GlassExit(
      exitShift(position, green) - entry.xy,
      exitShift(position, select(green, red, dot(red, red) > 0.5)) - entry.xy,
      exitShift(position, select(green, blue, dot(blue, blue) > 0.5)) - entry.xy,
      path,
      trapped,
    );
  }
  let fallback = position.xy - entry.xy;
  return GlassExit(fallback, fallback, fallback, path, trapped);
}

fn refractedField(position: vec2f, shiftUnits: vec2f, lens: Lens, colors: Palette, weight: vec3f) -> vec3f {
  var shift = rotate(shiftUnits * lens.scale, lens.angle);
  let length2 = dot(shift, shift);
  if (length2 > REFRACT_MAX_PX * REFRACT_MAX_PX) { shift *= REFRACT_MAX_PX / sqrt(length2); }
  return fieldColor(position + shift, colors, min(1.0, weight.x * 2.4 + 0.3), 1.0, mix(1.7, 3.2, params.theme));
}

fn glassInterior(position: vec2f, colors: Palette, d: f32, markPoint: vec2f, lens: Lens) -> vec3f {
  let dark = 1.0 - params.theme;
  let depth = -d - BEVEL;
  let magnified = position - (position - lens.center) * 0.08 + rotate(vec2f(0.0, -1.3), lens.angle) * lens.scale;
  let behind = fieldColor(magnified, colors, 1.0, mix(BEHIND_GLASS_FOCUS, LIGHT_BEHIND_FOCUS, params.theme), mix(DARK_BEHIND_GAIN, LIGHT_BEHIND_GAIN, params.theme));
  let darkBody = behind * DARK_BODY_TINT + colors.accent * (0.008 + 0.04 * exp(-max(depth, 0.0) / 1.3));
  let lightBody = behind * LIGHT_BODY_TINT;
  var body = mix(lightBody, darkBody, dark);

  let parallax = rotate(BACK_FACE_PARALLAX, -lens.angle);
  let back = sdMark(markPoint - parallax) + BEVEL * 0.5;
  let backEdge = exp(-pow(back / (1.1 / lens.scale + 0.09), 2.0));
  let backInk = mix(colors.text * 0.55, colors.accent * 0.55 + vec3f(0.04), dark);
  body = mix(body, backInk, backEdge * mix(0.3, 0.4, dark));
  return body;
}

fn glassColor(position: vec2f, markPoint: vec2f, d: f32, gradientMark: vec2f, lens: Lens, colors: Palette, weight: vec3f) -> vec3f {
  let dark = 1.0 - params.theme;
  let interior = glassInterior(position, colors, d, markPoint, lens);

  var normal = vec3f(0.0, 0.0, 1.0);
  var entryZ = SLAB_CORE + BEVEL;
  let bevelOffset = d + BEVEL;
  if (bevelOffset > 0.0) {
    let e = min(bevelOffset, BEVEL * 0.999);
    let lift = sqrt(BEVEL * BEVEL - e * e);
    entryZ = SLAB_CORE + lift;
    normal = normalize(vec3f(gradientMark * e, lift));
  }

  var transmitted: vec3f;
  var path = 2.0 * (SLAB_CORE + BEVEL);
  var trapped = 0.0;
  if (bevelOffset > 0.0) {
    let exit = traceGlass(vec3f(markPoint, entryZ), normal);
    path = exit.path;
    trapped = exit.trapped;
    let red = refractedField(position, exit.shiftRed, lens, colors, weight);
    let green = refractedField(position, exit.shift, lens, colors, weight);
    let blue = refractedField(position, exit.shiftBlue, lens, colors, weight);
    let field = vec3f(red.r, green.g, blue.b);
    let band = smoothstep(0.0, BEVEL * 0.35, bevelOffset);
    transmitted = mix(interior, mix(field * DARK_FIELD_TINT, field, params.theme), band);
  } else {
    transmitted = interior;
  }

  let tint = mix(DARK_GLASS_TINT, LIGHT_GLASS_TINT, params.theme);
  transmitted *= pow(tint, vec3f(path * 0.17));

  let worldNormal = vec3f(rotate(normal.xy, lens.angle), normal.z);
  let toLight = normalize(vec3f(TO_LIGHT_2D, 0.75));
  let reflected = reflect(vec3f(0.0, 0.0, -1.0), worldNormal);
  var color = mix(transmitted, environment(reflected, colors, toLight), fresnel(worldNormal.z));

  let spread = 0.04;
  let glint = vec3f(
    pow(max(dot(reflected, normalize(toLight + vec3f(-spread, 0.0, 0.0))), 0.0), 160.0),
    pow(max(dot(reflected, toLight), 0.0), 160.0),
    pow(max(dot(reflected, normalize(toLight + vec3f(spread, 0.0, 0.0))), 0.0), 160.0),
  );
  color += COOL_WHITE * glint * mix(1.2, 0.8, params.theme) * 0.5;

  let outward = rotate(gradientMark, lens.angle);
  let facing = dot(outward, TO_LIGHT_2D);
  let inset = -d;
  let streakLine = exp(-pow((inset - BEVEL * 0.32) / (BEVEL * mix(0.16, 0.2, params.theme)), 2.0));
  let streak = streakLine * smoothstep(0.02, 0.55, facing);
  let lightFacing = smoothstep(0.02, 0.55, facing);
  let refractionBand = exp(-pow((inset - BEVEL * 0.66) / (BEVEL * 0.18), 2.0)) * lightFacing;
  let bevelDepth = smoothstep(BEVEL * 1.02, BEVEL * 0.1, inset);
  let shadeSide = 0.6 + 0.4 * (1.0 - lightFacing);
  color = mix(color, color * LIGHT_BEVEL_SHADE, bevelDepth * shadeSide * params.theme);
  let refractionEdge = 1.0 - smoothstep(0.6, 1.4, abs(inset - BEVEL) * lens.scale);
  color = mix(color, colors.text * 0.6 + colors.accent * 0.25, refractionEdge * mix(0.22, 0.42, 1.0 - lightFacing) * params.theme);
  color = mix(color, colors.text * 0.55 + colors.accent * 0.3, refractionBand * 0.3 * params.theme);
  let lightStreak = exp(-pow((inset - BEVEL * 0.3) / max(BEVEL * 0.1, 1.1 / lens.scale), 2.0)) * smoothstep(0.02, 0.45, facing);
  color = mix(color, COOL_WHITE * 1.15, clamp(streak * 0.95, 0.0, 1.0) * dark);
  color = mix(color, vec3f(1.0), clamp(lightStreak, 0.0, 1.0) * params.theme);

  let shadowSide = smoothstep(-0.1, -0.7, facing);
  let innerLine = exp(-pow((inset - BEVEL * 0.7) / (BEVEL * 0.14), 2.0)) * shadowSide;
  let causticRipple = 0.6 + 0.4 * valueNoise(markPoint * vec2f(0.6, 1.6) + vec2f(params.time * 0.25, 0.0));
  let innerGlow = exp(-max(inset - BEVEL, 0.0) / 2.0) * shadowSide * smoothstep(0.0, BEVEL, inset) * (1.0 - smoothstep(BEVEL, INNER_GLOW_REACH, inset)) * causticRipple;
  color += colors.accent * (innerLine * 0.55 + innerGlow * 0.2) * dark;
  color = mix(color, colors.accent, (innerLine * 0.25 + innerGlow * 0.1) * params.theme);

  let rimBand = smoothstep(-BEVEL, 0.0, d);
  color += colors.accent * trapped * 0.024 * dark;
  let underside = clamp(-facing, 0.0, 1.0) * rimBand;
  color = mix(color, colors.text * 0.6 + colors.accent * 0.4, underside * 0.34 * params.theme);
  color *= 1.0 - underside * 0.25 * dark;

  let sweepPhase = fract(params.time * 0.07);
  let sweepLine = dot(position - lens.center, normalize(vec2f(1.0, -0.6))) / (lens.scale * 45.0) - (sweepPhase * 3.0 - 1.5);
  color += vec3f(exp(-sweepLine * sweepLine * 90.0) * 0.05 * dark);
  return color;
}

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn magnifiedAt(position: vec2f, center: vec2f, r: f32, zoom: f32, colors: Palette) -> f32 {
  let source = center + (position - center) / (zoom * (1.0 + LENS_PINCUSHION * r * r));
  return luminance(fieldColor(source, colors, 1.0, 1.0, mix(2.6, 3.2, params.theme)));
}

fn lensView(position: vec2f, markPoint: vec2f, colors: Palette, lens: Lens) -> vec3f {
  let dark = 1.0 - params.theme;
  let center = lensWorld(lens);
  let fromCenter = markPoint - LENS_CENTER;
  let r = length(fromCenter) / RING_INNER;
  let spread = LENS_DISPERSION * r * r;
  let source = center + (position - center) / (LENS_ZOOM * (1.0 + LENS_PINCUSHION * r * r));
  let field = fieldColor(source, colors, 1.0, 1.0, mix(2.6, 3.2, params.theme));
  let fringe = vec2f(magnifiedAt(position, center, r, LENS_ZOOM * (1.0 - spread), colors), magnifiedAt(position, center, r, LENS_ZOOM * (1.0 + spread), colors)) - luminance(field);
  var color = field + vec3f(fringe.x, 0.0, fringe.y) * smoothstep(0.4, 1.0, r);
  color = mix(color, color * LIGHT_GLASS_TINT, params.theme);
  color += colors.accent * 0.04 * smoothstep(0.55, 1.0, r) * dark;
  let toward = dot(rotate(fromCenter / max(length(fromCenter), 1e-4), lens.angle), -TO_LIGHT_2D);
  let sheen = exp(-pow((r - 0.8) / 0.09, 2.0)) * smoothstep(0.35, 0.95, -toward);
  color += COOL_WHITE * sheen * mix(0.07, 0.12, params.theme);
  return mix(color, color * mix(0.8, 0.94, params.theme), smoothstep(0.82, 1.0, r));
}

fn lightCaustic(position: vec2f, lens: Lens) -> f32 {
  let focusPoint = lensWorld(lens) - TO_LIGHT_2D * (RING_OUTER + 3.5) * lens.scale;
  let rel = position - focusPoint;
  let along = dot(rel, perpendicular(TO_LIGHT_2D)) / (RING_OUTER * 0.45 * lens.scale);
  let across = dot(rel, TO_LIGHT_2D) / (1.4 * lens.scale);
  let ripple = 0.75 + 0.25 * valueNoise(rel / lens.scale * 0.9 + vec2f(params.time * 0.2, 0.0));
  return exp(-(along * along + across * across)) * ripple * 0.6;
}

fn darkGround(color: vec3f, position: vec2f, lens: Lens, colors: Palette, weight: vec3f) -> vec3f {
  let offset = SHADOW_OFFSET_UNITS * lens.scale;
  let shadowDistance = sdMark(toMarkSpace(position - offset, lens)) * lens.scale;
  let shadow = exp(-max(shadowDistance, 0.0) / 22.0) * smoothstep(-26.0, 6.0, shadowDistance) * params.reveal;
  var lit = color * (1.0 - shadow * 0.62);
  let causticPoint = toMarkSpace(position - offset * 0.82, lens);
  let causticDistance = sdMark(causticPoint);
  let ripple = 0.65 + 0.35 * valueNoise(causticPoint * 0.6 + vec2f(params.time * 0.15, 0.0));
  let caustic = (exp(-pow((causticDistance + 1.5) / 0.75, 2.0)) * 0.9 + smoothstep(0.45, -3.6, causticDistance) * 0.16) * ripple;
  let energy = caustic * params.reveal * weight.z;
  lit += colors.accent * energy * 0.42;
  let halo = exp(-max(shadowDistance, 0.0) / 70.0);
  return lit + colors.accent * halo * 0.035 * params.reveal * weight.z;
}

fn lightGround(color: vec3f, position: vec2f, distancePx: f32, lens: Lens, colors: Palette) -> vec3f {
  let contactDistance = sdMark(toMarkSpace(position + TO_LIGHT_2D * CONTACT_OFFSET_PX, lens)) * lens.scale;
  let contact = exp(-max(contactDistance, 0.0) / CONTACT_FALLOFF_PX) * smoothstep(-3.0, 0.0, distancePx) * params.reveal;
  let lit = color * mix(vec3f(1.0), CONTACT_TINT, contact * 0.85);
  return mix(lit, LIGHT_CAUSTIC * colors.bg, lightCaustic(position, lens) * params.reveal);
}

fn groundLight(color: vec3f, position: vec2f, distancePx: f32, lens: Lens, colors: Palette, weight: vec3f) -> vec3f {
  var dark = color;
  var light = color;
  if (params.theme < 1.0) { dark = darkGround(color, position, lens, colors, weight); }
  if (params.theme > 0.0) { light = lightGround(color, position, distancePx, lens, colors); }
  return mix(dark, light, params.theme);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let colors = palette();
  let position = uv * params.resolution / params.dpr;
  let lens = currentLens();
  let pixel = 1.0 / params.dpr;
  let dark = 1.0 - params.theme;

  let markPoint = toMarkSpace(position, lens);
  let d = sdMark(markPoint);
  let distancePx = d * lens.scale;
  let coverage = smoothstep(pixel, -pixel, distancePx) * params.reveal;
  let weight = fieldWeight(position, markPoint, d, lens);

  var gradientMark = vec2f(0.0, 1.0);
  if (distancePx < 90.0) { gradientMark = markGradient(markPoint, d); }
  let facing = dot(rotate(gradientMark, lens.angle), TO_LIGHT_2D);
  let towardLight = clamp(facing * 0.5 + 0.5, 0.0, 1.0);

  var color = colors.bg;
  if (coverage < 1.0) {
    color = fieldColor(position, colors, weight.x, weight.y, 1.0);
    if (distancePx < 260.0) { color = groundLight(color, position, distancePx, lens, colors, weight); }
    let localShade = exp(-max(distancePx, 0.0) / LOCAL_VIGNETTE_PX) * params.reveal;
    color *= 1.0 - localShade * mix(0.22, LIGHT_LOCAL_SHADE, params.theme);
    let outer = exp(-max(distancePx, 0.0) / 7.0) * params.reveal * dark;
    color += COOL_WHITE * outer * pow(towardLight, 3.0) * 0.16 + colors.accent * outer * (1.0 - towardLight) * 0.07;
    let inLens = smoothstep(pixel, -pixel, lensDistance(markPoint) * lens.scale) * params.reveal;
    if (inLens > 0.0) { color = mix(color, lensView(position, markPoint, colors, lens), inLens); }
  }

  if (coverage > 0.0) {
    let glass = glassColor(position, markPoint, d, gradientMark, lens, colors, weight);
    color = mix(color, glass, coverage);
  }

  let shadowSide = 1.0 - towardLight;
  let darkRimProfile = exp(-abs(distancePx + 0.4) * params.dpr * 0.85);
  let inkHalfWidth = mix(0.55, 1.05, smoothstep(0.35, 0.8, shadowSide));
  let inkProfile = 1.0 - smoothstep(inkHalfWidth - 0.5 * pixel, inkHalfWidth + 0.5 * pixel, abs(distancePx + inkHalfWidth));
  let rim = mix(darkRimProfile, inkProfile, params.theme) * params.reveal;
  let darkRim = mix(DARK_RIM, COOL_WHITE, towardLight);
  let darkRimAlpha = 0.32 + 0.68 * towardLight;
  let lightRimAlpha = 0.28 + 0.66 * smoothstep(0.3, 0.85, shadowSide);
  color = mix(color, mix(darkRim, colors.text, params.theme), clamp(rim * mix(darkRimAlpha, lightRimAlpha, params.theme), 0.0, 1.0));

  let grain = (unitHash(hash2(i32(uv.x * params.resolution.x), i32(uv.y * params.resolution.y) + i32(params.time * 30.0) * 7919)) - 0.5) / 255.0 * 1.5;
  return vec4f(color + grain, 1.0);
}
