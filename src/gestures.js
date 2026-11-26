// Gesture recognition. Pure logic: no DOM and no Three.js, so it can be
// unit-tested in Node. All points are screen pixels, already mirrored.

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// 3D helpers. Points without z are treated as flat (z = 0).
const sub3 = (a, b) => ({ x: b.x - a.x, y: b.y - a.y, z: (b.z ?? 0) - (a.z ?? 0) });
const len3 = (v) => Math.hypot(v.x, v.y, v.z);
const dist3 = (a, b) => len3(sub3(a, b));
const angle = (u, v) => {
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / ((len3(u) * len3(v)) || 1);
  return (Math.acos(clamp(d, -1, 1)) * 180) / Math.PI;
};

const FINGERS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
const RECOGNIZER_MIN_SCORE = 0.55;

// Describe one hand. Accepts either 21 screen points, or
// { points, world, gesture, score } where `world` holds MediaPipe's 3D world
// landmarks and `gesture` its trained gesture label for this hand.
//
// Fingers are judged by how much their joints bend in 3D, which works however
// the hand is turned or tilted and however far it is from the camera. The
// trained recognizer's label, when confident, settles fist / open / point.
export function analyzeHand(input) {
  const hand = Array.isArray(input) ? { points: input } : input;
  const p = hand.points;
  const W = hand.world || p.map((q) => ({ x: q.x, y: q.y, z: 0 }));
  const size = dist3(W[0], W[9]) || 1;           // wrist -> middle knuckle, 3D
  const scale = dist(p[0], p[9]) || 1;           // same, in screen pixels

  const bend = {};
  const fingers = {};
  const curled = {};
  for (const [name, [m, a, b, t]] of Object.entries(FINGERS)) {
    const knuckle = angle(sub3(W[0], W[m]), sub3(W[m], W[a]));
    const joints = angle(sub3(W[m], W[a]), sub3(W[a], W[b])) + angle(sub3(W[a], W[b]), sub3(W[b], W[t]));
    bend[name] = Math.round(knuckle + joints);
    fingers[name] = joints < 70 && knuckle < 70;
    curled[name] = joints > 100 || (knuckle > 50 && joints > 60);
  }
  const count = Object.values(fingers).filter(Boolean).length;
  const curledCount = Object.values(curled).filter(Boolean).length;

  const pinch = dist3(W[4], W[8]) / size;          // thumb tip to index tip
  const indexReach = dist3(W[8], W[0]) / size;
  const dir = (f) => sub3(W[FINGERS[f][0]], W[FINGERS[f][3]]);
  // Average angle between neighbouring extended fingers (0 if fewer than two pairs).
  const pairs = [['index', 'middle'], ['middle', 'ring'], ['ring', 'pinky']].filter(([a, b]) => fingers[a] && fingers[b]);
  const spread = pairs.length >= 2 ? pairs.reduce((s, [a, b]) => s + angle(dir(a), dir(b)), 0) / pairs.length : 0;

  const palmIds = [0, 5, 9, 13, 17];
  const palm = {
    x: palmIds.reduce((s, i) => s + p[i].x, 0) / palmIds.length,
    y: palmIds.reduce((s, i) => s + p[i].y, 0) / palmIds.length,
  };

  const label = (hand.score ?? 0) >= RECOGNIZER_MIN_SCORE ? hand.gesture : null;
  const isPinch = pinch < 0.35 && indexReach > 1.0 && !curled.index;
  const openPose = () => (spread > 16 ? 'spread' : 'open');

  let pose;
  if (label === 'Closed_Fist') pose = 'fist';
  else if (isPinch) pose = 'pinch';
  else if (label === 'Pointing_Up') pose = 'point';
  else if (label === 'Open_Palm') pose = openPose();
  else if (curledCount === 4) pose = 'fist';
  else if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) pose = 'point';
  else if (count >= 4) pose = openPose();
  else if (count >= 3) pose = 'open';
  else pose = 'other';

  return {
    points: p, scale, size, fingers, curled, bend, count, pinch, spread, indexReach, palm,
    tip: p[8], thumb: p[4], pose, label: hand.gesture ?? null, labelScore: hand.score ?? 0,
  };
}

