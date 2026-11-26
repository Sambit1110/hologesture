import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { analyzeHand, GestureController, HandSmoother, POSE_LABELS } from './gestures.js';
import { Overlay } from './overlay.js';
import { Recorder, snapshot } from './recorder.js';
import { disposeTree } from './holo.js';
import { Calibration } from './calibrate.js';
import { buildEngine } from './models/engine.js';
import { buildSolar } from './models/solar.js';
import { buildHeart } from './models/heart.js';
import { buildRobot } from './models/robot.js';

const MODELS = [
  { key: 'engine', name: 'Jet Engine', icon: '✈️', build: buildEngine },
  { key: 'solar', name: 'Solar System', icon: '🪐', build: buildSolar },
  { key: 'heart', name: 'Human Heart', icon: '❤️', build: buildHeart },
  { key: 'robot', name: 'Robot Arm', icon: '🦾', build: buildRobot },
];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- renderer
const glCanvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x03060c, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(0, 0.3, 9);
camera.lookAt(0, 0, 0);
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.4, 0.6);
composer.addPass(bloom);
// feedPass is added here once it is defined below.

// Camera feed. It is not part of the 3D scene: the hologram and its bloom
// are rendered on black first, then this pass lays them over the processed
// camera image. That way only the hologram glows, however bright the room.
const video = $('cam');
const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
const feedPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    tVideo: { value: null },
    uvTransform: { value: new THREE.Matrix3() },
    uCamera: { value: 0 },
    uDim: { value: 0.35 },
    uSat: { value: 0.35 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tVideo;
    uniform mat3 uvTransform;
    uniform float uCamera;
    uniform float uDim;
    uniform float uSat;
    varying vec2 vUv;
    void main() {
      vec4 holo = texture2D(tDiffuse, vUv);
      vec3 bg = vec3(0.0);
      if (uCamera > 0.5) {
        vec3 c = texture2D(tVideo, (uvTransform * vec3(vUv, 1.0)).xy).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat) * vec3(0.82, 0.93, 1.08);
        float vignette = mix(0.5, 1.0, smoothstep(0.85, 0.25, distance(vUv, vec2(0.5))));
        // The slider is perceptual: square-ish so 0.45 looks like 45% brightness.
        bg = c * pow(uDim, 2.2) * vignette;
      }
      gl_FragColor = vec4(bg + holo.rgb, 1.0);
    }`,
});
feedPass.uniforms.tVideo.value = videoTexture; // set after construction: ShaderPass clones its uniforms
composer.addPass(feedPass);
composer.addPass(new OutputPass());


// Faint stars, shown when there's no camera.
const stars = (() => {
  const n = 700;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 30);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fdcff, size: 0.12, transparent: true, opacity: 0.55 }));
})();
scene.add(stars);

// Stage: the model plus the projector base. Shifted right to clear the sidebar.
const stage = new THREE.Group();
scene.add(stage);
const modelRoot = new THREE.Group();
stage.add(modelRoot);

const projector = (() => {
  const g = new THREE.Group();
  g.position.y = -2.7;
  const mat = (o) => new THREE.LineBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = [1.0, 1.6, 2.3].map((r, i) => {
    const pts = [];
    const seg = 96;
    for (let k = 0; k <= seg; k++) {
      if (i === 1 && k % 8 > 5) continue; // dashed middle ring
      const a = (k / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const line = i === 1
      ? new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat(0.5))
      : new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat(0.45 - i * 0.1));
    g.add(line);
    return line;
  });
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 1.0, 4.6, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 2.3;
  g.add(beam);
  g.userData.rings = rings;
  return g;
})();
stage.add(projector);

// ---------------------------------------------------------------- state
const overlay = new Overlay($('overlay'));
const recorder = new Recorder();
const controller = new GestureController();
const smoother = new HandSmoother();
const calibration = new Calibration(document.getElementById('calib'), {
  async onSave(payload) {
    const res = await fetch('/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    return (await res.json()).file;
  },
});
const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

const state = {
  model: null,
  modelIndex: 0,
  explode: 0,
  explodeTarget: 0,
  zoom: 1,
  zoomTarget: 1,
  rot: new THREE.Vector2(),
  rotTarget: new THREE.Vector2(),
  hover: null,
  selected: null,
  voice: false,
  cameraOn: false,
  tracker: null,
  trackerLoading: false,
  handPts: [],
  lastVideoTime: -1,
  mouse: null,
  lastInput: 0,
  snapshotPending: false,
  debug: false,
  w: 1,
  h: 1,
  sidebarW: 0,
};

// ---------------------------------------------------------------- models
function loadModel(index) {
  if (state.model) {
    modelRoot.remove(state.model.root);
    disposeTree(state.model.root);
  }
  state.modelIndex = index;
  const m = MODELS[index].build();
  state.model = m;
  m.parts.forEach((p, i) => p.meshes.forEach((mesh) => { mesh.userData.partIndex = i; }));
  modelRoot.add(m.root);

  state.explode = state.explodeTarget = m.defaultExplode ?? 0;
  state.zoomTarget = 1;
  state.zoom = 0.6;
  const [rx, ry] = m.defaultRotation || [0.2, 0];
  state.rotTarget.set(rx, ry);
  state.rot.set(rx, ry - 0.8);
  state.hover = null;
  state.selected = null;

  renderModelTabs();
  renderParts();
  renderDetail();
  $('model-title').textContent = m.title;
  $('model-subtitle').textContent = m.subtitle;
  $('explode').value = state.explodeTarget;
}

function select(index, { speak = true } = {}) {
  state.selected = index === state.selected ? null : index;
  renderParts();
  renderDetail();
  if (state.selected != null && speak) say(state.model.parts[state.selected]);
}

function say(part) {
  if (!state.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${part.name}. ${part.desc}`);
  u.rate = 1.02;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- UI
