// Run with: npm test   (or: node --test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHand, GestureController, HandSmoother, OneEuro } from '../src/gestures.js';

// Build 21 synthetic landmarks for a hand at (cx, cy), fingers pointing up.
// fingers: { index, middle, ring, pinky } -> true (straight) / false (curled)
function makeHand({ cx = 400, cy = 500, s = 100, fingers = {}, spread = 0.12, pinch = false } = {}) {
  const p = new Array(21);
  const at = (x, y) => ({ x: cx + x * s, y: cy + y * s });
  p[0] = at(0, 0);
  const mcps = { index: [-0.3, -0.95], middle: [0, -1], ring: [0.25, -0.95], pinky: [0.48, -0.85] };
  const ids = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
  const splay = { index: -1.5, middle: -0.5, ring: 0.5, pinky: 1.5 };
  for (const name of Object.keys(mcps)) {
    const [mx, my] = mcps[name];
    const [a, b, c, d] = ids[name];
    p[a] = at(mx, my);
    const ang = splay[name] * spread;
    const ux = Math.sin(ang);
    const uy = -Math.cos(ang);
    if (fingers[name] !== false) {
      p[b] = at(mx + ux * 0.4, my + uy * 0.4);
      p[c] = at(mx + ux * 0.65, my + uy * 0.65);
      p[d] = at(mx + ux * 0.87, my + uy * 0.87);
    } else {
      p[b] = at(mx, my - 0.3);
      p[c] = at(mx, my - 0.1);
      p[d] = at(mx * 0.8, my * 0.7); // tucked toward the palm
    }
  }
  p[1] = at(-0.35, -0.25);
  p[2] = at(-0.55, -0.45);
  p[3] = at(-0.7, -0.65);
  p[4] = pinch ? { ...p[8] } : at(-0.8, -0.85);
  if (pinch) {
    // index bends toward the thumb, still reaching away from the wrist
    p[6] = at(-0.4, -1.25);
    p[7] = at(-0.5, -1.3);
    p[8] = at(-0.62, -1.25);
    p[4] = at(-0.6, -1.22);
  }
  return p;
}

const OPEN = { index: true, middle: true, ring: true, pinky: true };
const FIST = { index: false, middle: false, ring: false, pinky: false };
const POINT = { index: true, middle: false, ring: false, pinky: false };

test('recognises the basic poses', () => {
  assert.equal(analyzeHand(makeHand({ fingers: OPEN })).pose, 'open');
  assert.equal(analyzeHand(makeHand({ fingers: OPEN, spread: 0.45 })).pose, 'spread');
  assert.equal(analyzeHand(makeHand({ fingers: FIST })).pose, 'fist');
  assert.equal(analyzeHand(makeHand({ fingers: POINT })).pose, 'point');
  assert.equal(analyzeHand(makeHand({ fingers: { index: false, middle: true, ring: true, pinky: true }, pinch: true })).pose, 'pinch');
});

test('a fist is not mistaken for a pinch', () => {
  const h = analyzeHand(makeHand({ fingers: FIST }));
  assert.notEqual(h.pose, 'pinch');
});

test('moving an open hand rotates', () => {
  const c = new GestureController();
  const st = { zoom: 1, explode: 0, hoverPart: null, viewW: 1200 };
  c.update([analyzeHand(makeHand({ cx: 400, fingers: OPEN }))], 1 / 30, st);
  const out = c.update([analyzeHand(makeHand({ cx: 440, fingers: OPEN }))], 1 / 30, st);
  assert.equal(out.mode, 'open');
  assert.ok(out.rotate.y > 30, `expected rotation, got ${out.rotate.y}`);
});

test('holding a spread hand explodes once, holding a fist assembles', () => {
  const c = new GestureController({ holdTime: 0.3 });
  const st = { zoom: 1, explode: 0, hoverPart: null, viewW: 1200 };
  const spread = analyzeHand(makeHand({ fingers: OPEN, spread: 0.45 }));
  const fires = [];
  for (let i = 0; i < 20; i++) {
    const out = c.update([spread], 0.05, st);
    if (out.explode != null) fires.push(out.explode);
  }
  assert.deepEqual(fires, [1]);

  const fist = analyzeHand(makeHand({ fingers: FIST }));
  let assembled = null;
  for (let i = 0; i < 10; i++) {
    const out = c.update([fist], 0.05, st);
    if (out.explode != null) assembled = out.explode;
  }
  assert.equal(assembled, 0);
});

