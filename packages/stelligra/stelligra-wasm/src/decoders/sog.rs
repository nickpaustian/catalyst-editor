use wasm_bindgen::prelude::*;
use serde::Deserialize;
use std::io::Cursor;
use std::collections::HashMap;

const SH_C0: f32 = 0.28209479177387814;

// ---------------------------------------------------------------------------
// Meta types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum SogRoot {
	V2(SogV2),
	V1(SogV1),
}

#[derive(Debug, Deserialize)]
struct SogV2 {
	count: usize,
	means: Means,
	scales: ScalesV2,
	quats: Quats,
	sh0: Sh0V2,
	#[serde(rename = "shN")]
	sh_n: Option<ShNV2>,
}

#[derive(Debug, Deserialize)]
struct ShNV2 {
	bands: usize,
	codebook: Vec<f32>,
	files: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SogV1 {
	means: MeansV1,
	scales: ScalesV1,
	quats: Quats,
	sh0: Sh0V1,
}

#[derive(Debug, Deserialize)]
struct Means {
	files: Vec<String>,
	mins: [f32; 3],
	maxs: [f32; 3],
}

#[derive(Debug, Deserialize)]
struct MeansV1 {
	files: Vec<String>,
	mins: [f32; 3],
	maxs: [f32; 3],
	shape: [usize; 2],
}

#[derive(Debug, Deserialize)]
struct ScalesV2 {
	files: Vec<String>,
	codebook: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct ScalesV1 {
	files: Vec<String>,
	mins: [f32; 3],
	maxs: [f32; 3],
}

#[derive(Debug, Deserialize)]
struct Quats {
	files: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Sh0V2 {
	files: Vec<String>,
	codebook: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct Sh0V1 {
	files: Vec<String>,
	mins: [f32; 4],
	maxs: [f32; 4],
}

// ---------------------------------------------------------------------------
// ZIP reader
// ---------------------------------------------------------------------------

fn unzip_entries(data: &[u8]) -> Result<HashMap<String, Vec<u8>>, String> {
	let cursor = Cursor::new(data);
	let mut archive = zip::ZipArchive::new(cursor)
		.map_err(|e| format!("ZIP open failed: {e}"))?;

	let mut files = HashMap::new();

	// Find prefix from meta.json location
	let mut prefix = String::new();
	for i in 0..archive.len() {
		let entry = archive.by_index(i).map_err(|e| e.to_string())?;
		let name = entry.name().to_string();
		if name.ends_with("meta.json") {
			if let Some(pos) = name.rfind('/') {
				prefix = format!("{}/", &name[..pos]);
			}
			break;
		}
	}

	for i in 0..archive.len() {
		let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
		let raw_name = entry.name().to_string();
		// Strip prefix for map key
		let key = if raw_name.starts_with(&prefix) {
			raw_name[prefix.len()..].to_string()
		} else {
			raw_name
		};
		let mut bytes = Vec::new();
		std::io::copy(&mut entry, &mut bytes).map_err(|e| e.to_string())?;
		files.insert(key, bytes);
	}

	Ok(files)
}

// ---------------------------------------------------------------------------
// Image decode
// ---------------------------------------------------------------------------

struct ImgData {
	rgba: Vec<u8>,
	width: usize,
}

fn decode_img(bytes: &[u8]) -> Result<ImgData, String> {
	let img = image::load_from_memory(bytes)
		.map_err(|e| format!("Image decode failed: {e}"))?;
	let (width, height) = (img.width() as usize, img.height() as usize);
	let rgba = img.to_rgba8().into_raw();
	Ok(ImgData { rgba, width })
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
	a + (b - a) * t
}

#[inline]
fn unlog(n: f32) -> f32 {
	n.signum() * (n.abs().exp() - 1.0)
}

#[inline]
fn clamp_u8(v: f32) -> u8 {
	(v * 255.0 + 0.5).clamp(0.0, 255.0) as u8
}

fn reconstruct_quaternion(r: u8, g: u8, b: u8, a: u8) -> (f32, f32, f32, f32) {
	let s = 2.0_f32.sqrt();
	let fa = |c: u8| (c as f32 / 255.0 - 0.5) * (2.0 / s);
	let (ca, cb, cc) = (fa(r), fa(g), fa(b));
	let mode = a as i32 - 252;
	let t = ca * ca + cb * cb + cc * cc;
	let d = (1.0_f32 - t).max(0.0).sqrt();
	let (mut qx, mut qy, mut qz, mut qw) = match mode {
		0 => (ca, cb, cc, d),
		1 => (d,  cb, cc, ca),
		2 => (cb, d,  cc, ca),
		3 => (cb, cc, d,  ca),
		_ => (0.0, 0.0, 0.0, 1.0),
	};
	if qw < 0.0 { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
	let len = (qx*qx + qy*qy + qz*qz + qw*qw).sqrt();
	if len > 1e-6 { qx/=len; qy/=len; qz/=len; qw/=len; }
	(qx, qy, qz, qw)
}

// ---------------------------------------------------------------------------
// Core decode
// ---------------------------------------------------------------------------

struct DecodedSplats {
	count: usize,
	positions: Vec<f32>,    // count × 3
	covariances: Vec<f32>,  // count × 6
	colors: Vec<u8>,        // count × 4
	sh: Vec<u32>,           // count × sh_stride, see pack_sh
}

/// Coefficients per colour channel for each SH band count.
const SH_COEFFS: [usize; 4] = [0, 3, 8, 15];

/// u32s per splat in the packed SH output: a scale followed by one
/// 11/10/11 word per coefficient, padded to 1 or 4 RGBA32UI texels so a
/// splat's SH never straddles a texture row.
pub fn sh_stride(bands: usize) -> usize {
	match bands {
		0 => 0,
		1 => 4,
		_ => 16,
	}
}

/// Pack RGB coefficients (coeffs × 3, channel-interleaved) as
/// [scale, (r11 << 21) | (g10 << 11) | b11, ...] where each channel maps
/// [-scale, scale] onto its bit range.
fn pack_sh(coeffs: &[f32], out: &mut [u32]) {
	let scale = coeffs.iter().fold(0.0f32, |m, v| m.max(v.abs()));
	out[0] = scale.to_bits();
	let inv = if scale > 0.0 { 1.0 / scale } else { 0.0 };
	let quantise = |v: f32, max: f32| ((v * inv * 0.5 + 0.5) * max + 0.5).clamp(0.0, max) as u32;
	for (k, c) in coeffs.chunks(3).enumerate() {
		out[k + 1] = (quantise(c[0], 2047.0) << 21) | (quantise(c[1], 1023.0) << 11) | quantise(c[2], 2047.0);
	}
}

fn decode_sh_v2(
	sh_n: &ShNV2,
	files: &HashMap<String, Vec<u8>>,
	count: usize,
	img_w: usize,
	bands: usize,
) -> Result<Vec<u32>, String> {
	let stride = sh_stride(bands);
	let mut sh = vec![0u32; count * stride];
	if stride == 0 {
		return Ok(sh);
	}

	let centroids = decode_img(files.get(&sh_n.files[0]).ok_or("Missing shN centroids")?)?;
	let labels = decode_img(files.get(&sh_n.files[1]).ok_or("Missing shN labels")?)?;
	let stored_coeffs = SH_COEFFS[sh_n.bands.min(3)];
	let used_coeffs = SH_COEFFS[bands].min(stored_coeffs);
	let book = &sh_n.codebook;
	let mut coeffs = vec![0.0f32; SH_COEFFS[bands] * 3];

	for i in 0..count {
		let idx = ((i % img_w) + (i / img_w) * labels.width) * 4;
		let label = labels.rgba[idx] as usize | (labels.rgba[idx + 1] as usize) << 8;
		let u = (label % 64) * stored_coeffs;
		let v = label / 64;
		for k in 0..used_coeffs {
			let t = ((u + k) + v * centroids.width) * 4;
			coeffs[k * 3] = book[centroids.rgba[t] as usize];
			coeffs[k * 3 + 1] = book[centroids.rgba[t + 1] as usize];
			coeffs[k * 3 + 2] = book[centroids.rgba[t + 2] as usize];
		}
		pack_sh(&coeffs, &mut sh[i * stride..(i + 1) * stride]);
	}

	Ok(sh)
}

fn decode_v2(meta: SogV2, files: &HashMap<String, Vec<u8>>, sh_bands: usize) -> Result<DecodedSplats, String> {
	let count = meta.count;

	let means_l = decode_img(files.get(&meta.means.files[0])
		.ok_or("Missing means[0]")?)?;
	let means_u = decode_img(files.get(&meta.means.files[1])
		.ok_or("Missing means[1]")?)?;
	let quats   = decode_img(files.get(&meta.quats.files[0])
		.ok_or("Missing quats")?)?;
	let scales  = decode_img(files.get(&meta.scales.files[0])
		.ok_or("Missing scales")?)?;
	let sh0     = decode_img(files.get(&meta.sh0.files[0])
		.ok_or("Missing sh0")?)?;

	let img_w = means_l.width;
	let sc = &meta.scales.codebook;
	let sh = &meta.sh0.codebook;

	let mut positions   = vec![0.0f32; count * 3];
	let mut covariances = vec![0.0f32; count * 6];
	let mut colors      = vec![0u8; count * 4];

	for i in 0..count {
		let px = i % img_w;
		let py = i / img_w;
		let idx = (px + py * img_w) * 4;

		// Position
		let qx16 = ((means_u.rgba[idx]   as u16) << 8) | means_l.rgba[idx]   as u16;
		let qy16 = ((means_u.rgba[idx+1] as u16) << 8) | means_l.rgba[idx+1] as u16;
		let qz16 = ((means_u.rgba[idx+2] as u16) << 8) | means_l.rgba[idx+2] as u16;
		let x = unlog(lerp(meta.means.mins[0], meta.means.maxs[0], qx16 as f32 / 65535.0));
		let y = unlog(lerp(meta.means.mins[1], meta.means.maxs[1], qy16 as f32 / 65535.0));
		let z = unlog(lerp(meta.means.mins[2], meta.means.maxs[2], qz16 as f32 / 65535.0));
		positions[i*3]   = x;
		positions[i*3+1] = y;
		positions[i*3+2] = z;

		// Scale
		let sx = sc[scales.rgba[idx]   as usize].exp();
		let sy = sc[scales.rgba[idx+1] as usize].exp();
		let sz = sc[scales.rgba[idx+2] as usize].exp();

		// Rotation → covariance
		let (qx, qy, qz, qw) = reconstruct_quaternion(
			quats.rgba[idx], quats.rgba[idx+1],
			quats.rgba[idx+2], quats.rgba[idx+3],
		);
		let m00=(1.0-2.0*(qy*qy+qz*qz))*sx; let m10=(2.0*(qx*qy+qw*qz))*sx; let m20=(2.0*(qx*qz-qw*qy))*sx;
		let m01=(2.0*(qx*qy-qw*qz))*sy;     let m11=(1.0-2.0*(qx*qx+qz*qz))*sy; let m21=(2.0*(qy*qz+qw*qx))*sy;
		let m02=(2.0*(qx*qz+qw*qy))*sz;     let m12=(2.0*(qy*qz-qw*qx))*sz; let m22=(1.0-2.0*(qx*qx+qy*qy))*sz;

		let ci = i * 6;
		covariances[ci]  =m00*m00+m01*m01+m02*m02;
		covariances[ci+1]=m00*m10+m01*m11+m02*m12;
		covariances[ci+2]=m00*m20+m01*m21+m02*m22;
		covariances[ci+3]=m10*m10+m11*m11+m12*m12;
		covariances[ci+4]=m10*m20+m11*m21+m12*m22;
		covariances[ci+5]=m20*m20+m21*m21+m22*m22;

		// Color
		let ki = i * 4;
		colors[ki]   = clamp_u8(SH_C0 * sh[sh0.rgba[idx]   as usize] + 0.5);
		colors[ki+1] = clamp_u8(SH_C0 * sh[sh0.rgba[idx+1] as usize] + 0.5);
		colors[ki+2] = clamp_u8(SH_C0 * sh[sh0.rgba[idx+2] as usize] + 0.5);
		colors[ki+3] = sh0.rgba[idx+3];
	}

	let sh = match &meta.sh_n {
		Some(sh_n) => decode_sh_v2(sh_n, files, count, img_w, sh_bands)?,
		None => vec![0u32; count * sh_stride(sh_bands)],
	};

	Ok(DecodedSplats { count, positions, covariances, colors, sh })
}

fn decode_v1(meta: SogV1, files: &HashMap<String, Vec<u8>>, sh_bands: usize) -> Result<DecodedSplats, String> {
	let count = meta.means.shape[0];

	let means_l = decode_img(files.get(&meta.means.files[0])
		.ok_or("Missing means[0]")?)?;
	let means_u = decode_img(files.get(&meta.means.files[1])
		.ok_or("Missing means[1]")?)?;
	let quats   = decode_img(files.get(&meta.quats.files[0])
		.ok_or("Missing quats")?)?;
	let scales  = decode_img(files.get(&meta.scales.files[0])
		.ok_or("Missing scales")?)?;
	let sh0     = decode_img(files.get(&meta.sh0.files[0])
		.ok_or("Missing sh0")?)?;

	let img_w = means_l.width;

	let mut positions   = vec![0.0f32; count * 3];
	let mut covariances = vec![0.0f32; count * 6];
	let mut colors      = vec![0u8; count * 4];

	for i in 0..count {
		let px = i % img_w;
		let py = i / img_w;
		let idx = (px + py * img_w) * 4;

		// Position
		let qx16 = ((means_u.rgba[idx]   as u16) << 8) | means_l.rgba[idx]   as u16;
		let qy16 = ((means_u.rgba[idx+1] as u16) << 8) | means_l.rgba[idx+1] as u16;
		let qz16 = ((means_u.rgba[idx+2] as u16) << 8) | means_l.rgba[idx+2] as u16;
		let x = unlog(lerp(meta.means.mins[0], meta.means.maxs[0], qx16 as f32 / 65535.0));
		let y = unlog(lerp(meta.means.mins[1], meta.means.maxs[1], qy16 as f32 / 65535.0));
		let z = unlog(lerp(meta.means.mins[2], meta.means.maxs[2], qz16 as f32 / 65535.0));
		positions[i*3]   = x;
		positions[i*3+1] = y;
		positions[i*3+2] = z;

		// Scale (V1 — linear quantized, then exp)
		let sx = lerp(meta.scales.mins[0], meta.scales.maxs[0], scales.rgba[idx]   as f32 / 255.0).exp();
		let sy = lerp(meta.scales.mins[1], meta.scales.maxs[1], scales.rgba[idx+1] as f32 / 255.0).exp();
		let sz = lerp(meta.scales.mins[2], meta.scales.maxs[2], scales.rgba[idx+2] as f32 / 255.0).exp();

		// Rotation → covariance
		let (qx, qy, qz, qw) = reconstruct_quaternion(
			quats.rgba[idx], quats.rgba[idx+1],
			quats.rgba[idx+2], quats.rgba[idx+3],
		);
		let m00=(1.0-2.0*(qy*qy+qz*qz))*sx; let m10=(2.0*(qx*qy+qw*qz))*sx; let m20=(2.0*(qx*qz-qw*qy))*sx;
		let m01=(2.0*(qx*qy-qw*qz))*sy;     let m11=(1.0-2.0*(qx*qx+qz*qz))*sy; let m21=(2.0*(qy*qz+qw*qx))*sy;
		let m02=(2.0*(qx*qz+qw*qy))*sz;     let m12=(2.0*(qy*qz-qw*qx))*sz; let m22=(1.0-2.0*(qx*qx+qy*qy))*sz;

		let ci = i * 6;
		covariances[ci]  =m00*m00+m01*m01+m02*m02;
		covariances[ci+1]=m00*m10+m01*m11+m02*m12;
		covariances[ci+2]=m00*m20+m01*m21+m02*m22;
		covariances[ci+3]=m10*m10+m11*m11+m12*m12;
		covariances[ci+4]=m10*m20+m11*m21+m12*m22;
		covariances[ci+5]=m20*m20+m21*m21+m22*m22;

		// Color (V1 — linear quantized)
		let ki = i * 4;
		colors[ki]   = clamp_u8(SH_C0 * lerp(meta.sh0.mins[0], meta.sh0.maxs[0], sh0.rgba[idx]   as f32 / 255.0) + 0.5);
		colors[ki+1] = clamp_u8(SH_C0 * lerp(meta.sh0.mins[1], meta.sh0.maxs[1], sh0.rgba[idx+1] as f32 / 255.0) + 0.5);
		colors[ki+2] = clamp_u8(SH_C0 * lerp(meta.sh0.mins[2], meta.sh0.maxs[2], sh0.rgba[idx+2] as f32 / 255.0) + 0.5);
		// V1 opacity — sigmoid mapped
		let raw_opacity = lerp(meta.sh0.mins[3], meta.sh0.maxs[3], sh0.rgba[idx+3] as f32 / 255.0);
		colors[ki+3] = ((1.0 / (1.0 + (-raw_opacity).exp())) * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
	}

	let sh = vec![0u32; count * sh_stride(sh_bands)];

	Ok(DecodedSplats { count, positions, covariances, colors, sh })
}

// ---------------------------------------------------------------------------
// World transform
// ---------------------------------------------------------------------------

fn apply_world_transform(
	positions: &mut [f32],
	covariances: &mut [f32],
	count: usize,
	me: &[f32],   // 16 elements, column-major
) {
	// Normal matrix — upper-left 3×3 (correct for uniform scale + rotation)
	let nm = [
		me[0], me[1], me[2],
		me[4], me[5], me[6],
		me[8], me[9], me[10],
	];

	for i in 0..count {
		let pi = i * 3;
		let sx = positions[pi]; let sy = positions[pi+1]; let sz = positions[pi+2];
		positions[pi]   = me[0]*sx + me[4]*sy + me[8] *sz + me[12];
		positions[pi+1] = me[1]*sx + me[5]*sy + me[9] *sz + me[13];
		positions[pi+2] = me[2]*sx + me[6]*sy + me[10]*sz + me[14];

		let ci = i * 6;
		let (m11,m12,m13,m22,m23,m33) = (
			covariances[ci], covariances[ci+1], covariances[ci+2],
			covariances[ci+3], covariances[ci+4], covariances[ci+5],
		);
		let ns00=nm[0]*m11+nm[3]*m12+nm[6]*m13;
		let ns01=nm[0]*m12+nm[3]*m22+nm[6]*m23;
		let ns02=nm[0]*m13+nm[3]*m23+nm[6]*m33;
		let ns10=nm[1]*m11+nm[4]*m12+nm[7]*m13;
		let ns11=nm[1]*m12+nm[4]*m22+nm[7]*m23;
		let ns12=nm[1]*m13+nm[4]*m23+nm[7]*m33;
		let ns20=nm[2]*m11+nm[5]*m12+nm[8]*m13;
		let ns21=nm[2]*m12+nm[5]*m22+nm[8]*m23;
		let ns22=nm[2]*m13+nm[5]*m23+nm[8]*m33;
		covariances[ci]   = ns00*nm[0]+ns01*nm[3]+ns02*nm[6];
		covariances[ci+1] = ns00*nm[1]+ns01*nm[4]+ns02*nm[7];
		covariances[ci+2] = ns00*nm[2]+ns01*nm[5]+ns02*nm[8];
		covariances[ci+3] = ns10*nm[1]+ns11*nm[4]+ns12*nm[7];
		covariances[ci+4] = ns10*nm[2]+ns11*nm[5]+ns12*nm[8];
		covariances[ci+5] = ns20*nm[2]+ns21*nm[5]+ns22*nm[8];
	}
}

// ---------------------------------------------------------------------------
// Scatter into GPU texture layout
// ---------------------------------------------------------------------------

fn scatter_for_gpu(
	positions: &[f32],
	colors: &[u8],
	covariances: &[f32],
	count: usize,
) -> (Vec<f32>, Vec<u8>, Vec<f32>) {
	let mut center_data = vec![0.0f32; count * 4];
	let mut color_data  = vec![0u8;   count * 4];
	let mut cov_data    = vec![0.0f32; count * 8];

	for i in 0..count {
		center_data[i*4]   = positions[i*3];
		center_data[i*4+1] = positions[i*3+1];
		center_data[i*4+2] = positions[i*3+2];
		// center_data[i*4+3] = 0.0

		color_data[i*4]   = colors[i*4];
		color_data[i*4+1] = colors[i*4+1];
		color_data[i*4+2] = colors[i*4+2];
		color_data[i*4+3] = colors[i*4+3];

		cov_data[i*8]   = covariances[i*6];
		cov_data[i*8+1] = covariances[i*6+1];
		cov_data[i*8+2] = covariances[i*6+2];
		cov_data[i*8+3] = covariances[i*6+3];
		cov_data[i*8+4] = covariances[i*6+4];
		cov_data[i*8+5] = covariances[i*6+5];
		// cov_data[i*8+6] = cov_data[i*8+7] = 0.0
	}

	(center_data, color_data, cov_data)
}

// ---------------------------------------------------------------------------
// Public WASM API
// ---------------------------------------------------------------------------

/// Decode a SOG bundle and return pre-scattered GPU-ready buffers.
///
/// Returns a flat ArrayBuffer with this layout:
///   [0]    u32  count
///   [4]    u32  center_offset   (bytes from start)
///   [8]    u32  color_offset
///   [12]   u32  cov_offset
///   [16]   u32  bounds_offset
///   [20]   u32  sh_offset
///   [24]   u32  sh_stride        (u32s per splat, 0 when sh_bands is 0)
///   [28]   f32[count*4]  centerData  (XYZW)
///   [...]  u8[count*4]   colorData   (RGBA)
///   [...]  f32[count*8]  covData     (6 cov + 2 pad)
///   [...]  f32[6]        bounds      (minX,minY,minZ,maxX,maxY,maxZ)
///   [...]  u32[count*sh_stride] sh   (see pack_sh; SH stays in source space)
#[wasm_bindgen]
pub fn decode_sog(
	sog_data: &[u8],
	world_matrix: &[f32],
	sh_bands: u32,
) -> Result<Vec<u8>, JsValue> {
	let sh_bands = (sh_bands as usize).min(3);
	// Unpack ZIP
	let files = unzip_entries(sog_data)
		.map_err(|e| JsValue::from_str(&e))?;

	// Parse meta.json
	let meta_bytes = files.get("meta.json")
		.ok_or_else(|| JsValue::from_str("Missing meta.json"))?;
	let meta: SogRoot = serde_json::from_slice(meta_bytes)
		.map_err(|e| JsValue::from_str(&format!("meta.json parse error: {e}")))?;

	// Decode splats
	let mut splats = match meta {
		SogRoot::V2(v2) => decode_v2(v2, &files, sh_bands),
		SogRoot::V1(v1) => decode_v1(v1, &files, sh_bands),
	}.map_err(|e| JsValue::from_str(&e))?;

	// Apply world transform
	if world_matrix.len() == 16 {
		apply_world_transform(
			&mut splats.positions,
			&mut splats.covariances,
			splats.count,
			world_matrix,
		);
	}

	// Compute bounds
	let (mut min_x, mut min_y, mut min_z) = (f32::INFINITY, f32::INFINITY, f32::INFINITY);
	let (mut max_x, mut max_y, mut max_z) = (f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
	for i in 0..splats.count {
		let x = splats.positions[i*3];
		let y = splats.positions[i*3+1];
		let z = splats.positions[i*3+2];
		if x < min_x { min_x = x; } if x > max_x { max_x = x; }
		if y < min_y { min_y = y; } if y > max_y { max_y = y; }
		if z < min_z { min_z = z; } if z > max_z { max_z = z; }
	}

	// Scatter into GPU layout
	let (center_data, color_data, cov_data) = scatter_for_gpu(
		&splats.positions,
		&splats.colors,
		&splats.covariances,
		splats.count,
	);

	// Pack output buffer
	let count = splats.count;
	let center_bytes = count * 4 * 4;  // f32 × 4 per splat
	let color_bytes  = count * 4;      // u8 × 4 per splat
	let cov_bytes    = count * 8 * 4;  // f32 × 8 per splat
	let bounds_bytes = 6 * 4;          // f32 × 6
	let stride       = sh_stride(sh_bands);
	let sh_bytes     = count * stride * 4;

	let header_size = 7 * 4;  // count + 5 offsets + sh stride
	let center_offset = header_size;
	let color_offset  = center_offset + center_bytes;
	let cov_offset    = color_offset  + color_bytes;
	let bounds_offset = cov_offset    + cov_bytes;
	let sh_offset     = bounds_offset + bounds_bytes;
	let total         = sh_offset     + sh_bytes;

	let mut out = vec![0u8; total];
	let write_u32 = |buf: &mut Vec<u8>, pos: usize, v: u32| {
		buf[pos..pos+4].copy_from_slice(&v.to_le_bytes());
	};
	let write_f32 = |buf: &mut Vec<u8>, pos: usize, v: f32| {
		buf[pos..pos+4].copy_from_slice(&v.to_le_bytes());
	};

	write_u32(&mut out, 0,  count as u32);
	write_u32(&mut out, 4,  center_offset as u32);
	write_u32(&mut out, 8,  color_offset  as u32);
	write_u32(&mut out, 12, cov_offset    as u32);
	write_u32(&mut out, 16, bounds_offset as u32);
	write_u32(&mut out, 20, sh_offset     as u32);
	write_u32(&mut out, 24, stride        as u32);

	// Center data (f32)
	for (i, &v) in center_data.iter().enumerate() {
		write_f32(&mut out, center_offset + i * 4, v);
	}

	// Color data (u8 — direct copy)
	out[color_offset..color_offset+color_bytes].copy_from_slice(&color_data);

	// Cov data (f32)
	for (i, &v) in cov_data.iter().enumerate() {
		write_f32(&mut out, cov_offset + i * 4, v);
	}

	// Bounds
	write_f32(&mut out, bounds_offset,      min_x);
	write_f32(&mut out, bounds_offset +  4, min_y);
	write_f32(&mut out, bounds_offset +  8, min_z);
	write_f32(&mut out, bounds_offset + 12, max_x);
	write_f32(&mut out, bounds_offset + 16, max_y);
	write_f32(&mut out, bounds_offset + 20, max_z);

	// SH (u32)
	for (i, &v) in splats.sh.iter().enumerate() {
		write_u32(&mut out, sh_offset + i * 4, v);
	}

	Ok(out)
}

#[wasm_bindgen]
pub fn free_buffer(_buf: Vec<u8>) {
	// Takes ownership, drops immediately, reclaims WASM heap
}