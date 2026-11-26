// Six-axis industrial robot arm. An invisible joint chain does the motion;
// each part copies its joint's pose and adds its own explode offset on top.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Part, cylZ, lathe, tube } from '../holo.js';

const C = { base: 0x8fb4ff, joint: 0xffb547, link: 0x3fd8ff, tool: 0x7dffcf };
const JOINT = { fill: 0.04, line: 0.5 };
const LINK = { fill: 0.06, line: 0.7 };

// Side profile of an arm link: a tapered capsule from radius r0 at the
// bottom joint to r1 at the top joint, `len` apart, extruded `depth` deep.
function linkGeo(len, r0, r1, depth) {
  const s = new THREE.Shape();
  s.moveTo(r0, 0);
  s.lineTo(r1, len);
  s.absarc(0, len, r1, 0, Math.PI, false);
  s.lineTo(-r0, 0);
  s.absarc(0, 0, r0, Math.PI, Math.PI * 2, false);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 20,
  });
  return geo.translate(0, 0, -depth / 2);
}

// Joint motor: a housing with end caps and cooling fins, its axis along Z.
function motor(part, { r, len, fins = 4 }) {
  part.add(cylZ(r, len, 36));
  for (const z of [-len / 2, len / 2]) part.add(cylZ(r * 1.12, 0.06, 36), { pos: [0, 0, z], fill: false });
  for (let i = 0; i < fins; i++) {
    const z = -len / 2 + ((i + 1) / (fins + 1)) * len;
    part.add(cylZ(r * 1.06, 0.025, 36), { pos: [0, 0, z], fill: false });
  }
  part.add(cylZ(r * 0.45, len * 1.2, 20), { fill: false }); // axle
}

