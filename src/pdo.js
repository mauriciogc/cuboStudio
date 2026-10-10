// Importar figuras de papercraft de Pepakura (.pdo, versión 3) y convertirlas a cubos.
//
// El .pdo no tiene documentación oficial. El encabezado cambia según la versión de Pepakura, así
// que no se lee campo por campo: se busca dónde empieza la figura y se valida completa (objetos,
// caras, aristas y materiales con sus texturas). De la figura sólo se usan los vértices, las caras
// con sus coordenadas de textura (UV) y las texturas de cada material; lo de papel (piezas,
// pestañas, dobleces) se salta.

import { keyOf } from './model.js';

class Bad extends Error {}

/** Lee la figura a partir del byte `start`. Lanza Bad si ahí no empieza una figura válida. */
function readFrom(view, start) {
  const n = view.byteLength;
  let o = start;
  const need = (k) => { if (o + k > n) throw new Bad('eof'); };
  const i32 = () => { need(4); const v = view.getInt32(o, true); o += 4; return v; };
  const u8 = () => { need(1); return view.getUint8(o++); };
  const f64 = () => { need(8); const v = view.getFloat64(o, true); o += 8; return v; };
  const f32 = () => { need(4); const v = view.getFloat32(o, true); o += 4; return v; };
  const skip = (k) => { need(k); o += k; };

  const objects = [];
  const nobj = i32();
  if (nobj < 1 || nobj > 500) throw new Bad('objetos');
  for (let ob = 0; ob < nobj; ob++) {
    const nameLen = i32();
    if (nameLen < 0 || nameLen > 1000) throw new Bad('nombre');
    skip(nameLen);
    if (u8() > 1) throw new Bad('visible');
    const nv = i32();
    if (nv < 0 || nv > 2e6) throw new Bad('vértices');
    need(nv * 24);
    const vertices = new Float64Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) vertices[i] = f64();
    for (let i = 0; i < Math.min(nv * 3, 60); i++) {
      if (!Number.isFinite(vertices[i]) || Math.abs(vertices[i]) > 1e7) throw new Bad('vértice');
    }
    const nf = i32();
    if (nf < 0 || nf > 4e6) throw new Bad('caras');
    const faces = [];
    for (let f = 0; f < nf; f++) {
      const mat = i32();
      const part = i32(); // pieza de papel a la que pertenece
      skip(32); // plano de la cara
      const k = i32();
      if (k < 3 || k > 64) throw new Bad('lados');
      const idx = [];
      const uv = [];
      for (let j = 0; j < k; j++) {
        const vi = i32();
        if (vi < 0 || vi >= nv) throw new Bad('índice');
        skip(16); // posición en la hoja
        uv.push(f64(), f64());
        skip(1 + 24 + 24); // pestaña de pegado y doblez
        idx.push(vi);
      }
      faces.push({ mat, part, idx, uv });
    }
    const ne = i32();
    if (ne < 0 || ne > 8e6) throw new Bad('aristas');
    skip(ne * 22);
    objects.push({ vertices, faces });
  }

  const materials = [];
  const nm = i32();
  if (nm < 0 || nm > 500) throw new Bad('materiales');
  for (let m = 0; m < nm; m++) {
    const nameLen = i32();
    if (nameLen < 0 || nameLen > 1000) throw new Bad('material');
    skip(nameLen);
    const c = [];
    for (let i = 0; i < 20; i++) c.push(f32());
    const has = u8();
    if (has > 1) throw new Bad('textura');
    const mat = { color: [c[4], c[5], c[6]].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)), texture: null };
    if (has) {
      const w = i32(); const h = i32(); const size = i32();
      if (w < 1 || h < 1 || w > 16384 || h > 16384 || size < 2 || size > n) throw new Bad('textura');
      need(size);
      if (view.getUint8(o) !== 0x78) throw new Bad('zlib');
      mat.texture = { w, h, zipped: new Uint8Array(view.buffer, view.byteOffset + o, size) };
      o += size;
    }
    materials.push(mat);
  }
  return { objects, materials };
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Lee un .pdo (ArrayBuffer). Devuelve { objects, materials } con las texturas ya descomprimidas
 * (RGB, 3 bytes por pixel). Lanza un Error con un mensaje para la persona si no se puede leer.
 */
