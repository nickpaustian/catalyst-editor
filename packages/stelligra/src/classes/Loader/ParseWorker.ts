/**
 * Parse worker source, bundled as a string so it can be instantiated via a
 * Blob URL without requiring build-tool worker support. The code is plain JS
 * with no imports so it runs in any dedicated Worker context.
 *
 * Protocol:
 *   → { type: 'parse', id: number, format: 'ply'|'sog', buffer: ArrayBuffer }
 *       (buffer is transferred — zero-copy)
 *   ← { type: 'parsed', id: number, result: GaussianSplatData }
 *       (typed array buffers are transferred back — zero-copy)
 *   ← { type: 'error',  id: number, message: string }
 *
 * Multiple requests can be in-flight simultaneously; responses carry the same
 * id as the request so the caller can match them up.
 *
 * Only GaussianSplatData (gaussianSplat parseMode) is supported. Point-cloud
 * mode falls back to main-thread parsing in the Loader.
 */
export const PARSE_WORKER_CODE = /* js */ `
'use strict';

// ============================================================
// Utility
// ============================================================

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ============================================================
// ZIP Reader (for SOG bundles)
// ============================================================

function unzipStoredEntries(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const entries = new Map();
  const SIG_LOCAL   = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD    = 0x06054b50;
  const SIG_DD      = 0x08074b50;
  let cursor = 0;
  const size = u8.length;
  while (cursor + 30 <= size) {
    const sig = dv.getUint32(cursor, true);
    if (sig === SIG_CENTRAL || sig === SIG_EOCD) break;
    if (sig !== SIG_LOCAL) break;
    const gpFlags  = dv.getUint16(cursor + 6,  true);
    const method   = dv.getUint16(cursor + 8,  true);
    const nameLen  = dv.getUint16(cursor + 26, true);
    const extraLen = dv.getUint16(cursor + 28, true);
    if (method !== 0) throw new Error('Unsupported ZIP compression method: ' + method);
    const nameBytes = u8.subarray(cursor + 30, cursor + 30 + nameLen);
    const utf8 = (gpFlags & 0x800) !== 0;
    const name = new TextDecoder(utf8 ? 'utf-8' : 'ascii').decode(nameBytes);
    const headerEnd = cursor + 30 + nameLen + extraLen;
    const useDescriptor = (gpFlags & 0x8) !== 0;
    if (!useDescriptor) {
      const sizeUncomp = dv.getUint32(cursor + 22, true);
      entries.set(name, u8.slice(headerEnd, headerEnd + sizeUncomp));
      cursor = headerEnd + sizeUncomp;
    } else {
      let pos = headerEnd, found = false;
      while (pos + 16 <= size) {
        if (dv.getUint32(pos, true) === SIG_DD) {
          const sizeUncomp = dv.getUint32(pos + 8, true);
          entries.set(name, u8.slice(headerEnd, headerEnd + sizeUncomp));
          cursor = pos + 16;
          found = true;
          break;
        }
        pos++;
      }
      if (!found) throw new Error('ZIP data descriptor not found for: ' + name);
    }
  }
  return entries;
}

// ============================================================
// PLY Parser (Gaussian splat path)
// ============================================================

const SH_C0 = 0.28209479177387814;

function findHeaderEnd(view) {
  const needle = new TextEncoder().encode('end_header\\n');
  for (let i = 0; i < view.length - needle.length; i++) {
    if (view.subarray(i, i + needle.length).every((v, j) => v === needle[j])) return i + needle.length;
  }
  throw new Error('Invalid PLY: no end_header found');
}

function getPropertySize(type) {
  if (type === 'float' || type === 'int' || type === 'uint') return 4;
  if (type === 'double') return 8;
  if (type === 'char' || type === 'uchar') return 1;
  throw new Error('Unknown PLY type: ' + type);
}

function parsePLYHeader(view) {
  const headerEnd = findHeaderEnd(view);
  const headerText = new TextDecoder().decode(view.slice(0, headerEnd));
  const lines = headerText.split('\\n').filter(l => l.trim());
  let vertexCount = 0;
  const properties = [];
  for (const line of lines) {
    const vm = line.match(/element\\s+vertex\\s+(\\d+)/i);
    if (vm) vertexCount = parseInt(vm[1]);
    const pm = line.match(/property\\s+(\\w+)\\s+(\\w+)/i);
    if (pm) properties.push({ type: pm[1], name: pm[2] });
  }
  return {
    format: (headerText.match(/format\\s+(\\S+)/i)?.[1] || 'binary_little_endian'),
    vertexCount,
    properties,
  };
}

function buildFieldMap(properties) {
  const map = new Map();
  let offset = 0;
  for (const p of properties) { map.set(p.name, { offset, type: p.type }); offset += getPropertySize(p.type); }
  return map;
}

function calcStride(properties) { return properties.reduce((s, p) => s + getPropertySize(p.type), 0); }

function readField(dv, offset, type, le) {
  switch (type) {
    case 'float':  return dv.getFloat32(offset, le);
    case 'double': return dv.getFloat64(offset, le);
    case 'int':    return dv.getInt32(offset, le);
    case 'uint':   return dv.getUint32(offset, le);
    case 'char':   return dv.getInt8(offset);
    case 'uchar':  return dv.getUint8(offset);
  }
}

function parsePLYAsGaussianSplat(buffer) {
  const view = new Uint8Array(buffer);
  const header = parsePLYHeader(view);
  if (header.format === 'ascii') throw new Error('ASCII PLY not supported in worker');
  const le = header.format === 'binary_little_endian';
  const headerEnd = findHeaderEnd(view);
  const dv = new DataView(buffer, headerEnd);
  const stride = calcStride(header.properties);
  const count  = header.vertexCount;
  const fm = buildFieldMap(header.properties);

  const xF = fm.get('x'), yF = fm.get('y'), zF = fm.get('z');
  if (!xF || !yF || !zF) throw new Error('PLY missing position fields');

  const s0F = fm.get('scale_0'), s1F = fm.get('scale_1'), s2F = fm.get('scale_2');
  const r0F = fm.get('rot_0'),   r1F = fm.get('rot_1'),   r2F = fm.get('rot_2'), r3F = fm.get('rot_3');
  const f0F = fm.get('f_dc_0'),  f1F = fm.get('f_dc_1'),  f2F = fm.get('f_dc_2');
  const rF  = fm.get('red'),     gF  = fm.get('green'),   bF  = fm.get('blue');
  const opF = fm.get('opacity');

  const frestFields = [];
  for (let i = 0; fm.get('f_rest_' + i); i++) frestFields.push(fm.get('f_rest_' + i));
  const fpc = (frestFields.length / 3) | 0;  // f_rest per channel
  const shPerCh = Math.min(fpc, 15);
  const hasSH = shPerCh >= 3;
  const shDeg = shPerCh >= 8 ? (shPerCh >= 15 ? 3 : 2) : 1;

  const positions   = new Float32Array(count * 3);
  const covariances = new Float32Array(count * 6);
  const colors      = new Uint8Array(count * 4);
  const shCoeffs    = hasSH ? new Float32Array(count * 45) : null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const x = readField(dv, base + xF.offset, xF.type, le);
    const y = readField(dv, base + yF.offset, yF.type, le);
    const z = readField(dv, base + zF.offset, zF.type, le);
    positions[i*3]=x; positions[i*3+1]=y; positions[i*3+2]=z;
    if (x<minX)minX=x; if (y<minY)minY=y; if (z<minZ)minZ=z;
    if (x>maxX)maxX=x; if (y>maxY)maxY=y; if (z>maxZ)maxZ=z;

    const sx = s0F ? Math.exp(readField(dv, base+s0F.offset, s0F.type, le)) : 0.01;
    const sy = s1F ? Math.exp(readField(dv, base+s1F.offset, s1F.type, le)) : 0.01;
    const sz = s2F ? Math.exp(readField(dv, base+s2F.offset, s2F.type, le)) : 0.01;

    let qw = r0F ? readField(dv, base+r0F.offset, r0F.type, le) : 1.0;
    let qx = r1F ? readField(dv, base+r1F.offset, r1F.type, le) : 0.0;
    let qy = r2F ? readField(dv, base+r2F.offset, r2F.type, le) : 0.0;
    let qz = r3F ? readField(dv, base+r3F.offset, r3F.type, le) : 0.0;
    const ql = Math.sqrt(qw*qw+qx*qx+qy*qy+qz*qz);
    if (ql > 1e-6) { qw/=ql; qx/=ql; qy/=ql; qz/=ql; }

    const m00=(1-2*(qy*qy+qz*qz))*sx, m10=(2*(qx*qy+qw*qz))*sx, m20=(2*(qx*qz-qw*qy))*sx;
    const m01=(2*(qx*qy-qw*qz))*sy,   m11=(1-2*(qx*qx+qz*qz))*sy, m21=(2*(qy*qz+qw*qx))*sy;
    const m02=(2*(qx*qz+qw*qy))*sz,   m12=(2*(qy*qz-qw*qx))*sz,   m22=(1-2*(qx*qx+qy*qy))*sz;
    const ci=i*6;
    covariances[ci]  =m00*m00+m01*m01+m02*m02;
    covariances[ci+1]=m00*m10+m01*m11+m02*m12;
    covariances[ci+2]=m00*m20+m01*m21+m02*m22;
    covariances[ci+3]=m10*m10+m11*m11+m12*m12;
    covariances[ci+4]=m10*m20+m11*m21+m12*m22;
    covariances[ci+5]=m20*m20+m21*m21+m22*m22;

    let r=0, g=0, b=0;
    if (f0F && f1F && f2F) {
      r=clamp(Math.round((0.5+SH_C0*readField(dv,base+f0F.offset,f0F.type,le))*255),0,255);
      g=clamp(Math.round((0.5+SH_C0*readField(dv,base+f1F.offset,f1F.type,le))*255),0,255);
      b=clamp(Math.round((0.5+SH_C0*readField(dv,base+f2F.offset,f2F.type,le))*255),0,255);
    } else if (rF && gF && bF) {
      const rv=readField(dv,base+rF.offset,rF.type,le);
      const gv=readField(dv,base+gF.offset,gF.type,le);
      const bv=readField(dv,base+bF.offset,bF.type,le);
      const uc = rF.type==='uchar';
      r=clamp(Math.round(uc?rv:rv*255),0,255);
      g=clamp(Math.round(uc?gv:gv*255),0,255);
      b=clamp(Math.round(uc?bv:bv*255),0,255);
    }
    const alpha = opF
      ? clamp(Math.round((1/(1+Math.exp(-readField(dv,base+opF.offset,opF.type,le))))*255),0,255)
      : 255;
    const ki=i*4;
    colors[ki]=r; colors[ki+1]=g; colors[ki+2]=b; colors[ki+3]=alpha;

    if (shCoeffs) {
      const si = i*45;
      for (let j=0; j<shPerCh; j++) {
        const RF=frestFields[j], GF=frestFields[fpc+j], BF=frestFields[fpc*2+j];
        shCoeffs[si+j]    =RF?readField(dv,base+RF.offset,RF.type,le):0;
        shCoeffs[si+15+j] =GF?readField(dv,base+GF.offset,GF.type,le):0;
        shCoeffs[si+30+j] =BF?readField(dv,base+BF.offset,BF.type,le):0;
      }
    }
  }

  return {
    count, positions, covariances, colors,
    ...(shCoeffs ? { shCoeffs, shDegree: shDeg } : {}),
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

// ============================================================
// SOG Image decoder (WebGL2 path, canvas fallback)
// ============================================================

async function loadImagePixelsFromBlob(blob) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bitmap;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('no webgl2');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fb);
    bitmap.close();
    return { data: raw, width, height };
  } catch (_) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const id = ctx.getImageData(0, 0, width, height);
    return { data: new Uint8Array(id.data.buffer), width, height };
  }
}

// ============================================================
// SOG Parser
// ============================================================

const SOG_SH_C0 = 0.28209479177387814;
const SOG_SH_PER_CH = 8;

function lerp(a, b, t) { return a + (b - a) * t; }
function unlog(n) { return Math.sign(n) * (Math.exp(Math.abs(n)) - 1); }

function reconstructQuat(r, g, b, a) {
  const comp = c => (c / 255 - 0.5) * (2.0 / Math.SQRT2);
  const A=comp(r), B=comp(g), C=comp(b);
  const mode = a - 252;
  const D = Math.sqrt(Math.max(0, 1 - A*A - B*B - C*C));
  let qx, qy, qz, qw;
  switch (mode) {
    case 0: qx=A; qy=B; qz=C; qw=D; break;
    case 1: qx=D; qy=B; qz=C; qw=A; break;
    case 2: qx=B; qy=D; qz=C; qw=A; break;
    case 3: qx=B; qy=C; qz=D; qw=A; break;
    default: throw new Error('Invalid SOG quat mode: ' + mode);
  }
  if (qw < 0) { qx=-qx; qy=-qy; qz=-qz; qw=-qw; }
  const len = Math.sqrt(qx*qx+qy*qy+qz*qz+qw*qw);
  if (len > 1e-6) { qx/=len; qy/=len; qz/=len; qw/=len; }
  return [qx, qy, qz, qw];
}

async function parseSOGBundle(buffer) {
  const files = unzipStoredEntries(buffer);
  const metaBytes = files.get('meta.json');
  if (!metaBytes) throw new Error('SOG bundle missing meta.json');
  const meta = JSON.parse(new TextDecoder().decode(metaBytes));

  const hasSHN = !!(meta.shN && meta.shN.bands && meta.shN.files.length >= 2);
  const shNCoeffsTotal = hasSHN ? ([0,3,8,15][meta.shN.bands] ?? 0) : 0;

  const resolver = async name => {
    const bytes = files.get(name);
    if (!bytes) throw new Error('SOG bundle missing: ' + name);
    return loadImagePixelsFromBlob(new Blob([bytes], { type: 'image/webp' }));
  };

  const [[meansL, meansU, quats, scalesImg, sh0Img], shNImgList] = await Promise.all([
    Promise.all([
      resolver(meta.means.files[0]),
      resolver(meta.means.files[1]),
      resolver(meta.quats.files[0]),
      resolver(meta.scales.files[0]),
      resolver(meta.sh0.files[0]),
    ]),
    hasSHN ? Promise.all(meta.shN.files.map(f => resolver(f))) : Promise.resolve(null),
  ]);

  let labelsImg = null, centroidsImg = null;
  if (hasSHN && shNImgList) {
    const isF0Labels = /label/i.test(meta.shN.files[0]);
    labelsImg    = isF0Labels ? shNImgList[0] : shNImgList[1];
    centroidsImg = isF0Labels ? shNImgList[1] : shNImgList[0];
  }

  const imgWidth = meansL.width;
  const count    = Math.min(meta.count, imgWidth * meansL.height);
  const sh0CB    = meta.sh0.codebook;
  const scaleCB  = meta.scales.codebook;
  const shNCB    = hasSHN ? meta.shN.codebook : null;

  const positions   = new Float32Array(count * 3);
  const covariances = new Float32Array(count * 6);
  const colors      = new Uint8Array(count * 4);
  const shCoeffs    = hasSHN ? new Float32Array(count * 45) : null;

  let minX=Infinity, minY=Infinity, minZ=Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;

  for (let i = 0; i < count; i++) {
    const px = i % imgWidth, py = (i / imgWidth) | 0;
    const idx = (px + py * imgWidth) * 4;

    const x = unlog(lerp(meta.means.mins[0], meta.means.maxs[0], ((meansU.data[idx]<<8)|meansL.data[idx])/65535));
    const y = unlog(lerp(meta.means.mins[1], meta.means.maxs[1], ((meansU.data[idx+1]<<8)|meansL.data[idx+1])/65535));
    const z = unlog(lerp(meta.means.mins[2], meta.means.maxs[2], ((meansU.data[idx+2]<<8)|meansL.data[idx+2])/65535));
    positions[i*3]=x; positions[i*3+1]=y; positions[i*3+2]=z;
    if (x<minX)minX=x; if (y<minY)minY=y; if (z<minZ)minZ=z;
    if (x>maxX)maxX=x; if (y>maxY)maxY=y; if (z>maxZ)maxZ=z;

    const sx=Math.exp(scaleCB[scalesImg.data[idx]]);
    const sy=Math.exp(scaleCB[scalesImg.data[idx+1]]);
    const sz=Math.exp(scaleCB[scalesImg.data[idx+2]]);
    const [qx,qy,qz,qw]=reconstructQuat(quats.data[idx],quats.data[idx+1],quats.data[idx+2],quats.data[idx+3]);

    const m00=(1-2*(qy*qy+qz*qz))*sx, m10=(2*(qx*qy+qw*qz))*sx, m20=(2*(qx*qz-qw*qy))*sx;
    const m01=(2*(qx*qy-qw*qz))*sy,   m11=(1-2*(qx*qx+qz*qz))*sy, m21=(2*(qy*qz+qw*qx))*sy;
    const m02=(2*(qx*qz+qw*qy))*sz,   m12=(2*(qy*qz-qw*qx))*sz,   m22=(1-2*(qx*qx+qy*qy))*sz;
    const ci=i*6;
    covariances[ci]  =m00*m00+m01*m01+m02*m02;
    covariances[ci+1]=m00*m10+m01*m11+m02*m12;
    covariances[ci+2]=m00*m20+m01*m21+m02*m22;
    covariances[ci+3]=m10*m10+m11*m11+m12*m12;
    covariances[ci+4]=m10*m20+m11*m21+m12*m22;
    covariances[ci+5]=m20*m20+m21*m21+m22*m22;

    const ki=i*4;
    colors[ki]  =clamp(Math.round((0.5+sh0CB[sh0Img.data[idx]]*SOG_SH_C0)*255),0,255);
    colors[ki+1]=clamp(Math.round((0.5+sh0CB[sh0Img.data[idx+1]]*SOG_SH_C0)*255),0,255);
    colors[ki+2]=clamp(Math.round((0.5+sh0CB[sh0Img.data[idx+2]]*SOG_SH_C0)*255),0,255);
    colors[ki+3]=sh0Img.data[idx+3];

    if (shCoeffs && shNCB && labelsImg && centroidsImg) {
      const label = labelsImg.data[idx] | (labelsImg.data[idx+1] << 8);
      const labelCol=(label%64), labelRow=((label/64)|0);
      const cW=centroidsImg.width;
      const si=i*45;
      for (let j=0; j<SOG_SH_PER_CH; j++) {
        const u    = labelCol*shNCoeffsTotal+j;
        const cidx = (labelRow*cW+u)*4;
        shCoeffs[si+j]   =shNCB[centroidsImg.data[cidx]]   ??0;
        shCoeffs[si+15+j]=shNCB[centroidsImg.data[cidx+1]] ??0;
        shCoeffs[si+30+j]=shNCB[centroidsImg.data[cidx+2]] ??0;
      }
    }
  }

  return {
    count, positions, covariances, colors,
    ...(shCoeffs ? { shCoeffs, shDegree: 2 } : {}),
    bounds: { min:[minX,minY,minZ], max:[maxX,maxY,maxZ] },
  };
}

// ============================================================
// Message handler
// ============================================================

self.onmessage = async function(e) {
  const { type, id, format, buffer } = e.data;
  if (type !== 'parse') return;
  try {
    let result;
    if (format === 'ply') {
      result = parsePLYAsGaussianSplat(buffer);
    } else if (format === 'sog') {
      result = await parseSOGBundle(buffer);
    } else {
      throw new Error('Unknown format: ' + format);
    }
    const transferables = [result.positions.buffer, result.covariances.buffer, result.colors.buffer];
    if (result.shCoeffs) transferables.push(result.shCoeffs.buffer);
    self.postMessage({ type: 'parsed', id, result }, transferables);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err.message });
  }
};
`
