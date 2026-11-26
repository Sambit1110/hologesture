// Stylised human heart, front view. The patient's right side is on the
// viewer's left. Blue = oxygen-poor blood, red = oxygen-rich blood.
// Chambers are organic shapes (tapering ventricles, atria with their
// appendages) drawn with holographic contour lines.
import * as THREE from 'three';
import { Part, tube, organic, contourLines } from '../holo.js';

const BLUE = 0x4da3ff;
const RED = 0xff4d6d;
const CORONARY = 0xffa24a;

// Rotate a point about the Z axis.
const rotZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
// A smooth bump in direction (ax, ay, az): 1 straight on, fading to 0 at the side.
const bump = (x, y, z, [ax, ay, az], sharp = 4) => Math.pow(Math.max(0, (x * ax + y * ay + z * az) / Math.hypot(ax, ay, az)), sharp);

// Ventricle: an egg that narrows to an apex at the bottom, tilted by `tilt`.
const ventricle = ({ w, h, d, tilt, flatBack = 1 }) => (x, y, z) => {
  const taper = y < 0 ? 1 - 0.62 * Math.pow(-y, 1.5) : 1 - 0.08 * y * y;
  const zz = z < 0 ? z * flatBack : z; // the right ventricle hugs the left one
  return rotZ([x * w * taper, y * h - (y < 0 ? 0.12 * y * y : 0), zz * d * taper], tilt);
};

// Atrium: a rounded sac with its ear-shaped appendage (auricle).
const atrium = ({ w, h, d, ear }) => (x, y, z) => {
  const k = 1 + 0.45 * bump(x, y, z, ear, 6);
  return [x * w * k, y * h * k, z * d * k];
};