export async function parsePDO(buffer) {
  const view = new DataView(buffer);
  const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(10, buffer.byteLength)));
  if (!head.startsWith('version ')) throw new Error('Ese archivo no es un .pdo de Pepakura');
  if (head !== 'version 3\n') throw new Error('Esa versión de .pdo todavía no se puede leer (sólo la 3)');
  let pdo = null;
  for (let start = 10; start < Math.min(buffer.byteLength - 8, 4000) && !pdo; start++) {
    try { pdo = readFrom(view, start); } catch (e) { if (!(e instanceof Bad) && !(e instanceof RangeError)) throw e; }
  }
  if (!pdo) throw new Error('No se pudo leer la figura de ese .pdo');
  for (const m of pdo.materials) {
    if (!m.texture) continue;
    const data = await inflate(m.texture.zipped);
    if (data.length !== m.texture.w * m.texture.h * 3) throw new Error('Una textura del .pdo está dañada');
    m.texture = { w: m.texture.w, h: m.texture.h, data };
  }
  return pdo;
}

/** Materiales que usa la figura, con cuántas caras tiene cada uno (los que no se usan, fuera). */
export function pdoParts(pdo) {
  const faces = new Map();
  for (const ob of pdo.objects) for (const f of ob.faces) faces.set(f.mat, (faces.get(f.mat) ?? 0) + 1);
  return [...faces].sort((a, b) => a[0] - b[0]).map(([mat, count]) => ({ mat, faces: count, material: pdo.materials[mat] ?? null }));
}

/** Miniatura de la textura de un material (o su color), como dataURL. */
export function partThumb(material, size = 72) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const t = material?.texture;
  if (!t) {
    g.fillStyle = `rgb(${(material?.color ?? [200, 200, 200]).join(',')})`;
    g.fillRect(0, 0, size, size);
    return c.toDataURL();
  }
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const s = (Math.floor((y / size) * t.h) * t.w + Math.floor((x / size) * t.w)) * 3;
    const d = (y * size + x) * 4;
    img.data[d] = t.data[s]; img.data[d + 1] = t.data[s + 1]; img.data[d + 2] = t.data[s + 2]; img.data[d + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Reduce colores a k con k-means (pesado por cuántos cubos lo usan); los centros son colores reales. */
export const PLAIN_COLOR = '#ece6dc'; // con un solo color: tono neutro, sólo la forma

function reduceColors(colors, k) {
  if (k <= 1) return () => PLAIN_COLOR;
  const uniq = new Map();
  for (const c of colors) {
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    uniq.set(key, (uniq.get(key) ?? 0) + 1);
  }
  const pts = [...uniq].map(([key, w]) => ({ c: [(key >> 16) & 255, (key >> 8) & 255, key & 255], w }));
  const d2 = (a, b) => (a[0] - b[0]) ** 2 * 2 + (a[1] - b[1]) ** 2 * 4 + (a[2] - b[2]) ** 2 * 3;
  let centers = [];
  if (pts.length <= k) centers = pts.map((p) => [...p.c]);
  else {
    // Inicio: el más usado y después el más lejano (pesado por uso)
    centers.push([...pts.reduce((a, b) => (b.w > a.w ? b : a)).c]);
    while (centers.length < k) {
      let best = null; let score = -1;
      for (const p of pts) {
        const s = p.w * Math.min(...centers.map((c) => d2(p.c, c)));
        if (s > score) { score = s; best = p; }
      }
      centers.push([...best.c]);
    }
    for (let it = 0; it < 12; it++) {
      const sum = centers.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0; let bd = Infinity;
        centers.forEach((c, i) => { const d = d2(p.c, c); if (d < bd) { bd = d; bi = i; } });
        const s = sum[bi];
        s[0] += p.c[0] * p.w; s[1] += p.c[1] * p.w; s[2] += p.c[2] * p.w; s[3] += p.w;
      }
      centers = centers.map((c, i) => (sum[i][3] ? sum[i].slice(0, 3).map((v) => v / sum[i][3]) : c));
    }
    // Cada centro pasa al color real más cercano (así no salen tonos que no estaban)
    centers = centers.map((c) => [...pts.reduce((a, b) => (d2(b.c, c) < d2(a.c, c) ? b : a)).c]);
  }
  const cache = new Map();
  return (c) => {
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    let out = cache.get(key);
    if (!out) {
      let bi = 0; let bd = Infinity;
      centers.forEach((cc, i) => { const d = d2(c, cc); if (d < bd) { bd = d; bi = i; } });
      out = hex(...centers[bi].map(Math.round));
      cache.set(key, out);
    }
    return out;
  };
}

