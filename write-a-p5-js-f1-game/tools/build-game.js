const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "game.js");

const TRACK_WIDTH = 620;
const SILVERSTONE_SVG_PATH = path.join(ROOT, "references", "silverstone-2011.svg");
const SILVERSTONE_TRACK_PATH_ID = "path2552-7";

const WORLD = {
  minX: -16500,
  maxX: 16500,
  minY: -13000,
  maxY: 13000,
};

function extractSvgPath(svg, id) {
  const tags = [...svg.matchAll(/<path[\s\S]*?\/?>/g)].map((match) => match[0]);
  const tag = tags.find((candidate) => candidate.includes(`id="${id}"`));
  if (!tag) throw new Error(`Could not find SVG path ${id}`);
  const pathMatch = tag.match(/d="([\s\S]*?)"/);
  if (!pathMatch) throw new Error(`SVG path ${id} has no d attribute`);
  return pathMatch[1].replace(/\s+/g, " ").trim();
}

function parseSvgPath(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const points = [];
  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const nextNumber = () => Number(tokens[i++]);
  const addPoint = (px, py) => points.push({ x: px, y: py });

  while (i < tokens.length) {
    if (isCommand(tokens[i])) cmd = tokens[i++];
    if (!cmd) break;
    const relative = cmd === cmd.toLowerCase();
    const command = cmd.toUpperCase();

    if (command === "M") {
      x = (relative ? x : 0) + nextNumber();
      y = (relative ? y : 0) + nextNumber();
      startX = x;
      startY = y;
      addPoint(x, y);
      cmd = relative ? "l" : "L";
    } else if (command === "L") {
      while (i < tokens.length && !isCommand(tokens[i])) {
        x = (relative ? x : 0) + nextNumber();
        y = (relative ? y : 0) + nextNumber();
        addPoint(x, y);
      }
    } else if (command === "C") {
      while (i < tokens.length && !isCommand(tokens[i])) {
        const x0 = x;
        const y0 = y;
        const x1 = (relative ? x : 0) + nextNumber();
        const y1 = (relative ? y : 0) + nextNumber();
        const x2 = (relative ? x : 0) + nextNumber();
        const y2 = (relative ? y : 0) + nextNumber();
        const x3 = (relative ? x : 0) + nextNumber();
        const y3 = (relative ? y : 0) + nextNumber();
        const steps = Math.max(8, Math.ceil(Math.hypot(x3 - x0, y3 - y0) / 2.8));
        for (let s = 1; s <= steps; s += 1) {
          const t = s / steps;
          const mt = 1 - t;
          addPoint(
            mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
            mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3
          );
        }
        x = x3;
        y = y3;
      }
    } else if (command === "Z") {
      x = startX;
      y = startY;
      addPoint(x, y);
      cmd = null;
    } else {
      throw new Error(`Unsupported SVG path command ${cmd}`);
    }
  }

  return points;
}

function resampleClosedPolyline(points, count) {
  const clean = points.slice();
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) < 0.001) clean.pop();
  const segments = [];
  let total = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const a = clean[i];
    const b = clean[(i + 1) % clean.length];
    const len = Math.max(0.0001, Math.hypot(b.x - a.x, b.y - a.y));
    segments.push({ a, b, len, start: total });
    total += len;
  }
  const sampled = [];
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * total;
    const seg = segments.find((candidate) => target >= candidate.start && target <= candidate.start + candidate.len) || segments[segments.length - 1];
    const t = (target - seg.start) / seg.len;
    sampled.push({
      x: seg.a.x + (seg.b.x - seg.a.x) * t,
      y: seg.a.y + (seg.b.y - seg.a.y) * t,
    });
  }
  return sampled;
}

function rotatePointsToStart(points, hint) {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i].sourceX - hint.x;
    const dy = points[i].sourceY - hint.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return points.slice(best).concat(points.slice(0, best));
}

function loadSilverstoneControlPoints() {
  const svg = fs.readFileSync(SILVERSTONE_SVG_PATH, "utf8");
  const raw = parseSvgPath(extractSvgPath(svg, SILVERSTONE_TRACK_PATH_ID));
  const bbox = raw.reduce(
    (box, point) => ({
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const centerX = (bbox.minX + bbox.maxX) * 0.5;
  const centerY = (bbox.minY + bbox.maxY) * 0.5;
  const scale = 36;
  const transformed = resampleClosedPolyline(raw, 112).map((point) => ({
    x: (point.x - centerX) * scale,
    y: (point.y - centerY) * scale,
    sourceX: point.x,
    sourceY: point.y,
  }));
  return rotatePointsToStart(transformed, { x: 472, y: 504 }).map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
  }));
}

const CONTROL_POINTS = loadSilverstoneControlPoints();

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260516);

function range(min, max) {
  return min + (max - min) * rand();
}

function pick(list) {
  return list[Math.floor(rand() * list.length)];
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function buildSamples() {
  const samples = [];
  const steps = 34;
  for (let i = 0; i < CONTROL_POINTS.length; i += 1) {
    const p0 = CONTROL_POINTS[(i - 1 + CONTROL_POINTS.length) % CONTROL_POINTS.length];
    const p1 = CONTROL_POINTS[i];
    const p2 = CONTROL_POINTS[(i + 1) % CONTROL_POINTS.length];
    const p3 = CONTROL_POINTS[(i + 2) % CONTROL_POINTS.length];
    for (let s = 0; s < steps; s += 1) {
      samples.push(catmull(p0, p1, p2, p3, s / steps));
    }
  }
  const segments = [];
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(0.0001, Math.hypot(dx, dy));
    segments.push({
      a,
      b,
      len,
      start: total,
      angle: Math.atan2(dy, dx),
      nx: -dy / len,
      ny: dx / len,
    });
    total += len;
  }
  return { samples, segments, total };
}

const builtTrack = buildSamples();

function wrapDistance(distance) {
  let d = distance % builtTrack.total;
  if (d < 0) d += builtTrack.total;
  return d;
}

function pointAt(distance, lane = 0) {
  const d = wrapDistance(distance);
  let lo = 0;
  let hi = builtTrack.segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = builtTrack.segments[mid];
    if (d < seg.start) {
      hi = mid - 1;
    } else if (d > seg.start + seg.len) {
      lo = mid + 1;
    } else {
      const t = (d - seg.start) / seg.len;
      const x = seg.a.x + (seg.b.x - seg.a.x) * t + seg.nx * lane;
      const y = seg.a.y + (seg.b.y - seg.a.y) * t + seg.ny * lane;
      return { x, y, angle: seg.angle, nx: seg.nx, ny: seg.ny, d };
    }
  }
  const seg = builtTrack.segments[builtTrack.segments.length - 1];
  return { x: seg.b.x + seg.nx * lane, y: seg.b.y + seg.ny * lane, angle: seg.angle, nx: seg.nx, ny: seg.ny, d };
}

function nearestTrackDistance(x, y) {
  let best = Infinity;
  for (const seg of builtTrack.segments) {
    const vx = seg.b.x - seg.a.x;
    const vy = seg.b.y - seg.a.y;
    const t = Math.max(0, Math.min(1, ((x - seg.a.x) * vx + (y - seg.a.y) * vy) / (seg.len * seg.len)));
    const px = seg.a.x + vx * t;
    const py = seg.a.y + vy * t;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

function gClamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function gSmoothStep(edge0, edge1, value) {
  const t = gClamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function gMix(a, b, t) {
  return a + (b - a) * t;
}

function gWrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function signedCurvatureAt(distance, span = 420) {
  const a = pointAt(distance - span, 0).angle;
  const b = pointAt(distance + span, 0).angle;
  return gWrapAngle(b - a);
}

function rotatedRectTrackClearance(x, y, a, w, h) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  let best = Infinity;
  const samples = [
    [-0.5, -0.5],
    [-0.25, -0.5],
    [0, -0.5],
    [0.25, -0.5],
    [0.5, -0.5],
    [-0.5, 0],
    [0.5, 0],
    [-0.5, 0.5],
    [-0.25, 0.5],
    [0, 0.5],
    [0.25, 0.5],
    [0.5, 0.5],
    [0, 0],
  ];
  for (const [sx, sy] of samples) {
    const lx = sx * w;
    const ly = sy * h;
    const px = x + ca * lx - sa * ly;
    const py = y + sa * lx + ca * ly;
    best = Math.min(best, nearestTrackDistance(px, py));
  }
  return best;
}

function placeTracksideRect(spec, laneBase, minClearance) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const lane = spec.side * (laneBase + attempt * 190);
    const p = pointAt(spec.d * builtTrack.total, lane);
    const angle = p.angle + (spec.angleOffset || 0);
    if (rotatedRectTrackClearance(p.x, p.y, angle, spec.w, spec.h) >= minClearance) {
      return { p, angle, lane };
    }
  }
  return null;
}

function fixed(n, digits = 1) {
  return Number(n).toFixed(digits);
}

function makeTrackDecals(count) {
  const decals = [];
  for (let i = 0; i < count; i += 1) {
    const d = range(0, builtTrack.total);
    const lane = range(-TRACK_WIDTH * 0.43, TRACK_WIDTH * 0.43);
    const p = pointAt(d, lane);
    decals.push({
      x: p.x,
      y: p.y,
      w: range(4, 18),
      h: range(2, 7),
      a: p.angle + range(-0.18, 0.18),
      tone: Math.floor(range(0, 6)),
      alpha: range(18, 72),
    });
  }
  return decals;
}

function makeSurfaceGrain(count) {
  const grain = [];
  for (let i = 0; i < count; i += 1) {
    const d = (i / count) * builtTrack.total + range(-34, 34);
    const lane = range(-TRACK_WIDTH * 0.46, TRACK_WIDTH * 0.46);
    const p = pointAt(d, lane);
    const edge = Math.abs(lane) / (TRACK_WIDTH * 0.5);
    const fastLine = Math.abs(lane) < TRACK_WIDTH * 0.16 ? 1 : 0;
    grain.push({
      x: p.x,
      y: p.y,
      w: range(3, 15 + edge * 5),
      h: range(2, 6 + edge * 3),
      a: p.angle + range(-0.09, 0.09),
      tone: Math.floor(range(0, 8)),
      alpha: range(10 + fastLine * 8, 44 + edge * 20),
    });
  }
  return grain;
}

function makeOptimalRacingLine(count) {
  const raw = [];
  for (let i = 0; i < count; i += 1) {
    const d = (i / count) * builtTrack.total;
    const now = signedCurvatureAt(d, 360);
    const ahead = signedCurvatureAt(d + 560, 460);
    const exit = signedCurvatureAt(d - 460, 420);
    const farAhead = signedCurvatureAt(d + 980, 520);
    const signNow = Math.sign(now || ahead || exit || 1);
    const signAhead = Math.sign(ahead || farAhead || signNow);
    const signExit = Math.sign(exit || signNow);
    const apex = gSmoothStep(0.045, 0.245, Math.abs(now));
    const entry = gSmoothStep(0.035, 0.215, Math.abs(ahead)) * (1 - apex * 0.58);
    const unwind = gSmoothStep(0.035, 0.205, Math.abs(exit)) * (1 - apex * 0.64);
    const complex = gSmoothStep(0.18, 0.48, Math.abs(gWrapAngle(ahead - exit)));
    const lane =
      signNow * TRACK_WIDTH * 0.315 * apex -
      signAhead * TRACK_WIDTH * 0.295 * entry -
      signExit * TRACK_WIDTH * 0.205 * unwind +
      signNow * TRACK_WIDTH * 0.055 * complex;
    raw.push({
      d,
      lane: gClamp(lane, -TRACK_WIDTH * 0.39, TRACK_WIDTH * 0.39),
      severity: Math.max(Math.abs(now), Math.abs(ahead) * 0.92, Math.abs(farAhead) * 0.72),
      entry,
      apex,
      complex,
    });
  }

  let lanes = raw.map((item) => item.lane);
  for (let pass = 0; pass < 8; pass += 1) {
    lanes = lanes.map((lane, i) => {
      const prev = lanes[(i - 1 + lanes.length) % lanes.length];
      const next = lanes[(i + 1) % lanes.length];
      return gClamp((prev + lane * 2.65 + next) / 4.65, -TRACK_WIDTH * 0.37, TRACK_WIDTH * 0.37);
    });
  }

  return raw.map((item, i) => {
    const lane = lanes[i];
    const p = pointAt(item.d, lane);
    const braking = gClamp(gSmoothStep(0.075, 0.285, item.severity) * 0.72 + item.entry * 0.30 + item.complex * 0.10 - item.apex * 0.16, 0, 1);
    const target = gClamp(53.5 - item.severity * 100 - item.entry * 8.2 - item.complex * 4.5 + item.apex * 1.8, 16.5, 54.5);
    const confidence = gClamp(0.64 + item.apex * 0.18 + item.entry * 0.12 - item.complex * 0.08, 0.55, 0.98);
    return {
      d: item.d,
      x: p.x,
      y: p.y,
      a: p.angle,
      lane,
      target,
      brake: braking,
      confidence,
    };
  });
}

function makeGrassDetails(count) {
  const details = [];
  let tries = 0;
  while (details.length < count && tries < count * 20) {
    tries += 1;
    const x = range(WORLD.minX, WORLD.maxX);
    const y = range(WORLD.minY, WORLD.maxY);
    const dist = nearestTrackDistance(x, y);
    if (dist < TRACK_WIDTH * 0.72 || dist > TRACK_WIDTH * 2.9) continue;
    details.push({
      x,
      y,
      w: range(5, 34),
      h: range(3, 20),
      a: range(-3.14, 3.14),
      tone: Math.floor(range(0, 9)),
    });
  }
  return details;
}

function makeTerrainRelief(count) {
  const relief = [];
  for (let i = 0; i < count; i += 1) {
    const d = (i / count) * builtTrack.total + range(-120, 120);
    const side = rand() > 0.5 ? 1 : -1;
    const lane = side * range(TRACK_WIDTH * 0.84, TRACK_WIDTH * 3.35);
    const p = pointAt(d, lane);
    const distanceFromTrack = Math.abs(lane) - TRACK_WIDTH * 0.5;
    const broad = gSmoothStep(TRACK_WIDTH * 0.65, TRACK_WIDTH * 2.9, distanceFromTrack);
    const bank = Math.sin(d * 0.00072 + side * 1.7) * 0.5 + Math.cos(d * 0.0019 + lane * 0.002) * 0.5;
    relief.push({
      x: p.x,
      y: p.y,
      w: range(150, 680) * (0.82 + broad * 0.5),
      h: range(10, 38) * (1.15 - broad * 0.18),
      a: p.angle + range(-0.075, 0.075),
      tone: Math.floor(gClamp((bank + 1) * 2.6 + range(0, 2.6), 0, 7)),
      alpha: range(15, 46) * (0.75 + broad * 0.5),
      side,
    });
  }
  return relief;
}

function makeBarrierPosts(spacing) {
  const posts = [];
  for (let d = 0; d < builtTrack.total; d += spacing) {
    for (const side of [-1, 1]) {
      if (side < 0 && (d < 1540 || d > builtTrack.total - 980)) continue;
      const wobble = (Math.sin(d * 0.004 + side) * 12 + Math.cos(d * 0.0017) * 8) * 0.45;
      const lane = side * (TRACK_WIDTH * 0.5 + 96 + wobble);
      const p = pointAt(d, lane);
      if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.58) continue;
      posts.push({
        x: p.x,
        y: p.y,
        a: p.angle,
        side,
        tone: Math.floor(range(0, 5)),
      });
    }
  }
  return posts;
}

function makeGrandstands() {
  const specs = [
    { d: 0.01, side: -1, w: 920, h: 180, label: "HAMILTON STRAIGHT" },
    { d: 0.08, side: 1, w: 680, h: 152, label: "ABBEY A/B" },
    { d: 0.13, side: 1, w: 620, h: 148, label: "FARM CURVE" },
    { d: 0.16, side: -1, w: 720, h: 152, label: "VILLAGE A/B" },
    { d: 0.20, side: -1, w: 610, h: 145, label: "THE LOOP" },
    { d: 0.25, side: 1, w: 1040, h: 158, label: "WELLINGTON" },
    { d: 0.33, side: -1, w: 860, h: 168, label: "LUFFIELD" },
    { d: 0.39, side: 1, w: 760, h: 152, label: "WOODCOTE" },
    { d: 0.45, side: 1, w: 900, h: 160, label: "COPSE" },
    { d: 0.57, side: -1, w: 1040, h: 156, label: "BECKETTS" },
    { d: 0.63, side: 1, w: 780, h: 148, label: "CHAPEL" },
    { d: 0.70, side: 1, w: 1050, h: 150, label: "HANGAR" },
    { d: 0.80, side: -1, w: 820, h: 152, label: "STOWE" },
    { d: 0.88, side: -1, w: 700, h: 150, label: "VALE" },
    { d: 0.94, side: 1, w: 1080, h: 165, label: "CLUB" },
    { d: 0.985, side: 1, w: 720, h: 150, label: "LAKESIDE" },
  ];
  const stands = [];
  for (const spec of specs) {
    const placed = placeTracksideRect(spec, TRACK_WIDTH * 0.5 + spec.h * 0.5 + 520, TRACK_WIDTH * 0.5 + 150);
    if (!placed) continue;
    const p = placed.p;
    stands.push({
      x: p.x,
      y: p.y,
      a: placed.angle,
      w: spec.w,
      h: spec.h,
      label: spec.label,
      tone: Math.floor(range(0, 5)),
    });
  }
  return stands;
}

function makeCrowdPixels(stands) {
  const blocks = stands.length
    ? stands.map((stand) => ({ x: stand.x, y: stand.y, w: stand.w * 0.86, h: stand.h * 0.58, a: stand.a }))
    : [{ x: 0, y: 0, w: 1000, h: 300, a: 0 }];
  const pixels = [];
  for (let i = 0; i < 1320; i += 1) {
    const block = pick(blocks);
    const lx = range(-block.w / 2, block.w / 2);
    const ly = range(-block.h / 2, block.h / 2);
    const ca = Math.cos(block.a);
    const sa = Math.sin(block.a);
    pixels.push({
      x: block.x + ca * lx - sa * ly,
      y: block.y + sa * lx + ca * ly,
      w: range(5, 13),
      h: range(5, 13),
      a: block.a,
      tone: Math.floor(range(0, 12)),
      pulse: range(0, 6.28),
    });
  }
  return pixels;
}

function makeSilverstoneBuildings() {
  const specs = [
    { d: 0.006, side: -1, lane: 1260, w: 1480, h: 245, label: "SILVERSTONE WING", type: "wing", tone: 0 },
    { d: 0.028, side: -1, lane: 1750, w: 900, h: 260, label: "INTL PADDOCK", type: "paddock", tone: 1 },
    { d: 0.051, side: -1, lane: 2050, w: 520, h: 210, label: "RACE CONTROL", type: "control", tone: 2 },
    { d: 0.088, side: 1, lane: 1760, w: 560, h: 230, label: "ABBEY SUITES", type: "hospitality", tone: 3 },
    { d: 0.148, side: -1, lane: 1780, w: 580, h: 220, label: "VILLAGE ENC.", type: "hospitality", tone: 5 },
    { d: 0.252, side: 1, lane: 1860, w: 1120, h: 260, label: "WELLINGTON ENC.", type: "hospitality", tone: 1 },
    { d: 0.323, side: -1, lane: 1840, w: 820, h: 240, label: "BROOKLANDS", type: "hospitality", tone: 2 },
    { d: 0.405, side: 1, lane: 1880, w: 1320, h: 250, label: "NATIONAL PITS", type: "paddock", tone: 4 },
    { d: 0.458, side: 1, lane: 1840, w: 760, h: 220, label: "COPSE COMPLEX", type: "hospitality", tone: 6 },
    { d: 0.565, side: -1, lane: 1880, w: 940, h: 230, label: "BECKETTS CLUB", type: "hospitality", tone: 1 },
    { d: 0.708, side: 1, lane: 1840, w: 1220, h: 250, label: "HANGAR IGNITION", type: "hospitality", tone: 3 },
    { d: 0.792, side: -1, lane: 1880, w: 760, h: 230, label: "STOWE HILTON", type: "hospitality", tone: 4 },
    { d: 0.927, side: 1, lane: 1840, w: 980, h: 250, label: "CLUB SILVERSTONE", type: "hospitality", tone: 6 },
    { d: 0.967, side: -1, lane: 2050, w: 700, h: 260, label: "MEDICAL CENTRE", type: "service", tone: 2 },
    { d: 0.992, side: 1, lane: 2180, w: 900, h: 300, label: "MAIN ENTRANCE", type: "service", tone: 0 },
    { d: 0.035, side: 1, lane: 2500, w: 820, h: 190, label: "MAIN CAR PARK", type: "parking", tone: 1, angleOffset: Math.PI / 2 },
    { d: 0.455, side: -1, lane: 2450, w: 720, h: 180, label: "COPSE CAR PARK", type: "parking", tone: 2, angleOffset: Math.PI / 2 },
    { d: 0.704, side: -1, lane: 2450, w: 900, h: 190, label: "HANGAR PARKING", type: "parking", tone: 3, angleOffset: Math.PI / 2 },
    { d: 0.011, side: -1, lane: 760, w: 1060, h: 54, label: "PIT LANE", type: "road", tone: 4 },
    { d: 0.412, side: 1, lane: 980, w: 1180, h: 58, label: "NATIONAL PIT LANE", type: "road", tone: 5 },
  ];
  const buildings = [];
  for (const spec of specs) {
    const placed = placeTracksideRect(spec, spec.lane, TRACK_WIDTH * 0.5 + (spec.type === "road" ? 50 : 180));
    if (!placed) continue;
    const p = placed.p;
    buildings.push({
      x: p.x,
      y: p.y,
      a: placed.angle,
      w: spec.w,
      h: spec.h,
      label: spec.label,
      type: spec.type,
      tone: spec.tone,
    });
  }
  return buildings;
}

function makeTracksideSigns() {
  const signs = [];
  const corners = [
    ["HAMILTON", 0.02, -1],
    ["ABBEY", 0.08, 1],
    ["FARM", 0.12, 1],
    ["VILLAGE", 0.16, -1],
    ["LOOP", 0.19, -1],
    ["AINTREE", 0.22, 1],
    ["WELLINGTON", 0.27, 1],
    ["BROOKLANDS", 0.34, -1],
    ["LUFFIELD", 0.38, -1],
    ["WOODCOTE", 0.43, 1],
    ["COPSE", 0.48, 1],
    ["MAGGOTS", 0.56, -1],
    ["BECKETTS", 0.60, -1],
    ["CHAPEL", 0.64, 1],
    ["HANGAR", 0.72, 1],
    ["STOWE", 0.80, -1],
    ["VALE", 0.88, -1],
    ["CLUB", 0.94, 1],
  ];
  for (const [label, fraction, side] of corners) {
    const p = pointAt(fraction * builtTrack.total, side * (TRACK_WIDTH * 0.92 + 115));
    if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.66) continue;
    signs.push({
      x: p.x,
      y: p.y,
      a: p.angle,
      side,
      label,
      tone: Math.floor(range(0, 7)),
    });
  }
  const boards = ["150", "100", "50"];
  for (let d = builtTrack.total * 0.05; d < builtTrack.total; d += 920) {
    for (let i = 0; i < boards.length; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const p = pointAt(d + i * 58, side * (TRACK_WIDTH * 0.8 + 90));
      if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.62) continue;
      signs.push({ x: p.x, y: p.y, a: p.angle, side, label: boards[i], tone: i + 1 });
    }
  }
  return signs;
}

function makeServiceVehicles() {
  const vehicles = [];
  const slots = [820, 2460, 4180, 6120, 7600, 9370, 11130, 13020, 15180];
  for (let i = 0; i < slots.length; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const p = pointAt(slots[i], side * (TRACK_WIDTH * 1.05 + 150));
    if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.72) continue;
    vehicles.push({
      x: p.x,
      y: p.y,
      a: p.angle + (side > 0 ? 0.2 : -0.2),
      tone: i % 6,
    });
  }
  return vehicles;
}

function makeRubberMarbles(count) {
  const marbles = [];
  for (let i = 0; i < count; i += 1) {
    const d = range(0, builtTrack.total);
    const side = rand() > 0.5 ? 1 : -1;
    const lane = side * range(TRACK_WIDTH * 0.25, TRACK_WIDTH * 0.48);
    const p = pointAt(d, lane);
    marbles.push({
      x: p.x,
      y: p.y,
      w: range(3, 10),
      h: range(2, 6),
      a: p.angle + range(-0.22, 0.22),
      tone: Math.floor(range(0, 5)),
      alpha: range(34, 96),
    });
  }
  return marbles;
}

function makeSponsorBanners() {
  const labels = ["PIXEL", "APEX", "TURBO", "SYNTH", "ION", "VELOCITY", "NOVA", "PRIME", "FLUX", "DRS"];
  const banners = [];
  for (let d = builtTrack.total * 0.015; d < builtTrack.total; d += 345) {
    const side = Math.sin(d * 0.0021) > 0 ? 1 : -1;
    const p = pointAt(d, side * (TRACK_WIDTH * 0.5 + range(190, 330)));
    if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.58) continue;
    banners.push({
      x: p.x,
      y: p.y,
      a: p.angle,
      side,
      w: range(120, 230),
      h: range(34, 54),
      label: labels[Math.floor(range(0, labels.length))],
      tone: Math.floor(range(0, 7)),
    });
  }
  return banners;
}

function makeMarshalPosts() {
  const posts = [];
  for (let d = builtTrack.total * 0.025; d < builtTrack.total; d += 740) {
    for (const side of [-1, 1]) {
      if (rand() < 0.28) continue;
      const p = pointAt(d + range(-70, 70), side * (TRACK_WIDTH * 0.5 + range(260, 430)));
      if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.66) continue;
      posts.push({
        x: p.x,
        y: p.y,
        a: p.angle,
        side,
        flag: Math.floor(range(0, 4)),
        tone: Math.floor(range(0, 6)),
      });
    }
  }
  return posts;
}

function makeCameraRigs() {
  const rigs = [];
  const slots = [0.02, 0.07, 0.12, 0.18, 0.24, 0.31, 0.39, 0.46, 0.55, 0.62, 0.70, 0.79, 0.86, 0.93, 0.98];
  for (let i = 0; i < slots.length; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const p = pointAt(slots[i] * builtTrack.total, side * (TRACK_WIDTH * 0.5 + 520));
    if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.78) continue;
    rigs.push({
      x: p.x,
      y: p.y,
      a: p.angle + side * 0.28,
      side,
      arm: range(70, 145),
      tone: i % 7,
    });
  }
  return rigs;
}

function makeLightRigs() {
  const rigs = [];
  for (let d = 0; d < builtTrack.total; d += 510) {
    const side = Math.sin(d * 0.0017) > 0 ? 1 : -1;
    const p = pointAt(d, side * (TRACK_WIDTH * 0.5 + range(390, 590)));
    if (nearestTrackDistance(p.x, p.y) < TRACK_WIDTH * 0.72) continue;
    rigs.push({
      x: p.x,
      y: p.y,
      a: p.angle,
      side,
      h: range(92, 155),
      cone: range(240, 430),
      tone: Math.floor(range(0, 5)),
    });
  }
  return rigs;
}

