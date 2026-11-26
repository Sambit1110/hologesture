// Solar System. "Assembled" packs the planets close to the Sun; "exploded"
// spreads them onto wider orbits. Sizes and distances are not to scale.
// Planets carry globe lines (bands on the gas giants), their real axial
// tilts, ring systems, and there is an asteroid belt between Mars and Jupiter.
import * as THREE from 'three';
import { Part, circle, globeLines } from '../holo.js';

const D = Math.PI / 180;
// name, radius, colour, near orbit, far orbit, speed, tilt (deg), bands, description
const PLANETS = [
  ['Mercury', 0.09, 0xb9c0d4, 0.95, 1.25, 1.6, 0, false, 'The smallest planet and the closest to the Sun. A year there lasts just 88 Earth days.'],
  ['Venus', 0.16, 0xffd28a, 1.15, 1.75, 1.2, 177, false, 'The hottest planet, at around 465 °C, because its thick carbon dioxide atmosphere traps heat. It spins backwards.'],
  ['Earth', 0.17, 0x4fb4ff, 1.38, 2.3, 1.0, 23.4, false, 'The only known world with liquid water on its surface and life. Its 23.4° tilt gives us the seasons, and its Moon goes around it every 27.3 days.'],
  ['Mars', 0.12, 0xff7a59, 1.58, 2.85, 0.8, 25.2, false, 'The red planet, coloured by iron oxide dust. Home to Olympus Mons, the tallest volcano in the Solar System.'],
  ['Jupiter', 0.42, 0xffc38a, 2.0, 3.85, 0.43, 3.1, true, 'The largest planet, a gas giant more than 11 times wider than Earth. Its cloud bands and Great Red Spot are storms bigger than Earth.'],
  ['Saturn', 0.36, 0xffe2a1, 2.45, 4.8, 0.32, 26.7, true, 'A gas giant famous for its rings of ice and rock, split by the dark Cassini Division. It is less dense than water.'],
  ['Uranus', 0.25, 0x8ff0ff, 2.85, 5.6, 0.23, 97.8, true, 'An ice giant that spins on its side, tilted by about 98°, so its faint rings stand almost upright.'],
  ['Neptune', 0.24, 0x5b7cff, 3.2, 6.35, 0.18, 28.3, true, 'The farthest planet, with the fastest winds measured in the Solar System, over 2,000 km/h.'],
];
const BELT = { near: 1.78, far: 3.35 };

// A flat ring band in the planet's equatorial plane.
const ringBand = (inner, outer) => new THREE.RingGeometry(inner, outer, 96, 1).rotateX(-Math.PI / 2);

export function buildSolar() {
  const root = new THREE.Group();
  const parts = [];

  const sun = new Part('Sun', 'A star made mostly of hydrogen and helium. It holds about 99.8% of all the mass in the Solar System.',
    0xffb547, { custom: true, anchor: [0, 0.85, 0], fill: 0.12, line: 0.6 });
  sun.add(new THREE.SphereGeometry(0.72, 32, 16), { edges: false });
  sun.lines(globeLines(0.74, 9, 14));
  // Corona: loose rings around the Sun at different angles.
  const corona = new THREE.Group();
  sun.spin.add(corona);
  [[0.95, 0.3, 0], [1.05, -0.5, 0.6], [1.15, 1.1, -0.4]].forEach(([r, rx, rz]) => {
    sun.lines(lineLoop(r, 96), { rot: [rx, 0, rz], parent: corona });
  });
  parts.push(sun);
  root.add(sun.group);

  const orbitGeo = circle(1, 160);
  const orbitMat = new THREE.LineBasicMaterial({
    color: 0x3fd8ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const orbits = [];
  const planets = PLANETS.map(([name, r, color, near, far, speed, tiltDeg, bands, desc], i) => {
    const p = new Part(name, desc, color, { custom: true, anchor: [0, r + 0.06, 0], fill: 0.1, line: 0.55 });
    // Tilt sits between the orbit position and the daily spin.
    const tilt = new THREE.Group();
    tilt.rotation.z = tiltDeg * D;
    p.group.remove(p.spin);
    p.group.add(tilt);
    tilt.add(p.spin);

    p.add(new THREE.SphereGeometry(r, 28, 14), { edges: false });
    p.lines(bands ? globeLines(r * 1.01, 12, 4) : globeLines(r * 1.01, 6, 8));
    if (name === 'Saturn') {
      for (const [a, b] of [[1.3, 1.62], [1.7, 2.15], [2.2, 2.32]]) p.add(ringBand(r * a, r * b), { threshold: 1 });
    }
    if (name === 'Uranus') p.add(ringBand(r * 1.55, r * 1.62), { threshold: 1 });
    if (name === 'Earth') {
      p.moon = p.add(new THREE.SphereGeometry(0.045, 12, 8), { pos: [0.32, 0, 0], parent: p.group });
      p.lines(lineLoop(0.32), { parent: p.group }); // the Moon's orbit
    }
    parts.push(p);
    root.add(p.group);
    const orbit = new THREE.LineLoop(orbitGeo, orbitMat);
    root.add(orbit);
    orbits.push(orbit);
    return { p, near, far, speed, angle: i * 1.7 };
  });

  // Asteroid belt: a loose cloud of points between Mars and Jupiter.
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = 0.92 + Math.random() * 0.16;
    pos.set([Math.cos(a) * rr, (Math.random() - 0.5) * 0.04, Math.sin(a) * rr], i * 3);
  }
  const beltGeo = new THREE.BufferGeometry();
  beltGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const belt = new THREE.Points(beltGeo, new THREE.PointsMaterial({
    color: 0xc9b89a, size: 0.025, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  root.add(belt);

  return {
    title: 'Solar System',
    subtitle: 'The Sun and its 8 planets (not to scale)',
    root,
    parts,
    labelMode: 'alternate',
    defaultRotation: [0.5, 0],
    defaultZoom: 0.68,
    defaultExplode: 0.6,
    update(t, dt, explode) {
      sun.spin.rotation.y += dt * 0.15;
      corona.rotation.y -= dt * 0.25;
      planets.forEach((pl, i) => {
        pl.angle += pl.speed * dt * 0.5;
        const r = pl.near + (pl.far - pl.near) * explode;
        pl.p.group.position.set(Math.cos(pl.angle) * r, 0, Math.sin(pl.angle) * r);
        pl.p.spin.rotation.y += dt * 0.8;
        orbits[i].scale.setScalar(r);
        if (pl.p.moon) {
          const a = t * 2;
          pl.p.moon.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
        }
      });
      belt.scale.setScalar(BELT.near + (BELT.far - BELT.near) * explode);
      belt.rotation.y += dt * 0.05;
    },
  };
}

// A circle as line segments (LineSegments needs pairs of points).
function lineLoop(radius, seg = 64) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a0) * radius, 0, Math.sin(a0) * radius), new THREE.Vector3(Math.cos(a1) * radius, 0, Math.sin(a1) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}
