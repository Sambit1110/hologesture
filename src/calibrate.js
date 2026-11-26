// Guided gesture calibration. Walks through each gesture, records what the
// tracker sees (raw landmarks, the trained model's label, the measured finger
// bends and the pose the app picked), shows how often each gesture was read
// correctly, and saves everything through serve.py so it can be analysed and
// the detection tuned to a real hand and camera.

const STEPS = [
  { key: 'open', emoji: '✋', title: 'Open hand', text: 'Hold your hand up, palm to the camera, fingers together.', expect: ['open'] },
  { key: 'spread', emoji: '🖐️', title: 'Spread', text: 'Spread your fingers wide and hold still.', expect: ['spread'] },
  { key: 'fist', emoji: '✊', title: 'Fist', text: 'Make a fist and hold still.', expect: ['fist'] },
  { key: 'point', emoji: '☝️', title: 'Point', text: 'Point your index finger at the screen, other fingers curled.', expect: ['point'] },
  { key: 'pinch', emoji: '🤏', title: 'Pinch', text: 'Touch your thumb and index fingertip together.', expect: ['pinch'] },
  { key: 'rotate', emoji: '↔️', title: 'Move open hand', text: 'Open hand: move it slowly left and right, as if turning the model.', expect: ['open', 'spread'] },
  { key: 'pinch-move', emoji: '↕️', title: 'Pinch and move', text: 'Keep pinching and move your hand slowly up and down.', expect: ['pinch'] },
];
const READY = 1.8;   // seconds to get into position
const RECORD = 3.5;  // seconds recorded per step

const r1 = (v) => Math.round(v * 10) / 10;

export class Calibration {
  constructor(el, { onSave } = {}) {
    this.el = el;
    this.onSave = onSave;
    this.active = false;
  }

  start() {
    this.renderedKey = null;
    this.summary = null;
    this.active = true;
    this.step = 0;
    this.phase = 'ready';
    this.t = 0;
    this.results = STEPS.map((s) => ({ key: s.key, expect: s.expect, frames: [] }));
    this.el.hidden = false;
    this.#render();
  }

  cancel() {
    this.active = false;
    this.el.hidden = true;
  }

  // rawHands: smoothed tracker hands ({ points, world, gesture, score });
  // hands: analysed hands; gesture: controller output for this frame.
  frame(rawHands, hands, gesture, dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.phase === 'ready') {
      if (this.t >= READY) { this.phase = 'record'; this.t = 0; }
    } else if (this.phase === 'record') {
      const h = hands[0];
      const raw = rawHands[0];
      this.results[this.step].frames.push(h ? {
        t: Math.round(this.t * 1000),
        hands: hands.length,
        pose: h.pose,
        mode: gesture.mode,
        label: h.label,
        score: Math.round(h.labelScore * 100) / 100,
        bend: h.bend,
        pinch: Math.round(h.pinch * 100) / 100,
        spread: Math.round(h.spread),
        reach: Math.round(h.indexReach * 100) / 100,
        palm: [Math.round(h.palm.x), Math.round(h.palm.y)],
        points: raw.points.map((p) => [r1(p.x), r1(p.y)]),
        world: raw.world ? raw.world.map((p) => [r1(p.x), r1(p.y), r1(p.z)]) : null,
      } : { t: Math.round(this.t * 1000), hands: 0 });
      if (this.t >= RECORD) {
        this.step += 1;
        this.t = 0;
        this.phase = this.step < STEPS.length ? 'ready' : 'done';
        if (this.phase === 'done') this.#finish();
      }
    }
    this.#render(hands[0]);
  }

  #summary() {
    return this.results.map((r) => {
      const seen = r.frames.filter((f) => f.hands > 0);
      const ok = seen.filter((f) => r.expect.includes(f.pose)).length;
      const wrong = {};
      for (const f of seen) if (!r.expect.includes(f.pose)) wrong[f.pose] = (wrong[f.pose] || 0) + 1;
      const top = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
      return {
        key: r.key,
        frames: r.frames.length,
        handSeen: r.frames.length ? Math.round((seen.length / r.frames.length) * 100) : 0,
        correct: seen.length ? Math.round((ok / seen.length) * 100) : 0,
        mostlyConfusedWith: top ? top[0] : null,
      };
    });
  }

  async #finish() {
    this.active = false; // gestures work again while the results save
    this.summary = this.#summary();
    this.saveState = 'saving';
    this.#render();
    const payload = {
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      view: [window.innerWidth, window.innerHeight],
      summary: this.summary,
      steps: this.results,
    };
    try {
      this.savedAs = await this.onSave?.(payload);
      this.saveState = 'saved';
    } catch (err) {
      console.warn('Could not save calibration', err);
      this.saveState = 'failed';
      this.payload = payload;
    }
    this.#render();
  }

  #render(hand) {
    const el = this.el;
    if (this.phase === 'done') {
      const rows = this.summary.map((s) => {
        const step = STEPS.find((x) => x.key === s.key);
        const cls = s.correct >= 85 ? 'good' : s.correct >= 60 ? 'meh' : 'bad';
        const note = s.handSeen < 80 ? `hand seen ${s.handSeen}%` : s.mostlyConfusedWith && s.correct < 85 ? `read as ${s.mostlyConfusedWith}` : '';
        return `<tr><td>${step.emoji} ${step.title}</td><td class="${cls}">${s.correct}%</td><td class="muted">${note}</td></tr>`;
      }).join('');
      const save = {
        saving: 'Saving…',
        saved: `Saved as <code>${this.savedAs || 'calibration file'}</code>.`,
        failed: '<button id="calib-download" class="ghost">Download results</button> (saving needs <code>python3 serve.py</code>)',
      }[this.saveState];
      el.innerHTML = `<h2>Calibration results</h2><table>${rows}</table><p class="save">${save}</p>
        <div class="calib-actions"><button id="calib-again" class="ghost">Run again</button><button id="calib-close" class="primary">Close</button></div>`;
      el.querySelector('#calib-close').onclick = () => this.cancel();
      el.querySelector('#calib-again').onclick = () => this.start();
      const dl = el.querySelector('#calib-download');
      if (dl) dl.onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(this.payload)], { type: 'application/json' }));
        a.download = `hologesture-calibration-${Date.now()}.json`;
        a.click();
      };
      return;
    }
    const s = STEPS[this.step];
    const key = `${this.step}:${this.phase}`;
    if (this.renderedKey !== key) {
      // Build the panel once per step and phase; per frame only the bar and
      // the live readout change, so the Cancel button stays clickable.
      this.renderedKey = key;
      el.innerHTML = `<div class="calib-step">Step ${this.step + 1} of ${STEPS.length}</div>
        <div class="calib-emoji">${s.emoji}</div>
        <h2>${s.title}</h2><p>${s.text}</p>
        <div class="calib-bar ${this.phase}"><span></span></div>
        <div class="calib-phase">${this.phase === 'ready' ? 'Get ready…' : 'Recording'}</div>
        <div class="calib-live"></div>
        <div class="calib-actions"><button id="calib-cancel" class="ghost">Cancel</button></div>`;
      el.querySelector('#calib-cancel').onclick = () => this.cancel();
    }
    const pct = this.phase === 'ready' ? (this.t / READY) * 100 : (this.t / RECORD) * 100;
    el.querySelector('.calib-bar span').style.width = `${Math.min(100, pct).toFixed(0)}%`;
    el.querySelector('.calib-live').innerHTML = hand
      ? `Seeing: <b>${hand.pose}</b>${hand.label ? ` · model: ${hand.label}` : ''}`
      : 'No hand in view';
  }
}