function renderModelTabs() {
  const box = $('models');
  box.innerHTML = '';
  MODELS.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = `model-tab${i === state.modelIndex ? ' active' : ''}`;
    b.innerHTML = `<span class="icon">${m.icon}</span><span>${m.name}</span><kbd>${i + 1}</kbd>`;
    b.onclick = () => loadModel(i);
    box.appendChild(b);
  });
}

function renderParts() {
  const list = $('parts');
  list.innerHTML = '';
  state.model.parts.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = i === state.selected ? 'active' : '';
    li.innerHTML = `<span class="swatch" style="--c:#${p.color.getHexString()}"></span>${p.name}`;
    li.onclick = () => select(i);
    li.onmouseenter = () => { state.listHover = i; };
    li.onmouseleave = () => { state.listHover = null; };
    list.appendChild(li);
  });
  $('part-count').textContent = `${state.model.parts.length} parts`;
}

function renderDetail() {
  const box = $('detail');
  if (state.selected == null) {
    box.innerHTML = '<p class="hint">Point at a part with one finger and hold, or click it, to learn what it does.</p>';
    return;
  }
  const p = state.model.parts[state.selected];
  box.innerHTML = `<h3><span class="swatch" style="--c:#${p.color.getHexString()}"></span>${p.name}</h3><p>${p.desc}</p>`;
}

function setStatus(text, kind = '') {
  const el = $('status');
  const cls = `status ${kind}`;
  if (el.textContent === text && el.className === cls) return;
  el.textContent = text;
  el.className = cls;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function setButton(id, on) {
  $(id).classList.toggle('on', on);
  $(id).setAttribute('aria-pressed', String(on));
}

// ---------------------------------------------------------------- camera + tracking
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    state.cameraOn = true;
    feedPass.uniforms.uCamera.value = 1;
    renderer.setClearColor(0x000000, 1);
    stars.visible = false;
    setButton('btn-camera', true);
    layout();
    loadTracker();
  } catch (err) {
    console.warn(err);
    setStatus('Camera unavailable. Using mouse controls.', 'warn');
    toast('Could not open the camera. You can still use the mouse.');
  }
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  state.cameraOn = false;
  state.handPts = [];
  smoother.reset();
  controller.reset();
  feedPass.uniforms.uCamera.value = 0;
  renderer.setClearColor(0x03060c, 1);
  stars.visible = true;
  setButton('btn-camera', false);
  setStatus('Camera off. Mouse controls active.');
}

