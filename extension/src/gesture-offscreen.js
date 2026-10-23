import { FaceLandmarker, FilesetResolver, HandLandmarker } from '../vendor/vision_bundle.mjs';

let modelsPromise = null;
let busy = false;

function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const files = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/wasm'));
      const hand = await HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL('models/hand_landmarker.task'),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      const face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL('models/face_landmarker.task'),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      return { hand, face };
    })().catch((err) => {
      modelsPromise = null;
      throw err;
    });
  }
  return modelsPromise;
}

async function detect(image) {
  if (busy) return { ok: true, skipped: true, gesture: false };
  busy = true;
  let bitmap = null;
  try {
    if (typeof image !== 'string' || image.length > 250000 || !image.startsWith('data:image/jpeg;base64,')) {
      return { ok: false, gesture: false };
    }
    const models = await loadModels();
    const bytes = Uint8Array.from(atob(image.slice(image.indexOf(',') + 1)), (char) => char.charCodeAt(0));
    bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    if (bitmap.width > 512 || bitmap.height > 512) return { ok: false, gesture: false };
    const hands = models.hand.detect(bitmap);
    const faces = models.face.detect(bitmap);
    const face = faces.faceLandmarks?.[0];
    const rules = globalThis.MeetTeleportGesture;
    const gesture = Boolean(face) && (hands.landmarks || []).some((hand) => rules.isForeheadTouch(hand, face));
    return {
      ok: true,
      gesture,
      hand: Boolean(hands.landmarks?.length),
      face: Boolean(face),
    };
  } catch (err) {
    console.warn('[meeteleport] no se pudo leer la pose', err);
    return { ok: false, gesture: false };
  } finally {
    bitmap?.close();
    busy = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'MEETELEPORT_OFFSCREEN') return false;
  if (message.type !== 'DETECT') return false;
  detect(message.image).then(sendResponse);
  return true;
});