const isOpen = (h) => h.pose === 'open' || h.pose === 'spread';

export const POSE_LABELS = {
  open: 'Rotate',
  spread: 'Explode',
  fist: 'Assemble',
  pinch: 'Zoom',
  point: 'Select',
  other: '',
  'two-explode': 'Two hands: Explode',
  'two-zoom': 'Two hands: Zoom',
};

// ---------------------------------------------------------------- smoothing

// One-Euro filter (Casiez et al. 2012): heavy smoothing when the signal is
// still, light smoothing when it moves fast. Kills jitter without adding lag.
export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.015, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    if (this.x == null || this.t == null || t <= this.t) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = t - this.t;
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}

// Keeps each physical hand on its own track between frames (MediaPipe returns
// hands in no fixed order), smooths every landmark, and bridges brief
// tracking dropouts so a single missed frame doesn't reset a gesture.
export class HandSmoother {
  constructor({ grace = 0.15, ...filterOpts } = {}) {
    this.grace = grace;
    this.filterOpts = filterOpts;
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  #newTrack(hand, t) {
    const mk = () => new OneEuro(this.filterOpts);
    return {
      id: this.nextId++,
      filters: hand.points.map(() => [mk(), mk()]),
      worldFilters: hand.world ? hand.world.map(() => [mk(), mk(), mk()]) : null,
      hand: null,
      lastSeen: t,
    };
  }

  #smooth(track, hand, t) {
    const points = hand.points.map((q, i) => ({
      x: track.filters[i][0].filter(q.x, t),
      y: track.filters[i][1].filter(q.y, t),
    }));
    let world = null;
    if (hand.world) {
      if (!track.worldFilters) track.worldFilters = hand.world.map(() => [0, 0, 0].map(() => new OneEuro(this.filterOpts)));
      world = hand.world.map((q, i) => ({
        x: track.worldFilters[i][0].filter(q.x, t),
        y: track.worldFilters[i][1].filter(q.y, t),
        z: track.worldFilters[i][2].filter(q.z ?? 0, t),
      }));
    }
    track.hand = { points, world, gesture: hand.gesture ?? null, score: hand.score ?? 0 };
    track.lastSeen = t;
  }

  #resetFilters(track) {
    track.filters.forEach((f) => f.forEach((x) => x.reset()));
    track.worldFilters?.forEach((f) => f.forEach((x) => x.reset()));
  }

  // hands: either arrays of 21 {x, y} screen points, or objects
  // { points, world?, gesture?, score? }. World landmarks should be in
  // millimetres so one set of filter settings suits both. t: seconds.
  // Returns smoothed hands as objects, ordered left to right on screen.
  update(hands, t) {
    const input = hands.map((h) => (Array.isArray(h) ? { points: h } : h));
    const free = [...this.tracks];
    const pairs = [];
    for (const [i, h] of input.entries()) {
      for (const tr of free) pairs.push({ i, tr, d: dist(h.points[0], tr.hand.points[0]) });
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedHands = new Set();
    const usedTracks = new Set();
    for (const { i, tr } of pairs) {
      if (usedHands.has(i) || usedTracks.has(tr)) continue;
      usedHands.add(i);
      usedTracks.add(tr);
      if (t - tr.lastSeen > this.grace) this.#resetFilters(tr);
      this.#smooth(tr, input[i], t);
    }
    for (const [i, h] of input.entries()) {
      if (usedHands.has(i)) continue;
      const tr = this.#newTrack(h, t);
      this.#smooth(tr, h, t);
      this.tracks.push(tr);
    }
    // Drop tracks that have been missing for longer than the grace period.
    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= this.grace);
    return this.tracks
      .slice()
      .sort((a, b) => a.hand.points[0].x - b.hand.points[0].x)
      .map((tr) => tr.hand);
  }
}

// ---------------------------------------------------------------- gestures