function objLine(obj, stringKeys = []) {
  const pieces = Object.entries(obj).map(([key, value]) => {
    if (typeof value === "number") return `${key}: ${fixed(value, Number.isInteger(value) ? 0 : 2)}`;
    if (stringKeys.includes(key)) return `${key}: ${JSON.stringify(value)}`;
    return `${key}: ${JSON.stringify(value)}`;
  });
  return `  { ${pieces.join(", ")} },`;
}

const trackDecals = makeTrackDecals(2150);
const surfaceGrain = makeSurfaceGrain(9100);
const grassDetails = makeGrassDetails(1500);
const terrainRelief = makeTerrainRelief(2300);
const barrierPosts = makeBarrierPosts(112);
const grandstands = makeGrandstands();
const crowdPixels = makeCrowdPixels(grandstands);
const silverstoneBuildings = makeSilverstoneBuildings();
const tracksideSigns = [];
const serviceVehicles = makeServiceVehicles();
const rubberMarbles = makeRubberMarbles(980);
const sponsorBanners = [];
const marshalPosts = makeMarshalPosts();
const cameraRigs = makeCameraRigs();
const lightRigs = makeLightRigs();
const optimalRacingLine = makeOptimalRacingLine(3400);

const dataBlock = `const TRACK_CONTROL_POINTS = ${JSON.stringify(CONTROL_POINTS, null, 2)};

const TRACK_DECALS = [
${trackDecals.map((item) => objLine(item)).join("\n")}
];

const SURFACE_GRAIN = [
${surfaceGrain.map((item) => objLine(item)).join("\n")}
];

const GRASS_DETAILS = [
${grassDetails.map((item) => objLine(item)).join("\n")}
];

const TERRAIN_RELIEF = [
${terrainRelief.map((item) => objLine(item)).join("\n")}
];

const BARRIER_POSTS = [
${barrierPosts.map((item) => objLine(item)).join("\n")}
];

const GRANDSTANDS = [
${grandstands.map((item) => objLine(item, ["label"])).join("\n")}
];

const CROWD_PIXELS = [
${crowdPixels.map((item) => objLine(item)).join("\n")}
];

const SILVERSTONE_BUILDINGS = [
${silverstoneBuildings.map((item) => objLine(item, ["label", "type"])).join("\n")}
];

const TRACKSIDE_SIGNS = [
${tracksideSigns.map((item) => objLine(item, ["label"])).join("\n")}
];

const SERVICE_VEHICLES = [
${serviceVehicles.map((item) => objLine(item)).join("\n")}
];

const RUBBER_MARBLES = [
${rubberMarbles.map((item) => objLine(item)).join("\n")}
];

const SPONSOR_BANNERS = [
${sponsorBanners.map((item) => objLine(item, ["label"])).join("\n")}
];

const MARSHAL_POSTS = [
${marshalPosts.map((item) => objLine(item)).join("\n")}
];

const CAMERA_RIGS = [
${cameraRigs.map((item) => objLine(item)).join("\n")}
];

const LIGHT_RIGS = [
${lightRigs.map((item) => objLine(item)).join("\n")}
];

const OPTIMAL_RACING_LINE = [
${optimalRacingLine.map((item) => objLine(item)).join("\n")}
];`;