async function loadTracker() {
  if (state.tracker || state.trackerLoading) {
    if (state.tracker) setStatus('Show your hand to the camera ✋', 'ok');
    return;
  }
  state.trackerLoading = true;
  setStatus('Loading hand tracking model…', 'busy');
  try {
    const { createHandTracker } = await import('./hands.js');
    state.tracker = await createHandTracker();
    setStatus('Show your hand to the camera ✋', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Hand tracking failed to load. Using mouse controls.', 'warn');
  } finally {
    state.trackerLoading = false;
  }
}

// Video pixels -> screen pixels, matching the mirrored, cover-fitted background.
function videoToScreen(nx, ny) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const s = Math.max(state.w / vw, state.h / vh);
  const dw = vw * s;
  const dh = vh * s;
  return { x: (state.w - dw) / 2 + (1 - nx) * dw, y: (state.h - dh) / 2 + ny * dh };
}

function detectHands(now) {
  if (!state.cameraOn || !state.tracker || video.readyState < 2) return;
  if (video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  const fresh = state.tracker.detect(video, now).map((h) => ({
    points: h.landmarks.map((p) => videoToScreen(p.x, p.y)),
    world: h.world,
    gesture: h.gesture,
    score: h.score,
  }));
  // Track each hand separately, filter out jitter, bridge dropped frames.
  state.handPts = smoother.update(fresh, now / 1000);
}

// ---------------------------------------------------------------- layout
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.w = w;
  state.h = h;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  overlay.resize(w, h, dpr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // Cover-fit and mirror the camera image.
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const A = w / h;
  const V = vw / vh;
  let rx = 1;
  let ry = 1;
  if (V > A) rx = A / V;
  else ry = V / A;
  videoTexture.repeat.set(-rx, ry);
  videoTexture.offset.set((1 + rx) / 2, (1 - ry) / 2);
  videoTexture.updateMatrix();
  feedPass.uniforms.uvTransform.value.copy(videoTexture.matrix);

  // Shift the stage so the model centres in the space right of the sidebar.
  const sidebar = $('sidebar');
  state.sidebarW = w > 900 && !sidebar.classList.contains('collapsed') ? sidebar.offsetWidth + 24 : 0;
  const worldPerPx = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / h;
  stage.position.x = (state.sidebarW / 2) * worldPerPx;
}
window.addEventListener('resize', layout);
video.addEventListener('loadedmetadata', layout);

// ---------------------------------------------------------------- picking
function pick(pointer) {
  if (!pointer || !state.model) return null;
  const ndc = new THREE.Vector2((pointer.x / state.w) * 2 - 1, -(pointer.y / state.h) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const meshes = state.model.parts.flatMap((p) => p.meshes);
  const hits = raycaster.intersectObjects(meshes, false);
  let best = null;
  let bestScore = Infinity;
  for (const hit of hits) {
    const i = hit.object.userData.partIndex;
    const score = hit.distance + state.model.parts[i].pickPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// A fingertip is never pixel-precise, so search a small disc around it:
// the centre first, then two rings, and take the first part found.
const PICK_OFFSETS = [[0, 0]];
for (const r of [18, 36]) for (let i = 0; i < 8; i++) PICK_OFFSETS.push([Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r]);
function pickNear(pointer) {
  if (!pointer) return null;
  for (const [dx, dy] of PICK_OFFSETS) {
    const hit = pick({ x: pointer.x + dx, y: pointer.y + dy });
    if (hit != null) return hit;
  }
  return null;
}

function toScreen(v) {
  tmp2.copy(v).project(camera);
  return { x: ((tmp2.x + 1) / 2) * state.w, y: ((1 - tmp2.y) / 2) * state.h, behind: tmp2.z > 1 };
}

// ---------------------------------------------------------------- mouse + keys
let drag = null;
glCanvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  glCanvas.setPointerCapture(e.pointerId);
});
glCanvas.addEventListener('pointermove', (e) => {
  state.mouse = { x: e.clientX, y: e.clientY };
  state.lastInput = performance.now();
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX;
  drag.y = e.clientY;
  state.rotTarget.y += dx * 0.008;
  state.rotTarget.x = clamp(state.rotTarget.x + dy * 0.008, -1.3, 1.3);
});
glCanvas.addEventListener('pointerup', () => {
  if (drag && drag.moved < 5) select(state.hover);
  drag = null;
});
glCanvas.addEventListener('pointerleave', () => { state.mouse = null; });
glCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.zoomTarget = clamp(state.zoomTarget * Math.exp(-e.deltaY * 0.0012), 0.35, 2.6);
  state.lastInput = performance.now();
}, { passive: false });