test('pinch and move up zooms in, down zooms out', () => {
  const c = new GestureController();
  const st = { zoom: 1, explode: 0, hoverPart: null, viewW: 1200 };
  const pinchAt = (cy) => analyzeHand(makeHand({ cy, fingers: { index: false, middle: true, ring: true, pinky: true }, pinch: true }));
  c.update([pinchAt(500)], 1 / 30, st);
  const up = c.update([pinchAt(420)], 1 / 30, st);
  assert.ok(up.zoom > 1.2, `zoom in, got ${up.zoom}`);
  const down = c.update([pinchAt(600)], 1 / 30, st);
  assert.ok(down.zoom < 1, `zoom out, got ${down.zoom}`);
});

test('pointing at the same part long enough selects it, once', () => {
  const c = new GestureController({ selectTime: 0.5 });
  const st = { zoom: 1, explode: 0, hoverPart: 3, viewW: 1200 };
  const point = analyzeHand(makeHand({ fingers: POINT }));
  const selections = [];
  for (let i = 0; i < 30; i++) {
    const out = c.update([point], 0.05, st);
    assert.ok(out.pointer, 'pointer is reported');
    if (out.select != null) selections.push(out.select);
  }
  assert.deepEqual(selections, [3]);
});

test('two open hands moving apart increase explode; two pinches zoom', () => {
  const c = new GestureController();
  const st = { zoom: 1, explode: 0.2, hoverPart: null, viewW: 1000 };
  const open = (cx) => analyzeHand(makeHand({ cx, fingers: OPEN }));
  c.update([open(400), open(600)], 1 / 30, st);
  const apart = c.update([open(300), open(700)], 1 / 30, st);
  assert.equal(apart.mode, 'two-explode');
  assert.ok(apart.explode > 0.6, `explode, got ${apart.explode}`);

  const pinch = (cx) => analyzeHand(makeHand({ cx, fingers: { index: false, middle: true, ring: true, pinky: true }, pinch: true }));
  c.update([pinch(400), pinch(600)], 1 / 30, st);
  const z = c.update([pinch(300), pinch(700)], 1 / 30, st);
  assert.equal(z.mode, 'two-zoom');
  assert.ok(Math.abs(z.zoom - 2) < 0.05, `zoom x2, got ${z.zoom}`);
});

test('losing the hand resets cleanly', () => {
  const c = new GestureController();
  const st = { zoom: 1, explode: 0, hoverPart: null, viewW: 1200 };
  c.update([analyzeHand(makeHand({ cx: 400, fingers: OPEN }))], 1 / 30, st);
  const none = c.update([], 1 / 30, st);
  assert.equal(none.mode, 'none');
  // Reappearing far away must not cause a big rotation jump.
  const back = c.update([analyzeHand(makeHand({ cx: 900, fingers: OPEN }))], 1 / 30, st);
  assert.equal(back.rotate.y, 0);
});

// ---------------------------------------------------------------- robustness

const ST = () => ({ zoom: 1, explode: 0, hoverPart: null, viewW: 1200 });

test('a one-frame pose flicker does not interrupt rotation', () => {
  const c = new GestureController();
  const st = ST();
  c.update([analyzeHand(makeHand({ cx: 400, fingers: OPEN }))], 1 / 30, st);
  c.update([analyzeHand(makeHand({ cx: 420, fingers: OPEN }))], 1 / 30, st);
  const glitch = c.update([analyzeHand(makeHand({ cx: 440, fingers: FIST }))], 1 / 30, st);
  assert.equal(glitch.mode, 'open', 'a single fist frame is ignored');
  const after = c.update([analyzeHand(makeHand({ cx: 460, fingers: OPEN }))], 1 / 30, st);
  assert.equal(after.mode, 'open');
  assert.ok(after.rotate.y > 10, `rotation continues, got ${after.rotate.y}`);
});

test('a held pose takes over after the switch time', () => {
  const c = new GestureController({ switchTime: 0.1 });
  const st = ST();
  c.update([analyzeHand(makeHand({ fingers: OPEN }))], 1 / 30, st);
  const modes = [];
  for (let i = 0; i < 5; i++) modes.push(c.update([analyzeHand(makeHand({ fingers: FIST }))], 1 / 30, st).mode);
  assert.deepEqual(modes, ['open', 'open', 'fist', 'fist', 'fist']);
});

