// Snapshot and video recording. Both combine the 3D canvas (which already
// contains the camera feed) with the overlay canvas.

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function compose(ctx, w, h, sources) {
  ctx.clearRect(0, 0, w, h);
  for (const src of sources) ctx.drawImage(src, 0, 0, w, h);
}

export function snapshot(sources) {
  const [first] = sources;
  const c = document.createElement('canvas');
  c.width = first.width;
  c.height = first.height;
  compose(c.getContext('2d'), c.width, c.height, sources);
  c.toBlob((blob) => blob && download(blob, `hologesture-${stamp()}.png`), 'image/png');
}

const TYPES = [
  ['video/mp4;codecs=avc1.42E01E', 'mp4'],
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
];

export class Recorder {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.rec = null;
    this.startedAt = 0;
  }

  static supported() {
    return typeof window.MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  }

  get active() {
    return !!this.rec;
  }

  get seconds() {
    return this.rec ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(width, height) {
    const k = Math.min(1, 1920 / width);
    this.canvas.width = Math.round((width * k) / 2) * 2;
    this.canvas.height = Math.round((height * k) / 2) * 2;
    const [type, ext] = TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) || ['', 'webm'];
    this.ext = ext;
    const stream = this.canvas.captureStream(30);
    this.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : {});
    const chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.rec.onstop = () => download(new Blob(chunks, { type: type || 'video/webm' }), `hologesture-${stamp()}.${ext}`);
    this.rec.start(250);
    this.startedAt = performance.now();
    return ext;
  }

  frame(sources) {
    if (this.rec) compose(this.ctx, this.canvas.width, this.canvas.height, sources);
  }

  stop() {
    if (!this.rec) return;
    this.rec.stop();
    this.rec = null;
  }
}