function toggleExplode() {
  state.explodeTarget = state.explodeTarget > 0.5 ? 0 : 1;
  $('explode').value = state.explodeTarget;
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= String(MODELS.length)) loadModel(Number(k) - 1);
  else if (k === 'e') toggleExplode();
  else if (k === 's') takeSnapshot();
  else if (k === 'r') toggleRecording();
  else if (k === 'v') toggleVoice();
  else if (k === 'h' || k === '?') toggleGuide();
  else if (k === 'c') startCalibration();
  else if (k === 'd') { state.debug = !state.debug; toast(state.debug ? 'Hand debug on' : 'Hand debug off'); }
  else if (k === 'escape') select(null);
  else return;
  e.preventDefault();
});

$('camdim').addEventListener('input', (e) => {
  feedPass.uniforms.uDim.value = Number(e.target.value);
});

$('explode').addEventListener('input', (e) => {
  state.explodeTarget = Number(e.target.value);
  state.lastInput = performance.now();
});

// ---------------------------------------------------------------- toolbar
function takeSnapshot() {
  state.snapshotPending = true;
}

function toggleRecording() {
  if (!Recorder.supported()) {
    toast('Recording is not supported in this browser.');
    return;
  }
  if (recorder.active) {
    recorder.stop();
    setButton('btn-record', false);
    $('rec').hidden = true;
    toast('Recording saved to your downloads.');
  } else {
    const ext = recorder.start(glCanvas.width, glCanvas.height);
    setButton('btn-record', true);
    $('rec').hidden = false;
    toast(ext === 'mp4' ? 'Recording (MP4)…' : 'Recording (WebM)…');
  }
}