/**
 * Convierte la figura a cubos.
 * cubes: cuántos cubos mide el lado más largo. skip: materiales que no entran.
 * Devuelve { size (cuadrícula), cells: Map(key → '#rrggbb') }.
 */
export function voxelizePDO(pdo, { cubes = 32, skip = new Set(), maxColors = 24, fill = false, grids = [8, 16, 24, 32, 48, 64, 128] } = {}) {
  // Caja de lo que entra
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const ob of pdo.objects) for (const f of ob.faces) {
    if (skip.has(f.mat)) continue;
    for (const vi of f.idx) for (let a = 0; a < 3; a++) {
      const v = ob.vertices[vi * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (min[0] === Infinity) return { size: grids.find((g) => g >= cubes) ?? 128, cells: new Map() };
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = (cubes - 1e-2) / ext; // un pelito menos: el último cubo no se sale de la cuadrícula
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const size = grids.find((g) => g >= cubes) ?? 128;
  const half = size / 2;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Muestras sobre cada triángulo; cada celda vota por el color de la textura en ese punto
  const votes = new Map();
  const p = [0, 0, 0];
  for (const ob of pdo.objects) {
    const V = ob.vertices;
    for (const f of ob.faces) {
      if (skip.has(f.mat)) continue;
      const mat = pdo.materials[f.mat];
      const tex = mat?.texture;
      for (let t = 1; t + 1 < f.idx.length; t++) {
        const tri = [0, t, t + 1];
        const P = tri.map((j) => [V[f.idx[j] * 3], V[f.idx[j] * 3 + 1], V[f.idx[j] * 3 + 2]]);
        const UV = tri.map((j) => [f.uv[j * 2], f.uv[j * 2 + 1]]);
        let L = 0;
        for (let a = 0; a < 3; a++) L = Math.max(L, Math.hypot(...P[a].map((v, i) => v - P[(a + 1) % 3][i])));
        const steps = Math.max(2, Math.ceil(L * s * 3) + 1);
        for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
          const a = i / steps; const b = j / steps; const c = 1 - a - b;
          for (let k = 0; k < 3; k++) p[k] = a * P[0][k] + b * P[1][k] + c * P[2][k];
          let rgb;
          if (tex) {
            const u = a * UV[0][0] + b * UV[1][0] + c * UV[2][0];
            const v = a * UV[0][1] + b * UV[1][1] + c * UV[2][1];
            const x = Math.min(tex.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.w)));
            const y = Math.min(tex.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.h)));
            const o = (y * tex.w + x) * 3;
            rgb = [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
          } else {
            rgb = mat?.color ?? [200, 200, 200];
          }
          // Dentro de la cuadrícula (por redondeo, una muestra puede caer un pelito afuera)
          const key = keyOf(clamp(Math.floor((p[0] - cx) * s), -half, half - 1), clamp(Math.floor((p[1] - min[1]) * s), 0, size - 1),
            clamp(Math.floor((p[2] - cz) * s), -half, half - 1));
          let cell = votes.get(key);
          if (!cell) votes.set(key, (cell = new Map()));
          // Tonos casi iguales votan juntos (16 niveles por canal)
          const bin = ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4);
          const acc = cell.get(bin);
          if (acc) { acc[0] += rgb[0]; acc[1] += rgb[1]; acc[2] += rgb[2]; acc[3]++; } else cell.set(bin, [...rgb, 1]);
        }
      }
    }
  }
  // Color de cada celda: el tono que más se repite (el promedio mezclaría, p. ej., piel con blanco)
  const raw = new Map();
  for (const [key, cell] of votes) {
    let top = null;
    for (const acc of cell.values()) if (!top || acc[3] > top[3]) top = acc;
    raw.set(key, [0, 1, 2].map((i) => Math.round(top[i] / top[3])));
  }

  if (fill) fillInside(raw);
  const toColor = reduceColors([...raw.values()], maxColors);
  const cells = new Map();
  for (const [key, c] of raw) cells.set(key, toColor(c));
  return { size, cells };
}