export function buildHeart() {
  const root = new THREE.Group();
  root.position.y = -0.35;
  const parts = [];
  const P = (name, desc, color, opts) => {
    const p = new Part(name, desc, color, opts);
    parts.push(p);
    root.add(p.group);
    return p;
  };
  // Filled surface plus contour lines slightly outside it.
  const chamber = (part, shape, pos) => {
    part.add(organic(shape), { pos, edges: false });
    part.lines(contourLines((x, y, z) => shape(x, y, z).map((v) => v * 1.015), 8, 12), { pos });
  };

  const ra = P('Right atrium', 'Receives oxygen-poor blood returning from the body through the venae cavae.',
    BLUE, { base: [-0.75, 0.55, 0.05], dir: [-1, 0.25, 0.2], dist: 1.1, anchor: [-0.35, 0.3, 0], fill: 0.1, line: 0.6 });
  chamber(ra, atrium({ w: 0.48, h: 0.52, d: 0.44, ear: [0.4, 0.5, 0.75] }));

  const rv = P('Right ventricle', 'Pumps oxygen-poor blood through the pulmonary artery to the lungs.',
    BLUE, { base: [-0.28, -0.42, 0.28], dir: [-0.6, -0.8, 0.5], dist: 1.1, anchor: [-0.3, -0.5, 0.25], fill: 0.1, line: 0.6 });
  chamber(rv, ventricle({ w: 0.56, h: 0.72, d: 0.5, tilt: -0.3, flatBack: 0.35 }));

  const la = P('Left atrium', 'Receives oxygen-rich blood from the lungs through the pulmonary veins.',
    RED, { base: [0.55, 0.68, -0.35], dir: [1, 0.35, -0.3], dist: 1.1, anchor: [0.35, 0.3, 0], fill: 0.1, line: 0.6 });
  chamber(la, atrium({ w: 0.5, h: 0.42, d: 0.42, ear: [-0.55, 0.35, 0.75] }));

  const lv = P('Left ventricle', 'The strongest chamber. Its thick muscular wall pumps oxygen-rich blood into the aorta and out to the whole body.',
    RED, { base: [0.38, -0.55, -0.08], dir: [0.7, -0.8, -0.1], dist: 1.1, anchor: [0.4, -0.65, 0], fill: 0.1, line: 0.6 });
  chamber(lv, ventricle({ w: 0.62, h: 0.95, d: 0.58, tilt: 0.42 }));

  const aorta = P('Aorta', "The body's largest artery. It carries oxygen-rich blood from the left ventricle to the rest of the body.",
    RED, { dir: [0.2, 1, -0.2], dist: 1.0, anchor: [0.35, 1.85, -0.1], fill: 0.2 });
  aorta.add(tube([[0.1, 0.25, 0], [0.05, 1.3, 0.05], [0.35, 1.85, -0.1], [0.85, 1.6, -0.4], [0.95, 0.6, -0.6], [0.95, -0.7, -0.6]], 0.16), { threshold: 25 });
  for (const [x, z] of [[0.15, 0.0], [0.4, -0.12], [0.62, -0.25]]) {
    aorta.add(tube([[x, 1.75, z], [x - 0.02, 2.25, z]], 0.06, 8, 8), { threshold: 25 });
  }

  const pa = P('Pulmonary artery', 'Carries oxygen-poor blood from the right ventricle to both lungs. Unusually for an artery, its blood is oxygen-poor.',
    BLUE, { dir: [0, 0.5, 1], dist: 1.0, anchor: [0, 1.15, 0.45], fill: 0.2 });
  pa.add(tube([[-0.15, 0.15, 0.4], [-0.05, 0.75, 0.5], [0.0, 1.1, 0.45]], 0.15, 24), { threshold: 25 });
  pa.add(tube([[0.0, 1.1, 0.45], [0.4, 1.25, 0.3], [0.85, 1.15, 0.1]], 0.1, 24), { threshold: 25 });
  pa.add(tube([[0.0, 1.1, 0.45], [-0.35, 1.2, 0.3], [-0.65, 1.05, 0.15]], 0.1, 24), { threshold: 25 });

  const svc = P('Superior vena cava', 'Brings oxygen-poor blood from the head, neck and arms back to the right atrium.',
    BLUE, { dir: [-1, 1, 0], dist: 1.0, anchor: [-0.85, 1.6, 0], fill: 0.2 });
  svc.add(tube([[-0.85, 2.0, 0.0], [-0.83, 1.4, 0.02], [-0.78, 0.85, 0.05]], 0.13, 16), { threshold: 25 });

  const ivc = P('Inferior vena cava', 'Brings oxygen-poor blood from the lower body back to the right atrium.',
    BLUE, { dir: [-1, -1, 0], dist: 1.0, anchor: [-0.75, -0.9, -0.15], fill: 0.2 });
  ivc.add(tube([[-0.78, 0.25, -0.05], [-0.75, -0.5, -0.15], [-0.72, -1.4, -0.2]], 0.14, 16), { threshold: 25 });

  const pv = P('Pulmonary veins', 'Carry fresh, oxygen-rich blood from the lungs into the left atrium.',
    RED, { dir: [1, 0, -1], dist: 1.0, anchor: [1.3, 0.95, -0.4], fill: 0.2 });
  pv.add(tube([[1.45, 0.95, -0.35], [1.1, 0.85, -0.38], [0.85, 0.78, -0.36]], 0.07, 12, 8), { threshold: 25 });
  pv.add(tube([[1.45, 0.45, -0.35], [1.1, 0.55, -0.38], [0.85, 0.6, -0.36]], 0.07, 12, 8), { threshold: 25 });
  pv.add(tube([[-0.2, 0.95, -0.95], [0.1, 0.85, -0.7], [0.35, 0.78, -0.5]], 0.07, 12, 8), { threshold: 25 });
  pv.add(tube([[-0.2, 0.45, -0.95], [0.1, 0.55, -0.7], [0.35, 0.6, -0.5]], 0.07, 12, 8), { threshold: 25 });

  const cor = P('Coronary arteries', "The heart's own blood supply. These small arteries branch off the base of the aorta and wrap around the heart to feed its muscle. A blockage here causes a heart attack.",
    CORONARY, { dir: [0, 0, 1], dist: 1.0, anchor: [0.3, -0.4, 0.6], fill: 0.1, line: 0.42 });
  const vessel = (pts, r = 0.026) => cor.add(tube(pts, r, 40, 6), { threshold: 30 });
  vessel([[0.12, 0.45, 0.32], [0.18, 0.2, 0.52], [0.22, -0.25, 0.6], [0.35, -0.75, 0.45], [0.55, -1.15, 0.12]]);   // left anterior descending
  vessel([[0.2, 0.25, 0.5], [0.45, 0.0, 0.5], [0.65, -0.35, 0.4]], 0.018);                                            // diagonal branch
  vessel([[0.12, 0.45, 0.32], [0.5, 0.38, 0.28], [0.85, 0.12, -0.05], [0.88, -0.15, -0.42]]);                        // circumflex
  vessel([[-0.02, 0.45, 0.35], [-0.45, 0.22, 0.6], [-0.85, -0.1, 0.42], [-0.82, -0.55, 0.0], [-0.4, -0.95, -0.15]]); // right coronary
  vessel([[-0.85, -0.1, 0.42], [-0.55, -0.45, 0.62], [-0.2, -0.8, 0.55]], 0.018);                                     // marginal branch

  const beat = (t, offset) => {
    const s = Math.sin((t * 1.2 + offset) * Math.PI * 2);
    return Math.pow(Math.max(0, s), 3);
  };

  return {
    title: 'Human Heart',
    subtitle: 'Stylised model. Blue: oxygen-poor blood, red: oxygen-rich',
    root,
    parts,
    labelMode: 'radial',
    defaultRotation: [0.1, 0.35],
    defaultZoom: 1.0,
    defaultExplode: 0,
    update(t) {
      const atria = 1 + 0.05 * beat(t, 0);
      const ventricles = 1 + 0.06 * beat(t, 0.25);
      ra.spin.scale.setScalar(atria);
      la.spin.scale.setScalar(atria);
      rv.spin.scale.setScalar(ventricles);
      lv.spin.scale.setScalar(ventricles);
    },
  };
}
