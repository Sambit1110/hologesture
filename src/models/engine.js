// Turbofan jet engine, built from code. The engine's axis runs along X.
// Revolved profiles give the casings their real shape, and every blade is a
// curved, twisted airfoil rather than a flat plate.
import * as THREE from 'three';
import { Part, cylX, latheX, tube } from '../holo.js';

const C = {
  cyan: 0x3fd8ff, sky: 0x6fb7ff, blue: 0x4f8dff, orange: 0xff9b42,
  red: 0xff6a57, mint: 0x7dffcf, steel: 0x8fb4ff,
};

// Bladed parts stack hundreds of additive surfaces on top of each other,
// so they need much fainter materials than the rest or the core burns white.
const BLADES = { fill: 0.035, line: 0.32 };

// A twisted, cambered airfoil. Its span runs along +Y from the root; at zero
// twist the chord lies along X (the engine axis).
function bladeGeo({ len, chordRoot, chordTip, twistRoot, twistTip, camber = 0.1, sweep = 0 }) {
  const geo = new THREE.PlaneGeometry(1, 1, 4, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);          // -0.5 .. 0.5 across the chord
    const t = pos.getY(i) + 0.5;    // 0 at the root .. 1 at the tip
    const chord = chordRoot + (chordTip - chordRoot) * t;
    const tw = twistRoot + (twistTip - twistRoot) * t;
    const cx = u * chord;
    const cz = camber * chord * (1 - 4 * u * u);
    pos.setXYZ(i,
      cx * Math.cos(tw) - cz * Math.sin(tw) + sweep * t * t,
      t * len,
      cx * Math.sin(tw) + cz * Math.cos(tw));
  }
  geo.computeVertexNormals();
  return geo;
}

// A ring of identical blades around the X axis, roots at radius `hub`.
function bladeRing(part, { x, hub, count, phase = 0, parent, ...blade }) {
  const geo = bladeGeo(blade);
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    part.add(geo, { pos: [x, Math.cos(a) * hub, Math.sin(a) * hub], rot: [a, 0, 0], parent });
  }
}

// Compressor or turbine: discs with rotor blades, and fixed stator vanes
// between them. `dir` flips the twist for turbines.
function stages(part, { x0, x1, n, hub, tipFrom, tipTo, blades, chord, dir = 1, vanes = true }) {
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    const x = x0 + step * i;
    const tip = tipFrom + (tipTo - tipFrom) * f;
    part.add(cylX(hub, hub, 0.05, 36), { pos: [x, 0, 0] });
    bladeRing(part, {
      x, hub, count: blades, phase: i * 0.2, len: tip - hub,
      chordRoot: chord, chordTip: chord * 0.8, twistRoot: dir * 0.55, twistTip: dir * 0.95, camber: 0.12,
    });
    if (vanes && i < n - 1) {
      bladeRing(part, {
        x: x + step / 2, hub, count: Math.round(blades * 0.8), len: tip - hub, parent: part.group, // stators don't spin
        chordRoot: chord * 0.7, chordTip: chord * 0.7, twistRoot: -dir * 0.35, twistTip: -dir * 0.35, camber: 0.08,
      });
    }
  }
}