/**
 * Junta cubos vecinos del mismo color en cajas (de distintos tamaños): crece en x, luego en z
 * (filas completas) y luego en y (capas completas). Devuelve [{ cell, size, color }].
 */
export function mergeCells(cells) {
  const keys = [...cells.keys()].map((k) => k.split(',').map(Number))
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  const done = new Set();
  const boxes = [];
  for (const [x0, y0, z0] of keys) {
    if (done.has(keyOf(x0, y0, z0))) continue;
    const color = cells.get(keyOf(x0, y0, z0));
    const ok = (x, y, z) => { const k = keyOf(x, y, z); return !done.has(k) && cells.get(k) === color; };
    let x1 = x0;
    while (ok(x1 + 1, y0, z0)) x1++;
    let z1 = z0;
    const rowOk = (z) => { for (let x = x0; x <= x1; x++) if (!ok(x, y0, z)) return false; return true; };
    while (rowOk(z1 + 1)) z1++;
    let y1 = y0;
    const layerOk = (y) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (!ok(x, y, z)) return false; return true; };
    while (layerOk(y1 + 1)) y1++;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) done.add(keyOf(x, y, z));
    boxes.push({ cell: [x0, y0, z0], size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1], color });
  }
  return boxes;
}

/** Rellena por dentro: lo que no se alcanza desde afuera se llena con el color de la cáscara más cercana. */
function fillInside(raw) {
  const pts = [...raw.keys()].map((k) => k.split(',').map(Number));
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])) - 1);
  const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) + 1);
  const inBox = (x, y, z) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];
  const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Afuera: todo lo vacío que se alcanza desde una esquina de la caja
  const outside = new Set([keyOf(...lo)]);
  const queue = [lo];
  while (queue.length) {
    const [x, y, z] = queue.pop();
    for (const [dx, dy, dz] of N6) {
      const n = [x + dx, y + dy, z + dz];
      const k = keyOf(...n);
      if (!inBox(...n) || outside.has(k) || raw.has(k)) continue;
      outside.add(k);
      queue.push(n);
    }
  }
  // Por dentro: se reparte el color desde la cáscara hacia el centro
  let front = [...raw.keys()];
  while (front.length) {
    const next = [];
    for (const k of front) {
      const [x, y, z] = k.split(',').map(Number);
      for (const [dx, dy, dz] of N6) {
        const n = [x + dx, y + dy, z + dz];
        const nk = keyOf(...n);
        if (!inBox(...n) || outside.has(nk) || raw.has(nk)) continue;
        raw.set(nk, raw.get(k));
        next.push(nk);
      }
    }
    front = next;
  }
}

/** Vectores propios de una matriz simétrica 3×3 (Jacobi). Devuelve columnas ordenadas de mayor a menor. */
function eigen3(m) {
  const a = m.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1); const sn = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p]; const akq = a[k][q];
        a[k][p] = c * akp - sn * akq; a[k][q] = sn * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k]; const aqk = a[q][k];
        a[p][k] = c * apk - sn * aqk; a[q][k] = sn * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p]; const vkq = v[k][q];
        v[k][p] = c * vkp - sn * vkq; v[k][q] = sn * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  const E = order.map((i) => [v[0][i], v[1][i], v[2][i]]); // E[k] = eje k (vector)
  const cross = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  E[2] = cross(E[0], E[1]); // base derecha
  return E;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Caja chueca (8 esquinas) que envuelve unos puntos: a lo largo de su eje principal, con su ancho en cada punta. */
