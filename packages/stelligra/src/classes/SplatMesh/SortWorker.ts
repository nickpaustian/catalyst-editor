/**
 * Sort worker — depth-sorts splats back-to-front each frame.
 *
 * Positions are resident in the worker: the main thread streams slot ranges in
 * once, when a slice is uploaded, instead of copying the whole position buffer
 * on every sort.
 *
 * Sort key is radial distance from the camera, not view-space depth. Radial
 * distance is invariant under camera rotation, so a sort that lags a frame or
 * two behind the camera stays correct while turning quickly — view-space
 * depth order goes stale the moment the camera rotates, which shows up as
 * tearing / popping.
 *
 * Sort is a single-pass 16-bit counting sort over distance quantised between
 * the nearest and furthest visible splat.
 *
 * Optional frustum cull: disabled when `cullMarginX` is 0. The main thread
 * widens the margin with camera angular velocity so the culled set covers
 * where the camera will be by the time the result is drawn.
 *
 * Protocol:
 *   → { type: 'reserve', capacity }
 *   → { type: 'positions', slotStart, count, data: Float32Array }  // count × 4 (XYZW), transferred
 *   → { type: 'sort',
 *       camPos:   [x, y, z],
 *       mvp:      Float32Array,   // 16-element column-major MVP (copied)
 *       cullMarginX, cullMarginY,  // clip-space margins, 0 = no cull
 *       deadMask?: Uint8Array,     // bit-per-slot, only sent when changed
 *       count,
 *       indicesBuffer?: ArrayBuffer }
 *   ← { type: 'sorted', indices: Uint32Array, visibleCount, msSort }
 *
 *   → { type: 'benchmark', ...sort fields, iterations }
 *   ← { type: 'benchmarkResult', iterations, splats, msPerSort }
 */
export const SORT_WORKER_CODE = /* js */ `
'use strict';

const BUCKETS = 65536;
const counts = new Uint32Array(BUCKETS);

let positions = new Float32Array(0);  // capacity × 4, slot-indexed
let deadMask  = new Uint8Array(0);
let dist      = new Float32Array(0);  // per visible splat
let visIdx    = new Uint32Array(0);   // slot index per visible splat
let bucketOf  = new Uint16Array(0);   // bucket per visible splat

function reserve(capacity) {
  if (positions.length >= capacity * 4) return;
  const p = new Float32Array(capacity * 4);
  p.set(positions);
  positions = p;
  const d = new Uint8Array(Math.ceil(capacity / 32) * 4);
  d.fill(0xFF);
  d.set(deadMask);
  deadMask = d;
}

function ensureScratch(count) {
  if (dist.length >= count) return;
  dist     = new Float32Array(count);
  visIdx   = new Uint32Array(count);
  bucketOf = new Uint16Array(count);
}

/**
 * Collect live (and optionally in-frustum) splats with their radial distance,
 * then counting-sort far → near into outIdx. Returns the visible count.
 */
function sortSplats(msg, outIdx) {
  const count = msg.count;
  ensureScratch(count);

  const cx = msg.camPos[0], cy = msg.camPos[1], cz = msg.camPos[2];
  const m = msg.mvp;
  const m0 = m[0], m4 = m[4], m8  = m[8],  m12 = m[12];
  const m1 = m[1], m5 = m[5], m9  = m[9],  m13 = m[13];
  const m3 = m[3], m7 = m[7], m11 = m[11], m15 = m[15];
  const mx = msg.cullMarginX, my = msg.cullMarginY;
  const cull = mx > 0;

  const dead32 = new Uint32Array(deadMask.buffer, 0, Math.ceil(count / 32));
  let vis = 0;
  let minD = Infinity, maxD = 0;

  for (let word = 0; word < dead32.length; word++) {
    const bits = dead32[word];
    if (bits === 0xFFFFFFFF) continue;
    const base = word * 32;
    const end = Math.min(base + 32, count);
    for (let i = base; i < end; i++) {
      if (bits & (1 << (i - base))) continue;
      const p = i * 4;
      const x = positions[p], y = positions[p + 1], z = positions[p + 2];
      if (cull) {
        const w = m3 * x + m7 * y + m11 * z + m15;
        if (w <= 0) continue;
        const clipX = m0 * x + m4 * y + m8 * z + m12;
        if (clipX > mx * w || clipX < -mx * w) continue;
        const clipY = m1 * x + m5 * y + m9 * z + m13;
        if (clipY > my * w || clipY < -my * w) continue;
      }
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dist[vis] = d;
      visIdx[vis] = i;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      vis++;
    }
  }

  if (vis === 0) return 0;

  // Far splats → low buckets, so ascending bucket order is back-to-front.
  const scale = maxD > minD ? (BUCKETS - 1) / (maxD - minD) : 0;
  counts.fill(0);
  for (let k = 0; k < vis; k++) {
    const b = ((maxD - dist[k]) * scale) | 0;
    bucketOf[k] = b;
    counts[b]++;
  }

  let sum = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const c = counts[b];
    counts[b] = sum;
    sum += c;
  }

  for (let k = 0; k < vis; k++) {
    outIdx[counts[bucketOf[k]]++] = visIdx[k];
  }

  return vis;
}

self.onmessage = function(e) {
  const msg = e.data;

  if (msg.type === 'reserve') {
    reserve(msg.capacity);
    return;
  }

  if (msg.type === 'positions') {
    reserve(msg.slotStart + msg.count);
    positions.set(msg.data.subarray(0, msg.count * 4), msg.slotStart * 4);
    return;
  }

  if (msg.deadMask) {
    reserve(msg.deadMask.length * 8);
    deadMask.set(msg.deadMask);
  }

  if (msg.type === 'sort') {
    const t0 = performance.now();
    let out = msg.indicesBuffer ? new Uint32Array(msg.indicesBuffer) : null;
    if (!out || out.length < msg.count) out = new Uint32Array(msg.count);

    const visibleCount = sortSplats(msg, out);

    self.postMessage(
      { type: 'sorted', indices: out, visibleCount, msSort: performance.now() - t0 },
      [out.buffer],
    );
    return;
  }

  if (msg.type === 'benchmark') {
    const n = msg.iterations || 100;
    const out = new Uint32Array(msg.count);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) sortSplats(msg, out);
    const msPerSort = (performance.now() - t0) / n;
    self.postMessage({ type: 'benchmarkResult', iterations: n, splats: msg.count, msPerSort });
  }
};
`
