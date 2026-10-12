/**
 * Bake worker source, bundled as a string (Blob URL).
 *
 * Transforms local-space positions and covariances to world space off the
 * main thread, eliminating the per-add stutter caused by running
 * _bakeWorldSpace() synchronously.
 *
 * Protocol:
 *   → { type: 'bake', positions: Float32Array, covariances: Float32Array,
 *                      worldMatrix: Float32Array (16), normalMatrix: Float32Array (9),
 *                      slotStart: number, meshId: number, count: number }
 *   ← { type: 'baked', positions: Float32Array, covariances: Float32Array,
 *                       slotStart: number, meshId: number }
 *
 * positions and covariances are transferred (zero-copy) in both directions.
 */
export const BAKE_WORKER_CODE = /* js */ `
'use strict';

self.onmessage = function(e) {
  const msg = e.data;
  if (msg.type !== 'bake') return;

  const { positions, covariances, worldMatrix: me, normalMatrix: nm,
          slotStart, meshId, count } = msg;

  const outPos = new Float32Array(count * 3);
  const outCov = new Float32Array(count * 6);

  for (let i = 0; i < count; i++) {
    // ---- Position (full 4×4 transform) ----------------------------------------
    const si = i * 3;
    const sx = positions[si], sy = positions[si + 1], sz = positions[si + 2];
    outPos[si]     = me[0]*sx + me[4]*sy + me[8] *sz + me[12];
    outPos[si + 1] = me[1]*sx + me[5]*sy + me[9] *sz + me[13];
    outPos[si + 2] = me[2]*sx + me[6]*sy + me[10]*sz + me[14];

    // ---- Covariance: Σ_world = N × Σ_local × Nᵀ --------------------------------
    const M11 = covariances[i * 6],     M12 = covariances[i * 6 + 1], M13 = covariances[i * 6 + 2];
    const M22 = covariances[i * 6 + 3], M23 = covariances[i * 6 + 4], M33 = covariances[i * 6 + 5];

    const NS00 = nm[0]*M11 + nm[3]*M12 + nm[6]*M13;
    const NS01 = nm[0]*M12 + nm[3]*M22 + nm[6]*M23;
    const NS02 = nm[0]*M13 + nm[3]*M23 + nm[6]*M33;
    const NS10 = nm[1]*M11 + nm[4]*M12 + nm[7]*M13;
    const NS11 = nm[1]*M12 + nm[4]*M22 + nm[7]*M23;
    const NS12 = nm[1]*M13 + nm[4]*M23 + nm[7]*M33;
    const NS20 = nm[2]*M11 + nm[5]*M12 + nm[8]*M13;
    const NS21 = nm[2]*M12 + nm[5]*M22 + nm[8]*M23;
    const NS22 = nm[2]*M13 + nm[5]*M23 + nm[8]*M33;

    const ci = i * 6;
    outCov[ci]     = NS00*nm[0] + NS01*nm[3] + NS02*nm[6];
    outCov[ci + 1] = NS00*nm[1] + NS01*nm[4] + NS02*nm[7];
    outCov[ci + 2] = NS00*nm[2] + NS01*nm[5] + NS02*nm[8];
    outCov[ci + 3] = NS10*nm[1] + NS11*nm[4] + NS12*nm[7];
    outCov[ci + 4] = NS10*nm[2] + NS11*nm[5] + NS12*nm[8];
    outCov[ci + 5] = NS20*nm[2] + NS21*nm[5] + NS22*nm[8];
  }

  self.postMessage(
    { type: 'baked', positions: outPos, covariances: outCov, slotStart, meshId },
    [outPos.buffer, outCov.buffer],
  );
};
`
