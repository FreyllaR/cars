// Reads a Kenney GLB into flat triangles with baked colours: [{node, mat, pos:[9], nor:[9], rgb:[3]}]
const fs = require('fs'), zlib = require('zlib'), path = require('path');

function decodePNG(buf) {
  let p = 8, w, h, ct, plte, trns, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('png: unsupported'); }
    else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = { 2: 3, 3: 1, 6: 4, 0: 1, 4: 2 }[ct], stride = w * bpp;
  const out = Buffer.alloc(w * h * 4), cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 3) { const k = cur[x]; out[o] = plte[k * 3]; out[o + 1] = plte[k * 3 + 1]; out[o + 2] = plte[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
      else if (ct === 2) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
      else if (ct === 6) cur.copy(out, o, x * 4, x * 4 + 4);
      else { out[o] = out[o + 1] = out[o + 2] = cur[x * bpp]; out[o + 3] = 255; }
    }
    cur.copy(prev);
  }
  return { w, h, px: out };
}

const texCache = {};
function texture(file) {
  return texCache[file] || (texCache[file] = decodePNG(fs.readFileSync(file)));
}

function mat4FromTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
function mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
const tp = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const tn = (m, v) => { const r = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]], l = Math.hypot(...r) || 1; return r.map(q => q / l); };

function readGLB(file) {
  const b = fs.readFileSync(file), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString());
  const binStart = 20 + jl + 8, bin = b.slice(binStart);
  const acc = i => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride ? bv.byteStride / C.BYTES_PER_ELEMENT : n;
    const src = new C(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + (a.count - 1) * stride * C.BYTES_PER_ELEMENT + n * C.BYTES_PER_ELEMENT));
    const out = []; for (let k = 0; k < a.count; k++) { const e = []; for (let c = 0; c < n; c++) e.push(src[k * stride + c]); out.push(n === 1 ? e[0] : e); }
    return out;
  };
  const tex = (j.images || []).map(im => im.uri ? texture(path.join(path.dirname(file), im.uri)) : null);
  const tris = [];
  const walk = (ni, parent) => {
    const n = j.nodes[ni], m = mul(parent, n.matrix || mat4FromTRS(n.translation, n.rotation, n.scale));
    if (n.mesh != null) for (const pr of j.meshes[n.mesh].primitives) {
      const P = acc(pr.attributes.POSITION), N = pr.attributes.NORMAL != null ? acc(pr.attributes.NORMAL) : null, UV = pr.attributes.TEXCOORD_0 != null ? acc(pr.attributes.TEXCOORD_0) : null;
      const I = pr.indices != null ? acc(pr.indices) : P.map((_, k) => k);
      const mat = j.materials[pr.material] || {}, pbr = mat.pbrMetallicRoughness || {}, f = pbr.baseColorFactor || [1, 1, 1, 1];
      const ti = pbr.baseColorTexture ? j.textures[pbr.baseColorTexture.index].source : null, T = ti != null ? tex[ti] : null;
      for (let k = 0; k < I.length; k += 3) {
        const ids = [I[k], I[k + 1], I[k + 2]], pos = [], nor = [];
        for (const id of ids) { pos.push(...tp(m, P[id])); nor.push(...(N ? tn(m, N[id]) : [0, 1, 0])); }
        let rgb = f.slice(0, 3).map(v => Math.round(Math.min(1, v) * 255));
        if (T && UV) {
          const u = (UV[ids[0]][0] + UV[ids[1]][0] + UV[ids[2]][0]) / 3, v = (UV[ids[0]][1] + UV[ids[1]][1] + UV[ids[2]][1]) / 3;
          const x = ((Math.floor(u * T.w) % T.w) + T.w) % T.w, y = ((Math.floor(v * T.h) % T.h) + T.h) % T.h, o = (y * T.w + x) * 4;
          rgb = [T.px[o], T.px[o + 1], T.px[o + 2]].map((c, q) => Math.round(c * Math.min(1, f[q])));
        }
        tris.push({ node: n.name || '', mat: mat.name || '', pos, nor, rgb, alpha: f[3] });
      }
    }
    for (const c of n.children || []) walk(c, m);
  };
  const scene = j.scenes[j.scene || 0];
  for (const ni of scene.nodes) walk(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { tris, nodes: j.nodes };
}
module.exports = { readGLB, decodePNG };
