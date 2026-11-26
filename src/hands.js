// Loads MediaPipe's gesture recognizer. It tracks 21 landmarks per hand
// (in screen space and in 3D "world" space) and also classifies each hand
// with a trained model (Closed_Fist, Open_Palm, Pointing_Up, ...).
// Everything runs locally in the browser: the camera feed is never uploaded.
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

// Everything is bundled with the app, so it works offline.
const WASM = new URL('../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href;
const MODEL = new URL('../models/gesture_recognizer.task', import.meta.url).href;

export async function createHandTracker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let recognizer;
  try {
    recognizer = await GestureRecognizer.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU hand tracking unavailable, falling back to CPU', err);
    recognizer = await GestureRecognizer.createFromOptions(fileset, options('CPU'));
  }

  // Returns one entry per hand: normalised screen landmarks, world landmarks
  // in millimetres, and the recognizer's top gesture label with its score.
  return {
    detect(video, timestamp) {
      const res = recognizer.recognizeForVideo(video, timestamp);
      return (res.landmarks || []).map((landmarks, i) => {
        const top = res.gestures?.[i]?.[0];
        return {
          landmarks,
          world: res.worldLandmarks?.[i]?.map((p) => ({ x: -p.x * 1000, y: p.y * 1000, z: p.z * 1000 })),
          gesture: top?.categoryName ?? null,
          score: top?.score ?? 0,
        };
      });
    },
  };
}