export function buildEngine() {
  const root = new THREE.Group();
  const parts = [];
  const P = (name, desc, color, opts) => {
    const p = new Part(name, desc, color, opts);
    parts.push(p);
    root.add(p.group);
    return p;
  };

  const fan = P('Fan', 'The giant front fan pulls in air. Most of it flows around the core and produces most of the thrust in a modern turbofan.',
    C.cyan, { base: [-2.45, 0, 0], dir: [-1, 0, 0], dist: 2.1, anchor: [0, 1.0, 0], ...BLADES });
  // Spinner: a smooth nose cone, with the hub behind it.
  fan.add(latheX([[0, -0.78], [0.1, -0.72], [0.2, -0.6], [0.29, -0.42], [0.35, -0.22], [0.38, 0], [0.38, 0.16], [0, 0.16]]), { threshold: 30 });
  bladeRing(fan, {
    x: 0.02, hub: 0.36, count: 22, len: 0.74,
    chordRoot: 0.2, chordTip: 0.34, twistRoot: 0.35, twistTip: 1.15, camber: 0.14, sweep: 0.08,
  });

  const lpc = P('Low-pressure compressor', 'The first set of compressor stages. It squeezes the air entering the engine core.',
    C.sky, { base: [-1.63, 0, 0], dir: [-1, 0, 0], dist: 1.4, anchor: [0, 0.85, 0], ...BLADES });
  stages(lpc, { x0: -0.27, x1: 0.27, n: 3, hub: 0.44, tipFrom: 0.78, tipTo: 0.7, blades: 18, chord: 0.12 });

  const hpc = P('High-pressure compressor', 'Smaller, faster stages that squeeze the air even more, up to about 40 times atmospheric pressure in modern engines.',
    C.blue, { base: [-0.78, 0, 0], dir: [-1, 0, 0], dist: 0.7, anchor: [0, 0.7, 0], ...BLADES });
  stages(hpc, { x0: -0.33, x1: 0.33, n: 5, hub: 0.36, tipFrom: 0.62, tipTo: 0.5, blades: 20, chord: 0.08 });
  // The drum the stages sit in narrows toward the combustor.
  hpc.add(latheX([[0.64, -0.4], [0.52, 0.4]], 40), { edges: false });

  const comb = P('Combustion chamber', 'Fuel is sprayed into the compressed air and burned, creating hot, fast-expanding gas.',
    C.orange, { base: [0.08, 0, 0], anchor: [0, 0.72, 0], fill: 0.08 });
  // Annular liner: outer and inner walls with a domed front.
  comb.add(latheX([[0.5, -0.42], [0.6, -0.36], [0.66, -0.2], [0.66, 0.24], [0.58, 0.42]], 48), { threshold: 15 });
  comb.add(latheX([[0.44, -0.42], [0.36, -0.34], [0.33, -0.2], [0.33, 0.24], [0.38, 0.42]], 40), { threshold: 15 });
  // Fuel nozzles curving in from the outside, plus two igniters.
  const nozzle = tube([[-0.62, 0.86, 0], [-0.55, 0.7, 0], [-0.45, 0.52, 0]], 0.025, 12, 6);
  for (let i = 0; i < 16; i++) comb.add(nozzle, { rot: [(i / 16) * Math.PI * 2, 0, 0], threshold: 40 });
  for (const a of [0.6, Math.PI + 0.6]) comb.add(cylX(0.02, 0.02, 0.3, 8).rotateZ(Math.PI / 2), { pos: [-0.05, Math.cos(a) * 0.78, Math.sin(a) * 0.78], rot: [a, 0, 0] });

  const hpt = P('High-pressure turbine', 'The hot gas spins this turbine, which drives the high-pressure compressor through the shaft.',
    C.red, { base: [0.78, 0, 0], dir: [1, 0, 0], dist: 0.6, anchor: [0, 0.68, 0], ...BLADES });
  stages(hpt, { x0: -0.1, x1: 0.1, n: 2, hub: 0.36, tipFrom: 0.6, tipTo: 0.62, blades: 24, chord: 0.1, dir: -1 });

  const lpt = P('Low-pressure turbine', 'Extracts more energy from the gas to drive the fan and low-pressure compressor.',
    C.orange, { base: [1.38, 0, 0], dir: [1, 0, 0], dist: 1.2, anchor: [0, 0.9, 0], ...BLADES });
  stages(lpt, { x0: -0.24, x1: 0.24, n: 4, hub: 0.4, tipFrom: 0.66, tipTo: 0.82, blades: 22, chord: 0.1, dir: -1 });

  const noz = P('Exhaust nozzle', 'Shapes the hot exhaust into a high-speed jet, adding the rest of the thrust.',
    C.cyan, { base: [2.3, 0, 0], dir: [1, 0, 0], dist: 1.9, anchor: [0, 0.9, 0], fill: 0.07 });
  noz.add(latheX([[0.84, -0.45], [0.86, -0.2], [0.8, 0.2], [0.68, 0.48]], 48), { threshold: 12 });
  // Tail cone (plug) in the middle of the jet.
  noz.add(latheX([[0.42, -0.45], [0.42, -0.2], [0.34, 0.1], [0.18, 0.42], [0.02, 0.62], [0, 0.62]], 40), { threshold: 18 });

  const shaft = P('Shaft', 'Two shafts, one inside the other: the inner one links the low-pressure turbine to the fan, the outer one links the high-pressure turbine to its compressor.',
    C.mint, { base: [-0.15, 0, 0], dir: [0, -1, 0], dist: 1.6, anchor: [1.2, 0, 0], fill: 0.06, line: 0.3 });
  shaft.add(cylX(0.05, 0.05, 4.9, 12));
  shaft.add(cylX(0.11, 0.11, 2.0, 20), { pos: [0.15, 0, 0] });
  for (const x of [-2.1, -0.9, 0.9, 2.0]) shaft.add(cylX(0.15, 0.15, 0.06, 20), { pos: [x, 0, 0] }); // bearings

  const casing = P('Casing (nacelle)', 'The streamlined outer shell, with a rounded intake lip. It guides air into the fan and around the core, and reduces noise. The inner core cowl and its struts split off the bypass air.',
    C.steel, { base: [-0.15, 0, 0], dir: [0, 1, 0], dist: 2.0, anchor: [0, 1.5, 0], fill: 0.03, line: 0.45, pickPenalty: 3 });
  // Nacelle cross-section, revolved: inner wall, rounded lip, outer skin.
  casing.add(latheX([
    [1.12, 2.3], [1.13, 0.2], [1.12, -1.6], [1.14, -2.35], [1.19, -2.66], [1.27, -2.8],
    [1.36, -2.78], [1.43, -2.62], [1.47, -2.2], [1.47, -1.0], [1.4, 0.8], [1.24, 2.0], [1.16, 2.3],
  ], 64), { threshold: 14 });
  // Core cowl around the compressors and turbines.
  casing.add(latheX([[0.66, -1.95], [0.8, -1.5], [0.86, -0.6], [0.86, 0.9], [0.8, 1.7], [0.72, 2.3]], 48), { threshold: 14 });
  // Struts from the core cowl out to the nacelle, behind the fan.
  const strut = new THREE.BoxGeometry(0.16, 0.3, 0.035);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    casing.add(strut, { pos: [-1.75, Math.cos(a) * 0.98, Math.sin(a) * 0.98], rot: [a, 0, 0] });
  }

  const spinning = [[fan, 2.2], [lpc, 2.2], [hpc, 4.5], [hpt, 4.5], [lpt, 2.2]];

  return {
    title: 'Jet Engine',
    subtitle: 'Turbofan, the type that powers most airliners',
    root,
    parts,
    labelMode: 'alternate',
    defaultRotation: [0.25, -0.55],
    defaultZoom: 0.88,
    defaultExplode: 0,
    update(t, dt) {
      for (const [p, speed] of spinning) p.spin.rotation.x += dt * speed;
    },
  };
}
