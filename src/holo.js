// Hologram building blocks shared by every model.
import * as THREE from 'three';

const HIGHLIGHT = new THREE.Color(0xffc857);
const WHITE = new THREE.Color(0xffffff);
const edgeCache = new WeakMap();

function edgesOf(geo, threshold) {
  let byThreshold = edgeCache.get(geo);
  if (!byThreshold) edgeCache.set(geo, (byThreshold = new Map()));
  if (!byThreshold.has(threshold)) byThreshold.set(threshold, new THREE.EdgesGeometry(geo, threshold));
  return byThreshold.get(threshold);
}

// A named, selectable piece of a model.
export class Part {
  constructor(name, desc, color, opts = {}) {
    this.name = name;
    this.desc = desc;
    this.color = new THREE.Color(color);
    this.group = new THREE.Group();
    this.group.name = name;
    this.spin = new THREE.Group(); // inner group, free for idle animation
    this.group.add(this.spin);

    this.base = new THREE.Vector3(...(opts.base || [0, 0, 0]));
    this.dir = opts.dir ? new THREE.Vector3(...opts.dir).normalize() : null;
    this.dist = opts.dist ?? 1;
    this.custom = !!opts.custom; // the model positions this part itself
    this.anchor = new THREE.Vector3(...(opts.anchor || [0, 0, 0]));
    this.pickPenalty = opts.pickPenalty ?? 0;

    this.fillOpacity = opts.fill ?? 0.14;
    this.lineOpacity = opts.line ?? 0.85;
    this.fill = new THREE.MeshBasicMaterial({
      color: this.color, transparent: true, opacity: this.fillOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.line = new THREE.LineBasicMaterial({
      color: this.color, transparent: true, opacity: this.lineOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.meshes = [];
  }

  // Add a geometry with glowing edges. Returns its holder group.
  // fill: false draws only the outline (for details that would stack up).
  add(geo, { pos, rot, scale, edges = true, wire = false, threshold = 20, parent, fill = true } = {}) {
    const holder = new THREE.Group();
    if (pos) holder.position.set(...pos);
    if (rot) holder.rotation.set(...rot);
    if (scale != null) {
      if (typeof scale === 'number') holder.scale.setScalar(scale);
      else holder.scale.set(...scale);
    }
    if (fill) {
      const mesh = new THREE.Mesh(geo, this.fill);
      holder.add(mesh);
      this.meshes.push(mesh);
    }
    if (wire) holder.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), this.line));
    else if (edges) holder.add(new THREE.LineSegments(edgesOf(geo, threshold), this.line));
    (parent || this.spin).add(holder);
    return holder;
  }

  // Add a line drawing (no fill). Returns its holder group.
  lines(geo, { pos, rot, scale, parent } = {}) {
    const holder = new THREE.Group();
    if (pos) holder.position.set(...pos);
    if (rot) holder.rotation.set(...rot);
    if (scale != null) {
      if (typeof scale === 'number') holder.scale.setScalar(scale);
      else holder.scale.set(...scale);
    }
    holder.add(new THREE.LineSegments(geo, this.line));
    (parent || this.spin).add(holder);
    return holder;
  }

  // level: 0 normal, 1 hovered, 2 selected. dimmed: another part is selected.
  setState(level, dimmed) {
    if (level === 2) {
      this.fill.color.copy(HIGHLIGHT);
      this.fill.opacity = Math.min(0.28, this.fillOpacity * 3 + 0.04);
      this.line.color.copy(HIGHLIGHT);
      this.line.opacity = 1;
    } else if (level === 1) {
      this.fill.color.copy(this.color).lerp(WHITE, 0.35);
      this.fill.opacity = Math.min(0.4, this.fillOpacity * 1.9);
      this.line.color.copy(this.color).lerp(WHITE, 0.55);
      this.line.opacity = 1;
    } else {
      this.fill.color.copy(this.color);
      this.fill.opacity = this.fillOpacity * (dimmed ? 0.35 : 1);
      this.line.color.copy(this.color);
      this.line.opacity = this.lineOpacity * (dimmed ? 0.3 : 1);
    }
  }

  worldAnchor(out) {
    return this.group.localToWorld(out.copy(this.anchor));
  }
}

// Geometry helpers. Cylinders are turned to lie along the X axis.
export const cylX = (rTop, rBottom, h, seg = 32, open = false) =>
  new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open).rotateZ(-Math.PI / 2);

export const cylZ = (r, h, seg = 32) =>
  new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2);

export function tube(points, radius, seg = 48, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, radius, radial, false);
}

export function circle(radius = 1, seg = 128) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// Revolve a profile of [radius, height] points around the Y axis.
export function lathe(profile, seg = 48) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

// Same, around the X axis (the jet engine's axis): [radius, x] points.
export function latheX(profile, seg = 48) {
  return lathe(profile, seg).rotateZ(-Math.PI / 2);
}

// A sphere-like surface bent by `shape`, which maps a unit direction
// (x, y, z) to a point. Used for organic shapes like heart chambers.
export function organic(shape, wSeg = 40, hSeg = 28) {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const [x, y, z] = shape(v.x, v.y, v.z);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Latitude and longitude lines over the same bent surface: the holographic
// "contour" look, without the diagonal lines a wireframe would add.
export function contourLines(shape, lat = 9, lon = 14, seg = 48) {
  const pts = [];
  const at = (theta, phi) => {
    const x = Math.sin(theta) * Math.cos(phi);
    const y = Math.cos(theta);
    const z = Math.sin(theta) * Math.sin(phi);
    return shape(x, y, z);
  };
  for (let i = 1; i < lat; i++) {
    const theta = (i / lat) * Math.PI;
    for (let j = 0; j < seg; j++) {
      pts.push(...at(theta, (j / seg) * Math.PI * 2), ...at(theta, ((j + 1) / seg) * Math.PI * 2));
    }
  }
  for (let j = 0; j < lon; j++) {
    const phi = (j / lon) * Math.PI * 2;
    for (let i = 0; i < seg / 2; i++) {
      pts.push(...at((i / (seg / 2)) * Math.PI, phi), ...at(((i + 1) / (seg / 2)) * Math.PI, phi));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

// Globe lines for a sphere of radius r.
export const globeLines = (r, lat = 7, lon = 10) => contourLines((x, y, z) => [x * r, y * r, z * r], lat, lon);

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
}
