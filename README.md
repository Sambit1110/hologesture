# HoloGesture

Control 3D holograms with your bare hands. Your webcam tracks your hand in real time, and simple gestures rotate, zoom, explode and select parts of a glowing 3D model floating over the camera feed.

Built with [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer) and [Three.js](https://threejs.org/), bundled locally so it works offline. Your camera feed never leaves your computer.

## Install

**macOS and Linux**, in Terminal:

```bash
curl -fsSL https://github.com/Sambit1110/hologesture/releases/latest/download/install.sh | bash
```

**Windows**, in PowerShell:

```powershell
irm https://github.com/Sambit1110/hologesture/releases/latest/download/install.ps1 | iex
```

The installer picks the right build for your computer (Mac: Apple Silicon or Intel; Linux: x64 or ARM; Windows: x64), checks its SHA-256 checksum, and installs it: on a Mac into Applications, on Linux into `~/.local/share/hologesture` with a `hologesture` command and a menu entry, on Windows with Start menu and desktop shortcuts. It works offline once installed. The first time you start the camera, allow access when asked.

To uninstall: `curl -fsSL https://github.com/Sambit1110/hologesture/releases/latest/download/install.sh | bash -s -- --uninstall` (Windows: `$env:HOLOGESTURE_UNINSTALL=1; irm https://github.com/Sambit1110/hologesture/releases/latest/download/install.ps1 | iex`).

## Features

- **Live hand tracking** with a glowing skeleton overlay and an Iron Man-style HUD ring around your palm
- **Four models** built from code, each split into named parts:
  - ✈️ **Jet Engine**: twisted fan and compressor blades, stator vanes, annular combustor with fuel nozzles, turbines, two-spool shaft, tail cone and a nacelle with a rounded intake lip
  - 🪐 **Solar System**: the Sun and 8 planets with their axial tilts, Saturn's and Uranus's rings and the asteroid belt, spreading onto wider orbits when exploded
  - ❤️ **Human Heart**: organic chambers, aorta, pulmonary artery, veins and coronary arteries, beating, colour-coded by blood oxygen
  - 🦾 **Robot Arm**: bolted base, finned joint motors, tapered links with a cable run, and a jointed gripper, moving on their own
- **Exploded view**: pull a model apart to see every part, with floating labels
- **Part info**: point at a part to highlight it, hold to select it and read what it does
- **Voice labels**: hear the name and description of the selected part
- **Snapshot and recording**: save a PNG or a video (MP4 where the browser supports it) of the hologram and labels
- **Mouse and keyboard fallback** when no camera is available

## Gestures

| Gesture | Action |
|---|---|
| ✋ Open hand, move it (flick to spin) | Rotate |
| 🤏 Pinch, move up / down | Zoom in / out |
| 🖐️ Spread fingers wide, hold still | Explode |
| ✊ Make a fist, hold still | Assemble |
| ☝️ Point at a part, hold | Select it |
| 🙌 Two open hands, apart / together | Set how far it explodes |
| 🤏🤏 Two pinches, apart / together | Zoom |

**Mouse and keys:** drag to rotate, scroll to zoom, click a part to select it. `E` explode, `1`–`4` switch models, `S` snapshot, `R` record, `V` voice, `H` guide, `D` hand debug, `Esc` deselect.

**Camera dim** (sidebar) sets how bright your camera feed is behind the hologram.

**Calibrate** (toolbar, or `C`) walks you through each gesture for a few seconds, shows how often each one was read correctly, and saves the recording to `calibration/` (needs `python3 serve.py`), so detection can be tuned to your hand and camera.

**Gesture not working?** Press `D`. A readout under each hand shows the pose the app sees, the trained model's label and confidence, how much each finger bends, and the pinch and spread values, so you can see what it is reading.

## Mac app

HoloGesture is also a standalone Mac app (Apple Silicon): open **HoloGesture** from Launchpad, Spotlight or `~/Applications`. It works offline, asks for camera access the first time, saves snapshots and recordings to Downloads, and saves calibration recordings to `~/Library/Application Support/HoloGesture/calibration/`.

To build the downloadable release files for every platform (into `release/`): `npm run release`.

To rebuild just your own Mac app after changing the code:

```bash
npm install
npm run package        # builds dist/HoloGesture-darwin-arm64/HoloGesture.app (and signs it locally)
npm run install-app    # copies it to ~/Applications
```

`npm run app` runs it straight from the source folder without packaging.

## Run it in the browser

Install the libraries once (`npm install`), then serve the folder locally. The camera only works on `localhost` or HTTPS. With Python (already on macOS):

```bash
cd hologesture
python3 serve.py
```

`serve.py` is a small wrapper around Python's built-in server with caching turned off (so you always get the latest code) and a bigger connection queue (the plain `python3 -m http.server` can drop some of the many files the browser requests at once).

Then open <http://localhost:8000> in Chrome and allow camera access.

Chrome or Edge work best. Safari works too. Video recording saves MP4 in recent Chrome and Safari, and WebM elsewhere.

## Tests

The gesture logic is plain JavaScript with no browser dependencies, so it is unit-tested with Node's built-in test runner using synthetic hand landmarks:

```bash
npm test
```

## How it works

1. **Tracking.** MediaPipe's gesture recognizer finds 21 points on each hand in every video frame, both on screen and in 3D, and classifies each hand with a trained model (fist, open palm, pointing).
2. **Gestures.** `src/gestures.js` measures how much each finger's joints bend in 3D (so it works however your hand is turned or tilted), the angle between neighbouring fingers and the 3D distance between thumb and index finger, and combines that with the trained model's label to pick a pose (open, spread, fist, pinch, point). Each hand keeps its own track between frames and every landmark goes through a One-Euro filter, so the overlay is steady when your hand is still and keeps up when it moves fast. A small state machine then ignores single-frame pose flickers, only fires explode / assemble when the hand is held still, lets the pointer slip off a part briefly without losing progress, and gives rotation momentum after a flick.
3. **Rendering.** Three.js draws the model with additive blending, glowing edges and a bloom pass, on black. A final pass lays that over your camera feed, dimmed, desaturated and vignetted, so only the hologram glows however bright the room is.
4. **Overlay.** Hand skeletons, the HUD ring and part labels are drawn on a 2D canvas above the 3D scene, so snapshots and recordings include them.

## Project structure

```
index.html          page layout and import map (Three.js, MediaPipe from node_modules)
electron/main.cjs   the Mac app: window, camera permission, file serving, saving
build/              app icon and macOS camera-permission text
models/             MediaPipe gesture recognizer model
serve.py            local web server (no caching, bigger connection queue)
style.css           interface styles
src/main.js         scene, render loop, input, UI
src/gestures.js     pose detection and gesture state machine (pure, unit-tested)
src/hands.js        loads the MediaPipe gesture recognizer
src/overlay.js      skeleton, HUD and label drawing
src/recorder.js     snapshot and video recording
src/calibrate.js    guided gesture calibration recorder
src/holo.js         hologram materials and the Part class
src/models/         the four models
test/               gesture unit tests
```

## Add your own model

Create a file in `src/models/` that returns `{ title, subtitle, root, parts, update }`. Build each piece as a `Part` with a name, a description, a colour and an explode direction, then add it to the `MODELS` list in `src/main.js`. `engine.js` is the simplest example to copy.