test('a spread hand that keeps moving never explodes', () => {
  const c = new GestureController({ holdTime: 0.3 });
  const st = ST();
  let fired = false;
  for (let i = 0; i < 40; i++) {
    const out = c.update([analyzeHand(makeHand({ cx: 300 + i * 15, fingers: OPEN, spread: 0.45 }))], 1 / 30, st);
    if (out.explode != null) fired = true;
  }
  assert.equal(fired, false);
});

test('pointing survives a brief slip off the part', () => {
  const c = new GestureController({ selectTime: 0.5, hoverGrace: 0.3 });
  const point = analyzeHand(makeHand({ fingers: POINT }));
  const hovers = [2, 2, 2, null, null, 2, 2, 2, 2, 2, 2, 2, 2, 2];
  let selectedAt = -1;
  hovers.forEach((hp, i) => {
    const out = c.update([point], 0.05, { ...ST(), hoverPart: hp });
    if (out.select != null && selectedAt < 0) selectedAt = i;
  });
  // The first frame starts the timer, then 0.5 s at 0.05 s per frame = 10
  // more frames, plus the 2 paused ones: frame 12. Without the grace period
  // the timer would restart at frame 5 and select only at frame 15.
  assert.equal(selectedAt, 12);
});

test('pointing elsewhere for longer than the grace period restarts the timer', () => {
  const c = new GestureController({ selectTime: 0.5, hoverGrace: 0.1 });
  const point = analyzeHand(makeHand({ fingers: POINT }));
  const hovers = [2, 2, 2, 2, 5, 5, 5, 2, 2, 2];
  let selected = null;
  for (const hp of hovers) {
    const out = c.update([point], 0.05, { ...ST(), hoverPart: hp });
    if (out.select != null) selected = out.select;
  }
  assert.equal(selected, null);
});

test('a flick keeps spinning after the hand leaves, then slows to a stop', () => {
  const c = new GestureController({ friction: 3 });
  const st = ST();
  for (let i = 0; i < 6; i++) c.update([analyzeHand(makeHand({ cx: 300 + i * 30, fingers: OPEN }))], 1 / 30, st);
  const spins = [];
  for (let i = 0; i < 120; i++) spins.push(c.update([], 1 / 30, st).rotate.y);
  assert.ok(spins[0] > 10, `still spinning, got ${spins[0]}`);
  assert.ok(spins[10] < spins[0], 'slowing down');
  assert.equal(spins.at(-1), 0, 'stopped');
});

test('holding an open hand still stops the spin', () => {
  const c = new GestureController();
  const st = ST();
  for (let i = 0; i < 6; i++) c.update([analyzeHand(makeHand({ cx: 300 + i * 30, fingers: OPEN }))], 1 / 30, st);
  for (let i = 0; i < 15; i++) c.update([analyzeHand(makeHand({ cx: 450, fingers: OPEN }))], 1 / 30, st);
  const out = c.update([], 1 / 30, st);
  assert.equal(out.rotate.y, 0);
});

test('a small wobble while pinching does not change the zoom', () => {
  const c = new GestureController();
  const st = ST();
  const pinchAt = (cy) => analyzeHand(makeHand({ cy, fingers: { index: false, middle: true, ring: true, pinky: true }, pinch: true }));
  c.update([pinchAt(500)], 1 / 30, st);
  const out = c.update([pinchAt(504)], 1 / 30, st);
  assert.equal(out.zoom, 1);
});

// ---------------------------------------------------------------- smoother

test('the One-Euro filter calms jitter on a still point', () => {
  const f = new OneEuro();
  const raw = [];
  const out = [];
  for (let i = 0; i < 90; i++) {
    const x = 100 + (i % 2 ? 4 : -4); // ±4 px of jitter
    raw.push(x);
    out.push(f.filter(x, i / 30));
  }
  const spread = (a) => Math.max(...a.slice(30)) - Math.min(...a.slice(30));
  assert.ok(spread(out) < spread(raw) / 3, `filtered ${spread(out)} vs raw ${spread(raw)}`);
});

test('the One-Euro filter keeps up with fast movement', () => {
  const f = new OneEuro();
  let y = 0;
  for (let i = 0; i <= 30; i++) y = f.filter(i * 30, i / 30); // 900 px/s
  assert.ok(900 - y < 60, `lag ${900 - y}px`);
});

test('hands keep their identity when MediaPipe swaps their order', () => {
  const sm = new HandSmoother();
  const left = makeHand({ cx: 300 });
  const right = makeHand({ cx: 800 });
  sm.update([left, right], 0);
  const swapped = sm.update([right, left], 1 / 30);
  assert.ok(Math.abs(swapped[0].points[0].x - 300) < 1, 'left hand stays left');
  assert.ok(Math.abs(swapped[1].points[0].x - 800) < 1, 'right hand stays right');
});