export function buildRobot() {
  const root = new THREE.Group();
  const parts = [];
  const P = (name, desc, color, opts) => {
    const p = new Part(name, desc, color, { custom: true, ...opts });
    parts.push(p);
    root.add(p.group);
    return p;
  };

  // Joint chain.
  const skel = new THREE.Group();
  root.add(skel);
  const node = (parent, y = 0) => {
    const n = new THREE.Object3D();
    n.position.y = y;
    parent.add(n);
    return n;
  };
  const baseNode = node(skel, -1.9);
  const yaw = node(baseNode, 0.32);
  const shoulder = node(yaw, 0.42);
  const elbow = node(shoulder, 1.5);
  const wrist = node(elbow, 1.3);
  const roll = node(wrist, 0);
  const tool = node(roll, 0.32);

  const base = P('Base', 'Bolts the arm to the floor and holds the power and control cables.',
    C.base, { dir: [0, -1, 0], dist: 0.8, anchor: [0.95, 0.1, 0], fill: 0.05, line: 0.6 });
  base.add(lathe([[0, 0], [1.0, 0], [1.0, 0.07], [0.94, 0.12], [0.8, 0.15], [0.72, 0.2], [0.68, 0.32], [0, 0.32]], 56), { threshold: 15 });
  const bolt = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    base.add(bolt, { pos: [Math.cos(a) * 0.88, 0.1, Math.sin(a) * 0.88] });
  }
  base.add(new RoundedBoxGeometry(0.3, 0.16, 0.24, 2, 0.04), { pos: [-0.95, 0.09, 0] }); // cable connector
  base.add(tube([[-1.1, 0.09, 0], [-1.35, 0.06, 0.05], [-1.6, 0.02, 0.2]], 0.045, 16, 8), { threshold: 30 });

  const turret = P('Turret', 'Turns the whole arm left and right, like a waist.',
    C.link, { dir: [-1, -0.2, 0], dist: 1.0, anchor: [0.6, 0.25, 0], fill: 0.05, line: 0.6 });
  turret.add(lathe([[0, 0], [0.62, 0], [0.62, 0.08], [0.56, 0.14], [0.52, 0.24], [0, 0.24]], 48), { threshold: 15 });
  // Yoke: two cheeks either side of the shoulder motor.
  for (const z of [-0.5, 0.5]) turret.add(new RoundedBoxGeometry(0.62, 0.62, 0.14, 2, 0.05), { pos: [0, 0.48, z] });

  const sh = P('Shoulder joint', 'A high-torque motor that lifts the upper arm up and down.',
    C.joint, { dir: [0, 0, 1], dist: 1.1, anchor: [0, 0.34, 0.4], ...JOINT });
  motor(sh, { r: 0.3, len: 0.8, fins: 5 });

  const upper = P('Upper arm', 'A rigid link that gives the arm its reach. A cable runs along it to power the motors further out.',
    C.link, { dir: [-1, 0.4, 0], dist: 1.1, anchor: [0.25, 0.75, 0], ...LINK });
  upper.add(linkGeo(1.5, 0.27, 0.2, 0.3), { threshold: 25 });
  upper.add(new THREE.BoxGeometry(0.14, 0.9, 0.34), { pos: [0, 0.75, 0] }); // stiffening rib
  upper.add(tube([[-0.3, 0.05, 0.2], [-0.32, 0.5, 0.22], [-0.27, 1.0, 0.22], [-0.2, 1.45, 0.2]], 0.03, 30, 6), { threshold: 30 });

  const el = P('Elbow joint', 'Bends the forearm, so the arm can fold in close or stretch out.',
    C.joint, { dir: [0, 0, 1], dist: 1.0, anchor: [0, 0.28, 0.32], ...JOINT });
  motor(el, { r: 0.24, len: 0.62, fins: 4 });

  const fore = P('Forearm', 'The second link. It carries the wrist and the tool.',
    C.link, { dir: [1, 0.5, 0], dist: 1.1, anchor: [0.2, 0.65, 0], ...LINK });
  fore.add(linkGeo(1.3, 0.2, 0.14, 0.24), { threshold: 25 });
  fore.add(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 20), { pos: [0, 0.35, 0] }); // wrist motor housing

  const wr = P('Wrist', 'Tilts and rolls the tool, so the gripper can reach objects from any angle.',
    C.joint, { dir: [0, 0, 1], dist: 1.0, anchor: [0, 0.22, 0.2], ...JOINT });
  motor(wr, { r: 0.15, len: 0.36, fins: 2 });
  wr.add(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 28), { pos: [0, 0.22, 0] }); // tool flange
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    wr.add(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), { pos: [Math.cos(a) * 0.11, 0.24, Math.sin(a) * 0.11] });
  }

  const grip = P('Gripper', 'Two jointed fingers with grip pads that open and close to pick up and hold objects.',
    C.tool, { dir: [1, 0.8, 0], dist: 1.2, anchor: [0, 0.45, 0], fill: 0.07, line: 0.7 });
  grip.add(new RoundedBoxGeometry(0.5, 0.14, 0.26, 2, 0.04), { pos: [0, 0.07, 0] });
  grip.add(new THREE.BoxGeometry(0.46, 0.03, 0.08), { pos: [0, 0.16, 0] }); // guide rail
  const fingerL = grip.add(new RoundedBoxGeometry(0.07, 0.22, 0.18, 2, 0.02), { pos: [-0.18, 0.27, 0] });
  const fingerR = grip.add(new RoundedBoxGeometry(0.07, 0.22, 0.18, 2, 0.02), { pos: [0.18, 0.27, 0] });
  // Fingertips angle inward, with soft pads.
  for (const [f, s] of [[fingerL, 1], [fingerR, -1]]) {
    grip.add(new RoundedBoxGeometry(0.06, 0.18, 0.16, 2, 0.02), { pos: [s * 0.03, 0.18, 0], rot: [0, 0, -s * 0.35], parent: f });
    grip.add(new THREE.BoxGeometry(0.02, 0.12, 0.14), { pos: [s * 0.07, 0.17, 0], rot: [0, 0, -s * 0.35], parent: f });
  }

  const map = [[base, baseNode], [turret, yaw], [sh, shoulder], [upper, shoulder], [el, elbow], [fore, elbow], [wr, wrist], [grip, tool]];
  const inv = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  return {
    title: 'Robot Arm',
    subtitle: 'Six-axis industrial arm with motor joints and a gripper',
    root,
    parts,
    labelMode: 'radial',
    defaultRotation: [0.15, -0.6],
    defaultZoom: 0.95,
    defaultExplode: 0,
    update(t, dt, explode) {
      yaw.rotation.y = 0.6 * Math.sin(t * 0.4);
      shoulder.rotation.z = 0.35 + 0.25 * Math.sin(t * 0.6);
      elbow.rotation.z = -0.9 + 0.3 * Math.sin(t * 0.7 + 1);
      wrist.rotation.z = -0.6 + 0.3 * Math.sin(t * 0.9);
      roll.rotation.y = t * 0.8;
      const open = 0.5 + 0.5 * Math.sin(t * 1.5);
      fingerL.position.x = -0.1 - 0.1 * open;
      fingerR.position.x = 0.1 + 0.1 * open;

      root.updateMatrixWorld(true);
      inv.copy(root.matrixWorld).invert();
      for (const [part, n] of map) {
        m.multiplyMatrices(inv, n.matrixWorld).decompose(pos, quat, scl);
        part.group.position.copy(pos).addScaledVector(part.dir, part.dist * explode);
        part.group.quaternion.copy(quat);
      }
    },
  };
}
