import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isForeheadTouch, createHold } = require('../extension/src/gesture-rules.js');

function point(x, y) {
  return { x, y };
}

function faceAt(forehead) {
  const face = Array.from({ length: 478 }, () => point(0.5, 0.5));
  face[234] = point(0.32, 0.42);
  face[454] = point(0.68, 0.42);
  face[10] = forehead;
  face[33] = point(0.42, 0.40);
  face[263] = point(0.58, 0.40);
  return face;
}

function touchingHand() {
  const hand = Array.from({ length: 21 }, () => point(0.5, 0.6));
  hand[0] = point(0.50, 0.62);
  hand[5] = point(0.46, 0.48);
  hand[17] = point(0.58, 0.50);
  hand[6] = point(0.48, 0.38);
  hand[8] = point(0.50, 0.25);
  hand[9] = point(0.52, 0.48);
  hand[10] = point(0.51, 0.38);
  hand[12] = point(0.51, 0.25);
  hand[14] = point(0.54, 0.52);
  hand[16] = point(0.54, 0.58);
  hand[18] = point(0.57, 0.52);
  hand[20] = point(0.57, 0.59);
  return hand;
}

const face = faceAt(point(0.50, 0.24));
assert.equal(isForeheadTouch(touchingHand(), face), true);

const spread = touchingHand();
spread[12] = point(0.78, 0.25);
assert.equal(isForeheadTouch(spread, face), false);

const low = touchingHand();
low[8] = point(0.50, 0.55);
low[12] = point(0.51, 0.55);
assert.equal(isForeheadTouch(low, face), false);

assert.equal(isForeheadTouch(touchingHand().slice(0, 10), face), false);

const hold = createHold({ holdMs: 100, releaseMs: 50 });
assert.equal(hold.update(true, 0).triggered, false);
assert.equal(hold.update(true, 120).triggered, true);
assert.equal(hold.update(true, 200).triggered, false);
assert.equal(hold.update(false, 260).progress, 0);
assert.equal(hold.update(true, 400).triggered, false);
assert.equal(hold.update(true, 510).triggered, true);

console.log('gesto ok');