function toggleVoice() {
  state.voice = !state.voice;
  setButton('btn-voice', state.voice);
  toast(state.voice ? 'Voice labels on' : 'Voice labels off');
  if (!state.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
  else if (state.voice && state.selected != null) say(state.model.parts[state.selected]);
}

function startCalibration() {
  if (!state.cameraOn || !state.tracker) {
    toast(state.cameraOn ? 'Hand tracking is still loading, try again in a moment.' : 'Turn on the camera first.');
    return;
  }
  calibration.start();
}

function toggleGuide() {
  const g = $('guide');
  g.classList.toggle('hidden');
  setButton('btn-guide', !g.classList.contains('hidden'));
}

$('btn-camera').onclick = () => (state.cameraOn ? stopCamera() : startCamera());
$('btn-snapshot').onclick = takeSnapshot;
$('btn-record').onclick = toggleRecording;
$('btn-voice').onclick = toggleVoice;
$('btn-guide').onclick = toggleGuide;
$('btn-calibrate').onclick = startCalibration;
$('btn-fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};
$('btn-sidebar').onclick = () => {
  $('sidebar').classList.toggle('collapsed');
  layout();
};
$('start-camera').onclick = () => {
  $('start').classList.add('gone');
  startCamera();
};
$('start-mouse').onclick = () => {
  $('start').classList.add('gone');
  setStatus('Mouse mode. Turn on the camera any time.');
};

// ---------------------------------------------------------------- loop
let last = performance.now();
let t = 0;
let gesture = { mode: 'none', progress: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

  detectHands(now);
  const hands = state.cameraOn ? state.handPts.map(analyzeHand) : [];
  gesture = controller.update(hands, dt, {
    zoom: state.zoomTarget,
    explode: state.explodeTarget,
    hoverPart: state.hover,
    viewW: state.w,
    viewH: state.h,
  });
  if (calibration.active) {
    // Record, and keep the model still while the user holds each gesture.
    calibration.frame(state.handPts, hands, gesture, dt);
    gesture = { ...gesture, rotate: { x: 0, y: 0 }, zoom: null, explode: null, select: null };
  }

  if (hands.length) state.lastInput = now;
  // Moving your hand across half the view turns the model half a turn.
  const rotGain = Math.PI / Math.max(400, state.w * 0.5);
  state.rotTarget.y += gesture.rotate.y * rotGain;
  state.rotTarget.x = clamp(state.rotTarget.x + gesture.rotate.x * rotGain, -1.3, 1.3);
  if (gesture.zoom != null) state.zoomTarget = clamp(gesture.zoom, 0.35, 2.6);
  gesture.zoomValue = state.zoomTarget;
  if (gesture.explode != null) {
    state.explodeTarget = gesture.explode;
    $('explode').value = state.explodeTarget;
  }
  if (gesture.select != null) select(gesture.select);

  if (hands.length) {
    const label = POSE_LABELS[gesture.mode];
    setStatus(`${hands.length === 2 ? 'Two hands' : 'Hand'} detected${label ? ` · ${label}` : ''}`, 'ok');
  } else if (state.cameraOn && state.tracker) {
    setStatus('Show your hand to the camera ✋', 'ok');
  }

  // Idle: slowly turn the model.
  if (now - state.lastInput > 4000 && !drag) state.rotTarget.y += dt * 0.18;

  // Smooth everything.
  state.explode = lerp(state.explode, state.explodeTarget, Math.min(1, dt * 5));
  state.zoom = lerp(state.zoom, state.zoomTarget, Math.min(1, dt * 7));
  state.rot.x = lerp(state.rot.x, state.rotTarget.x, Math.min(1, dt * 8));
  state.rot.y = lerp(state.rot.y, state.rotTarget.y, Math.min(1, dt * 8));

  const m = state.model;
  const z = state.zoom * (m.defaultZoom ?? 1);
  modelRoot.scale.setScalar(z);
  modelRoot.rotation.set(state.rot.x, state.rot.y, 0);
  projector.scale.setScalar(clamp(z, 0.6, 1.4));
  projector.userData.rings.forEach((r, i) => { r.rotation.y += dt * (i % 2 ? -0.3 : 0.2); });

  for (const p of m.parts) {
    if (p.custom) continue;
    p.group.position.copy(p.base);
    if (p.dir) p.group.position.addScaledVector(p.dir, p.dist * state.explode);
  }
  m.update(t, dt, state.explode);

  // Hover from a pointing finger, or the mouse.
  const fingerPointer = gesture.pointer;
  const pointer = fingerPointer || (state.cameraOn && hands.length ? null : state.mouse);
  state.hover = state.listHover ?? (fingerPointer ? pickNear(fingerPointer) : pick(pointer));
  glCanvas.style.cursor = state.hover != null ? 'pointer' : drag ? 'grabbing' : 'grab';

  m.parts.forEach((p, i) => {
    const level = i === state.selected ? 2 : i === state.hover ? 1 : 0;
    p.setState(level, state.selected != null && level === 0);
  });

  composer.render(dt);

  // Overlay.
  overlay.clear();
  scene.updateMatrixWorld();
  const center = toScreen(modelRoot.getWorldPosition(tmp));
  const labelAlpha = clamp((state.explode - 0.25) / 0.4, 0, 1);
  const labels = m.parts.map((p, i) => {
    const s = toScreen(p.worldAnchor(tmp));
    const active = i === state.selected || i === state.hover;
    return {
      x: s.x, y: s.y, cx: center.x, cy: center.y, name: p.name, index: i, active,
      alpha: s.behind ? 0 : Math.max(labelAlpha, active ? 1 : 0),
    };
  });
  overlay.labels(labels, m.labelMode);
  overlay.hands(hands, gesture, t);
  if (state.debug) overlay.debug(hands, gesture);

  const recording = recorder.active;
  if (recording || state.snapshotPending) overlay.watermark('HoloGesture');
  const sources = [glCanvas, overlay.canvas];
  if (state.snapshotPending) {
    state.snapshotPending = false;
    snapshot(sources);
    toast('Snapshot saved to your downloads.');
  }
  if (recording) {
    recorder.frame(sources);
    const s = Math.floor(recorder.seconds);
    $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}

// ---------------------------------------------------------------- go
loadModel(0);
layout();
setStatus('Ready');
requestAnimationFrame(frame);
window.__holo = { state, loadModel, select, bloom }; // handy for debugging in the console