const core = `/*
  Pixel Prix
  Generated p5.js top-down racing game.
  The large literal data arrays above are used by the renderer for track grit,
  racing-line telemetry, crowd pixels, barriers, grass, and service vehicles.
*/
"use strict";

const GAME_VERSION = "1.0.0";
const CAR_SHEET_PATH = "assets/f1-cars.png";
const CAR_SPRITE_COUNT = 11;
const PLAYER_SPRITE_INDEX = 4;
const RACE_LAPS = 3;
const TRACK_WIDTH = ${TRACK_WIDTH};
const PLAYER_GRASS_RESET_OVERFLOW = 150;
const WORLD_SPEED_SCALE = 31;
const DASHBOARD_SPEED_SCALE = 6.9;
const CAR_TOP_SPEED_MULT = 1.18;
const CAR_ACCEL_MULT = 1.14;
const CAR_BRAKE_MULT = 1.06;
const WORLD_BOUNDS = ${JSON.stringify(WORLD, null, 2)};

${dataBlock}

let game;
let carSheet;

function preload() {
  carSheet = loadImage(CAR_SHEET_PATH);
}

function setup() {
  const root = document.getElementById("game-root");
  const w = root ? root.clientWidth : windowWidth;
  const h = root ? root.clientHeight : windowHeight;
  const canvas = createCanvas(w, h);
  if (root) canvas.parent(root);
  pixelDensity(1);
  noSmooth();
  frameRate(60);
  rectMode(CENTER);
  imageMode(CENTER);
  textFont("monospace");
  game = new Game();
  window.pixelPrixGame = game;
  window.addEventListener("keydown", (event) => {
    if (!game || event.repeat) return;
    const tag = event.target && event.target.tagName ? event.target.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const code = event.keyCode || event.which;
    const actionKeys = [13, 27, 32, 37, 38, 39, 40, 49, 50, 51, 52, 53, 65, 67, 68, 76, 77, 79, 80, 82, 83, 84, 86, 87];
    if (actionKeys.includes(code)) {
      game.keyPressed(code);
      event.preventDefault();
    }
  }, { passive: false });
}

function draw() {
  if (!game) return;
  game.frame(Math.min(1 / 24, Math.max(0.001, deltaTime / 1000)));
}

function windowResized() {
  const root = document.getElementById("game-root");
  resizeCanvas(root ? root.clientWidth : windowWidth, root ? root.clientHeight : windowHeight);
  if (game) game.onResize();
}

function keyPressed() {
  if (game) game.keyPressed(keyCode);
  return false;
}

function mousePressed() {
  if (game) game.mousePressed();
  return false;
}

function mouseReleased() {
  if (game) game.releaseTouchControls();
  return false;
}

function touchStarted() {
  if (game) game.touchStarted();
  return false;
}

function touchMoved() {
  if (game) game.touchMoved();
  return false;
}

function touchEnded() {
  if (game) game.touchEnded();
  return false;
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function smoothStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function wrap(value, maxValue) {
  let v = value % maxValue;
  if (v < 0) v += maxValue;
  return v;
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function angleLerp(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

function length2(x, y) {
  return Math.sqrt(x * x + y * y);
}

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function colorFromPalette(palette, index, alpha) {
  const c = palette[Math.abs(index) % palette.length];
  return color(c[0], c[1], c[2], alpha === undefined ? c[3] || 255 : alpha);
}

function drawPixelRect(x, y, w, h, angle, fillColor) {
  push();
  translate(Math.round(x), Math.round(y));
  rotate(angle);
  noStroke();
  fill(fillColor);
  rect(0, 0, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  pop();
}

function drawPixelLine(x1, y1, x2, y2, weight, c) {
  stroke(c);
  strokeWeight(Math.max(1, Math.round(weight)));
  line(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2));
}

function pointSegmentInfo(px, py, ax, ay, bx, by, startDistance) {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = Math.max(0.00001, vx * vx + vy * vy);
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / lenSq, 0, 1);
  const nx = ax + vx * t;
  const ny = ay + vy * t;
  const dx = px - nx;
  const dy = py - ny;
  const len = Math.sqrt(lenSq);
  return {
    x: nx,
    y: ny,
    d2: dx * dx + dy * dy,
    t,
    progress: startDistance + len * t,
    normalX: -vy / len,
    normalY: vx / len,
    tangentX: vx / len,
    tangentY: vy / len,
    angle: Math.atan2(vy, vx),
    lateral: dx * (-vy / len) + dy * (vx / len),
  };
}

class Track {
  constructor(points) {
    this.controlPoints = points;
    this.samples = [];
    this.segments = [];
    this.totalLength = 0;
    this.width = TRACK_WIDTH;
    this.build();
  }

  catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x:
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y:
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    };
  }

  build() {
    this.samples.length = 0;
    const steps = 34;
    for (let i = 0; i < this.controlPoints.length; i += 1) {
      const p0 = this.controlPoints[(i - 1 + this.controlPoints.length) % this.controlPoints.length];
      const p1 = this.controlPoints[i];
      const p2 = this.controlPoints[(i + 1) % this.controlPoints.length];
      const p3 = this.controlPoints[(i + 2) % this.controlPoints.length];
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        this.samples.push({
          x:
            0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y:
            0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    this.segments.length = 0;
    this.totalLength = 0;
    for (let i = 0; i < this.samples.length; i += 1) {
      const a = this.samples[i];
      const b = this.samples[(i + 1) % this.samples.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
      this.segments.push({
        a,
        b,
        len,
        start: this.totalLength,
        angle: Math.atan2(dy, dx),
        nx: -dy / len,
        ny: dx / len,
        tx: dx / len,
        ty: dy / len,
      });
      this.totalLength += len;
    }
  }

  wrapDistance(distance) {
    return wrap(distance, this.totalLength);
  }

  pointAt(distance, laneOffset) {
    const d = this.wrapDistance(distance);
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const seg = this.segments[mid];
      if (d < seg.start) {
        hi = mid - 1;
      } else if (d > seg.start + seg.len) {
        lo = mid + 1;
      } else {
        const t = (d - seg.start) / seg.len;
        const lane = laneOffset || 0;
        return {
          x: seg.a.x + (seg.b.x - seg.a.x) * t + seg.nx * lane,
          y: seg.a.y + (seg.b.y - seg.a.y) * t + seg.ny * lane,
          angle: seg.angle,
          nx: seg.nx,
          ny: seg.ny,
          tx: seg.tx,
          ty: seg.ty,
          progress: d,
        };
      }
    }
    const seg = this.segments[this.segments.length - 1];
    return {
      x: seg.b.x + seg.nx * (laneOffset || 0),
      y: seg.b.y + seg.ny * (laneOffset || 0),
      angle: seg.angle,
      nx: seg.nx,
      ny: seg.ny,
      tx: seg.tx,
      ty: seg.ty,
      progress: d,
    };
  }

  nearest(x, y) {
    let best = null;
    for (const seg of this.segments) {
      const info = pointSegmentInfo(x, y, seg.a.x, seg.a.y, seg.b.x, seg.b.y, seg.start);
      if (!best || info.d2 < best.d2) best = info;
    }
    best.progress = this.wrapDistance(best.progress);
    best.distance = Math.sqrt(best.d2);
    best.edgeOverflow = Math.abs(best.lateral) - this.width * 0.5;
    return best;
  }

  nearestAround(x, y, centerDistance, windowDistance) {
    const center = this.wrapDistance(centerDistance || 0);
    const window = windowDistance || 1600;
    let best = null;
    for (const seg of this.segments) {
      const mid = this.wrapDistance(seg.start + seg.len * 0.5);
      let delta = mid - center;
      if (delta > this.totalLength * 0.5) delta -= this.totalLength;
      if (delta < -this.totalLength * 0.5) delta += this.totalLength;
      if (Math.abs(delta) > window + seg.len * 0.5) continue;
      const info = pointSegmentInfo(x, y, seg.a.x, seg.a.y, seg.b.x, seg.b.y, seg.start);
      if (!best || info.d2 < best.d2) best = info;
    }
    if (!best) return this.nearest(x, y);
    best.progress = this.wrapDistance(best.progress);
    best.distance = Math.sqrt(best.d2);
    best.edgeOverflow = Math.abs(best.lateral) - this.width * 0.5;
    return best;
  }

  curvatureAt(distance) {
    const a = this.pointAt(distance - 170, 0).angle;
    const b = this.pointAt(distance + 170, 0).angle;
    return Math.abs(wrapAngle(b - a));
  }

  drawBase(camera) {
    drawingContext.lineCap = "round";
    drawingContext.lineJoin = "round";
    stroke(9, 20, 18, 180);
    strokeWeight(this.width + 76);
    noFill();
    this.drawLoopLines();

    stroke(28, 32, 34, 255);
    strokeWeight(this.width + 32);
    this.drawLoopLines();

    stroke(48, 50, 52, 255);
    strokeWeight(this.width);
    this.drawLoopLines();

    stroke(62, 64, 66, 125);
    strokeWeight(this.width * 0.72);
    this.drawLoopLines(3);

    this.drawLanePaint(camera);
    this.drawCurbs(camera);
    this.drawStartFinish(camera);
  }

  drawLoopLines(step) {
    const stride = step || 1;
    for (let i = 0; i < this.segments.length; i += stride) {
      const seg = this.segments[i];
      line(seg.a.x, seg.a.y, seg.b.x, seg.b.y);
    }
  }

  drawLanePaint(camera) {
    const c = color(210, 214, 204, 82);
    stroke(c);
    strokeWeight(5);
    for (let i = 0; i < this.segments.length; i += 8) {
      const seg = this.segments[i];
      if (!camera.visibleWorld(seg.a.x, seg.a.y, 500)) continue;
      if (i % 16 < 8) line(seg.a.x, seg.a.y, seg.b.x, seg.b.y);
    }
    stroke(235, 239, 228, 95);
    strokeWeight(8);
    for (let i = 0; i < this.segments.length; i += 13) {
      const p = this.pointAt(this.segments[i].start, 0);
      if (!camera.visibleWorld(p.x, p.y, 520)) continue;
      const q = this.pointAt(this.segments[i].start + 34, 0);
      line(p.x, p.y, q.x, q.y);
    }
  }

  drawCurbs(camera) {
    for (let i = 0; i < this.segments.length; i += 7) {
      const seg = this.segments[i];
      const curve = this.curvatureAt(seg.start);
      if (curve > 0.18) continue;
      if (i % 28 > 13) continue;
      const curbW = curve > 0.12 ? 24 : 36;
      const curbH = curve > 0.12 ? 10 : 12;
      const curbGap = 34 + smoothStep(0.06, 0.18, curve) * 32;
      for (const side of [-1, 1]) {
        const p = this.pointAt(seg.start, side * (this.width * 0.5 + curbGap + curbH * 0.5));
        if (!camera.visibleWorld(p.x, p.y, 460)) continue;
        const isRed = (i + side + 20) % 2 === 0;
        drawPixelRect(p.x, p.y, curbW, curbH, p.angle, isRed ? color(212, 26, 38, 235) : color(242, 240, 230, 235));
      }
    }
  }

  drawStartFinish(camera) {
    const p = this.pointAt(0, 0);
    if (!camera.visibleWorld(p.x, p.y, 520)) return;
    const cells = 14;
    const cellW = 18;
    const cellH = this.width / cells;
    push();
    translate(p.x, p.y);
    rotate(p.angle);
    noStroke();
    fill(245, 245, 235, 245);
    rect(0, 0, cellW * 2, this.width + 18, 0);
    for (let row = 0; row < cells; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        fill((row + col) % 2 === 0 ? color(18, 20, 22, 245) : color(244, 244, 236, 245));
        rect((col - 0.5) * cellW, -this.width * 0.5 + cellH * row + cellH * 0.5, cellW, cellH);
      }
    }
    pop();
  }
}

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 0.32;
    this.targetZoom = 0.32;
    this.shake = 0;
    this.rotation = 0;
    this.speedTremor = 0;
    this.viewWidth = 0;
    this.viewHeight = 0;
  }

  follow(target, dt, game) {
    const mode = game && game.currentCameraMode ? game.currentCameraMode().id : "CHASE";
    const speed = target.speedMagnitude();
    const look = target.forwardVector();
    let targetX = target.pos.x + look.x * clamp(speed * 4.4, 0, 310);
    let targetY = target.pos.y + look.y * clamp(speed * 4.4, 0, 310);
    let targetZoom = clamp(0.42 - speed * 0.0037, 0.24, 0.42);
    let targetRotation = -HALF_PI - target.heading;
    let smooth = 1 - Math.pow(0.001, dt);

    if (mode === "CLOSE") {
      targetX = target.pos.x + look.x * clamp(speed * 2.1, 0, 160);
      targetY = target.pos.y + look.y * clamp(speed * 2.1, 0, 160);
      targetZoom = clamp(0.58 - speed * 0.0032, 0.42, 0.58);
      smooth = 1 - Math.pow(0.00045, dt);
    } else if (mode === "WIDE") {
      targetX = target.pos.x + look.x * clamp(speed * 8.6, 120, 620);
      targetY = target.pos.y + look.y * clamp(speed * 8.6, 120, 620);
      targetZoom = clamp(0.34 - speed * 0.0026, 0.18, 0.34);
      smooth = 1 - Math.pow(0.0018, dt);
    } else if (mode === "HELI") {
      targetX = target.pos.x + look.x * clamp(speed * 3.2, 0, 230);
      targetY = target.pos.y + look.y * clamp(speed * 3.2, 0, 230);
      targetZoom = clamp(0.27 - speed * 0.0012, 0.18, 0.27);
      targetRotation = 0;
      smooth = 1 - Math.pow(0.003, dt);
    } else if (mode === "TV") {
      const track = game.track;
      const side = Math.sin(target.progress * 0.00034) >= 0 ? 1 : -1;
      const anchor = track.pointAt(target.progress + 520, side * (TRACK_WIDTH * 0.5 + 760));
      targetX = mix(anchor.x, target.pos.x, 0.66);
      targetY = mix(anchor.y, target.pos.y, 0.66);
      targetZoom = clamp(0.39 - speed * 0.0023, 0.24, 0.39);
      targetRotation = -HALF_PI - anchor.angle + side * 0.18;
      smooth = 1 - Math.pow(0.006, dt);
    }
    this.x = mix(this.x, targetX, smooth);
    this.y = mix(this.y, targetY, smooth);
    this.targetZoom = targetZoom;
    this.zoom = mix(this.zoom, this.targetZoom, 1 - Math.pow(0.0004, dt));
    this.rotation = angleLerp(this.rotation, targetRotation, 1 - Math.pow(0.0002, dt));
    this.speedTremor = mix(this.speedTremor, smoothStep(22, 48, speed), 1 - Math.pow(0.015, dt));
    this.shake = Math.max(0, this.shake - dt * 9);
  }

  addShake(amount) {
    this.shake = Math.min(18, this.shake + amount);
  }

  snapTo(target, game) {
    const mode = game && game.currentCameraMode ? game.currentCameraMode().id : "CHASE";
    const speed = target.speedMagnitude();
    const look = target.forwardVector();
    let targetX = target.pos.x + look.x * clamp(speed * 3.2, 0, 210);
    let targetY = target.pos.y + look.y * clamp(speed * 3.2, 0, 210);
    let targetZoom = clamp(0.42 - speed * 0.0037, 0.24, 0.42);
    let targetRotation = -HALF_PI - target.heading;
    if (mode === "CLOSE") {
      targetX = target.pos.x + look.x * clamp(speed * 1.6, 0, 120);
      targetY = target.pos.y + look.y * clamp(speed * 1.6, 0, 120);
      targetZoom = clamp(0.58 - speed * 0.0032, 0.42, 0.58);
    } else if (mode === "WIDE") {
      targetX = target.pos.x + look.x * clamp(speed * 6.2, 80, 430);
      targetY = target.pos.y + look.y * clamp(speed * 6.2, 80, 430);
      targetZoom = clamp(0.34 - speed * 0.0026, 0.18, 0.34);
    } else if (mode === "HELI") {
      targetZoom = clamp(0.27 - speed * 0.0012, 0.18, 0.27);
      targetRotation = 0;
    }
    this.x = targetX;
    this.y = targetY;
    this.zoom = targetZoom;
    this.targetZoom = targetZoom;
    this.rotation = targetRotation;
    this.speedTremor = 0;
  }

  setViewport(viewW, viewH) {
    this.viewWidth = viewW || width;
    this.viewHeight = viewH || height;
  }

  apply(viewW, viewH) {
    this.setViewport(viewW, viewH);
    const sx = this.viewWidth * 0.5;
    const sy = this.viewHeight * 0.5;
    const speedShake = this.speedTremor * 3.5;
    const shakeX = (noise(frameCount * 0.37) - 0.5) * (this.shake + speedShake);
    const shakeY = (noise(1000 + frameCount * 0.37) - 0.5) * (this.shake + speedShake * 1.8);
    translate(sx + shakeX, sy + shakeY);
    rotate(this.rotation);
    scale(this.zoom);
    translate(-this.x, -this.y);
  }

  worldToScreen(x, y) {
    const dx = (x - this.x) * this.zoom;
    const dy = (y - this.y) * this.zoom;
    const cr = Math.cos(this.rotation);
    const sr = Math.sin(this.rotation);
    return {
      x: dx * cr - dy * sr + (this.viewWidth || width) * 0.5,
      y: dx * sr + dy * cr + (this.viewHeight || height) * 0.5,
    };
  }

  visibleWorld(x, y, pad) {
    const p = this.worldToScreen(x, y);
    const margin = pad || 0;
    const viewW = this.viewWidth || width;
    const viewH = this.viewHeight || height;
    return p.x > -margin && p.x < viewW + margin && p.y > -margin && p.y < viewH + margin;
  }
}

class Car {
  constructor(game, options) {
    this.game = game;
    this.name = options.name;
    this.spriteIndex = options.spriteIndex;
    this.isPlayer = !!options.isPlayer;
    this.playerIndex = options.playerIndex || 0;
    this.controlScheme = options.controlScheme || (this.isPlayer ? "hybrid" : "ai");
    this.ai = !this.isPlayer;
    this.pos = createVector(0, 0);
    this.vel = createVector(0, 0);
    this.heading = 0;
    this.radius = 36;
    this.length = 126;
    this.width = 49;
    this.mass = options.mass || 735;
    this.enginePower = (options.enginePower || 8900) * CAR_ACCEL_MULT;
    this.brakePower = (options.brakePower || 14500) * CAR_BRAKE_MULT;
    this.maxSpeed = (options.maxSpeed || 49) * CAR_TOP_SPEED_MULT;
    this.baseGrip = options.grip || 9.1;
    this.steerRate = options.steerRate || 2.55;
    this.aggression = options.aggression || 0.6;
    this.racecraft = options.racecraft || 0.78;
    this.consistency = options.consistency || 0.86;
    this.lineBias = options.lineBias || 0;
    this.reaction = options.reaction || (this.ai ? 0.9 : 0.72);
    this.colorTone = options.colorTone || 0;
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.steerAngle = 0;
    this.yawRate = 0;
    this.slip = 0;
    this.handbrake = 0;
    this.ers = 1;
    this.fuel = 1;
    this.tire = 1;
    this.tireHeat = 0.45;
    this.tireCompoundIndex = options.tireCompoundIndex || 1;
    this.damage = 0;
    this.gear = 1;
    this.rpm = 0;
    this.lap = -1;
    this.progress = 0;
    this.raceDistance = -9999;
    this.currentLapStart = 0;
    this.lastLap = 0;
    this.bestLap = 0;
    this.finished = false;
    this.finishTime = 0;
    this.aiLane = 0;
    this.aiBaseLane = options.aiBaseLane || 0;
    this.aiPatience = random(0.2, 0.9);
    this.aiTrafficPenalty = 0;
    this.aiPassingSide = options.passSide || (this.lineBias >= 0 ? 1 : -1);
    this.aiCornerPlan = 0;
    this.autodrivePassLane = 0;
    this.autodriveLaneHold = 0;
    this.autodriveMode = "FLOW";
    this.autodriveTargetName = "";
    this.autodriveLaneMemory = 0;
    this.autodriveSteerMemory = 0;
    this.autodriveAimX = 0;
    this.autodriveAimY = 0;
    this.autodriveAimReady = false;
    this.trackInfo = null;
    this.trailTimer = 0;
    this.recoveryCooldown = 0;
    this.engineFlicker = random(1000);
  }

  placeAtRaceDistance(distance) {
    const p = this.game.track.pointAt(distance, this.lineBias);
    this.pos.set(p.x, p.y);
    this.heading = p.angle;
    this.vel.set(0, 0);
    this.progress = this.game.track.wrapDistance(distance);
    this.lap = Math.floor(distance / this.game.track.totalLength);
    if (distance < 0) this.lap = -1;
    this.raceDistance = this.lap * this.game.track.totalLength + this.progress;
    this.currentLapStart = 0;
  }

  forwardVector() {
    return { x: Math.cos(this.heading), y: Math.sin(this.heading) };
  }

  rightVector() {
    return { x: -Math.sin(this.heading), y: Math.cos(this.heading) };
  }

  speedMagnitude() {
    return Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
  }

  speedKmh() {
    return Math.round(this.speedMagnitude() * DASHBOARD_SPEED_SCALE);
  }

  tireCompound() {
    return this.game.tireCompounds[this.tireCompoundIndex] || this.game.tireCompounds[1];
  }

  trackRelativeInfo(x, y) {
    if (this.isPlayer) return this.game.track.nearestAround(x, y, this.progress, 1800);
    return this.game.track.nearest(x, y);
  }

  fitTireCompound(index) {
    this.tireCompoundIndex = wrap(index, this.game.tireCompounds.length);
    const compound = this.tireCompound();
    this.tire = 1;
    this.tireHeat = compound.startHeat;
  }

  update(dt) {
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
    this.trackInfo = this.trackRelativeInfo(this.pos.x, this.pos.y);
    if (this.isPlayer && this.game.pitStopTimer > 0 && this.game.pitStopCar === this) {
      this.throttle = 0;
      this.brake = 1;
      this.steer = 0;
      this.steerTarget = 0;
      this.steerAngle = mix(this.steerAngle, 0, 1 - Math.pow(0.0008, dt));
      this.yawRate = 0;
      this.vel.mult(Math.pow(0.012, dt));
      this.updateTelemetry(dt);
      return;
    }
    if (this.game.state !== "race") {
      this.throttle = 0;
      this.brake = 0;
      this.steer = 0;
      this.steerTarget = 0;
      this.steerAngle = mix(this.steerAngle, 0, 1 - Math.pow(0.0008, dt));
      this.yawRate = 0;
      this.vel.mult(Math.pow(0.08, dt));
      this.updateTelemetry(dt);
      return;
    }
    if (this.ai) this.updateAI(dt);
    else if (this.game.playerAutodrive) this.updateAutodrive(dt);
    else this.updatePlayerInputs(dt);
    this.integratePhysics(dt);
    this.updateRaceProgress();
    this.updateTelemetry(dt);
  }

  updatePlayerInputs(dt) {
    const scheme = this.controlScheme || "hybrid";
    const useWasd = scheme === "hybrid" || scheme === "wasd";
    const useArrows = scheme === "hybrid" || scheme === "arrows";
    const touch = this.game.mobileControlInput(this);
    const left = (useArrows && keyIsDown(LEFT_ARROW)) || (useWasd && keyIsDown(65)) || touch.left;
    const right = (useArrows && keyIsDown(RIGHT_ARROW)) || (useWasd && keyIsDown(68)) || touch.right;
    const throttleKey = (useArrows && keyIsDown(UP_ARROW)) || (useWasd && keyIsDown(87)) || touch.throttle;
    const brakeKey = (useArrows && keyIsDown(DOWN_ARROW)) || (useWasd && keyIsDown(83)) || touch.brake;
    const boostKey = keyIsDown(16) || touch.boost;
    this.steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    const steerResponse = this.steerTarget === 0 ? 1 - Math.pow(0.0015, dt) : 1 - Math.pow(0.018, dt);
    this.steer = mix(this.steer, this.steerTarget, steerResponse);
    this.throttle = mix(this.throttle, throttleKey ? 1 : 0, 1 - Math.pow(0.018, dt));
    this.brake = mix(this.brake, brakeKey ? 1 : 0, 1 - Math.pow(0.015, dt));
    this.handbrake = ((scheme === "arrows" ? keyIsDown(13) : keyIsDown(32)) || touch.handbrake) ? 1 : 0;
    if (boostKey && this.ers > 0.02) {
      this.throttle = Math.max(this.throttle, 0.72);
      this.ers = Math.max(0, this.ers - dt * 0.12);
      if (frameCount % 3 === 0) this.game.emitExhaust(this, 2);
    } else {
      this.ers = Math.min(1, this.ers + dt * 0.025 + this.brake * dt * 0.035);
    }
  }

  updateAutodrive(dt) {
    const track = this.game.track;
    const speed = this.speedMagnitude();
    const lookAhead = 560 + speed * 19;
    const lineNear = this.game.sampleOptimalLine(this.progress + lookAhead * 0.40);
    const lineMid = this.game.sampleOptimalLine(this.progress + lookAhead * 0.82);
    const lineFar = this.game.sampleOptimalLine(this.progress + lookAhead * 1.22);
    const rawLineLane =
      (lineNear ? lineNear.lane * 0.20 : 0) +
      (lineMid ? lineMid.lane * 0.52 : 0) +
      (lineFar ? lineFar.lane * 0.28 : 0);
    const curvature = Math.max(
      track.curvatureAt(this.progress + lookAhead * 0.38),
      track.curvatureAt(this.progress + lookAhead * 0.78),
      track.curvatureAt(this.progress + lookAhead * 1.18),
      track.curvatureAt(this.progress + lookAhead * 1.56)
    );
    const cornerCommit = smoothStep(0.08, 0.24, curvature);
    const edgeRisk = smoothStep(-120, 12, this.trackInfo.edgeOverflow);
    const flowLane = clamp(rawLineLane * mix(0.10, 0.42, cornerCommit), -TRACK_WIDTH * 0.24, TRACK_WIDTH * 0.24);
    const plan = this.planAutodriveLane(flowLane, curvature, dt);
    const recoveryLane = edgeRisk > 0.01
      ? clamp(mix(plan.lane, 0, edgeRisk * 0.82), -TRACK_WIDTH * 0.30, TRACK_WIDTH * 0.30)
      : plan.lane;
    const laneStep = (plan.mode === "OVERTAKE" ? 92 : 38) * dt * (1 + edgeRisk * 1.3);
    this.autodriveLaneMemory += clamp(recoveryLane - this.autodriveLaneMemory, -laneStep, laneStep);
    this.autodriveLaneMemory = clamp(this.autodriveLaneMemory, -TRACK_WIDTH * 0.30, TRACK_WIDTH * 0.30);
    this.aiLane = this.autodriveLaneMemory;

    const pursuit = mix(Math.max(700, speed * 13.5), Math.max(470, speed * 8.6), Math.max(cornerCommit, edgeRisk));
    const near = track.pointAt(this.progress + pursuit * 0.56, this.aiLane * 0.10);
    const mid = track.pointAt(this.progress + pursuit * 0.98, this.aiLane * 0.48);
    const far = track.pointAt(this.progress + pursuit * 1.36, this.aiLane * 0.72);
    const rawAimX = mix(near.x, mix(mid.x, far.x, 0.62), 0.70);
    const rawAimY = mix(near.y, mix(mid.y, far.y, 0.62), 0.70);
    if (!this.autodriveAimReady) {
      this.autodriveAimX = rawAimX;
      this.autodriveAimY = rawAimY;
      this.autodriveAimReady = true;
    } else {
      const aimBlend = 1 - Math.pow(0.00012, dt * (1.2 + edgeRisk * 1.8));
      this.autodriveAimX = mix(this.autodriveAimX, rawAimX, aimBlend);
      this.autodriveAimY = mix(this.autodriveAimY, rawAimY, aimBlend);
    }
    const desired = Math.atan2(this.autodriveAimY - this.pos.y, this.autodriveAimX - this.pos.x);
    const angleError = wrapAngle(desired - this.heading);
    const laneError = clamp((this.aiLane - this.trackInfo.lateral) / (TRACK_WIDTH * 0.5), -1, 1);
    const lateralSpeed = dot(this.vel.x, this.vel.y, -Math.sin(this.heading), Math.cos(this.heading));
    const steerPower = 1.02 + cornerCommit * 0.22 + edgeRisk * 0.18;
    const edgeCorrection = clamp(-this.trackInfo.lateral / (TRACK_WIDTH * 0.5), -1, 1) * edgeRisk * 0.22;
    const laneCorrection = laneError * mix(0.006, 0.024, cornerCommit) + edgeCorrection;
    const yawDamping = this.yawRate * 0.42 + lateralSpeed * 0.0062;
    const rawSteer = clamp(angleError * steerPower + laneCorrection - yawDamping, -1, 1);
    const steerStep = (0.62 + edgeRisk * 0.95 + cornerCommit * 0.18) * dt;
    this.autodriveSteerMemory += clamp(rawSteer - this.autodriveSteerMemory, -steerStep, steerStep);
    this.steerTarget = this.autodriveSteerMemory;
    const steerBlend = 1 - Math.pow(0.020, dt * mix(0.78, 0.48, clamp(speed / Math.max(1, this.maxSpeed), 0, 1)) * (1 + edgeRisk * 0.45));
    this.steer = mix(this.steer, this.steerTarget, steerBlend);

    const lineBrake = Math.max(lineNear ? lineNear.brake : 0, lineMid ? lineMid.brake : 0, lineFar ? lineFar.brake : 0) * 0.58;
    const lineTarget = Math.min(
      (lineNear ? lineNear.target : this.maxSpeed) * 1.12,
      (lineMid ? lineMid.target : this.maxSpeed) * 1.14,
      (lineFar ? lineFar.target : this.maxSpeed) * 1.10
    );
    const weatherGrip = mix(1, 0.76, this.game.weather.rain);
    const lanePenalty = Math.abs(this.trackInfo.lateral - this.aiLane) / Math.max(1, TRACK_WIDTH * 0.5);
    const cornerLimit = this.maxSpeed * (1.27 - curvature * 1.34 - lanePenalty * 0.045) * weatherGrip;
    const cornerFloor = mix(31, 20.5, smoothStep(0.08, 0.36, curvature)) * weatherGrip;
    const cleanLimit = Math.min(lineTarget + 3.0, cornerLimit);
    const targetSpeed = clamp(cleanLimit + plan.attackBoost - plan.trafficBrake * 3.1 - edgeRisk * 7.5, cornerFloor * mix(1, 0.74, edgeRisk), this.maxSpeed * 1.11);
    const approachBrake = smoothStep(targetSpeed + 3.0, targetSpeed + 10.8, speed);
    this.throttle = clamp((targetSpeed - speed) * 0.165 + 0.60 - Math.abs(angleError) * 0.055 - lineBrake * 0.060, 0, 1);
    this.brake = clamp(approachBrake * 0.42 + lineBrake * 0.11 + Math.abs(angleError) * 0.085 + curvature * 0.055 + plan.trafficBrake * 0.58 + edgeRisk * 0.18, 0, 1);
    if (this.brake > 0.26) this.throttle *= mix(1, 0.34, this.brake);
    this.handbrake = 0;
    this.ers = Math.min(1, this.ers + dt * 0.018 + this.brake * dt * 0.032);
    if (this.ers > 0.36 && this.throttle > 0.82 && curvature < 0.11 && plan.trafficBrake < 0.18) {
      this.ers = Math.max(0, this.ers - dt * 0.070);
      this.throttle = 1;
    }
    this.game.autodriveState = {
      lane: this.aiLane,
      mode: plan.mode,
      targetSpeed,
      trafficBrake: plan.trafficBrake,
      target: plan.targetName,
    };
  }

  planAutodriveLane(optimalLane, curvature, dt) {
    this.autodriveLaneHold = Math.max(0, this.autodriveLaneHold - dt);
    let lane = clamp(optimalLane || 0, -TRACK_WIDTH * 0.38, TRACK_WIDTH * 0.38);
    let trafficBrake = 0;
    let attackBoost = 0;
    let mode = "FLOW";
    let targetName = "";
    const speed = this.speedMagnitude();
    const blockers = [];
    let target = null;
    let density = 0;
    for (const other of this.game.cars) {
      if (other === this) continue;
      const delta = other.raceDistance - this.raceDistance;
      if (delta < -90 || delta > 820) continue;
      const otherLat = other.trackInfo ? other.trackInfo.lateral : other.aiBaseLane;
      const sameLane = Math.abs(lane - otherLat);
      const closing = speed - other.speedMagnitude();
      if (delta > 0 && delta < 680) {
        const danger = clamp(1 - sameLane / 190, 0, 1) * clamp(1 - delta / 680, 0, 1);
        trafficBrake = Math.max(trafficBrake, danger * clamp((closing + 6) / 22, 0, 1) * 0.36);
        density += clamp(1 - delta / 720, 0, 1) * clamp(1 - sameLane / 360, 0, 1);
      }
      if (delta > 35 && delta < 660 && Math.abs(lane - otherLat) < 240) {
        blockers.push({ car: other, delta, lateral: otherLat });
        if (!target || delta < target.delta) target = { car: other, delta, lateral: otherLat };
      }
    }
    trafficBrake += clamp(density - 1.25, 0, 1.4) * 0.10;

    if (this.autodriveLaneHold > 0 && this.autodriveMode === "OVERTAKE") {
      const heldScore = this.scoreAutodriveLane(this.autodrivePassLane, target ? target.delta : 280, lane);
      if (heldScore > -0.52 || blockers.length) {
        return {
          lane: clamp(mix(lane, this.autodrivePassLane, 0.84), -TRACK_WIDTH * 0.42, TRACK_WIDTH * 0.42),
          trafficBrake: clamp(trafficBrake * 0.72, 0, 0.38),
          attackBoost: curvature < 0.18 ? 5.2 : 3.2,
          mode: "OVERTAKE",
          targetName: this.autodriveTargetName,
        };
      }
    }

    if (target) {
      let bestLane = lane;
      let bestScore = this.scoreAutodriveLane(lane, target.delta, lane);
      const candidates = [
        lane,
        clamp(target.lateral - (this.radius + target.car.radius + 146), -TRACK_WIDTH * 0.42, TRACK_WIDTH * 0.42),
        clamp(target.lateral + (this.radius + target.car.radius + 146), -TRACK_WIDTH * 0.42, TRACK_WIDTH * 0.42),
        clamp(lane - 180, -TRACK_WIDTH * 0.42, TRACK_WIDTH * 0.42),
        clamp(lane + 180, -TRACK_WIDTH * 0.42, TRACK_WIDTH * 0.42),
      ];
      for (const candidate of candidates) {
        const clearance = this.scoreAutodriveLane(candidate, target.delta, lane);
        const routeBias = 1 - Math.abs(candidate - optimalLane) / Math.max(1, TRACK_WIDTH * 0.82);
        const apexBias = curvature > 0.12 && Math.sign(candidate) === Math.sign(optimalLane) ? 0.10 : 0;
        const edgeCost = smoothStep(TRACK_WIDTH * 0.31, TRACK_WIDTH * 0.48, Math.abs(candidate)) * 0.22;
        const score = clearance + routeBias * 0.34 + apexBias - edgeCost;
        if (score > bestScore) {
          bestScore = score;
          bestLane = candidate;
        }
      }
      if (Math.abs(bestLane - lane) > 42 && bestScore > this.scoreAutodriveLane(lane, target.delta, lane) + 0.10) {
        this.autodrivePassLane = bestLane;
        this.autodriveLaneHold = 0.95;
        this.autodriveMode = "OVERTAKE";
        this.autodriveTargetName = target.car.name;
      }
      const committedLane = this.autodriveLaneHold > 0 ? this.autodrivePassLane : bestLane;
      lane = mix(optimalLane, committedLane, clamp(0.64 + (660 - target.delta) / 1120, 0.64, 0.86));
      mode = "OVERTAKE";
      targetName = target.car.name;
      attackBoost = clamp(3.6 + (660 - target.delta) * 0.007, 3.6, 7.4);
      trafficBrake = Math.max(0, trafficBrake - bestScore * 0.16);
    } else {
      this.autodriveMode = "FLOW";
      this.autodriveTargetName = "";
    }

    return {
      lane: clamp(lane, -TRACK_WIDTH * 0.42, TRACK_WIDTH * 0.42),
      trafficBrake: clamp(trafficBrake, 0, 0.36),
      attackBoost,
      mode,
      targetName,
    };
  }

  scoreAutodriveLane(candidate, focusDelta, baseLane) {
    let score = 1.05 - smoothStep(TRACK_WIDTH * 0.30, TRACK_WIDTH * 0.48, Math.abs(candidate)) * 0.42;
    score -= Math.abs(candidate - baseLane) / Math.max(1, TRACK_WIDTH) * 0.10;
    for (const other of this.game.cars) {
      if (other === this) continue;
      const delta = other.raceDistance - this.raceDistance;
      if (delta < -110 || delta > 840) continue;
      const otherLat = other.trackInfo ? other.trackInfo.lateral : other.aiBaseLane;
      const laneGap = Math.abs(candidate - otherLat);
      const longitudinalRisk = clamp(1 - Math.abs(delta - focusDelta) / 620, 0, 1);
      const lateralRisk = clamp(1 - laneGap / 190, 0, 1);
      score -= longitudinalRisk * lateralRisk * (delta > 0 ? 1.16 : 0.54);
      if (delta > -40 && delta < 190) score -= lateralRisk * 0.58;
    }
    return score;
  }

  updateAI(dt) {
    const track = this.game.track;
    const speed = this.speedMagnitude();
    const lookAhead = 520 + speed * 18 + this.racecraft * 230;
    const lineLook = this.game.sampleOptimalLine(this.progress + lookAhead * 0.72);
    const optimalLane = lineLook ? lineLook.lane : 0;
    const curvature = Math.max(
      track.curvatureAt(this.progress + lookAhead * 0.45),
      track.curvatureAt(this.progress + lookAhead * 0.82),
      track.curvatureAt(this.progress + lookAhead * 1.2)
    );
    const tactical = this.findTacticalLane(optimalLane);
    const recoveryLane = Math.abs(this.trackInfo.lateral) > TRACK_WIDTH * 0.44 ? clamp(optimalLane + this.aiBaseLane * 0.45 - this.trackInfo.lateral * 0.22, -TRACK_WIDTH * 0.36, TRACK_WIDTH * 0.36) : tactical;
    this.aiLane = mix(this.aiLane, recoveryLane, 1 - Math.pow(0.28, dt * (0.58 + this.racecraft * 0.18)));
    const near = track.pointAt(this.progress + Math.max(250, speed * 6.2), this.aiLane * 0.55);
    const far = track.pointAt(this.progress + lookAhead, this.aiLane);
    const aimX = mix(near.x, far.x, 0.82);
    const aimY = mix(near.y, far.y, 0.82);
    const desired = Math.atan2(aimY - this.pos.y, aimX - this.pos.x);
    const angleError = wrapAngle(desired - this.heading);
    const centerCorrection = clamp((this.aiLane - this.trackInfo.lateral) / (TRACK_WIDTH * 0.5), -1, 1) * 0.022;
    this.steerTarget = clamp(angleError * (1.78 + this.racecraft * 0.14) + centerCorrection, -1, 1);
    this.steer = mix(this.steer, this.steerTarget, 1 - Math.pow(0.11, dt * this.reaction * 0.86));
    const weatherGrip = mix(1, 0.80, this.game.weather.rain);
    const lateralError = Math.abs(this.trackInfo.lateral) / Math.max(1, TRACK_WIDTH * 0.5);
    const physicsSafe = this.maxSpeed * (1.18 - curvature * (2.02 - this.racecraft * 0.35) - lateralError * 0.07) * weatherGrip;
    const lineBrake = lineLook ? clamp(lineLook.brake * 1.16, 0, 1) : 0;
    const lineLimit = lineLook ? mix(this.maxSpeed, lineLook.target * (1.04 + this.racecraft * 0.09), lineBrake) : this.maxSpeed;
    const safeSpeed = clamp(Math.min(physicsSafe, lineLimit), 17, this.maxSpeed);
    const congestion = this.nearbyCongestion();
    const offTrackPenalty = this.trackInfo.edgeOverflow > -20 ? 0.70 : 1;
    const targetSpeed = Math.max(15, (safeSpeed - congestion * 1.2 - this.aiTrafficPenalty + this.aggression * 5.2 + this.game.aiChallengeBoost(this)) * offTrackPenalty);
    this.throttle = clamp((targetSpeed - speed) * 0.13 + 0.38, 0, 1);
    this.brake = clamp((speed - targetSpeed) * 0.22 + Math.abs(angleError) * 0.24 + curvature * 0.15 + lineBrake * 0.14 + lateralError * 0.03, 0, 1);
    this.handbrake = 0;
    this.ers = Math.min(1, this.ers + dt * 0.018 + this.brake * dt * 0.025);
    if (this.ers > 0.45 && curvature < 0.12 && this.throttle > 0.85 && this.game.state === "race") {
      this.ers -= dt * 0.055;
      this.throttle = 1;
    }
  }

  findTacticalLane(optimalLane) {
    this.aiTrafficPenalty = 0;
    let lane = clamp((optimalLane || 0) + this.aiBaseLane * 0.58, -TRACK_WIDTH * 0.36, TRACK_WIDTH * 0.36);
    for (const other of this.game.cars) {
      if (other === this) continue;
      const delta = other.raceDistance - this.raceDistance;
      if (delta > 0 && delta < 340) {
        const otherLat = other.trackInfo ? other.trackInfo.lateral : other.aiBaseLane;
        const lateralGap = lane - otherLat;
        const overlapRisk = clamp(1 - Math.abs(lateralGap) / (this.radius + other.radius + 58), 0, 1);
        this.aiTrafficPenalty += overlapRisk * (1 - delta / 340) * 2.1;
        const passLane = clamp(otherLat + this.aiPassingSide * (this.radius + other.radius + 92), -TRACK_WIDTH * 0.38, TRACK_WIDTH * 0.38);
        lane = mix(lane, passLane, overlapRisk * (1 - delta / 340) * 0.62);
      }
    }
    return clamp(lane, -TRACK_WIDTH * 0.38, TRACK_WIDTH * 0.38);
  }

  nearbyCongestion() {
    let c = 0;
    for (const other of this.game.cars) {
      if (other === this) continue;
      const dx = other.pos.x - this.pos.x;
      const dy = other.pos.y - this.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 300) c += (300 - dist) / 300;
    }
    return Math.min(c, 2.2);
  }

  integratePhysics(dt) {
    const fwd = this.forwardVector();
    const right = this.rightVector();
    const forwardSpeed = dot(this.vel.x, this.vel.y, fwd.x, fwd.y);
    const lateralSpeed = dot(this.vel.x, this.vel.y, right.x, right.y);
    const speed = this.speedMagnitude();
    const absForward = Math.abs(forwardSpeed);
    const compound = this.tireCompound();
    const inPitLane = this.game.isPointInPitLane(this.pos.x, this.pos.y);
    const offTrack = inPitLane ? 0 : clamp((this.trackInfo.edgeOverflow + 28) / 190, 0, 1);
    const rainGrip = mix(1, 0.64, this.game.weather.rain);
    const weatherSuit = mix(compound.dryGrip, compound.wetGrip, smoothStep(0.08, 0.38, this.game.weather.rain));
    const tireGrip = clamp((0.72 + this.tire * 0.52 - Math.abs(this.tireHeat - compound.idealHeat) * 0.34) * compound.grip * weatherSuit, 0.58, 1.34);
    const autopilot = this.isPlayer && this.game.playerAutodrive;
    const playerAssist = autopilot ? 0.92 : this.isPlayer && this.game.stabilityAssist ? this.game.stabilityAssist() : 0.35;
    const cornerDemand = this.isPlayer
      ? Math.max(this.game.track.curvatureAt(this.progress + 260), this.game.track.curvatureAt(this.progress + 520))
      : 0;
    const cornerStressRaw = this.isPlayer ? smoothStep(0.08, 0.30, cornerDemand) * smoothStep(24, this.maxSpeed * 0.95, speed) * mix(1, 0.55, this.brake) : 0;
    const cornerStress = autopilot ? cornerStressRaw * 0.38 : cornerStressRaw;
    const aiGripHelp = this.ai ? 1.36 : autopilot ? 1.18 : mix(0.88, 1.05, playerAssist);
    const grip = this.baseGrip * aiGripHelp * mix(1, 0.36, offTrack) * rainGrip * tireGrip * (this.isPlayer ? mix(1, autopilot ? 0.92 : 0.80, cornerStress) : 1);
    const speedNorm = clamp(speed / this.maxSpeed, 0, 1.3);
    const highSpeedSteer = this.ai ? 0.24 : mix(0.15, 0.20, playerAssist);
    const steerLimit = mix(0.66, highSpeedSteer, smoothStep(12, this.maxSpeed * 0.95, absForward)) * (this.handbrake ? 1.08 : 1) * (this.ai ? 1.14 : mix(0.92, 1, playerAssist)) * (this.isPlayer ? mix(1, autopilot ? 0.92 : 0.78, cornerStress) : 1);
    const targetSteerAngle = this.steer * steerLimit;
    const steerCatch = 1 - Math.pow(this.ai ? 0.018 : 0.024, dt * mix(4.4, 2.6, speedNorm));
    this.steerAngle = mix(this.steerAngle, targetSteerAngle, steerCatch);
    const slipAngle = Math.atan2(lateralSpeed, Math.max(5, absForward)) * (forwardSpeed >= 0 ? 1 : -1);
    this.slip = mix(this.slip, slipAngle, 1 - Math.pow(0.02, dt));
    const highSpeedUndersteer = smoothStep(24, this.maxSpeed * 1.08, speed) * (this.ai ? 0.28 : autopilot ? 0.30 : 0.50);
    const brakeUndersteer = this.brake * speedNorm * 0.12;
    const throttlePush = this.isPlayer && !autopilot ? this.throttle * cornerStress * 0.34 : 0;
    const understeer = clamp(1 - highSpeedUndersteer - brakeUndersteer - throttlePush + Math.abs(this.slip) * 0.07, this.ai ? 0.48 : 0.28, 1);
    const wheelBase = this.ai ? 142 : 148;
    const yawGrip = mix(1, 0.58, offTrack) * rainGrip * tireGrip;
    const desiredYawRate = (forwardSpeed * WORLD_SPEED_SCALE / wheelBase) * Math.tan(this.steerAngle) * understeer * yawGrip;
    this.yawRate = mix(this.yawRate, desiredYawRate, 1 - Math.pow(0.018, dt * 2.5));
    this.yawRate *= Math.pow(0.78, dt * (1 + Math.abs(this.slip) * 0.45));
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    const boost = this.ers > 0.05 && this.throttle > 0.94 ? 1.055 : 1;
    const penaltyLimiter = this.isPlayer && this.game.penaltySlowdownTimer > 0 ? 0.68 : 1;
    const powerCurve = clamp(1.03 - Math.abs(forwardSpeed) / (this.maxSpeed * 1.25), 0.20, 1.05);
    let engine = this.throttle * this.enginePower * powerCurve * boost * mix(1, 0.68, offTrack) * (0.82 + this.fuel * 0.18) * penaltyLimiter;
    if (forwardSpeed < -8) engine *= 0.2;
    const braking = this.brake * this.brakePower * (forwardSpeed > 1 ? 1 : 0.38);
    const reverse = this.isPlayer && this.brake > 0.2 && forwardSpeed < 5 && this.throttle < 0.05 ? this.brake * 5200 : 0;
    const drag = (0.74 + offTrack * 1.08 + this.game.weather.rain * 0.16 + cornerStress * 0.32) * speed * speed;
    const rolling = 76 * speed;

    const longForce = engine - Math.sign(forwardSpeed) * braking - Math.sign(forwardSpeed) * drag - Math.sign(forwardSpeed) * rolling - reverse;
    this.vel.x += fwd.x * (longForce / this.mass) * dt;
    this.vel.y += fwd.y * (longForce / this.mass) * dt;

    const loadedGrip = grip * mix(0.58, 1.18, smoothStep(2, 20, absForward)) * (this.isPlayer ? mix(1, 0.88, cornerStress) : 1);
    const lateralKill = clamp(loadedGrip * dt * 0.92 * (this.handbrake ? 0.24 : 1) * mix(1, 0.78, this.brake * speedNorm), 0, 0.68);
    this.vel.x -= right.x * lateralSpeed * lateralKill;
    this.vel.y -= right.y * lateralSpeed * lateralKill;
    const postGripSpeed = this.speedMagnitude();
    if (postGripSpeed > 0.4 && forwardSpeed > -2) {
      const velocityAngle = Math.atan2(this.vel.y, this.vel.x);
      const align = clamp(loadedGrip * dt * (this.handbrake ? 0.12 : 0.34), 0, this.ai ? 0.24 : mix(0.11, 0.15, playerAssist));
      const alignedAngle = angleLerp(velocityAngle, this.heading, align);
      this.vel.x = Math.cos(alignedAngle) * postGripSpeed;
      this.vel.y = Math.sin(alignedAngle) * postGripSpeed;
    }
    const scrub = clamp(Math.abs(this.slip) * 0.0035 + this.handbrake * 0.004, 0, 0.024);
    this.vel.mult(1 - scrub);

    const pitLaneLimit = inPitLane ? 18.5 : Infinity;
    const autodriveCap = autopilot ? 1.14 : 1;
    const max = Math.min(this.maxSpeed * compound.speed * autodriveCap * penaltyLimiter * (this.finished ? 0.55 : 1), pitLaneLimit);
    const newSpeed = this.speedMagnitude();
    if (newSpeed > max) {
      this.vel.mult(max / newSpeed);
    }

    this.pos.x += this.vel.x * dt * WORLD_SPEED_SCALE;
    this.pos.y += this.vel.y * dt * WORLD_SPEED_SCALE;
    this.trackInfo = this.trackRelativeInfo(this.pos.x, this.pos.y);
    const postMovePitLane = this.game.pitLaneInfo(this.pos.x, this.pos.y);
    if (this.ai) this.stabilizeAI(dt);
    this.handleBarriers(offTrack, lateralSpeed, dt, postMovePitLane);
    this.emitDrivingEffects(lateralSpeed, offTrack, dt);
  }

  stabilizeAI(dt) {
    const info = this.game.track.nearest(this.pos.x, this.pos.y);
    const laneError = info.lateral - this.aiLane;
    const lanePull = clamp(dt * 1.45, 0, 0.105);
    this.pos.x -= info.normalX * laneError * lanePull;
    this.pos.y -= info.normalY * laneError * lanePull;
    const normalSpeed = dot(this.vel.x, this.vel.y, info.normalX, info.normalY);
    this.vel.x -= info.normalX * normalSpeed * clamp(dt * 8.5, 0, 0.72);
    this.vel.y -= info.normalY * normalSpeed * clamp(dt * 8.5, 0, 0.72);
    const targetHeading = info.angle;
    this.heading = angleLerp(this.heading, targetHeading, clamp(dt * (1.15 + this.speedMagnitude() * 0.035), 0, 0.12));
    this.yawRate *= Math.pow(0.16, dt);
    this.slip *= Math.pow(0.08, dt);
  }

  recoverToTrackCenter(push) {
    const canAnnounce = this.recoveryCooldown <= 0;
    this.recoveryCooldown = 0.38;
    const progress = this.trackInfo ? this.trackInfo.progress : this.progress;
    const p = this.game.track.pointAt(progress + 96, 0);
    const keepSpeed = clamp(this.speedMagnitude() * 0.14, 0, 7);
    this.pos.set(p.x, p.y);
    this.heading = p.angle;
    this.vel.set(Math.cos(p.angle) * keepSpeed, Math.sin(p.angle) * keepSpeed);
    this.yawRate = 0;
    this.slip = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.steerAngle = 0;
    this.trackInfo = this.trackRelativeInfo(this.pos.x, this.pos.y);
    this.progress = this.trackInfo.progress;
    this.damage = clamp(this.damage + push * 0.00022, 0, 1);
    this.game.shakeCameraFor(this, 5);
    if (this.isPlayer) this.game.snapCameraTo(this);
    if (this.game.state === "race" && this.game.trackLimitCooldown <= 0) {
      this.game.penaltySeconds += 5;
      this.game.trackLimitWarnings = 0;
      this.game.penaltySlowdownTimer = 1.4;
      this.game.trackLimitCooldown = 1.6;
      this.game.pushDirector("TRACK RESET", "Recovered to center track. +5s penalty.", 2.8);
    } else if (canAnnounce) {
      this.game.pushDirector("TRACK RESET", "Recovered to the racing surface", 2.2);
    }
  }

  handleBarriers(offTrack, lateralSpeed, dt, pitLane) {
    if (this.isPlayer && pitLane && pitLane.inLane && pitLane.laneError < 132) return;
    const hardLimit = this.isPlayer ? TRACK_WIDTH * 0.5 + PLAYER_GRASS_RESET_OVERFLOW : TRACK_WIDTH * 0.5 + 160;
    const lateral = this.trackInfo.lateral;
    if (Math.abs(lateral) > hardLimit) {
      const side = lateral > 0 ? 1 : -1;
      const push = Math.abs(lateral) - hardLimit;
      if (this.isPlayer) {
        this.game.emitSparks(this.pos.x, this.pos.y, Math.min(12, 3 + push * 0.045));
        if (this.game.audio) this.game.audio.playImpact(push * 0.012 + this.speedMagnitude() * 0.08, this.pos.x, this.pos.y, true);
        this.recoverToTrackCenter(push);
        return;
      }
      this.pos.x -= this.trackInfo.normalX * side * push * 0.92;
      this.pos.y -= this.trackInfo.normalY * side * push * 0.92;
      const impact = dot(this.vel.x, this.vel.y, this.trackInfo.normalX * side, this.trackInfo.normalY * side);
      if (impact > 0) {
        this.vel.x -= this.trackInfo.normalX * side * impact * 1.72;
        this.vel.y -= this.trackInfo.normalY * side * impact * 1.72;
      }
      this.vel.mult(0.62);
      this.damage = clamp(this.damage + (push * 0.0005 + Math.abs(impact) * 0.006), 0, 1);
      this.game.shakeCameraFor(this, this.isPlayer ? clamp(push * 0.18, 2, 10) : 0.6);
      this.game.emitSparks(this.pos.x, this.pos.y, Math.min(16, 4 + push * 0.08));
      if (this.game.audio) this.game.audio.playImpact(push * 0.012 + Math.abs(impact) * 0.10, this.pos.x, this.pos.y, this.isPlayer);
    }
  }

  emitDrivingEffects(lateralSpeed, offTrack, dt) {
    this.trailTimer -= dt;
    const speed = this.speedMagnitude();
    if (this.trailTimer <= 0) {
      if (offTrack > 0.2 && speed > 10) {
        this.game.emitDust(this, 1 + Math.floor(offTrack * 3));
        this.trailTimer = 0.035;
      } else if ((Math.abs(lateralSpeed) > 12 || this.brake > 0.7) && speed > 18) {
        this.game.addSkidMark(this);
        this.trailTimer = 0.045;
      }
    }
    if (this.throttle > 0.88 && speed < 36 && frameCount % 8 === 0) {
      this.game.emitExhaust(this, 1);
    }
  }

  updateRaceProgress() {
    const previous = this.progress;
    const next = this.trackInfo.progress;
    const total = this.game.track.totalLength;
    if (next < total * 0.18 && previous > total * 0.82) {
      this.lap += 1;
      if (this.game.state === "race") {
        const lapTime = this.game.raceTime - this.currentLapStart;
        if (this.lap > 0) {
          this.lastLap = lapTime;
          if (!this.bestLap || lapTime < this.bestLap) this.bestLap = lapTime;
        }
        this.currentLapStart = this.game.raceTime;
      }
      if (this.lap >= this.game.raceLaps && !this.finished) {
        this.finished = true;
        this.finishTime = this.game.raceTime;
        if (this === this.game.player) this.game.finishRace();
      }
    } else if (next > total * 0.82 && previous < total * 0.18 && this.lap > -1) {
      this.lap -= 1;
    }
    this.progress = next;
    this.raceDistance = this.lap * total + this.progress;
  }

  updateTelemetry(dt) {
    const speed = this.speedMagnitude();
    const compound = this.tireCompound();
    this.fuel = clamp(this.fuel - this.throttle * dt * 0.0022, 0.18, 1);
    const slip = Math.abs(dot(this.vel.x, this.vel.y, -Math.sin(this.heading), Math.cos(this.heading)));
    const wetAbuse = compound.name === "WET" ? smoothStep(0.22, 0.02, this.game.weather.rain) * 1.55 : 0;
    const dryAbuse = compound.name !== "WET" ? smoothStep(0.16, 0.44, this.game.weather.rain) * 0.28 : 0;
    this.tire = clamp(this.tire - (slip * 0.000002 + this.brake * speed * 0.000003 + wetAbuse * speed * 0.0000012 + dryAbuse * speed * 0.0000007) * compound.wear * dt * 60, 0.24, 1);
    this.tireHeat = clamp(this.tireHeat + (slip * 0.0009 * compound.heatRate + this.brake * 0.02 + this.throttle * 0.006 - 0.012 - this.game.weather.rain * 0.008) * dt, 0, 1);
    const kmh = this.speedKmh();
    this.gear = kmh < 35 ? 1 : kmh < 82 ? 2 : kmh < 125 ? 3 : kmh < 168 ? 4 : kmh < 210 ? 5 : kmh < 250 ? 6 : 7;
    this.rpm = clamp((kmh % 42) / 42 + this.throttle * 0.35, 0, 1);
  }

  draw(camera) {
    if (!camera.visibleWorld(this.pos.x, this.pos.y, 260)) return;
    const speed = this.speedMagnitude();
    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.heading + HALF_PI);
    noStroke();
    fill(0, 0, 0, 92);
    rect(7, 9, this.width + 17, this.length * 0.86, 8);
    const sprite = this.game.sprites[this.spriteIndex];
    if (sprite) {
      if (this.damage > 0.62 && frameCount % 8 < 3) tint(255, 170, 170, 235);
      else tint(255);
      const stretch = this.isPlayer ? 1 + smoothStep(26, this.maxSpeed, speed) * 0.07 : 1;
      image(sprite.img, 0, 0, this.width * (1 - (stretch - 1) * 0.18), this.length * stretch);
      noTint();
    } else {
      fill(this.isPlayer ? color(210, 20, 30) : color(30, 95, 205));
      rect(0, 0, this.width, this.length);
    }
    if (this.throttle > 0.82 && this.game.state === "race") {
      const flame = 8 + noise(this.engineFlicker + frameCount * 0.21) * 14;
      fill(255, 130, 32, 205);
      rect(0, this.length * 0.48 + flame * 0.35, 12, flame);
      fill(255, 230, 90, 185);
      rect(0, this.length * 0.48 + flame * 0.12, 6, flame * 0.55);
    }
    if (speed > 30 && this.isPlayer) {
      stroke(255, 255, 255, 26 + smoothStep(30, this.maxSpeed, speed) * 42);
      strokeWeight(2);
      for (let i = 0; i < 3; i += 1) {
        line(-this.width * 0.55 + i * this.width * 0.55, this.length * 0.2, -this.width * 0.55 + i * this.width * 0.55, this.length * 0.76);
      }
    }
    pop();

    if (this.isPlayer || this.game.leaders[0] === this) {
      const p = camera.worldToScreen(this.pos.x, this.pos.y);
      push();
      resetMatrix();
      textAlign(CENTER, CENTER);
      textSize(11);
      noStroke();
      fill(this.isPlayer ? color(255, 236, 120) : color(255, 255, 255, 190));
      const label = this.isPlayer ? (this.game.isSplitScreenActive() ? "P" + this.playerIndex : "YOU") : "P1";
      text(label, p.x, p.y - 62);
      pop();
    }
  }
}

class Particle {
  constructor(x, y, vx, vy, life, size, c, type) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.c = c;
    this.type = type || "dust";
    this.spin = random(-2, 2);
    this.angle = random(TWO_PI);
  }

  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt * 60;
    this.y += this.vy * dt * 60;
    this.vx *= Math.pow(0.86, dt * 60);
    this.vy *= Math.pow(0.86, dt * 60);
    this.angle += this.spin * dt;
  }

  draw(camera) {
    if (this.life <= 0 || !camera.visibleWorld(this.x, this.y, 80)) return;
    const t = clamp(this.life / this.maxLife, 0, 1);
    push();
    translate(this.x, this.y);
    rotate(this.angle);
    noStroke();
    const cc = color(red(this.c), green(this.c), blue(this.c), alpha(this.c) * t);
    fill(cc);
    const s = this.size * mix(1.4, 0.4, t);
    rect(0, 0, s, s);
    pop();
  }
}

class SkidMark {
  constructor(x, y, angle, widthValue) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.width = widthValue;
    this.life = 10;
  }

  update(dt) {
    this.life -= dt;
  }

  draw(camera) {
    if (this.life <= 0 || !camera.visibleWorld(this.x, this.y, 120)) return;
    const a = clamp(this.life / 10, 0, 1) * 115;
    drawPixelRect(this.x, this.y, this.width, 7, this.angle, color(8, 8, 8, a));
  }
}

class RaceAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.unlocked = false;
    this.lastState = "";
    this.lastCountdownMark = "";
    this.lastGear = 0;
    this.lastLap = -1;
    this.lastPosition = 0;
    this.impactCooldown = 0;
    this.skidCooldown = 0;
    this.passCooldown = 0;
    this.uiCooldown = 0;
    this.nodes = {};
    this.oscLayers = [];
  }

  init() {
    if (this.ctx) return true;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return false;
    const ctx = new AudioCtor();
    this.ctx = ctx;

    this.nodes.master = ctx.createGain();
    this.nodes.engineBus = ctx.createGain();
    this.nodes.fxBus = ctx.createGain();
    this.nodes.ambientBus = ctx.createGain();
    this.nodes.compressor = ctx.createDynamicsCompressor();
    this.nodes.compressor.threshold.value = -18;
    this.nodes.compressor.knee.value = 20;
    this.nodes.compressor.ratio.value = 5;
    this.nodes.compressor.attack.value = 0.006;
    this.nodes.compressor.release.value = 0.18;
    this.nodes.master.gain.value = 0;
    this.nodes.engineBus.connect(this.nodes.master);
    this.nodes.fxBus.connect(this.nodes.master);
    this.nodes.ambientBus.connect(this.nodes.master);
    this.nodes.master.connect(this.nodes.compressor);
    this.nodes.compressor.connect(ctx.destination);

    this.createEngineRig();
    this.createAmbientRig();
    return true;
  }

  unlock() {
    if (!this.init()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      const mode = this.mode();
      const now = this.ctx.currentTime;
      this.nodes.master.gain.setValueAtTime(mode.master, now);
      this.nodes.engineBus.gain.setValueAtTime(mode.engine, now);
      this.nodes.fxBus.gain.setValueAtTime(mode.fx, now);
      this.nodes.ambientBus.gain.setValueAtTime(mode.ambient, now);
      this.playUi("arm");
    }
  }

  createEngineRig() {
    const ctx = this.ctx;
    this.nodes.engineDrive = ctx.createWaveShaper();
    this.nodes.engineDrive.curve = this.makeDistortionCurve(170);
    this.nodes.engineFilter = ctx.createBiquadFilter();
    this.nodes.engineFilter.type = "lowpass";
    this.nodes.engineFilter.frequency.value = 2600;
    this.nodes.engineFilter.Q.value = 0.88;
    this.nodes.enginePre = ctx.createGain();
    this.nodes.enginePre.gain.value = 0.82;
    this.nodes.enginePre.connect(this.nodes.engineDrive);
    this.nodes.engineDrive.connect(this.nodes.engineFilter);
    this.nodes.engineFilter.connect(this.nodes.engineBus);

    const real = new Float32Array([0, 1, 0.56, 0.32, 0.22, 0.14, 0.09, 0.055, 0.032, 0.018]);
    const imag = new Float32Array(real.length);
    const engineWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.addOscLayer("crank", "sawtooth", 0.50, 0.05);
    this.addOscLayer("body", "custom", 1.00, 0.09, engineWave);
    this.addOscLayer("bite", "square", 2.02, 0.034);
    this.addOscLayer("scream", "sawtooth", 3.02, 0.024);
    this.addOscLayer("whine", "sine", 6.10, 0.015);

    this.nodes.turboOsc = ctx.createOscillator();
    this.nodes.turboOsc.type = "sine";
    this.nodes.turboGain = ctx.createGain();
    this.nodes.turboGain.gain.value = 0;
    this.nodes.turboOsc.frequency.value = 1400;
    this.nodes.turboOsc.connect(this.nodes.turboGain);
    this.nodes.turboGain.connect(this.nodes.engineBus);
    this.nodes.turboOsc.start();

    this.nodes.packOsc = ctx.createOscillator();
    this.nodes.packOsc.type = "sawtooth";
    this.nodes.packGain = ctx.createGain();
    this.nodes.packGain.gain.value = 0;
    this.nodes.packFilter = ctx.createBiquadFilter();
    this.nodes.packFilter.type = "bandpass";
    this.nodes.packFilter.frequency.value = 340;
    this.nodes.packFilter.Q.value = 0.8;
    this.nodes.packOsc.connect(this.nodes.packFilter);
    this.nodes.packFilter.connect(this.nodes.packGain);
    this.nodes.packGain.connect(this.nodes.engineBus);
    this.nodes.packOsc.start();

    this.nodes.exhaustSource = this.makeNoiseSource(1.8);
    this.nodes.exhaustFilter = ctx.createBiquadFilter();
    this.nodes.exhaustFilter.type = "bandpass";
    this.nodes.exhaustFilter.frequency.value = 190;
    this.nodes.exhaustFilter.Q.value = 0.75;
    this.nodes.exhaustGain = ctx.createGain();
    this.nodes.exhaustGain.gain.value = 0;
    this.nodes.exhaustSource.connect(this.nodes.exhaustFilter);
    this.nodes.exhaustFilter.connect(this.nodes.exhaustGain);
    this.nodes.exhaustGain.connect(this.nodes.engineBus);
    this.nodes.exhaustSource.start();
  }

  addOscLayer(name, type, multiplier, gainValue, wave) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    if (type === "custom" && wave) osc.setPeriodicWave(wave);
    else osc.type = type;
    osc.frequency.value = 110 * multiplier;
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.nodes.enginePre);
    osc.start();
    this.oscLayers.push({ name, osc, gain, multiplier, gainValue });
  }

  createAmbientRig() {
    const ctx = this.ctx;
    this.nodes.tireSource = this.makeNoiseSource(2.3);
    this.nodes.tireFilter = ctx.createBiquadFilter();
    this.nodes.tireFilter.type = "bandpass";
    this.nodes.tireFilter.frequency.value = 980;
    this.nodes.tireFilter.Q.value = 1.7;
    this.nodes.tireGain = ctx.createGain();
    this.nodes.tireGain.gain.value = 0;
    this.nodes.tireSource.connect(this.nodes.tireFilter);
    this.nodes.tireFilter.connect(this.nodes.tireGain);
    this.nodes.tireGain.connect(this.nodes.fxBus);
    this.nodes.tireSource.start();

    this.nodes.windSource = this.makeNoiseSource(2.8);
    this.nodes.windFilter = ctx.createBiquadFilter();
    this.nodes.windFilter.type = "highpass";
    this.nodes.windFilter.frequency.value = 720;
    this.nodes.windGain = ctx.createGain();
    this.nodes.windGain.gain.value = 0;
    this.nodes.windSource.connect(this.nodes.windFilter);
    this.nodes.windFilter.connect(this.nodes.windGain);
    this.nodes.windGain.connect(this.nodes.ambientBus);
    this.nodes.windSource.start();

    this.nodes.rainSource = this.makeNoiseSource(2.1);
    this.nodes.rainFilter = ctx.createBiquadFilter();
    this.nodes.rainFilter.type = "highpass";
    this.nodes.rainFilter.frequency.value = 1800;
    this.nodes.rainGain = ctx.createGain();
    this.nodes.rainGain.gain.value = 0;
    this.nodes.rainSource.connect(this.nodes.rainFilter);
    this.nodes.rainFilter.connect(this.nodes.rainGain);
    this.nodes.rainGain.connect(this.nodes.ambientBus);
    this.nodes.rainSource.start();

    this.nodes.crowdSource = this.makeNoiseSource(3.4);
    this.nodes.crowdFilter = ctx.createBiquadFilter();
    this.nodes.crowdFilter.type = "bandpass";
    this.nodes.crowdFilter.frequency.value = 520;
    this.nodes.crowdFilter.Q.value = 0.45;
    this.nodes.crowdGain = ctx.createGain();
    this.nodes.crowdGain.gain.value = 0;
    this.nodes.crowdSource.connect(this.nodes.crowdFilter);
    this.nodes.crowdFilter.connect(this.nodes.crowdGain);
    this.nodes.crowdGain.connect(this.nodes.ambientBus);
    this.nodes.crowdSource.start();
  }

  makeNoiseSource(seconds) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let pink = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      pink = pink * 0.985 + white * 0.015;
      data[i] = pink * 2.8 + white * 0.16;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  makeDistortionCurve(amount) {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = amount || 80;
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  target(param, value, timeConstant) {
    if (!param) return;
    const now = this.ctx.currentTime;
    param.setTargetAtTime(value, now, timeConstant || 0.035);
  }

  mode() {
    return this.game.audioModes[this.game.settings.audioIndex] || this.game.audioModes[0];
  }

  update(dt) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    if (ctx.state === "suspended") return;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.skidCooldown = Math.max(0, this.skidCooldown - dt);
    this.passCooldown = Math.max(0, this.passCooldown - dt);
    this.uiCooldown = Math.max(0, this.uiCooldown - dt);

    const mode = this.mode();
    const master = mode.master;
    this.target(this.nodes.master.gain, master, 0.06);
    this.target(this.nodes.engineBus.gain, mode.engine, 0.08);
    this.target(this.nodes.fxBus.gain, mode.fx, 0.06);
    this.target(this.nodes.ambientBus.gain, mode.ambient, 0.12);
    if (master <= 0.001) return;

    this.updateRaceEvents();
    const car = this.game.player;
    if (!car) return;
    const speed = car.speedMagnitude();
    const speedNorm = clamp(speed / Math.max(1, car.maxSpeed), 0, 1.35);
    const throttle = clamp(car.throttle, 0, 1);
    const braking = clamp(car.brake, 0, 1);
    const slip = clamp(Math.abs(car.slip) * 3.2 + braking * speedNorm * 0.46 + car.handbrake * 0.5, 0, 1.4);
    const raceScale = this.game.state === "finished" ? 0.36 : this.game.pause ? 0.42 : 1;
    const rpm = clamp(0.24 + speedNorm * 0.56 + throttle * 0.30 + Math.sin(frameCount * 0.19) * 0.012, 0.18, 1.16);
    const baseFreq = 74 + rpm * 178 + car.gear * 5.5;
    const engineLevel = raceScale * (0.038 + throttle * 0.18 + speedNorm * 0.12 + slip * 0.025);

    for (const layer of this.oscLayers) {
      const jitter = 1 + Math.sin(frameCount * 0.041 + layer.multiplier * 7.1) * 0.004;
      this.target(layer.osc.frequency, baseFreq * layer.multiplier * jitter, 0.018);
      this.target(layer.gain.gain, engineLevel * layer.gainValue * (0.72 + throttle * 0.55), 0.032);
    }
    this.target(this.nodes.engineFilter.frequency, 1300 + rpm * 3600 + throttle * 900, 0.045);
    this.target(this.nodes.exhaustFilter.frequency, 110 + rpm * 280, 0.04);
    this.target(this.nodes.exhaustGain.gain, raceScale * (0.012 + throttle * 0.062 + braking * speedNorm * 0.035), 0.045);
    this.target(this.nodes.turboOsc.frequency, 920 + rpm * 2300 + throttle * 880, 0.04);
    this.target(this.nodes.turboGain.gain, raceScale * smoothStep(0.48, 0.98, rpm) * (0.005 + throttle * 0.037), 0.06);

    const aiPack = this.nearbyPackEnergy(car);
    this.target(this.nodes.packOsc.frequency, 104 + aiPack.pitch * 320, 0.08);
    this.target(this.nodes.packFilter.frequency, 260 + aiPack.pitch * 780, 0.10);
    this.target(this.nodes.packGain.gain, raceScale * aiPack.gain * 0.11, 0.11);

    this.target(this.nodes.tireFilter.frequency, 620 + speedNorm * 1250 + slip * 900, 0.03);
    this.target(this.nodes.tireGain.gain, raceScale * clamp(slip * 0.16 + Math.max(0, car.trackInfo ? car.trackInfo.edgeOverflow : -50) * 0.0005, 0, 0.22), 0.035);
    this.target(this.nodes.windFilter.frequency, 580 + speedNorm * 1800, 0.08);
    this.target(this.nodes.windGain.gain, raceScale * (speedNorm * speedNorm * 0.092 + this.game.weather.rain * 0.028), 0.12);
    this.target(this.nodes.rainGain.gain, this.game.weather.rain * (0.12 + speedNorm * 0.08), 0.16);
    this.target(this.nodes.crowdGain.gain, (0.018 + speedNorm * 0.025 + (this.game.state === "finished" ? 0.07 : 0)) * (1 - this.game.weather.rain * 0.28), 0.24);

    if (this.lastGear && car.gear !== this.lastGear && this.game.state === "race" && speed > 8) this.playGearPop(throttle + speedNorm * 0.4);
    this.lastGear = car.gear;
    if (this.lastLap !== -1 && car.lap !== this.lastLap && car.lap > 0 && this.game.state === "race") this.playLapTone();
    this.lastLap = car.lap;
    this.updatePassBy(car, dt);
  }

  nearbyPackEnergy(player) {
    let gain = 0;
    let pitch = 0;
    for (const car of this.game.cars) {
      if (car === player) continue;
      const dx = car.pos.x - player.pos.x;
      const dy = car.pos.y - player.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1800) continue;
      const closeness = 1 - dist / 1800;
      const speedNorm = clamp(car.speedMagnitude() / Math.max(1, car.maxSpeed), 0, 1.2);
      gain += closeness * (0.28 + speedNorm * 0.9);
      pitch += closeness * speedNorm;
    }
    return { gain: clamp(gain, 0, 1.5), pitch: clamp(pitch, 0, 1.25) };
  }

  updatePassBy(player) {
    if (this.passCooldown > 0 || this.game.state !== "race") return;
    for (const car of this.game.cars) {
      if (car === player) continue;
      const dx = car.pos.x - player.pos.x;
      const dy = car.pos.y - player.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const rel = Math.abs(car.speedMagnitude() - player.speedMagnitude());
      if (dist < 320 && rel > 2.8) {
        this.playPassBy(car.pos.x, car.pos.y, clamp(rel / 18, 0.25, 1));
        this.passCooldown = 0.9;
        return;
      }
    }
  }

  updateRaceEvents() {
    const state = this.game.state;
    if (state === "countdown") {
      let mark = "ready";
      if (this.game.countdown <= 0.15) mark = "go";
      else if (this.game.countdown <= 1) mark = "1";
      else if (this.game.countdown <= 2) mark = "2";
      else if (this.game.countdown <= 3) mark = "3";
      if (mark !== this.lastCountdownMark) {
        this.lastCountdownMark = mark;
        if (mark !== "ready") this.playCountdown(mark);
      }
    }
    if (state !== this.lastState) {
      if (state === "race") this.playRaceStart();
      if (state === "finished") this.playFinish(this.game.objectiveComplete);
      this.lastState = state;
    }
    const pos = this.game.leaders.indexOf(this.game.player) + 1;
    if (this.lastPosition && pos && pos !== this.lastPosition && state === "race") this.playPosition(pos < this.lastPosition);
    if (pos) this.lastPosition = pos;
  }

  panFor(x, y) {
    if (!this.game.player) return 0;
    const dx = x - this.game.player.pos.x;
    const dy = y - this.game.player.pos.y;
    const right = this.game.player.rightVector();
    return clamp((dx * right.x + dy * right.y) / 900, -0.85, 0.85);
  }

  connectWithPan(source, x, y, bus) {
    if (this.ctx.createStereoPanner) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = this.panFor(x, y);
      source.connect(pan);
      pan.connect(bus);
    } else {
      source.connect(bus);
    }
  }

  playNoiseBurst(duration, gainValue, frequency, q, x, y, bus) {
    if (!this.ctx || !this.unlocked || this.mode().master <= 0.001) return;
    const ctx = this.ctx;
    const source = this.makeNoiseSource(Math.max(0.08, duration));
    source.loop = false;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    this.connectWithPan(gain, x || 0, y || 0, bus || this.nodes.fxBus);
    source.start(now);
    source.stop(now + duration + 0.04);
  }

  playImpact(amount, x, y, important) {
    if (this.impactCooldown > 0 && !important) return;
    if (!this.ctx || !this.unlocked) return;
    const intensity = clamp(amount, 0.12, 1.35);
    this.impactCooldown = important ? 0.06 : 0.18;
    this.playNoiseBurst(0.13 + intensity * 0.10, 0.08 * intensity, 920 + intensity * 1300, 1.6, x, y, this.nodes.fxBus);
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(62 + intensity * 48, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.17);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.105 * intensity, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain);
    this.connectWithPan(gain, x, y, this.nodes.fxBus);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playSkid(amount) {
    if (this.skidCooldown > 0 || !this.ctx || !this.unlocked) return;
    this.skidCooldown = 0.22;
    this.playNoiseBurst(0.28, 0.028 * clamp(amount, 0.2, 1), 1400, 3.8, this.game.player.pos.x, this.game.player.pos.y, this.nodes.fxBus);
  }

  playPassBy(x, y, amount) {
    this.playNoiseBurst(0.36, 0.045 * amount, 1550, 0.8, x, y, this.nodes.fxBus);
  }

  playGearPop(amount) {
    if (!this.ctx || !this.unlocked) return;
    const car = this.game.player;
    this.playNoiseBurst(0.09, 0.018 + clamp(amount, 0, 1.4) * 0.035, 260, 0.7, car.pos.x, car.pos.y, this.nodes.engineBus);
  }

  playCountdown(mark) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = mark === "go" ? "sawtooth" : "square";
    const freq = mark === "go" ? 720 : 340 + Number(mark) * 62;
    osc.frequency.setValueAtTime(freq, now);
    if (mark === "go") osc.frequency.exponentialRampToValueAtTime(1100, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(mark === "go" ? 0.12 : 0.075, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (mark === "go" ? 0.34 : 0.18));
    osc.connect(gain);
    gain.connect(this.nodes.fxBus);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  playRaceStart() {
    if (!this.ctx || !this.unlocked) return;
    this.playCountdown("go");
    this.playNoiseBurst(0.42, 0.045, 120, 0.65, this.game.player.pos.x, this.game.player.pos.y, this.nodes.engineBus);
  }

  playFinish(success) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = success ? [523.25, 659.25, 783.99, 1046.5] : [392, 349.23, 293.66];
    for (let i = 0; i < notes.length; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * 0.115;
      osc.type = "triangle";
      osc.frequency.value = notes[i];
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain);
      gain.connect(this.nodes.fxBus);
      osc.start(start);
      osc.stop(start + 0.36);
    }
  }

  playLapTone() {
    this.playUi("lap");
  }

  playPosition(gained) {
    if (!this.ctx || !this.unlocked) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const a = gained ? 560 : 360;
    const b = gained ? 820 : 260;
    for (let i = 0; i < 2; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * 0.07;
      osc.type = "sine";
      osc.frequency.value = i === 0 ? a : b;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain);
      gain.connect(this.nodes.fxBus);
      osc.start(start);
      osc.stop(start + 0.18);
    }
  }

  playUi(kind) {
    if (this.uiCooldown > 0 || !this.ctx) return;
    this.uiCooldown = 0.035;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(kind === "lap" ? 880 : kind === "arm" ? 520 : 650, now);
    osc.frequency.exponentialRampToValueAtTime(kind === "arm" ? 780 : 420, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "arm" ? 0.042 : 0.03, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(gain);
    gain.connect(this.nodes.fxBus || this.nodes.master);
    osc.start(now);
    osc.stop(now + 0.16);
  }
}

class Game {
  constructor() {
    this.track = new Track(TRACK_CONTROL_POINTS);
    this.camera = new Camera();
    this.splitCameras = [new Camera(), new Camera()];
    this.sprites = [];
    this.cars = [];
    this.players = [];
    this.player = null;
    this.playerTwo = null;
    this.leaders = [];
    this.particles = [];
    this.skidMarks = [];
    this.state = "countdown";
    this.countdown = 3.85;
    this.raceTime = 0;
    this.finishedTime = 0;
    this.pause = false;
    this.showMap = true;
    this.showRacingLine = true;
    this.menuOpen = false;
    this.menuIndex = 0;
    this.bootIndex = 0;
    this.bootPulse = 0;
    this.bootButtons = [];
    this.bootCameraDistance = 2200;
    this.touchControls = {
      everUsed: false,
      lastTouchAt: 0,
      buttons: [],
      p1: { left: false, right: false, throttle: false, brake: false, boost: false, handbrake: false },
      p2: { left: false, right: false, throttle: false, brake: false, boost: false, handbrake: false },
    };
    this.raceLaps = RACE_LAPS;
    this.score = 0;
    this.objectiveComplete = false;
    this.directorMessage = "";
    this.directorSubtext = "";
    this.directorTimer = 0;
    this.playerAutodrive = false;
    this.autodriveState = { lane: 0, mode: "OFF", targetSpeed: 0, trafficBrake: 0 };
    this.lastActionKeyCode = 0;
    this.lastActionKeyAt = 0;
    this.lastPlayerPosition = 0;
    this.damageCallout = false;
    this.goal = { targetPosition: 3, label: "PODIUM CHARGE" };
    this.weatherPresets = [
      { name: "CLEAR", rain: 0.0, cloud: 0.05, light: 1.22, grass: 1.08, sky: [20, 38, 38], note: "fast dry track" },
      { name: "BRIGHT", rain: 0.0, cloud: 0.18, light: 1.12, grass: 1.04, sky: [18, 32, 30], note: "balanced daylight" },
      { name: "CLOUDY", rain: 0.04, cloud: 0.46, light: 0.92, grass: 0.92, sky: [10, 23, 22], note: "cooler grip" },
      { name: "RAIN", rain: 0.40, cloud: 0.90, light: 0.76, grass: 0.84, sky: [6, 15, 18], note: "low grip" },
      { name: "SUNSET", rain: 0.0, cloud: 0.26, light: 1.05, grass: 0.96, sky: [34, 28, 23], note: "golden glare" },
    ];
    this.difficulties = [
      { name: "ROOKIE", short: "P5 RELAXED", note: "P5 start, calmer AI, forgiving player car", aiPower: 0.96, aiGrip: 0.96, aiBrain: 0.9, aiPace: 0.92, chaseBoost: 0, playerPower: 1.04, playerGrip: 1.04, gridPlayer: 4 },
      { name: "PRO", short: "P8 FAST", note: "P8 start, faster AI, normal player car", aiPower: 1.16, aiGrip: 1.14, aiBrain: 1.16, aiPace: 1.1, chaseBoost: 2.8, playerPower: 0.98, playerGrip: 0.96, gridPlayer: 7 },
      { name: "LEGEND", short: "P11 MAX AI", note: "P11 start, fastest AI, weaker player car", aiPower: 1.42, aiGrip: 1.36, aiBrain: 1.34, aiPace: 1.29, chaseBoost: 5.4, playerPower: 0.82, playerGrip: 0.82, gridPlayer: 10 },
    ];
    this.assistModes = [
      { name: "SIM", stability: 0.12 },
      { name: "BALANCED", stability: 0.45 },
      { name: "ASSISTED", stability: 0.78 },
    ];
    this.cameraModes = [
      { id: "CHASE", name: "CHASE", note: "forward close follow" },
      { id: "CLOSE", name: "CLOSE", note: "tight cockpit-style chase" },
      { id: "WIDE", name: "WIDE", note: "more track ahead" },
      { id: "HELI", name: "HELI", note: "high north-up view" },
      { id: "TV", name: "TV CAM", note: "trackside broadcast angle" },
    ];
    this.lapChoices = [3, 5, 7];
    this.audioModes = [
      { name: "MUTE", master: 0, engine: 0, fx: 0, ambient: 0 },
      { name: "LOW", master: 0.44, engine: 0.72, fx: 0.62, ambient: 0.52 },
      { name: "RACE", master: 0.78, engine: 0.98, fx: 0.82, ambient: 0.66 },
      { name: "FULL", master: 1.0, engine: 1.12, fx: 0.96, ambient: 0.82 },
    ];
    this.tireCompounds = [
      { name: "SOFT", code: "S", color: [238, 48, 58], grip: 1.08, dryGrip: 1.03, wetGrip: 0.74, wear: 1.38, heatRate: 1.16, idealHeat: 0.64, startHeat: 0.54, speed: 1.01 },
      { name: "MEDIUM", code: "M", color: [244, 215, 72], grip: 1.00, dryGrip: 1.00, wetGrip: 0.82, wear: 1.00, heatRate: 1.00, idealHeat: 0.58, startHeat: 0.50, speed: 1.00 },
      { name: "HARD", code: "H", color: [232, 235, 226], grip: 0.94, dryGrip: 0.98, wetGrip: 0.86, wear: 0.68, heatRate: 0.88, idealHeat: 0.54, startHeat: 0.46, speed: 0.99 },
      { name: "WET", code: "W", color: [80, 168, 245], grip: 0.92, dryGrip: 0.82, wetGrip: 1.24, wear: 1.18, heatRate: 0.78, idealHeat: 0.46, startHeat: 0.42, speed: 0.96 },
    ];
    this.settings = { weatherIndex: 0, difficultyIndex: 2, assistIndex: 0, cameraIndex: 1, lapIndex: 0, audioIndex: 2, dynamicWeather: false, splitScreen: false };
    this.weather = { rain: 0, targetRain: 0, cloud: 0, targetCloud: 0, light: 1, targetLight: 1, grass: 1, targetGrass: 1 };
    this.audio = new RaceAudio(this);
    this.selectedTireIndex = 1;
    this.pitStopTimer = 0;
    this.pitStopCar = null;
    this.pitStopDuration = 2.65;
    this.inPitStall = false;
    this.trackLimitWarnings = 0;
    this.penaltySeconds = 0;
    this.trackLimitTimer = 0;
    this.trackLimitMax = 0;
    this.trackLimitCooldown = 0;
    this.penaltySlowdownTimer = 0;
    this.palette = this.createPalettes();
    this.buildSprites();
    this.applyWeatherPreset(this.settings.weatherIndex, true);
    this.resetRace("boot");
  }

  createPalettes() {
    return {
      grass: [
        [25, 78, 47, 230],
        [19, 67, 42, 230],
        [35, 95, 54, 230],
        [46, 107, 57, 230],
        [17, 55, 39, 230],
        [57, 117, 65, 230],
        [28, 90, 61, 230],
        [13, 48, 35, 230],
        [72, 126, 71, 230],
      ],
      asphalt: [
        [39, 41, 43, 52],
        [67, 68, 70, 42],
        [20, 22, 24, 58],
        [89, 91, 92, 35],
        [58, 60, 62, 45],
        [32, 34, 36, 60],
      ],
      crowd: [
        [240, 58, 70, 255],
        [45, 102, 225, 255],
        [245, 210, 74, 255],
        [52, 190, 109, 255],
        [236, 236, 226, 255],
        [25, 28, 36, 255],
        [255, 132, 48, 255],
        [188, 68, 220, 255],
        [34, 181, 212, 255],
        [218, 40, 45, 255],
        [120, 225, 90, 255],
        [232, 178, 110, 255],
      ],
      barrier: [
        [225, 225, 215, 255],
        [215, 24, 39, 255],
        [28, 44, 58, 255],
        [70, 170, 210, 255],
        [238, 197, 54, 255],
      ],
      sign: [
        [235, 235, 225, 255],
        [220, 35, 45, 255],
        [30, 45, 65, 255],
        [40, 145, 225, 255],
        [240, 205, 60, 255],
        [35, 185, 110, 255],
        [245, 120, 30, 255],
      ],
    };
  }

  buildSprites() {
    if (!carSheet || !carSheet.width) return;
    this.sprites = [];
    for (let i = 0; i < CAR_SPRITE_COUNT; i += 1) {
      const sx = Math.floor((i * carSheet.width) / CAR_SPRITE_COUNT);
      const ex = Math.floor(((i + 1) * carSheet.width) / CAR_SPRITE_COUNT);
      this.sprites.push(this.extractSprite(sx, Math.max(1, ex - sx), carSheet.height));
    }
  }

  extractSprite(sx, sw, sh) {
    const raw = createImage(sw, sh);
    raw.copy(carSheet, sx, 0, sw, sh, 0, 0, sw, sh);
    raw.loadPixels();
    const w = raw.width;
    const h = raw.height;
    const visited = new Uint8Array(w * h);
    const queue = [];
    const isBackground = (idx) => {
      const r = raw.pixels[idx * 4];
      const g = raw.pixels[idx * 4 + 1];
      const b = raw.pixels[idx * 4 + 2];
      return r > 232 && g > 232 && b > 232 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18;
    };
    const add = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x;
      if (!visited[idx] && isBackground(idx)) {
        visited[idx] = 1;
        queue.push(idx);
      }
    };
    for (let x = 0; x < w; x += 1) {
      add(x, 0);
      add(x, h - 1);
    }
    for (let y = 0; y < h; y += 1) {
      add(0, y);
      add(w - 1, y);
    }
    for (let q = 0; q < queue.length; q += 1) {
      const idx = queue[q];
      const x = idx % w;
      const y = Math.floor(idx / w);
      add(x + 1, y);
      add(x - 1, y);
      add(x, y + 1);
      add(x, y - 1);
    }
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < w * h; i += 1) {
      if (visited[i]) raw.pixels[i * 4 + 3] = 0;
      const a = raw.pixels[i * 4 + 3];
      if (a > 0) {
        const x = i % w;
        const y = Math.floor(i / w);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    raw.updatePixels();
    const pad = 3;
    minX = clamp(minX - pad, 0, w - 1);
    minY = clamp(minY - pad, 0, h - 1);
    maxX = clamp(maxX + pad, 0, w - 1);
    maxY = clamp(maxY + pad, 0, h - 1);
    const trimW = Math.max(1, maxX - minX + 1);
    const trimH = Math.max(1, maxY - minY + 1);
    const trimmed = createImage(trimW, trimH);
    trimmed.copy(raw, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
    return { img: trimmed, w: trimW, h: trimH };
  }

  sampleOptimalLine(distance) {
    if (!OPTIMAL_RACING_LINE.length) return null;
    const d = this.track.wrapDistance(distance);
    const exact = (d / this.track.totalLength) * OPTIMAL_RACING_LINE.length;
    const index = Math.floor(exact) % OPTIMAL_RACING_LINE.length;
    const nextIndex = (index + 1) % OPTIMAL_RACING_LINE.length;
    const t = exact - Math.floor(exact);
    const a = OPTIMAL_RACING_LINE[index];
    const b = OPTIMAL_RACING_LINE[nextIndex];
    const lane = mix(a.lane, b.lane, t);
    const p = this.track.pointAt(d, lane);
    return {
      x: p.x,
      y: p.y,
      a: p.angle,
      lane,
      target: mix(a.target, b.target, t),
      brake: mix(a.brake, b.brake, t),
      confidence: mix(a.confidence, b.confidence, t),
    };
  }

  currentDifficulty() {
    return this.difficulties[this.settings.difficultyIndex] || this.difficulties[0];
  }

  stabilityAssist() {
    const mode = this.assistModes[this.settings.assistIndex] || this.assistModes[0];
    return mode.stability;
  }

  currentCameraMode() {
    return this.cameraModes[this.settings.cameraIndex] || this.cameraModes[0];
  }

  isSplitScreenActive() {
    return !!(this.settings.splitScreen && this.player && this.playerTwo);
  }

  toggleSplitScreen(force) {
    this.settings.splitScreen = typeof force === "boolean" ? force : !this.settings.splitScreen;
    if (this.settings.splitScreen) this.playerAutodrive = false;
    this.resetRace(this.state === "boot" ? "boot" : undefined);
    this.pushDirector(this.settings.splitScreen ? "SPLIT SCREEN ON" : "SPLIT SCREEN OFF", this.settings.splitScreen ? "P1 uses WASD. P2 uses arrows." : "Single driver view restored", 2.8);
  }

  snapCameraTo(car) {
    if (!car) return;
    if (this.splitCameras && this.splitCameras[car.playerIndex - 1]) this.splitCameras[car.playerIndex - 1].snapTo(car, this);
    if (!this.isSplitScreenActive() || car === this.player) this.camera.snapTo(car, this);
  }

  shakeCameraFor(car, amount) {
    if (this.isSplitScreenActive() && car && car.isPlayer && this.splitCameras[car.playerIndex - 1]) {
      this.splitCameras[car.playerIndex - 1].addShake(amount);
    } else if (this.isSplitScreenActive()) {
      for (const splitCamera of this.splitCameras) splitCamera.addShake(amount * 0.75);
    }
    this.camera.addShake(amount);
  }

  updateRaceCameras(dt) {
    if (this.isSplitScreenActive()) {
      this.splitCameras[0].follow(this.player, dt, this);
      this.splitCameras[1].follow(this.playerTwo, dt, this);
    } else {
      this.camera.follow(this.player, dt, this);
    }
  }

  blankMobileInput() {
    return { left: false, right: false, throttle: false, brake: false, boost: false, handbrake: false };
  }

  releaseTouchControls() {
    this.touchControls.p1 = this.blankMobileInput();
    this.touchControls.p2 = this.blankMobileInput();
  }

  hasTouchScreen() {
    return typeof navigator !== "undefined" && navigator.maxTouchPoints && navigator.maxTouchPoints > 0;
  }

  shouldShowMobileControls() {
    if (this.state === "boot" || this.state === "finished" || this.menuOpen || this.pause) return false;
    return this.touchControls.everUsed || this.hasTouchScreen() || width <= 760 || height <= 520;
  }

  mobileControlInput(car) {
    if (!this.touchControls) return this.blankMobileInput();
    return car && car.playerIndex === 2 ? this.touchControls.p2 : this.touchControls.p1;
  }

  mobileControlLayouts() {
    const controls = [];
    const addSet = (view, playerIndex, compact) => {
      const size = clamp(Math.min(view.w, view.h) * (compact ? 0.135 : 0.120), 48, compact ? 66 : 74);
      const gap = Math.max(8, size * 0.16);
      const bottom = view.y + view.h - size - Math.max(14, view.h * 0.035);
      const leftX = view.x + Math.max(14, view.w * 0.035);
      const pedalX = view.x + view.w - size * 2 - gap - Math.max(14, view.w * 0.035);
      const pedalY = bottom;
      const steerY = bottom;
      controls.push({ id: "left", playerIndex, x: leftX, y: steerY, w: size, h: size, label: "L", tone: 0 });
      controls.push({ id: "right", playerIndex, x: leftX + size + gap, y: steerY, w: size, h: size, label: "R", tone: 0 });
      controls.push({ id: "brake", playerIndex, x: pedalX, y: pedalY, w: size, h: size, label: "BRK", tone: 1 });
      controls.push({ id: "throttle", playerIndex, x: pedalX + size + gap, y: pedalY, w: size, h: size, label: "GO", tone: 2 });
      controls.push({ id: "boost", playerIndex, x: pedalX + size * 0.50, y: pedalY - size - gap, w: size * 1.18, h: size * 0.58, label: "ERS", tone: 3 });
    };
    if (this.isSplitScreenActive()) {
      const views = this.splitLayout();
      for (let i = 0; i < views.length; i += 1) addSet(views[i], i + 1, true);
    } else {
      addSet({ x: 0, y: 0, w: width, h: height }, 1, false);
    }
    return controls;
  }

  pointerPoints() {
    const points = [];
    if (typeof touches !== "undefined" && touches && touches.length) {
      for (const t of touches) points.push({ x: t.x, y: t.y });
    } else if (typeof mouseIsPressed !== "undefined" && mouseIsPressed) {
      points.push({ x: mouseX, y: mouseY });
    }
    return points;
  }

  updateTouchControlsFromPointers() {
    this.releaseTouchControls();
    if (!this.shouldShowMobileControls()) return;
    const buttons = this.mobileControlLayouts();
    this.touchControls.buttons = buttons;
    const points = this.pointerPoints();
    for (const point of points) {
      for (const button of buttons) {
        if (point.x < button.x || point.x > button.x + button.w || point.y < button.y || point.y > button.y + button.h) continue;
        const state = button.playerIndex === 2 ? this.touchControls.p2 : this.touchControls.p1;
        state[button.id] = true;
      }
    }
  }

  toggleAutodrive(force) {
    if (this.settings.splitScreen && force !== false) {
      this.playerAutodrive = false;
      this.autodriveState = { lane: 0, mode: "OFF", targetSpeed: 0, trafficBrake: 0 };
      this.pushDirector("MANUAL DUEL", "Split screen keeps both cars under player control", 2.4);
      if (this.audio) this.audio.playUi("menu");
      return;
    }
    this.playerAutodrive = typeof force === "boolean" ? force : !this.playerAutodrive;
    if (this.player) {
      this.player.handbrake = 0;
      this.player.steer = 0;
      this.player.steerTarget = 0;
      this.player.steerAngle = 0;
      this.player.aiLane = this.player.trackInfo ? clamp(this.player.trackInfo.lateral, -TRACK_WIDTH * 0.24, TRACK_WIDTH * 0.24) : 0;
      this.player.autodrivePassLane = this.player.aiLane;
      this.player.autodriveLaneMemory = this.player.aiLane;
      this.player.autodriveLaneHold = 0;
      this.player.autodriveSteerMemory = 0;
      this.player.autodriveAimReady = false;
      this.player.autodriveMode = this.playerAutodrive ? "LINE" : "OFF";
      this.player.autodriveTargetName = "";
    }
    this.autodriveState = this.playerAutodrive ? { lane: this.player ? this.player.aiLane : 0, mode: "FLOW", targetSpeed: 0, trafficBrake: 0 } : { lane: 0, mode: "OFF", targetSpeed: 0, trafficBrake: 0 };
    this.pushDirector(this.playerAutodrive ? "AUTODRIVE ON" : "AUTODRIVE OFF", this.playerAutodrive ? "V toggles manual control. It smooths the route and passes traffic." : "Manual controls restored", 2.8);
    if (this.audio) this.audio.playUi("arm");
  }

  cycleCamera(delta) {
    this.settings.cameraIndex = wrap(this.settings.cameraIndex + delta, this.cameraModes.length);
    this.shakeCameraFor(null, 1.5);
  }

  aiChallengeBoost(car) {
    const difficulty = this.currentDifficulty();
    if (!difficulty.chaseBoost || !this.player || car.isPlayer) return 0;
    const playerPos = this.leaders.indexOf(this.player);
    const carPos = this.leaders.indexOf(car);
    if (playerPos < 0 || carPos < 0) return 0;
    const gapToPlayer = this.player.raceDistance - car.raceDistance;
    if (carPos > playerPos && gapToPlayer > -160 && gapToPlayer < 1250) return difficulty.chaseBoost;
    if (carPos < playerPos && gapToPlayer < 650) return difficulty.chaseBoost * 0.45;
    return 0;
  }

  applyWeatherPreset(index, instant) {
    this.settings.weatherIndex = wrap(index, this.weatherPresets.length);
    const preset = this.weatherPresets[this.settings.weatherIndex];
    this.weather.targetRain = preset.rain;
    this.weather.targetCloud = preset.cloud;
    this.weather.targetLight = preset.light;
    this.weather.targetGrass = preset.grass;
    if (instant) {
      this.weather.rain = preset.rain;
      this.weather.cloud = preset.cloud;
      this.weather.light = preset.light;
      this.weather.grass = preset.grass;
    }
  }

  pitLaneInfo(x, y) {
    const info = this.track.nearest(x, y);
    const total = this.track.totalLength;
    const startDistance = Math.min(info.progress, total - info.progress);
    const inStartWindow = info.progress < 1380 || info.progress > total - 920;
    const pitLaneOffset = -(TRACK_WIDTH * 0.5 + 188);
    const laneError = Math.abs(info.lateral - pitLaneOffset);
    return {
      info,
      startDistance,
      pitLaneOffset,
      laneError,
      inLane: inStartWindow && laneError < 172,
      inStall: inStartWindow && startDistance < 720 && laneError < 132,
    };
  }

  isPointInPitLane(x, y) {
    return this.pitLaneInfo(x, y).inLane;
  }

  isPlayerInPitStall() {
    if (!this.player) return false;
    return this.pitLaneInfo(this.player.pos.x, this.player.pos.y).inStall;
  }

  queuedTire() {
    return this.tireCompounds[this.selectedTireIndex] || this.tireCompounds[1];
  }

  cycleQueuedTire(delta) {
    this.selectedTireIndex = wrap(this.selectedTireIndex + delta, this.tireCompounds.length);
    const tire = this.queuedTire();
    this.pushDirector("TIRE SELECTED", tire.name + " queued. Stop in the TIRE BAY and press T.", 2.4);
    if (this.audio) this.audio.playUi("menu");
  }

  beginPitStop() {
    if (!this.player || this.pitStopTimer > 0) return;
    if (this.state !== "race") {
      this.pushDirector("PIT CLOSED", "Wait for the race start", 2.2);
      return;
    }
    if (!this.isPlayerInPitStall()) {
      this.pushDirector("TIRE BAY", "Use the blue pit lane beside start/finish", 2.8);
      return;
    }
    if (this.player.speedMagnitude() > 8.5) {
      this.pushDirector("SLOW DOWN", "Stop under 60 KM/H to change tires", 2.6);
      return;
    }
    this.pitStopTimer = this.pitStopDuration;
    this.pitStopCar = this.player;
    this.player.vel.mult(0.15);
    this.pushDirector("PIT STOP", "Fitting " + this.queuedTire().name + " tires", this.pitStopDuration);
    if (this.audio) this.audio.playUi("lap");
  }

  finishPitStop() {
    if (!this.player) return;
    this.player.fitTireCompound(this.selectedTireIndex);
    this.player.damage = Math.max(0, this.player.damage - 0.06);
    this.pitStopCar = null;
    this.pushDirector("TIRES FITTED", this.queuedTire().name + " compound ready", 2.5);
    if (this.audio) this.audio.playUi("lap");
  }

  updatePitSystem(dt) {
    if (!this.player) return;
    this.inPitStall = this.isPlayerInPitStall();
    if (this.pitStopTimer > 0) {
      this.pitStopTimer = Math.max(0, this.pitStopTimer - dt);
      if (this.pitStopCar) this.pitStopCar.vel.mult(Math.pow(0.012, dt));
      if (this.pitStopTimer <= 0) this.finishPitStop();
    }
  }

  registerTrackLimit(severe) {
    if (severe || this.trackLimitWarnings >= 2) {
      const added = severe ? 5 : 5;
      this.penaltySeconds += added;
      this.trackLimitWarnings = 0;
      this.penaltySlowdownTimer = 1.8;
      this.pushDirector("TRACK PENALTY", "+" + added + " SEC for leaving the circuit", 3.2);
      if (this.audio) this.audio.playPosition(false);
    } else {
      this.trackLimitWarnings += 1;
      this.pushDirector("TRACK LIMITS", "Warning " + this.trackLimitWarnings + "/3. Stay inside the circuit.", 2.6);
      if (this.audio) this.audio.playUi("menu");
    }
    this.trackLimitCooldown = 1.4;
  }

  updateTrackLimits(dt) {
    this.trackLimitCooldown = Math.max(0, this.trackLimitCooldown - dt);
    this.penaltySlowdownTimer = Math.max(0, this.penaltySlowdownTimer - dt);
    if (!this.player || this.state !== "race" || this.pitStopTimer > 0) return;
    this.player.trackInfo = this.player.trackRelativeInfo(this.player.pos.x, this.player.pos.y);
    const pitLane = this.pitLaneInfo(this.player.pos.x, this.player.pos.y);
    if (pitLane.inLane && pitLane.laneError < 132) {
      this.trackLimitTimer = 0;
      this.trackLimitMax = 0;
      return;
    }
    const edge = this.player.trackInfo ? this.player.trackInfo.edgeOverflow : -999;
    if (edge > PLAYER_GRASS_RESET_OVERFLOW && this.player.speedMagnitude() > 4) {
      this.player.recoverToTrackCenter(edge - PLAYER_GRASS_RESET_OVERFLOW + 18);
      this.trackLimitTimer = 0;
      this.trackLimitMax = 0;
      return;
    }
    const illegal = edge > 44 && this.player.speedMagnitude() > 6;
    if (illegal) {
      this.trackLimitTimer += dt;
      this.trackLimitMax = Math.max(this.trackLimitMax, edge);
      if (this.trackLimitTimer > 2.2 && this.trackLimitCooldown <= 0) {
        this.registerTrackLimit(true);
        this.trackLimitTimer = 0;
        this.trackLimitMax = 0;
      }
    } else {
      if (this.trackLimitTimer > 0.42 && this.trackLimitCooldown <= 0) {
        this.registerTrackLimit(this.trackLimitTimer > 1.25 || this.trackLimitMax > 160);
      }
      this.trackLimitTimer = 0;
      this.trackLimitMax = 0;
    }
  }

  menuItems() {
    const difficulty = this.currentDifficulty();
    return [
      { id: "weather", label: "WEATHER", value: this.weatherPresets[this.settings.weatherIndex].name },
      { id: "difficulty", label: "AI LEVEL", value: difficulty.name + " (" + difficulty.short + ")" },
      { id: "driving", label: "DRIVING", value: this.assistModes[this.settings.assistIndex].name },
      { id: "autodrive", label: "AUTODRIVE", value: this.playerAutodrive ? "ON - FLOW DRIVE" : "OFF - MANUAL" },
      { id: "split", label: "SPLIT SCREEN", value: this.settings.splitScreen ? "ON - WASD / ARROWS" : "OFF" },
      { id: "camera", label: "CAMERA", value: this.currentCameraMode().name },
      { id: "laps", label: "LAPS", value: this.raceLaps.toString() },
      { id: "audio", label: "AUDIO", value: this.audioModes[this.settings.audioIndex].name },
      { id: "dynamicSky", label: "DYNAMIC SKY", value: this.settings.dynamicWeather ? "ON" : "OFF" },
    ];
  }

  adjustMenu(delta) {
    const item = this.menuItems()[this.menuIndex];
    if (!item) return;
    if (item.id === "weather") this.applyWeatherPreset(this.settings.weatherIndex + delta, true);
    else if (item.id === "difficulty") {
      this.settings.difficultyIndex = wrap(this.settings.difficultyIndex + delta, this.difficulties.length);
      this.resetRace();
      this.menuOpen = true;
    }
    else if (item.id === "driving") this.settings.assistIndex = wrap(this.settings.assistIndex + delta, this.assistModes.length);
    else if (item.id === "autodrive") this.toggleAutodrive();
    else if (item.id === "split") {
      this.toggleSplitScreen();
      this.menuOpen = true;
    }
    else if (item.id === "camera") this.cycleCamera(delta);
    else if (item.id === "laps") {
      this.settings.lapIndex = wrap(this.settings.lapIndex + delta, this.lapChoices.length);
      this.raceLaps = this.lapChoices[this.settings.lapIndex];
      this.resetRace();
      this.menuOpen = true;
    }
    else if (item.id === "audio") this.settings.audioIndex = wrap(this.settings.audioIndex + delta, this.audioModes.length);
    else if (item.id === "dynamicSky") this.settings.dynamicWeather = !this.settings.dynamicWeather;
    if (this.audio) this.audio.playUi("menu");
  }

  calculateScore() {
    const pos = this.leaders.indexOf(this.player) + 1;
    const base = Math.max(0, 1400 - (pos - 1) * 150);
    const clean = Math.round((1 - this.player.damage) * 500);
    const lapBonus = this.player.bestLap ? Math.max(0, Math.round(900 - this.player.bestLap * 6)) : 0;
    const difficultyBonus = this.settings.difficultyIndex * 350;
    const penaltyCost = Math.round(this.penaltySeconds * 85 + this.trackLimitWarnings * 35);
    return Math.max(0, base + clean + lapBonus + difficultyBonus - penaltyCost);
  }

  pushDirector(message, subtext, duration) {
    this.directorMessage = message;
    this.directorSubtext = subtext || "";
    this.directorTimer = duration || 3.2;
  }

  resetRace(startState) {
    this.cars = [];
    this.players = [];
    this.player = null;
    this.playerTwo = null;
    this.particles = [];
    this.skidMarks = [];
    this.state = startState || "countdown";
    this.countdown = 3.85;
    this.raceTime = 0;
    this.finishedTime = 0;
    this.score = 0;
    this.objectiveComplete = false;
    this.directorTimer = 0;
    this.directorMessage = "";
    this.directorSubtext = "";
    this.damageCallout = false;
    this.pitStopTimer = 0;
    this.pitStopCar = null;
    this.inPitStall = false;
    this.trackLimitWarnings = 0;
    this.penaltySeconds = 0;
    this.trackLimitTimer = 0;
    this.trackLimitMax = 0;
    this.trackLimitCooldown = 0;
    this.penaltySlowdownTimer = 0;
    this.raceLaps = this.lapChoices[this.settings.lapIndex];
    this.applyWeatherPreset(this.settings.weatherIndex, true);
    const difficulty = this.currentDifficulty();
    const teams = [
      { name: "Velocity", spriteIndex: 0, lineBias: -18, enginePower: 9000, maxSpeed: 48.0, grip: 9.65, aggression: 0.76, reaction: 0.94, racecraft: 0.82 },
      { name: "Blue Bolt", spriteIndex: 1, lineBias: 34, enginePower: 9350, maxSpeed: 49.5, grip: 9.55, aggression: 0.88, reaction: 1.0, racecraft: 0.9 },
      { name: "Mint Arrow", spriteIndex: 2, lineBias: -48, enginePower: 8950, maxSpeed: 47.9, grip: 9.85, aggression: 0.74, reaction: 0.98, racecraft: 0.84 },
      { name: "Shadow GP", spriteIndex: 3, lineBias: 56, enginePower: 9280, maxSpeed: 49.0, grip: 9.7, aggression: 0.84, reaction: 1.02, racecraft: 0.88 },
      { name: "Crimson Player", spriteIndex: PLAYER_SPRITE_INDEX, lineBias: 0, enginePower: 8750, maxSpeed: 47.8, grip: 8.72, aggression: 0.66, isPlayer: true, playerIndex: 1, controlScheme: "hybrid" },
      { name: "Ivory Flame", spriteIndex: 5, lineBias: -72, enginePower: 9120, maxSpeed: 48.5, grip: 9.75, aggression: 0.80, reaction: 0.98, racecraft: 0.86 },
      { name: "Royal Apex", spriteIndex: 6, lineBias: 78, enginePower: 9480, maxSpeed: 50.2, grip: 9.68, aggression: 0.95, reaction: 1.08, racecraft: 0.96 },
      { name: "Chrome Line", spriteIndex: 7, lineBias: -86, enginePower: 9060, maxSpeed: 48.2, grip: 9.92, aggression: 0.78, reaction: 1.0, racecraft: 0.87 },
      { name: "Green Sector", spriteIndex: 8, lineBias: 92, enginePower: 9360, maxSpeed: 49.4, grip: 9.64, aggression: 0.86, reaction: 1.04, racecraft: 0.9 },
      { name: "Orange Brake", spriteIndex: 9, lineBias: -108, enginePower: 9240, maxSpeed: 48.9, grip: 9.78, aggression: 0.82, reaction: 1.02, racecraft: 0.88 },
      { name: "Gold Night", spriteIndex: 10, lineBias: 118, enginePower: 9550, maxSpeed: 50.4, grip: 9.62, aggression: 0.97, reaction: 1.1, racecraft: 0.97 },
    ];
    const aiGrid = [6, 10, 1, 8, 3, 9, 5, 2, 7, 0];
    const gridOrder = this.settings.splitScreen ? aiGrid.filter((index) => index !== 1) : [...aiGrid];
    const playerGrid = clamp(difficulty.gridPlayer, 0, gridOrder.length);
    gridOrder.splice(playerGrid, 0, 4);
    if (this.settings.splitScreen) gridOrder.splice(Math.min(playerGrid + 1, gridOrder.length), 0, 1);
    for (let place = 0; place < gridOrder.length; place += 1) {
      const baseSpec = teams[gridOrder[place]];
      const spec = { ...baseSpec };
      if (this.settings.splitScreen && gridOrder[place] === 4) {
        spec.controlScheme = "wasd";
        spec.playerIndex = 1;
        spec.name = "Crimson Player";
      }
      if (this.settings.splitScreen && gridOrder[place] === 1) {
        spec.isPlayer = true;
        spec.playerIndex = 2;
        spec.controlScheme = "arrows";
        spec.name = "Azure Player";
        spec.enginePower = 8750;
        spec.maxSpeed = 47.8;
        spec.grip = 8.72;
        spec.aggression = 0.66;
      }
      if (!spec.isPlayer) {
        spec.enginePower *= difficulty.aiPower;
        spec.maxSpeed *= difficulty.aiPace;
        spec.grip *= difficulty.aiGrip;
        spec.reaction *= difficulty.aiBrain;
        spec.racecraft *= difficulty.aiBrain;
        spec.aggression = clamp(spec.aggression + this.settings.difficultyIndex * 0.06, 0, 1.15);
        spec.passSide = spec.lineBias >= 0 ? 1 : -1;
      } else {
        spec.enginePower *= difficulty.playerPower;
        spec.maxSpeed *= difficulty.playerPower;
        spec.grip *= difficulty.playerGrip;
      }
      const car = new Car(this, spec);
      const row = Math.floor(place / 2);
      const col = place % 2 === 0 ? -1 : 1;
      const lane = col * 145;
      const raceLineBias = car.isPlayer ? 0 : clamp((spec.lineBias || 0) * 1.45, -TRACK_WIDTH * 0.34, TRACK_WIDTH * 0.34);
      const laneFamily = car.isPlayer ? 0 : (place % 4) - 1.5;
      const stableRaceLane = car.isPlayer ? 0 : clamp(raceLineBias * 0.72 + laneFamily * 18, -TRACK_WIDTH * 0.28, TRACK_WIDTH * 0.28);
      car.lineBias = lane;
      const gridDistance = -260 - row * 215;
      car.placeAtRaceDistance(gridDistance);
      const gridPoint = this.track.pointAt(gridDistance, lane);
      car.pos.set(gridPoint.x, gridPoint.y);
      car.heading = gridPoint.angle;
      car.lineBias = stableRaceLane;
      car.aiBaseLane = stableRaceLane;
      car.aiLane = stableRaceLane;
      car.aiPassingSide = stableRaceLane >= 0 ? 1 : -1;
      car.autodrivePassLane = stableRaceLane;
      car.autodriveLaneMemory = stableRaceLane;
      car.autodriveLaneHold = 0;
      car.autodriveSteerMemory = 0;
      car.autodriveAimReady = false;
      car.autodriveMode = "FLOW";
      car.autodriveTargetName = "";
      this.cars.push(car);
      if (car.isPlayer) {
        this.players.push(car);
        if (car.playerIndex === 2) this.playerTwo = car;
        else this.player = car;
      }
    }
    if (!this.player && this.players.length) this.player = this.players[0];
    if (!this.playerTwo && this.players.length > 1) this.playerTwo = this.players[1];
    this.camera.x = this.player.pos.x;
    this.camera.y = this.player.pos.y;
    this.camera.rotation = -HALF_PI - this.player.heading;
    this.camera.zoom = 0.32;
    this.camera.targetZoom = 0.32;
    this.splitCameras[0].snapTo(this.player, this);
    if (this.playerTwo) this.splitCameras[1].snapTo(this.playerTwo, this);
    this.autodriveState = this.playerAutodrive ? { lane: 0, mode: "FLOW", targetSpeed: 0, trafficBrake: 0 } : { lane: 0, mode: "OFF", targetSpeed: 0, trafficBrake: 0 };
    this.updateLeaders();
    this.lastPlayerPosition = this.leaders.indexOf(this.player) + 1;
    if (this.state === "boot") {
      this.directorTimer = 0;
      this.directorMessage = "";
      this.directorSubtext = "";
    } else {
      this.pushDirector("PODIUM CHARGE", "Finish P" + this.goal.targetPosition + " or better at Silverstone", 4.2);
    }
  }

  startRaceFromBoot() {
    this.resetRace("countdown");
    this.pushDirector("PODIUM CHARGE", "Finish P" + this.goal.targetPosition + " or better at Silverstone", 4.2);
    if (this.audio) this.audio.playUi("arm");
  }

  bootMenuItems() {
    const difficulty = this.currentDifficulty();
    return [
      { id: "start", label: "START RACE", value: this.settings.splitScreen ? "P1 + P2 GRID" : "P" + (difficulty.gridPlayer + 1) + " GRID" },
      { id: "difficulty", label: "AI LEVEL", value: difficulty.name },
      { id: "weather", label: "WEATHER", value: this.weatherPresets[this.settings.weatherIndex].name },
      { id: "laps", label: "LAPS", value: this.lapChoices[this.settings.lapIndex].toString() },
      { id: "split", label: "SPLIT SCREEN", value: this.settings.splitScreen ? "ON - 2P" : "OFF" },
      { id: "autodrive", label: "AUTODRIVE", value: this.playerAutodrive ? "ON" : "OFF" },
      { id: "options", label: "RACE OPTIONS", value: "OPEN" },
    ];
  }

  activateBootItem(delta) {
    const item = this.bootMenuItems()[this.bootIndex];
    if (!item) return;
    if (item.id === "start") {
      this.startRaceFromBoot();
    } else if (item.id === "difficulty") {
      const step = delta || 1;
      this.settings.difficultyIndex = wrap(this.settings.difficultyIndex + step, this.difficulties.length);
      this.resetRace("boot");
    } else if (item.id === "weather") {
      this.applyWeatherPreset(this.settings.weatherIndex + (delta || 1), true);
    } else if (item.id === "laps") {
      this.settings.lapIndex = wrap(this.settings.lapIndex + (delta || 1), this.lapChoices.length);
      this.raceLaps = this.lapChoices[this.settings.lapIndex];
    } else if (item.id === "split") {
      this.toggleSplitScreen();
      this.state = "boot";
    } else if (item.id === "autodrive") {
      this.toggleAutodrive();
      this.state = "boot";
      this.directorTimer = 0;
    } else if (item.id === "options") {
      this.menuOpen = true;
    }
  }

  updateBootPreview(dt) {
    this.bootPulse += dt;
    const focus = this.track.pointAt(260 + Math.sin(this.bootPulse * 0.36) * 180, 0);
    const orbit = this.bootPulse * 0.10;
    this.camera.x = mix(this.camera.x, focus.x + Math.cos(orbit) * 360, 1 - Math.pow(0.006, dt));
    this.camera.y = mix(this.camera.y, focus.y + Math.sin(orbit) * 240, 1 - Math.pow(0.006, dt));
    this.camera.rotation = angleLerp(this.camera.rotation, -HALF_PI - focus.angle + Math.sin(this.bootPulse * 0.22) * 0.025, 1 - Math.pow(0.002, dt));
    this.camera.targetZoom = width < 760 ? 0.30 : 0.37;
    this.camera.zoom = mix(this.camera.zoom, this.camera.targetZoom, 1 - Math.pow(0.001, dt));
    this.camera.shake = Math.max(0, this.camera.shake - dt * 9);
    for (const car of this.cars) {
      car.trackInfo = car.trackRelativeInfo(car.pos.x, car.pos.y);
      car.updateTelemetry(dt * 0.18);
    }
  }

  onResize() {
    this.shakeCameraFor(null, 2);
  }

  keyPressed(code) {
    const now = typeof millis === "function" ? millis() : Date.now();
    if (this.lastActionKeyCode === code && now - this.lastActionKeyAt < 90) return;
    this.lastActionKeyCode = code;
    this.lastActionKeyAt = now;
    if (this.audio) this.audio.unlock();
    if (this.state === "boot" && !this.menuOpen) {
      const items = this.bootMenuItems();
      if (code === UP_ARROW || code === 87) this.bootIndex = wrap(this.bootIndex - 1, items.length);
      else if (code === DOWN_ARROW || code === 83) this.bootIndex = wrap(this.bootIndex + 1, items.length);
      else if (code === LEFT_ARROW || code === 65) this.activateBootItem(-1);
      else if (code === RIGHT_ARROW || code === 68) this.activateBootItem(1);
      else if (code === ENTER || code === 13 || code === 32) this.activateBootItem(0);
      else if (code === 79) this.menuOpen = true;
      if (this.audio) this.audio.playUi("menu");
      return;
    }
    if (code === 79) {
      this.menuOpen = !this.menuOpen;
      if (this.audio) this.audio.playUi("menu");
      return;
    }
    if (this.menuOpen) {
      if (code === UP_ARROW) this.menuIndex = wrap(this.menuIndex - 1, this.menuItems().length);
      else if (code === DOWN_ARROW) this.menuIndex = wrap(this.menuIndex + 1, this.menuItems().length);
      else if (code === LEFT_ARROW) this.adjustMenu(-1);
      else if (code === RIGHT_ARROW) this.adjustMenu(1);
      else if (code >= 49 && code <= 53) this.applyWeatherPreset(code - 49, true);
      else if (code === ENTER || code === 13 || code === 27) this.menuOpen = false;
      if (this.audio) this.audio.playUi("menu");
      return;
    }
    if (code === 84) {
      if (this.isPlayerInPitStall()) this.beginPitStop();
      else this.cycleQueuedTire(1);
      return;
    }
    if (code >= 49 && code <= 52 && this.isPlayerInPitStall()) {
      this.selectedTireIndex = code - 49;
      this.beginPitStop();
      return;
    }
    if (code === 82) this.resetRace();
    if (code === 67) this.cycleCamera(1);
    if (code === 86) this.toggleAutodrive();
    if (code === 80) this.pause = !this.pause;
    if (code === 77) this.showMap = !this.showMap;
    if (code === 76) this.showRacingLine = !this.showRacingLine;
    if ((code === ENTER || code === 13) && this.state === "finished") this.resetRace();
  }

  mousePressed() {
    const now = typeof millis === "function" ? millis() : Date.now();
    if (this.touchControls.lastTouchAt && now - this.touchControls.lastTouchAt < 420) return;
    this.handlePointerPress(mouseX, mouseY);
  }

  handlePointerPress(px, py) {
    if (this.audio) this.audio.unlock();
    if (this.state === "boot" && !this.menuOpen) {
      for (let i = 0; i < this.bootButtons.length; i += 1) {
        const b = this.bootButtons[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          this.bootIndex = i;
          this.activateBootItem(0);
          if (this.audio) this.audio.playUi("menu");
          return;
        }
      }
    }
    if (this.state === "finished") this.resetRace();
  }

  touchStarted() {
    this.touchControls.everUsed = true;
    this.touchControls.lastTouchAt = typeof millis === "function" ? millis() : Date.now();
    const point = this.pointerPoints()[0];
    if (point && (this.state === "boot" || this.menuOpen || this.state === "finished")) this.handlePointerPress(point.x, point.y);
    else this.updateTouchControlsFromPointers();
  }

  touchMoved() {
    this.touchControls.everUsed = true;
    this.updateTouchControlsFromPointers();
  }

  touchEnded() {
    this.releaseTouchControls();
  }

  frame(dt) {
    if (document.hidden) dt = Math.min(dt, 1 / 60);
    if (this.state === "boot") {
      this.updateWeather(dt);
      this.updateBootPreview(dt);
      if (this.audio) this.audio.update(dt);
      this.drawScene(0);
      if (this.menuOpen) this.drawOptionsMenu();
      return;
    }
    if (this.menuOpen) {
      this.updateWeather(dt);
      if (this.audio) this.audio.update(dt);
      this.drawScene(0);
      this.drawOptionsMenu();
      return;
    }
    if (this.pause) {
      if (this.audio) this.audio.update(dt);
      this.drawScene(0);
      this.drawPause();
      return;
    }
    this.updateTouchControlsFromPointers();
    this.update(dt);
    if (this.audio) this.audio.update(dt);
    this.drawScene(dt);
  }

  update(dt) {
    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = "race";
        this.raceTime = 0;
        for (const car of this.cars) car.currentLapStart = 0;
      }
    } else if (this.state === "race") {
      this.raceTime += dt;
      this.updateWeather(dt);
    } else if (this.state === "finished") {
      this.finishedTime += dt;
    }

    this.updatePitSystem(dt);
    for (const car of this.cars) car.update(dt);
    this.resolveCarCollisions();
    this.updateLeaders();
    this.updateTrackLimits(dt);
    this.updateRaceDirector(dt);
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      this.particles[i].update(dt);
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.skidMarks.length - 1; i >= 0; i -= 1) {
      this.skidMarks[i].update(dt);
      if (this.skidMarks[i].life <= 0) this.skidMarks.splice(i, 1);
    }
    this.updateRaceCameras(dt);
  }

  updateWeather(dt) {
    if (this.settings.dynamicWeather && frameCount % 420 === 0) {
      const base = this.weatherPresets[this.settings.weatherIndex];
      this.weather.targetRain = clamp(base.rain + noise(this.raceTime * 0.05) * 0.18 - 0.04, 0, 0.55);
      this.weather.targetCloud = clamp(base.cloud + noise(9 + this.raceTime * 0.04) * 0.22 - 0.06, 0.02, 1);
      this.weather.targetLight = clamp(base.light - this.weather.targetCloud * 0.22, 0.68, 1.28);
    }
    this.weather.rain = mix(this.weather.rain, this.weather.targetRain, 1 - Math.pow(0.06, dt));
    this.weather.cloud = mix(this.weather.cloud, this.weather.targetCloud, 1 - Math.pow(0.035, dt));
    this.weather.light = mix(this.weather.light, this.weather.targetLight, 1 - Math.pow(0.035, dt));
    this.weather.grass = mix(this.weather.grass, this.weather.targetGrass, 1 - Math.pow(0.035, dt));
  }

  updateRaceDirector(dt) {
    this.directorTimer = Math.max(0, this.directorTimer - dt);
    if (!this.player || this.state !== "race") return;
    const pos = this.leaders.indexOf(this.player) + 1;
    if (this.lastPlayerPosition && pos !== this.lastPlayerPosition && this.raceTime > 1.5) {
      if (pos < this.lastPlayerPosition) this.pushDirector("POSITION GAINED", "Now running P" + pos, 2.2);
      else this.pushDirector("POSITION LOST", "Dropped to P" + pos, 2.2);
      this.lastPlayerPosition = pos;
    }
    if (!this.damageCallout && this.player.damage > 0.42) {
      this.damageCallout = true;
      this.pushDirector("CAR DAMAGE", "Keep it clean to protect your score", 3.4);
    }
  }

  resolveCarCollisions() {
    for (let i = 0; i < this.cars.length; i += 1) {
      for (let j = i + 1; j < this.cars.length; j += 1) {
        const a = this.cars[i];
        const b = this.cars[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        const minDist = a.radius + b.radius;
        if (d >= minDist) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = minDist - d;
        const involvesPlayer = a.isPlayer || b.isPlayer;
        const aiOnly = a.ai && b.ai;
        const separation = involvesPlayer ? 0.5 : aiOnly ? 0.34 : 0.66;
        a.pos.x -= nx * overlap * separation;
        a.pos.y -= ny * overlap * separation;
        b.pos.x += nx * overlap * separation;
        b.pos.y += ny * overlap * separation;
        const rel = dot(b.vel.x - a.vel.x, b.vel.y - a.vel.y, nx, ny);
        if (rel < 0) {
          const impulse = -rel * (involvesPlayer ? 0.64 : aiOnly ? 0.18 : 0.48);
          a.vel.x -= nx * impulse;
          a.vel.y -= ny * impulse;
          b.vel.x += nx * impulse;
          b.vel.y += ny * impulse;
          const damageScale = involvesPlayer ? 0.004 : 0.002;
          a.damage = clamp(a.damage + impulse * damageScale, 0, 1);
          b.damage = clamp(b.damage + impulse * damageScale, 0, 1);
          if (involvesPlayer) this.shakeCameraFor(a.isPlayer ? a : b, clamp(impulse * 0.28, 1.5, 8));
          if (involvesPlayer || impulse > 5.5) {
            const sparkCount = involvesPlayer ? clamp(impulse * 0.8, 3, 13) : clamp(impulse * 0.35, 1, 5);
            this.emitSparks((a.pos.x + b.pos.x) * 0.5, (a.pos.y + b.pos.y) * 0.5, sparkCount);
            if (this.audio) this.audio.playImpact(impulse * 0.11, (a.pos.x + b.pos.x) * 0.5, (a.pos.y + b.pos.y) * 0.5, involvesPlayer);
          }
        }
      }
    }
  }

  updateLeaders() {
    this.leaders = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.raceDistance - a.raceDistance;
    });
  }

  finishRace() {
    this.state = "finished";
    this.finishedTime = 0;
    this.updateLeaders();
    this.objectiveComplete = this.leaders.indexOf(this.player) + 1 <= this.goal.targetPosition;
    this.score = this.calculateScore();
    this.pushDirector(this.objectiveComplete ? "OBJECTIVE COMPLETE" : "OBJECTIVE MISSED", "Final score " + this.score, 5.5);
    this.shakeCameraFor(this.player, 10);
  }

  emitDust(car, count) {
    const right = car.rightVector();
    for (let i = 0; i < count; i += 1) {
      const side = random() > 0.5 ? 1 : -1;
      const x = car.pos.x + right.x * side * 28 + random(-14, 14);
      const y = car.pos.y + right.y * side * 28 + random(-14, 14);
      this.particles.push(new Particle(x, y, -car.vel.x * 0.08 + random(-1.2, 1.2), -car.vel.y * 0.08 + random(-1.2, 1.2), random(0.45, 0.9), random(8, 20), color(132, 119, 82, 120), "dust"));
    }
  }

  emitExhaust(car, count) {
    const fwd = car.forwardVector();
    for (let i = 0; i < count; i += 1) {
      const x = car.pos.x - fwd.x * 62 + random(-6, 6);
      const y = car.pos.y - fwd.y * 62 + random(-6, 6);
      this.particles.push(new Particle(x, y, -fwd.x * random(0.9, 2.2), -fwd.y * random(0.9, 2.2), random(0.16, 0.32), random(4, 9), color(255, random(90, 180), 30, 180), "flame"));
    }
  }

  emitSparks(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      const a = random(TWO_PI);
      const s = random(1.5, 6.5);
      this.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, random(0.16, 0.52), random(3, 8), color(255, random(155, 230), 60, 220), "spark"));
    }
  }

  addSkidMark(car) {
    const right = car.rightVector();
    for (const side of [-1, 1]) {
      const x = car.pos.x + right.x * side * 18;
      const y = car.pos.y + right.y * side * 18;
      this.skidMarks.push(new SkidMark(x, y, car.heading, random(22, 36)));
    }
    if (this.skidMarks.length > 420) this.skidMarks.splice(0, this.skidMarks.length - 420);
    if (car.isPlayer && this.audio) this.audio.playSkid(Math.abs(car.slip) * 2.6 + car.brake * 0.5);
  }

  drawScene(dt) {
    if (this.isSplitScreenActive() && this.state !== "boot") {
      this.drawSplitScene(dt);
      return;
    }
    this.drawWorldView(this.camera, this.player, width, height);
    if (this.state !== "boot") {
      this.drawSpeedEffects();
      this.drawUI();
    }
    this.drawPostEffects();
    if (this.state === "boot") this.drawBootMenu();
  }

  drawWorldView(camera, focusCar, viewW, viewH) {
    const previousCamera = this.camera;
    this.camera = camera || previousCamera;
    this.camera.setViewport(viewW || width, viewH || height);
    this.viewFocusCar = focusCar || this.player;
    this.drawBackground();
    push();
    this.camera.apply(viewW || width, viewH || height);
    this.drawTerrainRelief();
    this.drawGrassDetails();
    this.drawSilverstoneBuildings();
    this.drawCrowds();
    this.drawLightRigs();
    this.drawPitComplex();
    this.track.drawBase(this.camera);
    this.drawPitLane();
    this.drawWetTrackHighlights();
    this.drawTrackDecals();
    this.drawSurfaceGrain();
    this.drawRubberMarbles();
    if (this.showRacingLine && this.state !== "boot") this.drawRacingLineAssist(this.viewFocusCar);
    for (const mark of this.skidMarks) mark.draw(this.camera);
    this.drawMarshalPosts();
    this.drawServiceVehicles();
    this.drawCameraRigs();
    this.drawStartGantry();
    this.drawBarriers();
    for (const car of this.cars.filter((c) => !c.isPlayer)) car.draw(this.camera);
    for (const car of this.cars.filter((c) => c.isPlayer)) car.draw(this.camera);
    for (const p of this.particles) p.draw(this.camera);
    pop();
    this.drawRain(viewW || width, viewH || height);
    this.camera = previousCamera;
    this.viewFocusCar = this.player;
  }

  splitLayout() {
    if (width >= height * 1.15) {
      const half = Math.floor(width * 0.5);
      return [
        { x: 0, y: 0, w: half, h: height, car: this.player, camera: this.splitCameras[0], label: "P1", controls: "WASD" },
        { x: half, y: 0, w: width - half, h: height, car: this.playerTwo, camera: this.splitCameras[1], label: "P2", controls: "ARROWS" },
      ];
    }
    const half = Math.floor(height * 0.5);
    return [
      { x: 0, y: 0, w: width, h: half, car: this.player, camera: this.splitCameras[0], label: "P1", controls: "WASD" },
      { x: 0, y: half, w: width, h: height - half, car: this.playerTwo, camera: this.splitCameras[1], label: "P2", controls: "ARROWS" },
    ];
  }

  drawSplitScene(dt) {
    const views = this.splitLayout();
    for (const view of views) {
      push();
      resetMatrix();
      drawingContext.save();
      drawingContext.beginPath();
      drawingContext.rect(view.x, view.y, view.w, view.h);
      drawingContext.clip();
      translate(view.x, view.y);
      this.drawWorldView(view.camera, view.car, view.w, view.h);
      drawingContext.restore();
      pop();
    }
    this.drawSplitDivider(views);
    if (this.state !== "boot") this.drawSplitUI(views);
    this.drawPostEffects();
  }

  drawBackground() {
    const light = this.weather.light || 1;
    const sky = this.weatherPresets[this.settings.weatherIndex].sky;
    const viewW = this.camera && this.camera.viewWidth ? this.camera.viewWidth : width;
    const viewH = this.camera && this.camera.viewHeight ? this.camera.viewHeight : height;
    noStroke();
    rectMode(CORNER);
    fill(sky[0] * light, sky[1] * light, sky[2] * light);
    rect(0, 0, viewW, viewH);
    const tile = 42;
    const scrollX = -((this.camera.x * this.camera.zoom) % tile);
    const scrollY = -((this.camera.y * this.camera.zoom) % tile);
    for (let x = scrollX - tile; x < viewW + tile; x += tile) {
      for (let y = scrollY - tile; y < viewH + tile; y += tile) {
        const n = noise((x + this.camera.x) * 0.004, (y + this.camera.y) * 0.004);
        const grassLight = (this.weather.grass || 1) * light;
        fill((16 + n * 24) * grassLight, (55 + n * 36) * grassLight, (34 + n * 20) * grassLight, 255);
        rectMode(CORNER);
        rect(Math.round(x), Math.round(y), tile + 1, tile + 1);
      }
    }
    rectMode(CENTER);
  }

  drawGrassDetails() {
    for (const item of GRASS_DETAILS) {
      if (!this.camera.visibleWorld(item.x, item.y, 120)) continue;
      const c = colorFromPalette(this.palette.grass, item.tone);
      drawPixelRect(item.x, item.y, item.w, item.h, item.a, color(red(c) * this.weather.grass, green(c) * this.weather.grass, blue(c) * this.weather.grass, alpha(c)));
    }
  }

  drawTerrainRelief() {
    const light = this.weather.light || 1;
    const rainDamp = 1 - this.weather.rain * 0.24;
    for (const item of TERRAIN_RELIEF) {
      if (!this.camera.visibleWorld(item.x, item.y, item.w + 120)) continue;
      const high = item.tone % 2 === 0;
      const warmth = high ? 1 : -1;
      const depth = 0.74 + item.tone * 0.045;
      const r = (30 + warmth * 10 + item.tone * 2) * this.weather.grass * light * rainDamp;
      const g = (78 + warmth * 14 + item.tone * 4) * this.weather.grass * light * rainDamp;
      const b = (43 + warmth * 7 + item.tone * 2) * this.weather.grass * light * rainDamp;
      drawPixelRect(item.x, item.y, item.w, item.h, item.a, color(r * depth, g * depth, b * depth, item.alpha));
      if (item.tone > 4) {
        drawPixelRect(item.x + Math.cos(item.a + HALF_PI) * 18, item.y + Math.sin(item.a + HALF_PI) * 18, item.w * 0.72, Math.max(3, item.h * 0.24), item.a, color(122, 160, 92, item.alpha * 0.28));
      }
    }
  }

  drawSilverstoneBuildings() {
    for (const item of SILVERSTONE_BUILDINGS) {
      if (!this.camera.visibleWorld(item.x, item.y, Math.max(item.w, item.h) + 160)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      noStroke();
      if (item.type === "road") {
        fill(30, 34, 35, 210);
        rect(0, 0, item.w, item.h, 2);
        fill(82, 86, 82, 120);
        for (let x = -item.w * 0.42; x < item.w * 0.46; x += 120) rect(x, 0, 42, 4, 1);
      } else if (item.type === "parking") {
        fill(18, 38, 32, 225);
        rect(0, 0, item.w, item.h, 3);
        fill(38, 44, 48, 230);
        rect(0, 0, item.w * 0.86, item.h * 0.72, 2);
        fill(220, 224, 210, 130);
        for (let x = -item.w * 0.34; x <= item.w * 0.34; x += 72) {
          for (let y = -item.h * 0.20; y <= item.h * 0.20; y += 38) rect(x, y, 36, 5, 1);
        }
      } else {
        const shell = item.type === "wing" ? color(18, 24, 31, 245) : item.type === "paddock" ? color(28, 38, 48, 238) : item.type === "service" ? color(36, 46, 47, 235) : color(24, 35, 43, 235);
        fill(4, 8, 10, 105);
        rect(12, 16, item.w + 34, item.h + 34, 4);
        fill(shell);
        rect(0, 0, item.w, item.h, 4);
        fill(72, 84, 94, 225);
        rect(0, -item.h * 0.36, item.w * 0.92, item.h * 0.16, 2);
        fill(item.type === "wing" ? color(210, 214, 205, 210) : color(88, 102, 108, 205));
        for (let x = -item.w * 0.42; x <= item.w * 0.42; x += item.type === "wing" ? 86 : 110) {
          rect(x, item.h * 0.12, item.type === "wing" ? 34 : 48, item.h * 0.46, 1);
        }
        if (item.type === "wing") {
          fill(190, 200, 205, 230);
          for (let x = -item.w * 0.45; x <= item.w * 0.45; x += 170) {
            triangle(x - 54, -item.h * 0.48, x + 54, -item.h * 0.48, x, -item.h * 0.68);
          }
        }
        textAlign(CENTER, CENTER);
        textSize(item.type === "wing" ? 18 : 13);
        fill(238, 238, 220, 220);
        text(item.label, 0, 0);
      }
      pop();
    }
  }

  drawTrackDecals() {
    for (const item of TRACK_DECALS) {
      if (!this.camera.visibleWorld(item.x, item.y, 90)) continue;
      drawPixelRect(item.x, item.y, item.w, item.h, item.a, colorFromPalette(this.palette.asphalt, item.tone, item.alpha));
    }
  }

  drawSurfaceGrain() {
    const wetLift = clamp(this.weather.rain * 1.35 + this.weather.cloud * 0.12, 0, 1);
    for (const item of SURFACE_GRAIN) {
      if (!this.camera.visibleWorld(item.x, item.y, 76)) continue;
      const shade = item.tone % 2 === 0 ? -1 : 1;
      const base = 42 + item.tone * 3 + wetLift * 18;
      drawPixelRect(item.x, item.y, item.w, item.h, item.a, color(base + shade * 5, base + shade * 4, base + shade * 3, item.alpha + wetLift * 20));
    }
  }

  drawRubberMarbles() {
    for (const item of RUBBER_MARBLES) {
      if (!this.camera.visibleWorld(item.x, item.y, 80)) continue;
      drawPixelRect(item.x, item.y, item.w, item.h, item.a, color(6 + item.tone * 7, 7 + item.tone * 6, 8 + item.tone * 5, item.alpha));
    }
  }

  drawWetTrackHighlights() {
    const wet = clamp(this.weather.rain * 1.8 + this.weather.cloud * 0.16, 0, 1);
    if (wet <= 0.03) return;
    push();
    noFill();
    strokeWeight(12);
    stroke(185, 215, 230, 22 * wet);
    for (let i = 0; i < this.track.segments.length; i += 37) {
      const seg = this.track.segments[i];
      if (!this.camera.visibleWorld(seg.a.x, seg.a.y, 520)) continue;
      const p = this.track.pointAt(seg.start, Math.sin(i * 0.45) * TRACK_WIDTH * 0.18);
      const q = this.track.pointAt(seg.start + 160, Math.sin(i * 0.45) * TRACK_WIDTH * 0.18);
      line(p.x, p.y, q.x, q.y);
    }
    pop();
  }

  drawRacingLineAssist(focusCar) {
    const car = focusCar || this.player;
    if (!car || this.state === "finished") return;
    const speed = car.speedMagnitude();
    for (let i = 3; i < 40; i += 1) {
      const distAhead = i * 112;
      const sample = this.sampleOptimalLine(car.progress + distAhead);
      if (!sample || !this.camera.visibleWorld(sample.x, sample.y, 180)) continue;
      const speedPressure = clamp((speed - sample.target + i * 0.18) / 12.5, 0, 1);
      const brakeNeed = clamp(sample.brake * 0.32 + speedPressure * 0.82, 0, 1);
      const fade = smoothStep(40, 4, i) * sample.confidence;
      const alphaValue = 128 * fade;
      const c = brakeNeed > 0.66 ? color(245, 52, 58, alphaValue) : brakeNeed > 0.34 ? color(245, 211, 68, alphaValue) : color(70, 238, 134, alphaValue);
      const w = mix(56, 34, brakeNeed);
      drawPixelRect(sample.x, sample.y, w, 9, sample.a, c);
      if (i % 5 === 0 && brakeNeed > 0.42) {
        const mark = color(250, 246, 225, 44 * fade);
        drawPixelRect(sample.x, sample.y, 10, 17, sample.a + HALF_PI, mark);
      }
    }
  }

  drawBarriers() {
    for (const item of BARRIER_POSTS) {
      if (!this.camera.visibleWorld(item.x, item.y, 140)) continue;
      drawPixelRect(item.x, item.y, 16, 34, item.a + HALF_PI, colorFromPalette(this.palette.barrier, item.tone));
      if (item.tone % 2 === 0) drawPixelRect(item.x, item.y, 7, 37, item.a + HALF_PI, color(30, 35, 40, 130));
    }
  }

  drawCrowds() {
    this.drawGrandstandShells();
    for (const item of CROWD_PIXELS) {
      if (!this.camera.visibleWorld(item.x, item.y, 130)) continue;
      const pulse = 0.72 + 0.28 * Math.sin(frameCount * 0.04 + item.pulse);
      drawPixelRect(item.x, item.y, item.w, item.h * pulse, item.a, colorFromPalette(this.palette.crowd, item.tone, 230));
    }
  }

  drawGrandstandShells() {
    for (const stand of GRANDSTANDS) {
      if (!this.camera.visibleWorld(stand.x, stand.y, Math.max(stand.w, stand.h))) continue;
      push();
      translate(stand.x, stand.y);
      rotate(stand.a);
      noStroke();
      fill(9, 13, 18, 205);
      rect(12, 24, stand.w + 42, stand.h + 38, 4);
      fill(31, 42, 54, 232);
      rect(0, 0, stand.w, stand.h, 3);
      fill(58, 72, 88, 230);
      rect(0, -stand.h * 0.42, stand.w * 0.96, 18, 2);
      fill(18, 24, 31, 210);
      rect(0, stand.h * 0.43, stand.w * 0.94, 16, 2);
      for (let row = -2; row <= 2; row += 1) {
        fill(row % 2 === 0 ? color(92, 108, 124, 180) : color(50, 63, 78, 210));
        rect(0, row * (stand.h * 0.16), stand.w - 28, 7, 1);
      }
      for (let col = -3; col <= 3; col += 1) {
        fill(14, 18, 23, 180);
        rect((col / 3) * stand.w * 0.42, 0, 6, stand.h * 0.92, 1);
      }
      textAlign(CENTER, CENTER);
      textSize(16);
      fill(235, 236, 220, 215);
      text(stand.label, 0, 0);
      pop();
    }
  }

  drawPitLane() {
    const lane = -(TRACK_WIDTH * 0.5 + 188);
    const stall = this.track.pointAt(210, lane);
    if (!this.camera.visibleWorld(stall.x, stall.y, 1480)) return;
    push();
    drawingContext.lineCap = "butt";
    drawingContext.lineJoin = "round";
    noFill();
    stroke(7, 12, 14, 235);
    strokeWeight(286);
    beginShape();
    for (let d = -920; d <= 1490; d += 48) {
      const p = this.track.pointAt(d, lane);
      vertex(p.x, p.y);
    }
    endShape();
    stroke(34, 43, 47, 248);
    strokeWeight(238);
    beginShape();
    for (let d = -900; d <= 1460; d += 48) {
      const p = this.track.pointAt(d, lane);
      vertex(p.x, p.y);
    }
    endShape();
    stroke(88, 98, 102, 150);
    strokeWeight(6);
    for (let d = -760; d <= 1330; d += 122) {
      const p = this.track.pointAt(d, lane);
      const q = this.track.pointAt(d + 52, lane);
      line(p.x, p.y, q.x, q.y);
    }
    stroke(82, 162, 218, 190);
    strokeWeight(8);
    beginShape();
    for (let d = -780; d <= 1360; d += 92) {
      const p = this.track.pointAt(d, lane - 74);
      vertex(p.x, p.y);
    }
    endShape();

    const entryA = this.track.pointAt(-920, -TRACK_WIDTH * 0.39);
    const entryB = this.track.pointAt(-650, lane);
    const exitA = this.track.pointAt(1190, lane);
    const exitB = this.track.pointAt(1490, -TRACK_WIDTH * 0.39);
    stroke(35, 45, 49, 248);
    strokeWeight(156);
    line(entryA.x, entryA.y, entryB.x, entryB.y);
    line(exitA.x, exitA.y, exitB.x, exitB.y);
    stroke(86, 170, 220, 180);
    strokeWeight(9);
    line(entryA.x, entryA.y, entryB.x, entryB.y);
    line(exitA.x, exitA.y, exitB.x, exitB.y);

    const tire = this.queuedTire();
    const current = this.player ? this.player.tireCompound() : tire;
    push();
    translate(stall.x, stall.y);
    rotate(stall.angle);
    noStroke();
    fill(5, 10, 13, 226);
    rect(0, 0, 520, 210, 4);
    fill(27, 50, 58, 245);
    rect(0, 0, 478, 168, 3);
    fill(44, 96, 122, 235);
    rect(0, -34, 430, 66, 2);
    fill(20, 28, 32, 230);
    for (let bay = -3; bay <= 3; bay += 1) {
      rect(bay * 60, 54, 42, 62, 1);
    }
    fill(238, 240, 218, 230);
    textAlign(CENTER, CENTER);
    textSize(24);
    text("TIRE BAY", 0, -62);
    textSize(13);
    text("T / 1-4 FIT", 0, -36);
    const swatchStart = -132;
    for (let i = 0; i < this.tireCompounds.length; i += 1) {
      const c = this.tireCompounds[i];
      const active = i === this.selectedTireIndex;
      const fitted = c.name === current.name;
      fill(c.color[0], c.color[1], c.color[2], active ? 245 : 160);
      rect(swatchStart + i * 88, 0, active ? 60 : 48, fitted ? 34 : 26, 2);
      fill(12, 16, 18, 230);
      textSize(14);
      text(c.code, swatchStart + i * 88, 0);
    }
    if (this.pitStopTimer > 0) {
      fill(0, 0, 0, 150);
      rect(0, 86, 346, 22, 2);
      fill(110, 235, 150, 230);
      rectMode(CORNER);
      rect(-173, 75, 346 * (1 - this.pitStopTimer / this.pitStopDuration), 22, 2);
      rectMode(CENTER);
    }
    pop();
    pop();
  }

  drawPitComplex() {
    const start = this.track.pointAt(0, -TRACK_WIDTH * 1.28 - 260);
    if (!this.camera.visibleWorld(start.x, start.y, 980)) return;
    push();
    translate(start.x, start.y);
    rotate(start.angle);
    noStroke();
    fill(8, 12, 18, 215);
    rect(0, 36, 1080, 190, 4);
    fill(34, 44, 58, 245);
    rect(0, 0, 1040, 150, 3);
    fill(72, 85, 101, 245);
    rect(0, -62, 1040, 26, 2);
    fill(18, 22, 30, 255);
    for (let bay = -8; bay <= 8; bay += 1) {
      const x = bay * 58;
      rect(x, 28, 38, 64, 1);
      fill(bay % 2 === 0 ? color(195, 28, 44, 230) : color(230, 230, 214, 230));
      rect(x, -22, 42, 10, 1);
      fill(18, 22, 30, 255);
    }
    fill(230, 235, 220, 220);
    textAlign(CENTER, CENTER);
    textSize(18);
    text("SILVERSTONE WING", 0, -64);
    pop();
  }

  drawStartGantry() {
    const p = this.track.pointAt(-86, 0);
    if (!this.camera.visibleWorld(p.x, p.y, 720)) return;
    push();
    translate(p.x, p.y);
    rotate(p.angle);
    noStroke();
    fill(4, 7, 9, 230);
    rect(0, -TRACK_WIDTH * 0.5 - 42, TRACK_WIDTH + 220, 38, 2);
    rect(-TRACK_WIDTH * 0.5 - 72, 0, 34, TRACK_WIDTH + 160, 2);
    rect(TRACK_WIDTH * 0.5 + 72, 0, 34, TRACK_WIDTH + 160, 2);
    fill(48, 60, 70, 245);
    for (let i = -4; i <= 4; i += 1) {
      const lit = this.state === "countdown" && this.countdown < 3.2 - (i + 4) * 0.24;
      fill(lit ? color(245, 34, 42, 245) : color(46, 18, 20, 230));
      rect(i * 58, -TRACK_WIDTH * 0.5 - 43, 34, 24, 2);
    }
    fill(240, 236, 205, 235);
    textAlign(CENTER, CENTER);
    textSize(16);
    text("SILVERSTONE START", 0, -TRACK_WIDTH * 0.5 - 82);
    pop();
  }

  drawSigns() {
    textAlign(CENTER, CENTER);
    textSize(28);
    for (const item of TRACKSIDE_SIGNS) {
      if (!this.camera.visibleWorld(item.x, item.y, 180)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      const signW = Math.max(118, item.label.length * 17 + 36);
      fill(colorFromPalette(this.palette.sign, item.tone));
      noStroke();
      rect(0, 0, signW, 44, 2);
      fill(10, 16, 20, 230);
      rect(0, 0, signW - 14, 31, 1);
      fill(245, 245, 235);
      text(item.label, 0, 1);
      pop();
    }
  }

  drawSponsorBanners() {
    textAlign(CENTER, CENTER);
    for (const item of SPONSOR_BANNERS) {
      if (!this.camera.visibleWorld(item.x, item.y, 180)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      noStroke();
      fill(5, 8, 10, 130);
      rect(7, 7, item.w + 14, item.h + 14, 2);
      fill(colorFromPalette(this.palette.sign, item.tone));
      rect(0, 0, item.w, item.h, 2);
      fill(4, 9, 14, 220);
      rect(0, 0, item.w - 14, item.h - 12, 1);
      fill(245, 244, 226);
      textSize(Math.min(24, item.w / Math.max(4, item.label.length)));
      text(item.label, 0, 1);
      pop();
    }
  }

  drawMarshalPosts() {
    const flagColors = [color(255, 220, 60), color(52, 185, 95), color(68, 135, 245), color(230, 45, 58)];
    for (const item of MARSHAL_POSTS) {
      if (!this.camera.visibleWorld(item.x, item.y, 180)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      noStroke();
      fill(6, 10, 12, 160);
      rect(8, 8, 58, 46, 3);
      fill(32, 42, 48, 238);
      rect(0, 0, 52, 38, 2);
      fill(220, 224, 208, 210);
      rect(0, -8, 42, 8, 1);
      stroke(220, 220, 205, 210);
      strokeWeight(3);
      line(item.side * 34, -20, item.side * 34, 34);
      noStroke();
      const flap = Math.sin(frameCount * 0.13 + item.x * 0.01) * 7;
      fill(flagColors[item.flag % flagColors.length]);
      rect(item.side * (47 + flap * 0.08), -18 + flap * 0.08, 28, 16, 1);
      pop();
    }
  }

  drawCameraRigs() {
    for (const item of CAMERA_RIGS) {
      if (!this.camera.visibleWorld(item.x, item.y, 220)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      stroke(22, 29, 35, 230);
      strokeWeight(7);
      line(0, 0, item.side * item.arm, -34);
      strokeWeight(4);
      line(0, -48, 0, 52);
      noStroke();
      fill(10, 14, 18, 220);
      rect(0, 58, 54, 20, 2);
      fill(72, 85, 96, 245);
      rect(item.side * item.arm, -34, 46, 24, 2);
      fill(45, 160, 230, 220);
      rect(item.side * item.arm + item.side * 18, -34, 10, 12, 1);
      pop();
    }
  }

  drawLightRigs() {
    const nightFactor = clamp(1.16 - this.weather.light + this.weather.cloud * 0.28 + this.weather.rain * 0.5, 0, 1);
    for (const item of LIGHT_RIGS) {
      if (!this.camera.visibleWorld(item.x, item.y, item.cone + 140)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      stroke(20, 25, 28, 210);
      strokeWeight(6);
      line(0, 0, 0, -item.h);
      noStroke();
      fill(220, 226, 210, 235);
      rect(0, -item.h, 70, 18, 2);
      if (nightFactor > 0.04) {
        fill(245, 242, 198, 22 + nightFactor * 44);
        triangle(-item.cone * 0.38, -item.h + 6, item.cone * 0.38, -item.h + 6, 0, item.cone * 0.65);
        fill(255, 246, 192, 95 + nightFactor * 85);
        rect(-20, -item.h, 18, 8, 1);
        rect(20, -item.h, 18, 8, 1);
      }
      pop();
    }
  }

  drawServiceVehicles() {
    for (const item of SERVICE_VEHICLES) {
      if (!this.camera.visibleWorld(item.x, item.y, 190)) continue;
      push();
      translate(item.x, item.y);
      rotate(item.a);
      noStroke();
      fill(12, 15, 18, 135);
      rect(6, 8, 92, 44, 4);
      fill(colorFromPalette(this.palette.sign, item.tone));
      rect(0, 0, 84, 38, 3);
      fill(230, 235, 225, 230);
      rect(-24, -3, 22, 16, 1);
      fill(28, 34, 38, 255);
      rect(-32, 22, 16, 10, 1);
      rect(32, 22, 16, 10, 1);
      rect(-32, -22, 16, 10, 1);
      rect(32, -22, 16, 10, 1);
      pop();
    }
  }

  drawRain(viewW, viewH) {
    if (this.weather.rain < 0.05) return;
    push();
    stroke(145, 190, 215, 90 * this.weather.rain);
    strokeWeight(2);
    const drops = Math.floor(60 + this.weather.rain * 190);
    const w = viewW || width;
    const h = viewH || height;
    for (let i = 0; i < drops; i += 1) {
      const x = (i * 97 + frameCount * 18) % (w + 160) - 80;
      const y = (i * 53 + frameCount * 31) % (h + 160) - 80;
      line(x, y, x - 10, y + 26);
    }
    pop();
  }

  drawSpeedEffects() {
    const speed = this.player.speedMagnitude();
    const t = smoothStep(20, 48, speed);
    if (t <= 0.01) return;
    push();
    resetMatrix();
    const streaks = Math.floor(10 + t * 42);
    strokeWeight(2);
    for (let i = 0; i < streaks; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const lane = (i * 47 + frameCount * 6) % Math.floor(width * 0.48);
      const x = side > 0 ? width - lane : lane;
      const y = (i * 137 + frameCount * (7 + speed * 0.65)) % (height + 180) - 90;
      const len = 34 + speed * 1.35 + (i % 5) * 12;
      stroke(220, 235, 255, 20 + 72 * t);
      line(x, y, x + side * 12, y + len);
    }
    noStroke();
    const edge = drawingContext.createLinearGradient(0, 0, width, 0);
    edge.addColorStop(0, "rgba(180,220,255," + (0.16 * t).toFixed(3) + ")");
    edge.addColorStop(0.18, "rgba(180,220,255,0)");
    edge.addColorStop(0.82, "rgba(180,220,255,0)");
    edge.addColorStop(1, "rgba(180,220,255," + (0.16 * t).toFixed(3) + ")");
    drawingContext.fillStyle = edge;
    rectMode(CORNER);
    drawingContext.fillRect(0, 0, width, height);
    rectMode(CENTER);
    pop();
  }

  drawUI() {
    push();
    resetMatrix();
    const mobile = this.shouldShowMobileControls();
    if (mobile) {
      this.drawMobileRaceHud();
      this.drawRaceDirector();
      this.drawMobileControls();
      if (this.state === "countdown") this.drawCountdown();
      if (this.state === "finished") this.drawFinishOverlay();
      pop();
      return;
    }
    this.drawTopHud();
    this.drawLeaderboard();
    this.drawObjectivePanel();
    this.drawCameraBadge();
    this.drawRaceDirector();
    if (this.showMap) this.drawMiniMap();
    this.drawSpeedCluster();
    if (this.state === "countdown") this.drawCountdown();
    if (this.state === "finished") this.drawFinishOverlay();
    pop();
  }

  drawSplitDivider(views) {
    push();
    resetMatrix();
    rectMode(CORNER);
    noStroke();
    fill(3, 6, 8, 242);
    if (views[0].x !== views[1].x) rect(width * 0.5 - 2, 0, 4, height);
    else rect(0, height * 0.5 - 2, width, 4);
    fill(255, 244, 185, 130);
    if (views[0].x !== views[1].x) rect(width * 0.5 - 1, 0, 1, height);
    else rect(0, height * 0.5 - 1, width, 1);
    rectMode(CENTER);
    pop();
  }

  drawSplitUI(views) {
    push();
    resetMatrix();
    for (const view of views) this.drawSplitDriverHud(view);
    this.drawSplitRaceTag(views);
    this.drawRaceDirector();
    if (this.shouldShowMobileControls()) this.drawMobileControls();
    if (this.state === "countdown") this.drawCountdown();
    if (this.state === "finished") this.drawFinishOverlay();
    pop();
  }

  drawSplitDriverHud(view) {
    const car = view.car;
    if (!car) return;
    const pos = this.leaders.indexOf(car) + 1;
    const panelW = Math.min(256, view.w - 28);
    const panelH = 106;
    const x = view.x + 14;
    const y = view.y + 14;
    this.drawPanel(x, y, panelW, panelH, 216);
    textAlign(LEFT, TOP);
    noStroke();
    fill(view.label === "P1" ? color(255, 226, 92) : color(112, 198, 255));
    textSize(16);
    text(view.label + "  " + car.name.toUpperCase(), x + 14, y + 12);
    fill(160, 184, 190);
    textSize(11);
    text(view.controls + " CONTROL", x + 14, y + 34);
    fill(235, 238, 224);
    textSize(14);
    text("P" + pos + " / " + this.cars.length + "   LAP " + clamp(car.lap + 1, 1, this.raceLaps) + "/" + this.raceLaps, x + 14, y + 54);
    const tire = car.tireCompound();
    fill(tire.color[0], tire.color[1], tire.color[2]);
    text("TIRE " + tire.code + "   G" + car.gear, x + 14, y + 76);
    textAlign(RIGHT, TOP);
    fill(248, 248, 235);
    textSize(30);
    text(car.speedKmh().toString().padStart(3, "0"), x + panelW - 18, y + 45);
    fill(154, 174, 184);
    textSize(10);
    text("KM/H", x + panelW - 18, y + 78);
    textAlign(LEFT, TOP);
  }

  drawSplitRaceTag(views) {
    const w = Math.min(320, width - 42);
    const x = width * 0.5 - w * 0.5;
    const y = 16;
    this.drawPanel(x, y, w, 48, 188);
    textAlign(CENTER, TOP);
    noStroke();
    fill(255, 244, 185);
    textSize(13);
    text("SILVERSTONE APEX GP  /  SPLIT SCREEN", x + w * 0.5, y + 10);
    fill(150, 170, 180);
    textSize(10);
    text("P1 WASD  /  P2 ARROWS  /  O OPTIONS", x + w * 0.5, y + 28);
  }

  drawMenuText(label, x, centerY, size, alignMode) {
    textSize(size);
    textAlign(alignMode || LEFT, BASELINE);
    const baseline = centerY + (textAscent() - textDescent()) * 0.5;
    text(label, x, baseline);
  }

  drawBootText(label, x, centerY, size, alignMode) {
    textSize(size);
    textAlign(alignMode || LEFT, TOP);
    text(label, x, centerY - size * 0.78);
  }

  drawMobileRaceHud() {
    const p = this.player;
    if (!p) return;
    const tire = p.tireCompound();
    const pos = this.leaders.indexOf(p) + 1;
    const w = Math.min(380, width - 28);
    const h = 78;
    const x = 14;
    const y = 14;
    this.drawPanel(x, y, w, h, 196);
    textAlign(LEFT, TOP);
    noStroke();
    fill(255, 244, 185);
    textSize(12);
    text("SILVERSTONE APEX", x + 14, y + 10);
    fill(248, 248, 235);
    textSize(30);
    text(p.speedKmh().toString().padStart(3, "0"), x + 14, y + 32);
    fill(154, 174, 184);
    textSize(10);
    text("KM/H", x + 84, y + 50);
    fill(255, 226, 100);
    textSize(20);
    text("G" + p.gear, x + 126, y + 34);
    fill(tire.color[0], tire.color[1], tire.color[2]);
    textSize(12);
    text(tire.code + " " + tire.name, x + 126, y + 56);
    const detailX = x + (w > 330 ? 214 : 188);
    fill(210, 220, 214);
    textSize(w > 330 ? 12 : 10);
    text("P" + pos + "/" + this.cars.length + "  LAP " + clamp(p.lap + 1, 1, this.raceLaps) + "/" + this.raceLaps, detailX, y + 34);
    fill(150, 170, 180);
    text("TOUCH DRIVE", detailX, y + 56);
  }

  drawMobileControls() {
    const buttons = this.mobileControlLayouts();
    this.touchControls.buttons = buttons;
    push();
    resetMatrix();
    rectMode(CORNER);
    textAlign(CENTER, CENTER);
    noStroke();
    for (const button of buttons) {
      const state = button.playerIndex === 2 ? this.touchControls.p2 : this.touchControls.p1;
      const active = !!state[button.id];
      let base = color(20, 34, 40, active ? 224 : 154);
      let edge = color(136, 166, 174, active ? 230 : 120);
      if (button.tone === 1) {
        base = color(96, 22, 28, active ? 230 : 166);
        edge = color(245, 82, 92, active ? 245 : 150);
      } else if (button.tone === 2) {
        base = color(24, 82, 48, active ? 232 : 168);
        edge = color(86, 238, 138, active ? 245 : 160);
      } else if (button.tone === 3) {
        base = color(44, 40, 86, active ? 226 : 154);
        edge = color(210, 170, 255, active ? 242 : 142);
      }
      fill(0, 0, 0, 88);
      rect(button.x + 4, button.y + 5, button.w, button.h, 7);
      fill(base);
      rect(button.x, button.y, button.w, button.h, 7);
      fill(edge);
      rect(button.x, button.y, button.w, 4, 3);
      fill(246, 248, 232, active ? 255 : 218);
      textSize(button.h < 42 ? 11 : button.label.length > 2 ? 13 : 20);
      text(button.label, button.x + button.w * 0.5, button.y + button.h * 0.52);
      if (this.isSplitScreenActive()) {
        fill(button.playerIndex === 1 ? color(255, 226, 92, 210) : color(112, 198, 255, 210));
        textSize(9);
        text("P" + button.playerIndex, button.x + button.w * 0.5, button.y + 10);
      }
    }
    rectMode(CENTER);
    pop();
  }

  drawPanel(x, y, w, h, alphaValue) {
    rectMode(CORNER);
    noStroke();
    fill(4, 9, 11, alphaValue || 205);
    rect(x, y, w, h, 6);
    fill(255, 255, 255, 16);
    rect(x, y, w, 2);
    rectMode(CENTER);
  }

  drawBootMenu() {
    push();
    resetMatrix();
    this.bootButtons = [];
    rectMode(CORNER);
    noStroke();
    fill(0, 0, 0, 112);
    rect(0, 0, width, height);
    fill(8, 18, 20, 178);
    rect(0, 0, width, height);

    const compact = width < 820 || height < 620;
    const panelW = compact ? Math.min(width - 36, 560) : Math.min(560, width * 0.46);
    const panelH = compact ? Math.min(height - 36, 560) : Math.min(height - 72, 590);
    const x = compact ? width * 0.5 - panelW * 0.5 : 46;
    const baseY = height * 0.5 - panelH * 0.5;
    const y = Math.max(12, baseY - (compact ? 24 : 70));
    this.drawPanel(x, y, panelW, panelH, 236);
    rectMode(CORNER);

    fill(255, 255, 255, 16);
    rect(x + 18, y + 18, panelW - 36, 2);
    fill(76, 220, 154, 210);
    rect(x + 18, y + 18, panelW * 0.30, 2);
    fill(245, 210, 74, 235);
    rect(x + 18 + panelW * 0.32, y + 18, panelW * 0.12, 2);

    textAlign(LEFT, TOP);
    noStroke();
    textSize(compact ? 14 : 16);
    fill(140, 172, 178);
    text("SILVERSTONE, UNITED KINGDOM", x + 28, y + 22);
    fill(246, 239, 190);
    textSize(compact ? 38 : 52);
    text("SILVERSTONE", x + 28, y + 46);
    fill(245, 245, 232);
    textSize(compact ? 48 : 66);
    text("APEX GP", x + 28, y + (compact ? 86 : 96));
    fill(118, 152, 158);
    textSize(13);
    text("PIXEL GRAND PRIX  /  BRDC CIRCUIT SPEC", x + 30, y + (compact ? 144 : 166));

    const items = this.bootMenuItems();
    const listY = y + (compact ? 170 : 202);
    const rowH = compact ? 40 : 43;
    for (let i = 0; i < items.length; i += 1) {
      const rowY = listY + i * rowH;
      const active = i === this.bootIndex;
      const isStart = items[i].id === "start";
      const h = rowH - 5;
      const rowX = x + 28;
      const rowW = panelW - 56;
      stroke(active ? color(246, 226, 92, 170) : color(255, 255, 255, 58));
      strokeWeight(1);
      fill(active ? color(180, 158, 54, 232) : color(15, 27, 31, 232));
      rect(rowX, rowY, rowW, h, 5);
      if (active) {
        noStroke();
        fill(isStart ? color(78, 230, 154, 230) : color(245, 210, 74, 220));
        rect(rowX, rowY, 5, h, 2);
      }
      noStroke();
      fill(isStart ? color(250, 242, 190) : active ? color(255, 235, 120) : color(224, 230, 218));
      textAlign(LEFT, TOP);
      textSize(isStart ? 19 : 14);
      text(items[i].label, rowX + 48, rowY + (isStart ? 9 : 8));
      fill(active ? color(246, 248, 232) : color(142, 166, 172));
      textAlign(RIGHT, TOP);
      textSize(isStart ? 13 : 12);
      text(items[i].value, rowX + rowW - 22, rowY + (isStart ? 12 : 10));
      textAlign(LEFT, TOP);
      this.bootButtons.push({ x: rowX, y: rowY, w: rowW, h });
    }

    const footerY = y + panelH - 34;
    fill(90, 118, 126);
    textSize(12);
    textAlign(LEFT, TOP);
    text("MAGGOTTS  BECKETTS  HANGAR STRAIGHT  STOWE", x + 28, footerY);
    fill(255, 255, 255, 20);
    rect(x + 28, footerY + 20, panelW - 56, 2);

    if (!compact) this.drawBootCircuitPanel(x + panelW + 34, y, Math.max(300, width - (x + panelW + 80)), panelH);
    pop();
  }

  drawBootCircuitPanel(x, y, w, h) {
    const panelW = Math.min(w, 420);
    const panelH = Math.min(h, 420);
    const px = x + Math.max(0, (w - panelW) * 0.5);
    const py = y + Math.max(0, (h - panelH) * 0.5);
    this.drawPanel(px, py, panelW, panelH, 198);
    rectMode(CORNER);
    textAlign(LEFT, TOP);
    noStroke();
    fill(138, 166, 170);
    textSize(12);
    text("CIRCUIT PROFILE", px + 24, py + 22);
    fill(246, 239, 190);
    textSize(22);
    text("SILVERSTONE", px + 24, py + 42);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of this.track.samples) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    const boxX = px + 34;
    const boxY = py + 92;
    const boxW = panelW - 68;
    const boxH = panelH - 170;
    const scale = Math.min(boxW / Math.max(1, maxX - minX), boxH / Math.max(1, maxY - minY));
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const project = (wx, wy) => ({
      x: boxX + boxW * 0.5 + (wx - cx) * scale,
      y: boxY + boxH * 0.5 + (wy - cy) * scale,
    });
    noFill();
    stroke(3, 7, 8, 230);
    strokeWeight(12);
    beginShape();
    for (const pt of this.track.samples) {
      const p = project(pt.x, pt.y);
      vertex(p.x, p.y);
    }
    endShape(CLOSE);
    stroke(225, 230, 218, 236);
    strokeWeight(5);
    beginShape();
    for (const pt of this.track.samples) {
      const p = project(pt.x, pt.y);
      vertex(p.x, p.y);
    }
    endShape(CLOSE);
    stroke(78, 230, 154, 210);
    strokeWeight(3);
    const start = project(this.track.pointAt(0, 0).x, this.track.pointAt(0, 0).y);
    line(start.x - 14, start.y, start.x + 14, start.y);

    const sprite = this.sprites[PLAYER_SPRITE_INDEX];
    if (sprite) {
      push();
      translate(px + panelW - 86, py + panelH - 74);
      rotate(-0.18);
      tint(255);
      image(sprite.img, 0, 0, 58, 146);
      pop();
    }
    noStroke();
    fill(128, 154, 162);
    textSize(12);
    text(this.settings.splitScreen ? "TARGET  P1 PODIUM / P2 DUEL" : "TARGET  P" + this.goal.targetPosition + " OR BETTER", px + 24, py + panelH - 62);
    fill(230, 236, 220);
    text(this.settings.splitScreen ? "START  LOCAL 2P GRID" : "START  " + this.currentDifficulty().short, px + 24, py + panelH - 40);
  }

  drawTopHud() {
    const p = this.player;
    const pos = this.leaders.indexOf(p) + 1;
    this.drawPanel(18, 18, 282, 100, 216);
    textAlign(LEFT, TOP);
    noStroke();
    textSize(13);
    fill(255, 244, 185);
    text("SILVERSTONE APEX", 34, 30);
    fill(235);
    text("P" + pos + " / " + this.cars.length, 34, 54);
    text("LAP " + clamp(p.lap + 1, 1, this.raceLaps) + " / " + this.raceLaps, 120, 54);
    text(this.formatTime(this.raceTime), 210, 54);
    fill(160, 205, 255);
    text("BEST " + (p.bestLap ? this.formatTime(p.bestLap) : "--:--.---"), 34, 80);
  }

  drawObjectivePanel() {
    const pos = this.leaders.indexOf(this.player) + 1;
    const x = 18;
    const y = 126;
    this.drawPanel(x, y, 318, 118, 196);
    textAlign(LEFT, TOP);
    noStroke();
    textSize(12);
    fill(255, 244, 185);
    text("GOAL  " + this.goal.label, x + 16, y + 13);
    fill(pos <= this.goal.targetPosition ? color(90, 235, 120) : color(230, 230, 220));
    text("FINISH P" + this.goal.targetPosition + " OR BETTER", x + 16, y + 36);
    fill(150, 170, 180);
    const diff = this.currentDifficulty().name;
    const weather = this.weatherPresets[this.settings.weatherIndex].name;
    text(diff + " / " + weather + " / " + (this.playerAutodrive ? "AUTO" : "MANUAL"), x + 16, y + 54);
    const tire = this.player.tireCompound();
    fill(tire.color[0], tire.color[1], tire.color[2]);
    text("TIRE " + tire.name + "  QUEUE " + this.queuedTire().name, x + 16, y + 75);
    fill(this.penaltySeconds > 0 ? color(245, 82, 88) : color(160, 184, 190));
    text("LIMITS W" + this.trackLimitWarnings + "/3  PEN +" + this.penaltySeconds.toFixed(0) + "s", x + 16, y + 94);
  }

  drawCameraBadge() {
    const mode = this.currentCameraMode();
    const w = 178;
    const x = width * 0.5 - w * 0.5;
    const y = 18;
    this.drawPanel(x, y, w, 44, 188);
    textAlign(CENTER, TOP);
    noStroke();
    fill(255, 244, 185);
    textSize(12);
    text("CAMERA  " + mode.name, x + w * 0.5, y + 10);
    fill(150, 170, 180);
    textSize(10);
    text("C CAMERA / V AUTO", x + w * 0.5, y + 27);
  }

  drawRaceDirector() {
    if (this.directorTimer <= 0 || !this.directorMessage) return;
    const t = clamp(this.directorTimer / 0.35, 0, 1);
    const w = Math.min(460, width - 42);
    const h = this.directorSubtext ? 82 : 58;
    const x = width * 0.5 - w * 0.5;
    const y = 74 - (1 - t) * 22;
    this.drawPanel(x, y, w, h, 226 * t);
    textAlign(CENTER, TOP);
    noStroke();
    fill(255, 238, 112, 255 * t);
    textSize(22);
    text(this.directorMessage, x + w * 0.5, y + 14);
    if (this.directorSubtext) {
      fill(214, 224, 222, 220 * t);
      textSize(13);
      text(this.directorSubtext, x + w * 0.5, y + 48);
    }
  }

  drawLeaderboard() {
    const w = 260;
    const h = 30 + this.leaders.length * 22;
    this.drawPanel(width - w - 18, 18, w, h, 212);
    textAlign(LEFT, TOP);
    textSize(12);
    fill(255, 244, 185);
    text("STANDINGS", width - w + 2, 30);
    for (let i = 0; i < this.leaders.length; i += 1) {
      const car = this.leaders[i];
      const y = 55 + i * 22;
      fill(car.isPlayer ? color(255, 220, 85) : color(225));
      text((i + 1).toString().padStart(2, "0") + "  " + car.name, width - w + 2, y);
      const gap = i === 0 ? "LEAD" : "+" + Math.max(0, ((this.leaders[0].raceDistance - car.raceDistance) / 120).toFixed(1));
      fill(160, 174, 184);
      text(gap, width - 70, y);
    }
  }

  drawMiniMap() {
    const mapW = 318;
    const mapH = 238;
    const x = 18;
    const y = height - mapH - 18;
    this.drawPanel(x, y, mapW, mapH, 210);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of this.track.samples) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
    const pad = 18;
    const scale = Math.min((mapW - pad * 2) / Math.max(1, maxX - minX), (mapH - pad * 2) / Math.max(1, maxY - minY));
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const project = (wx, wy) => ({
      x: x + mapW * 0.5 + (wx - cx) * scale,
      y: y + mapH * 0.5 + (wy - cy) * scale,
    });
    noFill();
    stroke(8, 10, 12, 210);
    strokeWeight(9);
    beginShape();
    for (const pt of this.track.samples) {
      const p = project(pt.x, pt.y);
      vertex(p.x, p.y);
    }
    endShape(CLOSE);
    stroke(88, 94, 96, 235);
    strokeWeight(6);
    beginShape();
    for (const pt of this.track.samples) {
      const p = project(pt.x, pt.y);
      vertex(p.x, p.y);
    }
    endShape(CLOSE);
    stroke(205, 210, 195);
    strokeWeight(2);
    beginShape();
    for (const pt of this.track.samples) {
      const p = project(pt.x, pt.y);
      vertex(p.x, p.y);
    }
    endShape(CLOSE);
    const pitLane = -(TRACK_WIDTH * 0.5 + 188);
    stroke(7, 13, 16, 230);
    strokeWeight(7);
    beginShape();
    for (let d = -900; d <= 1460; d += 64) {
      const p = this.track.pointAt(d, pitLane);
      const q = project(p.x, p.y);
      vertex(q.x, q.y);
    }
    endShape();
    stroke(80, 168, 245, 235);
    strokeWeight(4);
    beginShape();
    for (let d = -900; d <= 1460; d += 64) {
      const p = this.track.pointAt(d, pitLane);
      const q = project(p.x, p.y);
      vertex(q.x, q.y);
    }
    endShape();
    const pitEntry = project(this.track.pointAt(-920, -TRACK_WIDTH * 0.39).x, this.track.pointAt(-920, -TRACK_WIDTH * 0.39).y);
    const pitEntryB = project(this.track.pointAt(-650, pitLane).x, this.track.pointAt(-650, pitLane).y);
    const pitExit = project(this.track.pointAt(1190, pitLane).x, this.track.pointAt(1190, pitLane).y);
    const pitExitB = project(this.track.pointAt(1490, -TRACK_WIDTH * 0.39).x, this.track.pointAt(1490, -TRACK_WIDTH * 0.39).y);
    line(pitEntry.x, pitEntry.y, pitEntryB.x, pitEntryB.y);
    line(pitExit.x, pitExit.y, pitExitB.x, pitExitB.y);
    const start = this.track.pointAt(0, 0);
    const startLeft = project(start.x - start.nx * 170, start.y - start.ny * 170);
    const startRight = project(start.x + start.nx * 170, start.y + start.ny * 170);
    stroke(255, 245, 120);
    strokeWeight(3);
    line(startLeft.x, startLeft.y, startRight.x, startRight.y);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(9);
    fill(255, 245, 120);
    const label = project(start.x, start.y);
    text("START", label.x, label.y - 10);
    const pit = this.track.pointAt(210, pitLane);
    const pitP = project(pit.x, pit.y);
    fill(80, 168, 245, 230);
    rect(pitP.x, pitP.y, 11, 11, 1);
    textSize(8);
    text("PIT", pitP.x + 15, pitP.y);
    const s2 = this.track.pointAt(this.track.totalLength / 3, 0);
    const s3 = this.track.pointAt((this.track.totalLength * 2) / 3, 0);
    for (const sector of [s2, s3]) {
      const p = project(sector.x, sector.y);
      fill(120, 190, 255, 230);
      rect(p.x, p.y, 5, 5);
    }
    noStroke();
    for (const car of this.cars) {
      const p = project(car.pos.x, car.pos.y);
      fill(car.isPlayer ? color(255, 210, 55) : color(190, 210, 245));
      rect(p.x, p.y, car.isPlayer ? 7 : 5, car.isPlayer ? 7 : 5);
    }
  }

  drawSpeedCluster() {
    const p = this.player;
    const tire = p.tireCompound();
    const w = 296;
    const h = 164;
    const x = width - w - 18;
    const y = height - h - 18;
    this.drawPanel(x, y, w, h, 218);
    textAlign(LEFT, TOP);
    noStroke();
    fill(245);
    textSize(48);
    text(p.speedKmh().toString().padStart(3, "0"), x + 22, y + 18);
    textSize(14);
    fill(160, 174, 184);
    text("KM/H", x + 136, y + 36);
    fill(255, 226, 100);
    textSize(32);
    text("G" + p.gear, x + 214, y + 24);
    fill(tire.color[0], tire.color[1], tire.color[2]);
    textSize(17);
    text(tire.code + " " + tire.name, x + 214, y + 62);
    this.drawBar(x + 24, y + 88, 118, 10, p.throttle, color(70, 210, 105));
    this.drawBar(x + 154, y + 88, 118, 10, p.brake, color(240, 70, 80));
    this.drawBar(x + 24, y + 112, 76, 8, 1 - p.damage, color(90, 170, 245));
    this.drawBar(x + 112, y + 112, 76, 8, p.tire, color(240, 215, 95));
    this.drawBar(x + 200, y + 112, 72, 8, p.ers, color(200, 120, 255));
    if (this.pitStopTimer > 0) {
      fill(160, 174, 184);
      textSize(11);
      text("PIT SERVICE", x + 24, y + 132);
      this.drawBar(x + 112, y + 135, 160, 8, 1 - this.pitStopTimer / this.pitStopDuration, color(110, 235, 150));
    } else if (this.inPitStall) {
      fill(110, 235, 150);
      textSize(11);
      text("T TO FIT " + this.queuedTire().name, x + 24, y + 132);
    } else if (this.playerAutodrive) {
      fill(110, 210, 255);
      textSize(11);
      const auto = this.autodriveState || { mode: "FLOW", targetSpeed: 0 };
      text("V AUTODRIVE " + auto.mode + "  " + Math.round(auto.targetSpeed * DASHBOARD_SPEED_SCALE) + " KM/H", x + 24, y + 132);
    } else if (this.penaltySeconds > 0 || this.trackLimitWarnings > 0) {
      fill(245, 90, 95);
      textSize(11);
      text("PEN +" + this.penaltySeconds.toFixed(0) + "s  W" + this.trackLimitWarnings + "/3", x + 24, y + 132);
    }
  }

  drawBar(x, y, w, h, value, c) {
    rectMode(CORNER);
    noStroke();
    fill(255, 255, 255, 24);
    rect(x, y, w, h, 2);
    fill(c);
    rect(x, y, Math.max(2, w * clamp(value, 0, 1)), h, 2);
    rectMode(CENTER);
  }

  drawCountdown() {
    const t = this.countdown;
    textAlign(CENTER, CENTER);
    noStroke();
    let label = "";
    if (t > 3) label = "READY";
    else if (t > 2) label = "3";
    else if (t > 1) label = "2";
    else if (t > 0) label = "1";
    else label = "GO";
    fill(0, 0, 0, 135);
    rect(width * 0.5, height * 0.5, 280, 128, 7);
    fill(t < 0.4 ? color(90, 255, 120) : color(255, 230, 80));
    textSize(label.length > 2 ? 46 : 72);
    text(label, width * 0.5, height * 0.5);
  }

  drawFinishOverlay() {
    fill(0, 0, 0, 168);
    rect(width * 0.5, height * 0.5, 560, 270, 8);
    textAlign(CENTER, CENTER);
    noStroke();
    fill(this.objectiveComplete ? color(110, 245, 135) : color(255, 210, 85));
    textSize(42);
    text(this.objectiveComplete ? "GOAL COMPLETE" : "GOAL MISSED", width * 0.5, height * 0.5 - 82);
    fill(235);
    textSize(20);
    const pos = this.leaders.indexOf(this.player) + 1;
    const rawFinish = this.player.finishTime || this.raceTime;
    const penaltyText = this.penaltySeconds > 0 ? "  +" + this.penaltySeconds.toFixed(0) + "s PEN" : "";
    text("P" + pos + "  " + this.formatTime(rawFinish + this.penaltySeconds) + penaltyText, width * 0.5, height * 0.5 - 28);
    fill(255, 244, 185);
    textSize(26);
    text("SCORE " + this.score, width * 0.5, height * 0.5 + 20);
    fill(155, 175, 190);
    textSize(14);
    text("ENTER RESET  /  O OPTIONS", width * 0.5, height * 0.5 + 82);
  }

  drawOptionsMenu() {
    push();
    resetMatrix();
    fill(0, 0, 0, 105);
    rect(width * 0.5, height * 0.5, width, height);
    const w = Math.min(560, width - 36);
    const h = Math.min(520, height - 36);
    const x = width * 0.5 - w * 0.5;
    const y = height * 0.5 - h * 0.5;
    this.drawPanel(x, y, w, h, 236);
    textAlign(LEFT, TOP);
    noStroke();
    fill(255, 244, 185);
    textSize(24);
    text("RACE OPTIONS", x + 28, y + 24);
    fill(160, 178, 188);
    textSize(12);
    text("ARROWS CHANGE  /  V AUTODRIVE  /  1-5 WEATHER  /  O CLOSE", x + 28, y + 56);
    const items = this.menuItems();
    for (let i = 0; i < items.length; i += 1) {
      const rowY = y + 94 + i * 40;
      const active = i === this.menuIndex;
      fill(active ? color(255, 232, 92, 32) : color(255, 255, 255, 12));
      rectMode(CORNER);
      rect(x + 24, rowY - 8, w - 48, 36, 4);
      rectMode(CENTER);
      fill(active ? color(255, 235, 96) : color(232, 232, 220));
      textSize(16);
      text(items[i].label, x + 42, rowY);
      fill(active ? color(255, 255, 255) : color(170, 186, 194));
      textAlign(RIGHT, TOP);
      const value = items[i].value;
      text(value.length > 24 ? value.slice(0, 24) : value, x + w - 42, rowY);
      textAlign(LEFT, TOP);
    }
    const preset = this.weatherPresets[this.settings.weatherIndex];
    fill(130, 155, 165);
    textSize(13);
    const difficulty = this.currentDifficulty();
    text("AI: " + difficulty.note + ". Weather: " + preset.note + ".", x + 28, y + h - 66);
    fill(210, 220, 214);
    text("Autodrive smooths the route, brakes for corners, and holds passing lanes.", x + 28, y + h - 40);
    pop();
  }

  drawPause() {
    push();
    resetMatrix();
    fill(0, 0, 0, 150);
    rect(width * 0.5, height * 0.5, 300, 110, 8);
    fill(255, 240, 120);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(34);
    text("PAUSED", width * 0.5, height * 0.5);
    pop();
  }

  drawPostEffects() {
    push();
    resetMatrix();
    noFill();
    const speedPulse = this.player ? smoothStep(24, 50, this.player.speedMagnitude()) : 0;
    const vignette = drawingContext.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.24, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    const gloom = clamp(0.16 + this.weather.cloud * 0.30 + (1.18 - this.weather.light) * 0.30, 0.12, 0.52);
    vignette.addColorStop(1, "rgba(0,0,0," + (gloom + speedPulse * 0.10).toFixed(3) + ")");
    drawingContext.fillStyle = vignette;
    rectMode(CORNER);
    drawingContext.fillRect(0, 0, width, height);
    noStroke();
    fill(255, 255, 255, 10 + speedPulse * 8);
    for (let y = 0; y < height; y += 4) {
      rect(0, y, width, 1);
    }
    rectMode(CENTER);
    pop();
  }

  formatTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    const ms = Math.floor((safe - Math.floor(safe)) * 1000);
    return m + ":" + s.toString().padStart(2, "0") + "." + ms.toString().padStart(3, "0");
  }
}
`;

const generated = core.replace(/\n{3,}/g, "\n\n");
fs.writeFileSync(OUT, generated, "utf8");
const lines = generated.split("\n").length;
console.log(`Generated ${path.relative(ROOT, OUT)} with ${lines} lines.`);