function fitHex(pts, { tip = 0.12, minHalf = 0.3 } = {}) {
  const n = pts.length;
  const c = [0, 1, 2].map((k) => pts.reduce((acc, p) => acc + p[k], 0) / n);
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
  const E = eigen3(cov);
  const L = pts.map((p) => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot(d, E[0]), dot(d, E[1]), dot(d, E[2])]; });
  const t0 = Math.min(...L.map((l) => l[0])); const t1 = Math.max(...L.map((l) => l[0]));
  const span = (arr, k) => [Math.min(...arr.map((l) => l[k])), Math.max(...arr.map((l) => l[k]))];
  const ends = [[t0, t0 + tip * (t1 - t0)], [t1 - tip * (t1 - t0), t1]].map(([lo, hi]) => {
    let S = L.filter((l) => l[0] >= lo && l[0] <= hi);
    if (S.length < 3) S = L;
    const [a2, b2] = span(S, 1); const [a3, b3] = span(S, 2);
    return { c2: (a2 + b2) / 2, h2: Math.max(minHalf, (b2 - a2) / 2), c3: (a3 + b3) / 2, h3: Math.max(minHalf, (b3 - a3) / 2) };
  });
  const [z0, z1] = span(L, 2);
  return { c, E, L, t0, t1, ends, thick: z1 - z0, wide: span(L, 1) };
}

/** Las 8 esquinas de la caja chueca, en el orden de CuboStudio (bit 1 = +x, bit 2 = +y, bit 4 = +z). */
function hexCorners({ c, E, t0, t1, ends }) {
  // Cada eje del mundo toma el eje propio más alineado (con su signo): así cada esquina cae en su lugar
  const used = new Set(); const la = []; const sg = [];
  for (const a of [0, 1, 2].sort((i, j) => Math.max(...E.map((e) => Math.abs(e[j]))) - Math.max(...E.map((e) => Math.abs(e[i]))))) {
    let best = -1;
    for (let k = 0; k < 3; k++) if (!used.has(k) && (best < 0 || Math.abs(E[k][a]) > Math.abs(E[best][a]))) best = k;
    used.add(best); la[a] = best; sg[a] = E[best][a] >= 0 ? 1 : -1;
  }
  const out = [];
  for (let i = 0; i < 8; i++) {
    const side = [0, 0, 0];
    for (let a = 0; a < 3; a++) { const bit = (i >> a) & 1; side[la[a]] = sg[a] > 0 ? bit : 1 - bit; }
    const e = ends[side[0]];
    const l = [side[0] ? t1 : t0, e.c2 + (side[1] ? e.h2 : -e.h2), e.c3 + (side[2] ? e.h3 : -e.h3)];
    out.push([0, 1, 2].map((k) => c[k] + E[0][k] * l[0] + E[1][k] * l[1] + E[2][k] * l[2]));
  }
  return out;
}

/**
 * Convierte la figura a piezas por pieza de papel.
 * style: 'boxes' (cajas rectas) o 'blocks' (cajas chuecas, deformadas).
 * Devuelve { size, pieces: [{ corners (8 × [x,y,z]), color, value, cell }] } listo para CuboStudio.
 */