test('a brief tracking dropout is bridged, a long one is not', () => {
  const sm = new HandSmoother({ grace: 0.15 });
  const hand = makeHand({ cx: 400 });
  sm.update([hand], 0);
  assert.equal(sm.update([], 0.1).length, 1, 'still there after 0.1 s');
  assert.equal(sm.update([], 0.3).length, 0, 'gone after 0.3 s');
});

// ---------------------------------------------------------------- 3D + recognizer

// Turn a flat synthetic hand into 3D "world" landmarks, rotated about the
// X axis (tilting the fingers toward the camera) by `tilt` radians.
function toWorld(points, { tilt = 0, cx = 400, cy = 500 } = {}) {
  return points.map((q) => {
    const x = q.x - cx;
    const y = q.y - cy;
    return { x, y: y * Math.cos(tilt), z: y * Math.sin(tilt) };
  });
}

// What the camera sees of that tilted hand: the depth is lost.
function project(world, { cx = 400, cy = 500 } = {}) {
  return world.map((q) => ({ x: q.x + cx, y: q.y + cy }));
}

test('a fist facing the camera reads as a fist, though the fingers look straight on screen', () => {
  const flat = makeHand({ fingers: OPEN });
  const world = toWorld(flat);
  // Each finger reaches toward the camera, then folds back toward the palm.
  // On screen the joints line up in a straight row, so a 2D check sees an open hand.
  for (const [m, a, b, t] of [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
    const k = world[m];
    world[a] = { x: k.x, y: k.y - 30, z: -30 };
    world[b] = { x: k.x, y: k.y - 40, z: 10 };
    world[t] = { x: k.x, y: k.y - 50, z: 40 };
  }
  const screen = project(world);
  assert.notEqual(analyzeHand(screen).pose, 'fist', 'the flat 2D view is fooled');
  assert.equal(analyzeHand({ points: screen, world }).pose, 'fist', 'the 3D view is not');
});

test('an open hand tilted away from the camera still reads as open', () => {
  const flat = makeHand({ fingers: OPEN });
  const world = toWorld(flat, { tilt: 1.1 });
  const h = analyzeHand({ points: project(world), world });
  assert.equal(h.pose, 'open');
});

test('a confident recognizer label decides fist, open palm and pointing', () => {
  const ambiguous = makeHand({ fingers: { index: true, middle: true, ring: false, pinky: false } });
  assert.equal(analyzeHand(ambiguous).pose, 'other');
  assert.equal(analyzeHand({ points: ambiguous, gesture: 'Closed_Fist', score: 0.9 }).pose, 'fist');
  assert.equal(analyzeHand({ points: ambiguous, gesture: 'Open_Palm', score: 0.9 }).pose, 'open');
  assert.equal(analyzeHand({ points: ambiguous, gesture: 'Pointing_Up', score: 0.9 }).pose, 'point');
});

test('an unsure recognizer label is ignored', () => {
  const open = makeHand({ fingers: OPEN });
  assert.equal(analyzeHand({ points: open, gesture: 'Closed_Fist', score: 0.3 }).pose, 'open');
});

test('pinch beats an open-palm label, but not a fist label', () => {
  const pinch = makeHand({ fingers: { index: false, middle: true, ring: true, pinky: true }, pinch: true });
  assert.equal(analyzeHand({ points: pinch, gesture: 'Open_Palm', score: 0.8 }).pose, 'pinch');
  assert.equal(analyzeHand({ points: pinch, gesture: 'Closed_Fist', score: 0.8 }).pose, 'fist');
});

test('letting go of a slow rotation does not keep it spinning', () => {
  const c = new GestureController();
  const st = ST();
  for (let i = 0; i < 6; i++) c.update([analyzeHand(makeHand({ cx: 300 + i * 4, fingers: OPEN }))], 1 / 30, st);
  const out = c.update([], 1 / 30, st);
  assert.equal(out.rotate.y, 0);
});

test('the smoother passes world landmarks and the gesture label through', () => {
  const sm = new HandSmoother();
  const points = makeHand({});
  const [h] = sm.update([{ points, world: toWorld(points), gesture: 'Open_Palm', score: 0.9 }], 0);
  assert.equal(h.gesture, 'Open_Palm');
  assert.equal(h.world.length, 21);
  assert.equal(analyzeHand(h).pose, 'open');
});
