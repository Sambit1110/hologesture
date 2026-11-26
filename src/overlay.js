// 2D overlay drawn on a canvas above the 3D scene: hand skeletons, the
// palm HUD ring, the pinch readout and part labels. Drawing on a canvas
// (not HTML) means snapshots and recordings include all of it.
import { HAND_CONNECTIONS, POSE_LABELS } from './gestures.js';

const CYAN = '#3fd8ff';
const AMBER = '#ffc857';

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  clear() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
  }

  hands(hands, gesture, t) {
    const { ctx } = this;
    for (const h of hands) {
      const p = h.points;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(63,216,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(p[a].x, p[a].y);
        ctx.lineTo(p[b].x, p[b].y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      for (let i = 0; i < p.length; i++) {
        const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        ctx.fillStyle = tip ? '#ffffff' : 'rgba(180,240,255,0.9)';
        ctx.beginPath();
        ctx.arc(p[i].x, p[i].y, tip ? 4 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (!hands.length) return;
    const two = gesture.mode === 'two-explode' || gesture.mode === 'two-zoom';
    if (two) this.#twoHandLink(hands[0], hands[1], gesture);
    else this.#ring(hands[0], gesture, t);
    if (gesture.pinchPoint) this.#pinch(hands[0], gesture);
    if (gesture.pointer) this.#crosshair(gesture.pointer, gesture.progress, t);
  }

  #ring(h, gesture, t) {
    const { ctx } = this;
    const r = Math.max(40, h.scale * 1.25);
    const { x, y } = h.palm;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(63,216,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(63,216,255,0.9)';
    for (let i = 0; i < 3; i++) {
      const a = t * 1.4 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, a, a + 0.7);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 - t * 0.5;
      const len = i % 3 === 0 ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      ctx.lineTo(Math.cos(a) * (r - 3 - len), Math.sin(a) * (r - 3 - len));
      ctx.stroke();
    }
    if (gesture.progress > 0 && (gesture.mode === 'spread' || gesture.mode === 'fist')) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r + 15, -Math.PI / 2, -Math.PI / 2 + gesture.progress * Math.PI * 2);
      ctx.stroke();
    }
    const label = POSE_LABELS[gesture.mode];
    if (label) this.#tag(label, 0, r + 32, CYAN);
    ctx.restore();
  }

  #twoHandLink(a, b, gesture) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = gesture.mode === 'two-explode' ? AMBER : CYAN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.palm.x, a.palm.y);
    ctx.lineTo(b.palm.x, b.palm.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const h of [a, b]) {
      ctx.beginPath();
      ctx.arc(h.palm.x, h.palm.y, Math.max(30, h.scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    const mx = (a.palm.x + b.palm.x) / 2;
    const my = (a.palm.y + b.palm.y) / 2;
    ctx.translate(mx, my);
    this.#tag(POSE_LABELS[gesture.mode], 0, -18, ctx.strokeStyle);
    ctx.restore();
  }

  #pinch(h, gesture) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(h.thumb.x, h.thumb.y);
    ctx.lineTo(h.tip.x, h.tip.y);
    ctx.stroke();
    const m = gesture.pinchPoint;
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
    ctx.fill();
    if (gesture.zoomValue) {
      ctx.translate(m.x + 40, m.y);
      this.#tag(`${Math.round(gesture.zoomValue * 100)}%`, 0, 0, AMBER);
    }
    ctx.restore();
  }

  #crosshair(p, progress, t) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(dx * 8, dy * 8);
      ctx.lineTo(dx * 20, dy * 20);
    }
    ctx.stroke();
    if (progress > 0) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // labels: [{ x, y, cx, cy, name, alpha, active, index }]
  labels(labels, mode) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '600 13px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const l of labels) {
      if (l.alpha <= 0.01) continue;
      let ox;
      let oy;
      if (mode === 'radial') {
        let dx = l.x - l.cx;
        let dy = l.y - l.cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        ox = dx * 90;
        oy = dy * 70;
      } else {
        const up = l.index % 2 === 0;
        ox = 0;
        oy = (up ? -1 : 1) * (64 + (l.index % 3) * 16);
      }
      const lx = l.x + ox;
      const ly = l.y + oy;
      const color = l.active ? AMBER : CYAN;
      ctx.globalAlpha = l.alpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(l.x, l.y, 3, 0, Math.PI * 2);
      ctx.fill();

      const w = ctx.measureText(l.name).width + 18;
      const h = 24;
      let bx = lx - w / 2;
      if (mode === 'radial' && Math.abs(ox) > 20) bx = ox > 0 ? lx : lx - w;
      bx = Math.min(Math.max(bx, 6), this.w - w - 6);
      const by = Math.min(Math.max(ly - h / 2, 76), this.h - h - 6); // 76: clear of the toolbar
      ctx.fillStyle = 'rgba(4,12,24,0.78)';
      roundRect(ctx, bx, by, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = l.active ? AMBER : '#e6faff';
      ctx.fillText(l.name, bx + 9, by + h / 2 + 0.5);
    }
    ctx.restore();
  }

  // Live readout of what the tracker sees for each hand (press D).
  debug(hands, gesture) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (const h of hands) {
      const b = h.bend;
      const lines = [
        `pose   ${h.pose}${hands.length === 1 ? `  (active: ${gesture.mode})` : ''}`,
        `model  ${h.label ?? '-'} ${h.label ? h.labelScore.toFixed(2) : ''}`,
        `bend   I${b.index} M${b.middle} R${b.ring} P${b.pinky}`,
        `pinch  ${h.pinch.toFixed(2)}  spread ${h.spread.toFixed(0)}°`,
      ];
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
      const x = Math.min(Math.max(h.points[0].x - w / 2, 6), this.w - w - 6);
      const y = Math.min(h.points[0].y + 24, this.h - lines.length * 16 - 14);
      ctx.fillStyle = 'rgba(4,12,24,0.82)';
      ctx.strokeStyle = 'rgba(63,216,255,0.6)';
      roundRect(ctx, x, y, w, lines.length * 16 + 10, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e6faff';
      lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 6 + i * 16));
    }
    ctx.restore();
  }

  watermark(text) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230,250,255,0.55)';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, 14, this.h - 12);
    ctx.restore();
  }

  #tag(text, x, y, color) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(4,12,24,0.75)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    roundRect(ctx, x - w / 2, y - 11, w, 22, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
