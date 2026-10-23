// Pose de la Transmisión Instantánea: índice y corazón juntos, en la frente.
(function (root) {
  'use strict';

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function finite(point) {
    return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  function isForeheadTouch(hand, face) {
    if (!Array.isArray(hand) || hand.length < 21 || !Array.isArray(face) || face.length < 468) return false;
    const handIds = [0, 5, 6, 8, 9, 10, 12, 14, 16, 17, 18, 20];
    const faceIds = [10, 33, 263, 234, 454];
    if (handIds.some((id) => !finite(hand[id])) || faceIds.some((id) => !finite(face[id]))) return false;

    const wrist = hand[0];
    const palm = dist(hand[5], hand[17]);
    const faceWidth = dist(face[234], face[454]);
    if (palm < 1e-4 || faceWidth < 1e-4) return false;

    const extended = (tip, pip) => dist(wrist, hand[tip]) > dist(wrist, hand[pip]) * 1.12;
    const folded = (tip, pip) => dist(wrist, hand[tip]) < dist(wrist, hand[pip]) * 1.08;
    if (!extended(8, 6) || !extended(12, 10) || !folded(16, 14) || !folded(20, 18)) return false;
    if (dist(hand[8], hand[12]) > palm * 0.55) return false;

    const mid = { x: (hand[8].x + hand[12].x) / 2, y: (hand[8].y + hand[12].y) / 2 };
    if (dist(mid, face[10]) > faceWidth * 0.42) return false;
    const eyeY = (face[33].y + face[263].y) / 2;
    return mid.y <= eyeY + faceWidth * 0.08;
  }

  // Hay que soltar la pose antes de poder repetirla.
  function createHold(options = {}) {
    const holdMs = options.holdMs ?? 480;
    const releaseMs = options.releaseMs ?? 700;
    let since = null;
    let armed = true;
    let lastFire = -Infinity;
    return {
      update(active, now) {
        if (!Number.isFinite(now)) return { triggered: false, progress: 0 };
        if (!active) {
          since = null;
          if (now - lastFire >= releaseMs) armed = true;
          return { triggered: false, progress: 0 };
        }
        if (!armed) return { triggered: false, progress: 1 };
        if (since === null) since = now;
        const progress = Math.min(1, (now - since) / holdMs);
        if (now - since < holdMs) return { triggered: false, progress };
        lastFire = now;
        armed = false;
        since = null;
        return { triggered: true, progress: 1 };
      },
    };
  }

  const api = { isForeheadTouch, createHold };
  root.MeetTeleportGesture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