export function piecesPDO(pdo, { cubes = 32, skip = new Set(), maxColors = 24, style = 'boxes', grids = [8, 16, 24, 32, 48, 64, 128] } = {}) {
  // Caja de lo que entra y escala a `cubes`
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (const ob of pdo.objects) for (const f of ob.faces) {
    if (skip.has(f.mat)) continue;
    for (const vi of f.idx) for (let a = 0; a < 3; a++) {
      const v = ob.vertices[vi * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (min[0] === Infinity) return { size: grids.find((g) => g >= cubes) ?? 128, pieces: [] };
  const fit = cubes * 0.94; // un margen: las cajas salen un poco más gruesas que la figura
  const s = fit / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const k = cubes / 30; // las medidas del ajuste se pensaron para ~30 cubos
  const minHalf = 0.3 * k; const thickMax = 3.5 * k;

  // Puntos con su color, agrupados por pieza de papel
  const groups = new Map();
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  pdo.objects.forEach((ob, oi) => {
    const V = ob.vertices;
    for (const f of ob.faces) {
      if (skip.has(f.mat)) continue;
      const mat = pdo.materials[f.mat];
      const tex = mat?.texture;
      const key = `${oi}:${f.part}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { pts: [], cols: [] }));
      for (let t = 1; t + 1 < f.idx.length; t++) {
        const tri = [0, t, t + 1];
        const P = tri.map((j) => [0, 1, 2].map((a) => (V[f.idx[j] * 3 + a] - min[a]) * s));
        const UV = tri.map((j) => [f.uv[j * 2], f.uv[j * 2 + 1]]);
        const ab = P[1].map((v, i) => v - P[0][i]); const ac = P[2].map((v, i) => v - P[0][i]);
        const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
        const n = Math.min(400, Math.max(3, Math.ceil(area * 12)));
        for (let i = 0; i < n; i++) {
          let r1 = rand(); let r2 = rand();
          if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
          const w = [1 - r1 - r2, r1, r2];
          g.pts.push([0, 1, 2].map((a) => w[0] * P[0][a] + w[1] * P[1][a] + w[2] * P[2][a]));
          if (tex) {
            const u = w[0] * UV[0][0] + w[1] * UV[1][0] + w[2] * UV[2][0];
            const v = w[0] * UV[0][1] + w[1] * UV[1][1] + w[2] * UV[2][1];
            const x = Math.min(tex.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.w)));
            const y = Math.min(tex.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.h)));
            const o = (y * tex.w + x) * 3;
            g.cols.push([tex.data[o], tex.data[o + 1], tex.data[o + 2]]);
          } else g.cols.push(mat?.color ?? [200, 200, 200]);
        }
      }
    }
  });

  // Cada pieza de papel → una caja; si es muy curva, se parte a la mitad (hasta 4 veces)
  const raw = [];
  const split = (pts, cols, depth) => {
    if (pts.length < 4) return;
    const h = fitHex(pts, { minHalf });
    if (h.thick > thickMax && pts.length > 80 && depth < 4) {
      const ax = (h.t1 - h.t0) >= (h.wide[1] - h.wide[0]) ? 0 : 1;
      const vals = h.L.map((l) => l[ax]).sort((a, b) => a - b);
      const cut = vals[Math.floor(vals.length / 2)];
      const A = []; const B = []; const cA = []; const cB = [];
      h.L.forEach((l, i) => { if (l[ax] <= cut) { A.push(pts[i]); cA.push(cols[i]); } else { B.push(pts[i]); cB.push(cols[i]); } });
      if (A.length && B.length) { split(A, cA, depth + 1); split(B, cB, depth + 1); return; }
    }
    // Color: el tono que más se repite
    const bins = new Map();
    for (const c of cols) {
      const b = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const acc = bins.get(b);
      if (acc) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3]++; } else bins.set(b, [...c, 1]);
    }
    let top = null;
    for (const acc of bins.values()) if (!top || acc[3] > top[3]) top = acc;
    raw.push({ corners: hexCorners(h), rgb: [0, 1, 2].map((i) => Math.round(top[i] / top[3])) });
  };
  for (const g of groups.values()) split(g.pts, g.cols, 0);

  // Todo dentro de la cuadrícula: centrado y con la base en el piso
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const r of raw) for (const p of r.corners) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const size = grids.find((g) => g >= Math.ceil(ext)) ?? 128;
  const shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
  const toColor = reduceColors(raw.map((r) => r.rgb), maxColors);
  const r1 = (v) => Math.round(v * 10) / 10;
  const fmt = (v) => String(Math.round(v * 1000) / 1000);
  const pieces = raw.map((r) => {
    let corners = r.corners.map((p) => p.map((v, a) => v + shift[a]));
    const color = toColor(r.rgb);
    const bmin = [0, 1, 2].map((a) => Math.min(...corners.map((p) => p[a])));
    const bmax = [0, 1, 2].map((a) => Math.max(...corners.map((p) => p[a])));
    if (style === 'boxes') {
      // Caja recta, en pasos de 0.1 (como al mover o escalar en la app)
      const mn = bmin.map(r1);
      const sz = bmax.map((v, a) => Math.max(0.1, r1(v - mn[a])));
      const cell = mn.map(Math.floor);
      const off = mn.map((v, a) => r1(v - cell[a]));
      corners = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map((a) => mn[a] + ((i >> a) & 1) * sz[a]));
      return { corners, color, cell, value: `${color}/cube/2/0/${sz.join(',')}/${off.join(',')}` };
    }
    const sz = bmax.map((v, a) => Math.max(0.05, v - bmin[a]));
    const deform = [];
    for (let i = 0; i < 8; i++) for (let a = 0; a < 3; a++) {
      deform.push((corners[i][a] - (bmin[a] + ((i >> a) & 1) * sz[a])) / sz[a]);
    }
    const cell = bmin.map(Math.floor);
    const off = bmin.map((v, a) => v - cell[a]);
    return { corners, color, cell, value: `${color}/deform:${deform.map(fmt).join(',')}/2/0/${sz.map(fmt).join(',')}/${off.map(fmt).join(',')}` };
  });
  return { size, pieces };
}

/**
 * Vista previa isométrica en un canvas, sin 3D: cada pieza (cubo o caja de 8 esquinas) se dibuja
 * con sus caras visibles, de atrás hacia adelante.
 * items: Map(key → color) de cubos, o [{ corners, color }].
 */
export function drawPreview(canvas, items) {
  const g = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  g.clearRect(0, 0, W, H);
  const pieces = items instanceof Map
    ? [...items].map(([k, color]) => {
      const [x, y, z] = k.split(',').map(Number);
      return { color, corners: Array.from({ length: 8 }, (_, i) => [x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1)]) };
    })
    : items;
  if (!pieces.length) return;
  // Proyección: x→derecha-abajo, z→izquierda-abajo, y→arriba
  const proj = ([x, y, z]) => [(x - z) * 0.866, (x + z) * 0.5 - y];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of pieces) for (const c of p.corners) {
    const [a, b] = proj(c);
    minX = Math.min(minX, a); maxX = Math.max(maxX, a); minY = Math.min(minY, b); maxY = Math.max(maxY, b);
  }
  const sc = Math.min((W - 16) / (maxX - minX || 1), (H - 16) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
  const oy = (H - (maxY - minY) * sc) / 2 - minY * sc;
  const P = (c) => { const [a, b] = proj(c); return [ox + a * sc, oy + b * sc]; };
  // Caras de la caja por índices de esquina (vistas desde afuera)
  const FACES = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  const LIGHT = [0.45, 0.8, 0.4];
  const len = Math.hypot(...LIGHT);
  const sorted = pieces.map((p) => {
    const cx = p.corners.reduce((s, c) => s + c[0], 0) / 8;
    const cy = p.corners.reduce((s, c) => s + c[1], 0) / 8;
    const cz = p.corners.reduce((s, c) => s + c[2], 0) / 8;
    return { p, d: cx + cz + cy * 0.6 };
  }).sort((a, b) => a.d - b.d);
  for (const { p } of sorted) {
    const n = parseInt(p.color.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const pts = p.corners.map(P);
    for (const f of FACES) {
      const q = f.map((i) => pts[i]);
      // Sólo las caras que miran a la cámara (área con signo en pantalla)
      let area = 0;
      for (let i = 0; i < 4; i++) { const [x1, y1] = q[i]; const [x2, y2] = q[(i + 1) % 4]; area += x1 * y2 - x2 * y1; }
      if (area >= 0) continue;
      const w = f.map((i) => p.corners[i]);
      const u = [0, 1, 2].map((a) => w[1][a] - w[0][a]); const v = [0, 1, 2].map((a) => w[3][a] - w[0][a]);
      const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...nn) || 1;
      const light = 0.62 + 0.38 * Math.max(0, (nn[0] * LIGHT[0] + nn[1] * LIGHT[1] + nn[2] * LIGHT[2]) / nl / len);
      g.beginPath();
      q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = `rgb(${rgb.map((c) => Math.round(c * light)).join(',')})`;
      g.fill();
    }
  }
}