// Turns a stream of analysed hands into app actions.
export class GestureController {
  constructor(opts = {}) {
    this.holdTime = opts.holdTime ?? 0.5;       // seconds to hold spread / fist still
    this.selectTime = opts.selectTime ?? 0.7;   // seconds to point at a part
    this.zoomSpeed = opts.zoomSpeed ?? null;   // per px; default scales with the view height
    this.switchTime = opts.switchTime ?? 0.1;   // a new pose must last this long to count
    this.stillSpeed = opts.stillSpeed ?? 1.5;   // hand-sizes per second that still counts as "still"
    this.hoverGrace = opts.hoverGrace ?? 0.3;   // pointer can slip off a part this long
    this.friction = opts.friction ?? 5;         // how fast rotation momentum fades
    this.minFlick = opts.minFlick ?? 400;      // px/s a hand must be moving to keep spinning after
    this.reset();
  }

  reset() {
    this.#resetHand();
    this.two = null;
    this.vel = { x: 0, y: 0 };
    this.coasting = false;
    this.#resetHover();
  }

  #resetHand() {
    this.pose = null;          // the stable pose actions are based on
    this.candidate = null;     // a different pose waiting to be confirmed
    this.candidateT = 0;
    this.prevPalm = null;
    this.prevPose = null;
    this.speed = 0;
    this.holdT = 0;
    this.fired = false;
    this.pinchStart = null;
  }

  // state: { zoom, explode, hoverPart, viewW, viewH }
  update(hands, dt, state) {
    const out = {
      rotate: { x: 0, y: 0 },
      zoom: null,
      explode: null,
      pointer: null,
      pinchPoint: null,
      select: null,
      mode: 'none',
      progress: 0,
    };

    if (hands.length >= 2 && this.#twoHands(hands, state, out)) {
      this.#resetHand();
      this.vel = { x: 0, y: 0 };
      this.coasting = false;
      return out;
    }
    this.two = null;

    if (hands.length === 0) {
      this.#resetHand();
      this.#resetHover();
      this.#coast(dt, out);
      return out;
    }

    this.#oneHand(hands[0], dt, state, out);
    return out;
  }

  // Keep spinning after a flick, slowing down.
  #coast(dt, out) {
    if (!this.coasting) {
      // Only a real flick keeps spinning; slowly letting go just stops.
      if (Math.hypot(this.vel.x, this.vel.y) < this.minFlick) {
        this.vel = { x: 0, y: 0 };
        return;
      }
      this.coasting = true;
    }
    const decay = Math.exp(-this.friction * dt);
    this.vel.x *= decay;
    this.vel.y *= decay;
    if (Math.hypot(this.vel.x, this.vel.y) < 5) {
      this.vel = { x: 0, y: 0 };
      this.coasting = false;
      return;
    }
    out.rotate.x = this.vel.x * dt;
    out.rotate.y = this.vel.y * dt;
  }

  // Ignore single-frame pose flickers: a new pose has to persist briefly.
  #stabilize(raw, dt) {
    if (this.pose == null || raw === this.pose) {
      this.pose = raw;
      this.candidate = null;
      return this.pose;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateT = 0;
    }
    this.candidateT += dt;
    if (this.candidateT >= this.switchTime - 1e-9) {
      this.pose = raw;
      this.candidate = null;
    }
    return this.pose;
  }

  #twoHands([a, b], state, out) {
    const D = dist(a.palm, b.palm);
    let kind = null;
    if (isOpen(a) && isOpen(b)) kind = 'explode';
    else if (a.pose === 'pinch' && b.pose === 'pinch') kind = 'zoom';
    if (!kind) return false;

    if (!this.two || this.two.kind !== kind) {
      this.two = { kind, D0: Math.max(D, 1), e0: state.explode, z0: state.zoom };
    }
    if (kind === 'explode') {
      const range = (state.viewW || 1200) * 0.45;
      out.explode = clamp(this.two.e0 + (D - this.two.D0) / range, 0, 1);
      out.mode = 'two-explode';
    } else {
      out.zoom = this.two.z0 * (D / this.two.D0);
      out.mode = 'two-zoom';
    }
    this.#resetHover();
    return true;
  }

  #oneHand(h, dt, state, out) {
    let raw = h.pose;
    // Hysteresis: keep a pinch until the fingers clearly separate.
    if (this.pose === 'pinch' && raw !== 'pinch' && raw !== 'fist' && h.pinch < 0.5 && h.indexReach > 1.0) raw = 'pinch';
    const prevStable = this.pose;
    const pose = this.#stabilize(raw, dt);

    // Palm speed in hand-sizes per second, lightly smoothed.
    if (this.prevPalm) {
      const v = dist(h.palm, this.prevPalm) / Math.max(dt, 1e-3) / h.scale;
      this.speed += (v - this.speed) * 0.4;
    }

    if (pose !== prevStable) {
      this.holdT = 0;
      this.fired = false;
    }

    // Rotate: move an open hand. Momentum builds while it moves.
    if (isOpen({ pose })) {
      this.coasting = false;
      if (this.prevPalm && isOpen({ pose: this.prevPose })) {
        const dx = h.palm.x - this.prevPalm.x;
        const dy = h.palm.y - this.prevPalm.y;
        const moving = Math.hypot(dx, dy) > 1.5;
        if (moving) {
          out.rotate.x = dy;
          out.rotate.y = dx;
        }
        const k = 0.35;
        this.vel.x += ((moving ? dy / dt : 0) - this.vel.x) * k;
        this.vel.y += ((moving ? dx / dt : 0) - this.vel.y) * k;
      }
    } else if (pose === 'other') {
      this.#coast(dt, out); // relaxing the hand mid-flick lets it keep spinning
    } else {
      this.vel = { x: 0, y: 0 }; // any deliberate gesture stops the spin
      this.coasting = false;
    }

    // Explode / assemble: hold the pose still, so a moving hand never fires it.
    if (pose === 'spread' || pose === 'fist') {
      if (this.speed < this.stillSpeed) this.holdT += dt;
      out.progress = clamp(this.holdT / this.holdTime, 0, 1);
      if (this.holdT >= this.holdTime - 1e-9 && !this.fired) {
        out.explode = pose === 'spread' ? 1 : 0;
        this.fired = true;
      }
    }

    // Zoom: pinch and move up (zoom in) or down (zoom out).
    if (pose === 'pinch') {
      const m = mid(h.thumb, h.tip);
      if (!this.pinchStart) this.pinchStart = { y: m.y, zoom: state.zoom };
      const dy = m.y - this.pinchStart.y;
      const dead = 6; // px, so closing the pinch doesn't nudge the zoom
      const eff = Math.abs(dy) < dead ? 0 : dy - Math.sign(dy) * dead;
      const k = this.zoomSpeed ?? 1 / (0.3 * (state.viewH || 800)); // 30% of the view height ~ x2.7
      out.zoom = this.pinchStart.zoom * Math.exp(-eff * k);
      out.pinchPoint = m;
    } else {
      this.pinchStart = null;
    }

    // Point: highlight, and select after holding on the same part. The
    // pointer may slip off briefly without losing progress.
    if (pose === 'point') {
      out.pointer = { x: h.tip.x, y: h.tip.y };
      const hp = state.hoverPart;
      if (hp != null && hp === this.hoverPart) {
        this.missT = 0;
        this.hoverT += dt;
        if (this.hoverT >= this.selectTime - 1e-9 && !this.selectFired) {
          out.select = hp;
          this.selectFired = true;
        }
      } else if (this.hoverPart != null && this.missT + dt < this.hoverGrace) {
        this.missT += dt; // paused, not reset
      } else {
        this.hoverPart = hp;
        this.hoverT = 0;
        this.missT = 0;
        this.selectFired = false;
      }
      out.progress = this.hoverPart != null ? clamp(this.hoverT / this.selectTime, 0, 1) : 0;
    } else {
      this.#resetHover();
    }

    out.mode = pose;
    this.prevPalm = h.palm;
    this.prevPose = pose;
  }

  #resetHover() {
    this.hoverPart = null;
    this.hoverT = 0;
    this.missT = 0;
    this.selectFired = false;
  }
}
