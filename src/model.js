// Modelo de datos: un mapa disperso "x,y,z" -> color hex.
// La cuadrícula está centrada en X/Z: x,z ∈ [-size/2, size/2), y ∈ [0, size).

export const keyOf = (x, y, z) => `${x},${y},${z}`;
/** Celda de una clave. Las claves pueden llevar "#n" cuando varias piezas comparten celda base. */
export const parseKey = (k) => k.split('#')[0].split(',').map(Number);

export const NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

export const GRID_SIZES = [8, 16, 24, 32, 48, 64, 128];

// Caras: mismo orden que NEIGHBORS (+X, -X, +Y, -Y, +Z, -Z)
export const FACE_NORMALS = NEIGHBORS;
export const faceIndex = (n) => FACE_NORMALS.findIndex((f) => f[0] === n[0] && f[1] === n[1] && f[2] === n[2]);

// Calcomanías: clave "s:px,py,pz,cara", donde p es el centro sobre el plano de la cara.
// Valor: { s: id, c: color, n: tamaño en cubos, flip: espejo horizontal }
export const STICKER_PREFIX = 's:';
export const stickerKey = (p, f) => `${STICKER_PREFIX}${p[0]},${p[1]},${p[2]},${f}`;
export function parseStickerKey(k) {
  const [x, y, z, f] = k.slice(STICKER_PREFIX.length).split(',').map(Number);
  return { p: [x, y, z], f };
}
const isStickerKey = (k) => k.startsWith(STICKER_PREFIX);

const HEX = /^#[0-9a-f]{6}$/;

// Piezas: cada celda puede ser un cubo u otra forma. El valor de un vóxel es
// "#rrggbb" (cubo 1×1×1) o "#rrggbb/forma/cara[/giro[/ancho,alto,fondo[/dx,dy,dz]]]".
// El color puede llevar transparencia: "#rrggbbaa" (aa = opacidad).
// cara = hacia dónde apunta (0..5), giro = cuartos de vuelta (0..3),
// tamaño = medidas en cubos (pasos de 0.1), creciendo desde la esquina de su celda,
// desplazamiento = corrimiento fino dentro de la celda (pasos de 0.1).
export const PIECES = {
  cube: 'Cubo',
  sphere: 'Esfera',
  cylinder: 'Cilindro',
  cone: 'Cono',
  pyramid: 'Pirámide',
  wedge: 'Triángulo',
};
const NUM = '\\d+(\\.\\d+)?';
const VOXEL = new RegExp(`^#[0-9a-f]{6}([0-9a-f]{2})?(\\/(cube|sphere|cylinder|cone|pyramid|wedge|compound:[-0-9.,;]+)\\/[0-5](\\/[0-3](\\/${NUM},${NUM},${NUM}(\\/${NUM},${NUM},${NUM})?)?)?)?(\\|g\\d+)?$`);
const UP_FACE = 2;
const UNIT = [1, 1, 1];
const ZERO = [0, 0, 0];

export const MIN_PIECE = 0.1;

/** Paso fino para mover y escalar: 0.1 (redondeado para no arrastrar decimales raros). */
export const snapStep = (v) => Math.round(v * 10) / 10;
export const OPACITIES = [1, 0.75, 0.5, 0.25];

/** Color con opacidad: '#rrggbb' si es sólido, '#rrggbbaa' si es transparente. */
export function withAlpha(color, opacity = 1) {
  const c = color.slice(0, 7);
  if (opacity >= 1) return c;
  return c + Math.round(opacity * 255).toString(16).padStart(2, '0');
}

export function parseVoxel(v) {
  const [body, group = null] = v.split('|');
  const [fill, shape = 'cube', f = UP_FACE, t = 0, size, offset] = body.split('/');
  const opacity = fill.length === 9 ? Math.round((parseInt(fill.slice(7), 16) / 255) * 20) / 20 : 1;
  return {
    fill, // color con su opacidad, tal como se guarda
    color: fill.slice(0, 7),
    opacity,
    shape,
    f: Number(f),
    t: Number(t),
    size: size ? size.split(',').map(Number) : [...UNIT],
    offset: offset ? offset.split(',').map(Number) : [...ZERO],
    group, // "g12" si la pieza está en un grupo
  };
}

export const isUnit = (size) => !size || size.every((s) => s === 1);
export const isZero = (o) => !o || o.every((v) => v === 0);

function pieceBody(color, shape, f, t, size, offset) {
  if (!isZero(offset)) return `${color}/${shape}/${f}/${t}/${size.join(',')}/${offset.join(',')}`;
  if (!isUnit(size)) return `${color}/${shape}/${f}/${t}/${size.join(',')}`;
  if (shape === 'cube') return color;
  return t ? `${color}/${shape}/${f}/${t}` : `${color}/${shape}/${f}`;
}

/** Valor de una pieza. group = "g12" la mete en un grupo (se guarda como sufijo "|g12"). */
export function makeVoxel(color, shape = 'cube', f = UP_FACE, t = 0, size = UNIT, offset = ZERO, group = null) {
  const body = pieceBody(color, shape, f, t, size, offset);
  return group ? `${body}|${group}` : body;
}

// Pieza compuesta (fusión de cubos de un color): su "forma" lleva las cajas que la componen,
// "compound:x,y,z,w,h,d;x,y,z,w,h,d…", relativas a su esquina mínima.
export const isCompound = (p) => p.shape.startsWith('compound:');
export const compoundBoxes = (shape) => shape.slice(9).split(';').map((b) => b.split(',').map(Number));
export const makeCompoundShape = (boxes) => `compound:${boxes.map((b) => b.map(snapStep).join(',')).join(';')}`;

/** Tamaño natural (caja envolvente) de las cajas de una pieza compuesta. */
export function compoundNatural(boxes) {
  return [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b[a] + b[a + 3])));
}

/** Cajas de la pieza en el mundo: [[min], [tamaño]] (una sola, salvo las compuestas). */
export function pieceWorldBoxes(cell, p) {
  const min = cell.map((c, i) => c + p.offset[i]);
  if (!isCompound(p)) return [[min, p.size]];
  const boxes = compoundBoxes(p.shape);
  const k = compoundNatural(boxes).map((v, i) => p.size[i] / v); // por si se escaló
  return boxes.map((b) => [min.map((m, i) => m + b[i] * k[i]), [b[3] * k[0], b[4] * k[1], b[5] * k[2]]]);
}

/** Celdas que ocupa realmente una pieza (en una compuesta, sólo las de sus cajas). */
export function cellsOfPiece(cell, p) {
  if (!isCompound(p)) return pieceCells(cell, p.size, p.offset);
  const seen = new Map();
  for (const [m, s] of pieceWorldBoxes(cell, p)) {
    for (const c of pieceCells([0, 0, 0], s, m)) seen.set(c.join(','), c);
  }
  return [...seen.values()];
}

/** Celdas que toca una pieza (su caja va de celda+desplazamiento a +tamaño). */
export function pieceCells(cell, size, offset = ZERO) {
  const lo = cell.map((c, i) => Math.floor(c + offset[i] + 1e-6));
  const hi = cell.map((c, i) => Math.max(lo[i], Math.ceil(c + offset[i] + size[i] - 1e-6) - 1));
  const cells = [];
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) cells.push([x, y, z]);
  return cells;
}

/** Piezas que cambian al girarlas (cubo y esfera se ven igual). */
export const ROTATABLE = new Set(['cylinder', 'cone', 'pyramid', 'wedge']);

export class VoxelModel {
  constructor(size = 24) {
    this.size = size;
    this.voxels = new Map();
    this.stickers = new Map();
    this.coverCache = null;
  }

  get half() { return this.size / 2; }
  get count() { return this.voxels.size; }

  inBounds(x, y, z, size = this.size) {
    const h = size / 2;
    return x >= -h && x < h && z >= -h && z < h && y >= 0 && y < size;
  }

  get(x, y, z) { return this.voxels.get(keyOf(x, y, z)) ?? null; }

  /** Claves de las piezas de un grupo. */
  groupKeys(group) {
    const keys = [];
    for (const [k, v] of this.voxels) if (v.endsWith(`|${group}`)) keys.push(k);
    return keys;
  }

  /** Id de grupo sin usar ("g1", "g2"…). `reserved` evita repetir ids ya dados. */
  newGroupId(reserved = null) {
    let max = 0;
    for (const v of this.voxels.values()) {
      const i = v.indexOf('|g');
      if (i >= 0) max = Math.max(max, Number(v.slice(i + 2)));
    }
    for (const g of reserved ?? []) max = Math.max(max, Number(g.slice(1)));
    return `g${max + 1}`;
  }

  /**
   * Clave libre para una pieza con esa celda base: "x,y,z" o, si ya hay otra ahí,
   * "x,y,z#1", "x,y,z#2"… (así varias piezas encimadas pueden empezar en la misma celda).
   */
  freeKey(cell, taken = null) {
    const base = keyOf(...cell);
    const busy = (k) => this.voxels.has(k) || taken?.has(k);
    if (!busy(base)) return base;
    let i = 1;
    while (busy(`${base}#${i}`)) i++;
    return `${base}#${i}`;
  }
  has(x, y, z) { return this.voxels.has(keyOf(x, y, z)); }

  /** Lee cubo o calcomanía según la clave. */
  getKey(key) {
    return (isStickerKey(key) ? this.stickers : this.voxels).get(key) ?? null;
  }

  setKey(key, value) {
    const map = isStickerKey(key) ? this.stickers : this.voxels;
    if (map === this.voxels) this.coverCache = null;
    if (value) map.set(key, value);
    else map.delete(key);
  }

  /** Celdas cubiertas por piezas más grandes que 1 (celda -> clave de la pieza). */
  get covered() {
    if (!this.coverCache) {
      this.coverCache = new Map();
      for (const [k, v] of this.voxels) {
        if (!v.includes('/')) continue;
        const p = parseVoxel(v);
        // Las piezas transparentes (agua, vidrio) dejan construir dentro
        if (p.opacity < 1) continue;
        if (!isCompound(p) && p.size.every((s) => s <= 1) && isZero(p.offset)) continue;
        for (const c of cellsOfPiece(parseKey(k), p)) {
          const ck = keyOf(...c);
          if (ck !== k) this.coverCache.set(ck, k);
        }
      }
    }
    return this.coverCache;
  }

  /** Clave de la pieza que ocupa la celda (la propia o una grande que la cubre), o null. */
  pieceAt(x, y, z) {
    const k = keyOf(x, y, z);
    if (this.voxels.has(k)) return k;
    return this.covered.get(k) ?? null;
  }

  /**
   * ¿Cabe una caja (esquina mínima, tamaño) sin encimarse con piezas sólidas?
   * Sirve para piezas fuera de la cuadrícula (p. ej. un cubo apilado sobre uno aplastado).
   */
  boxFree(min, size) {
    const max = min.map((v, i) => v + size[i]);
    const lo = min.map((v) => Math.floor(v + 1e-6));
    const hi = max.map((v) => Math.ceil(v - 1e-6) - 1);
    const owners = new Set();
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          if (!this.inBounds(x, y, z)) return false;
          const base = keyOf(x, y, z);
          if (this.voxels.has(base)) owners.add(base);
          for (let i = 1; this.voxels.has(`${base}#${i}`); i++) owners.add(`${base}#${i}`);
          const cover = this.covered.get(base);
          if (cover) owners.add(cover);
        }
      }
    }
    for (const k of owners) {
      const p = parseVoxel(this.voxels.get(k));
      if (p.opacity < 1) continue; // dentro del agua se puede construir
      for (const [m, s] of pieceWorldBoxes(parseKey(k), p)) {
        if (m.every((v, i) => v < max[i] - 1e-6 && v + s[i] > min[i] + 1e-6)) return false;
      }
    }
    return true;
  }

  /** ¿La celda está ocupada por una pieza (propia o una grande que la cubre)? */
  occupied(x, y, z) {
    const k = keyOf(x, y, z);
    return this.voxels.has(k) || this.covered.has(k);
  }

  /** Celda del cubo que sostiene la calcomanía (detrás) o la que la taparía (delante). */
  stickerCell(key, side) {
    const { p, f } = parseStickerKey(key);
    const n = FACE_NORMALS[f];
    const d = side === 'front' ? 0.5 : -0.5;
    return p.map((v, i) => Math.floor(v + n[i] * d));
  }

  /** Celdas (claves) que la calcomanía cubre sobre su cara, del lado del cubo que la sostiene. */
  stickerFootprint(key, size = this.stickers.get(key)?.n ?? 1) {
    const { p, f } = parseStickerKey(key);
    const n = FACE_NORMALS[f];
    const axis = n.findIndex((v) => v !== 0);
    const ranges = p.map((c, i) => (i === axis
      ? [Math.floor(c - n[i] * 0.5), Math.floor(c - n[i] * 0.5)]
      : [Math.floor(c - size / 2), Math.ceil(c + size / 2) - 1]));
    const cells = [];
    for (let x = ranges[0][0]; x <= ranges[0][1]; x++) {
      for (let y = ranges[1][0]; y <= ranges[1][1]; y++) {
        for (let z = ranges[2][0]; z <= ranges[2][1]; z++) cells.push(keyOf(x, y, z));
      }
    }
    return cells;
  }

  /** ¿La calcomanía queda completa sobre caras visibles de cubos (sin salirse)? */
  stickerFits(key, size) {
    const n = FACE_NORMALS[parseStickerKey(key).f];
    return this.stickerFootprint(key, size).every((k) => {
      const [x, y, z] = parseKey(k);
      // Sirve sobre cubos y sobre la cara de piezas grandes
      return this.occupied(x, y, z) && !this.occupied(x + n[0], y + n[1], z + n[2]);
    });
  }

  /** Claves de calcomanías cuya celda (side) está en el conjunto de claves de cubo dado. */
  stickersOn(cellKeys, side) {
    const out = [];
    for (const k of this.stickers.keys()) {
      if (cellKeys.has(keyOf(...this.stickerCell(k, side)))) out.push(k);
    }
    return out;
  }

  fits(size) {
    for (const [k, v] of this.voxels) {
      const p = v.includes('/') && parseVoxel(v);
      const cells = p ? cellsOfPiece(parseKey(k), p) : [parseKey(k)];
      if (!cells.every((c) => this.inBounds(...c, size))) return false;
    }
    return true;
  }

  /** Caja envolvente en coordenadas de mundo ({min, max}) o null si está vacío. */
  bounds() {
    if (!this.count) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const k of this.voxels.keys()) {
      const p = parseKey(k);
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] + 1 > max[i]) max[i] = p[i] + 1;
      }
    }
    return { min, max };
  }

  /** Colores usados, del más frecuente al menos. */
  colors() {
    const counts = new Map();
    for (const v of this.voxels.values()) {
      const { color: c } = parseVoxel(v);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const { c } of this.stickers.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }

  /** Celdas conectadas (6 vecinos) con el mismo color que la celda inicial. */
  floodSameColor([x, y, z]) {
    if (!this.has(x, y, z)) return [];
    const target = parseVoxel(this.get(x, y, z)).color;
    const start = keyOf(x, y, z);
    const seen = new Set([start]);
    const stack = [[x, y, z]];
    while (stack.length) {
      const [cx, cy, cz] = stack.pop();
      for (const [dx, dy, dz] of NEIGHBORS) {
        const k = keyOf(cx + dx, cy + dy, cz + dz);
        if (!seen.has(k) && this.voxels.has(k) && parseVoxel(this.voxels.get(k)).color === target) {
          seen.add(k);
          stack.push([cx + dx, cy + dy, cz + dz]);
        }
      }
    }
    return [...seen];
  }

  clone() {
    const m = new VoxelModel(this.size);
    m.voxels = new Map(this.voxels);
    m.stickers = new Map(this.stickers);
    m.coverCache = null;
    return m;
  }

  /** Formato compacto: paleta + lista plana [x,y,z,índiceColor, ...]. */
  serialize() {
    const palette = [];
    const index = new Map();
    const voxels = [];
    for (const [k, c] of this.voxels) {
      if (!index.has(c)) { index.set(c, palette.length); palette.push(c); }
      voxels.push(...parseKey(k), index.get(c));
    }
    const stickers = [];
    for (const [k, st] of this.stickers) {
      const { p, f } = parseStickerKey(k);
      stickers.push([...p, f, st.s, st.c, st.n, st.flip ? 1 : 0]);
    }
    const out = { format: 'cubostudio', version: 2, size: this.size, palette, voxels, stickers };
    if (this.bevel) out.bevel = this.bevel; // orillas con las que se hizo ('flat' | 'soft' | 'round')
    return out;
  }

  static deserialize(data) {
    if (!data || data.format !== 'cubostudio' || !Array.isArray(data.voxels) || !Array.isArray(data.palette)) {
      throw new Error('Archivo no válido');
    }
    const size = GRID_SIZES.includes(data.size) ? data.size : 24;
    const m = new VoxelModel(size);
    if (['flat', 'soft', 'round'].includes(data.bevel)) m.bevel = data.bevel;
    const v = data.voxels;
    for (let i = 0; i + 3 < v.length; i += 4) {
      const color = String(data.palette[v[i + 3]] ?? '').toLowerCase();
      if (!VOXEL.test(color)) continue;
      const [x, y, z] = [v[i], v[i + 1], v[i + 2]].map((n) => Math.trunc(n));
      if (m.inBounds(x, y, z)) m.voxels.set(m.freeKey([x, y, z]), color);
    }
    for (const st of Array.isArray(data.stickers) ? data.stickers : []) {
      if (!Array.isArray(st) || st.length < 7) continue;
      const [x, y, z, f, id, c, n, flip] = st;
      const color = String(c).toLowerCase();
      if (![x, y, z].every(Number.isFinite) || !FACE_NORMALS[f] || typeof id !== 'string' || !HEX.test(color)) continue;
      const size = Math.min(8, Math.max(1, Math.trunc(n) || 1));
      m.stickers.set(stickerKey([x, y, z], f), { s: id, c: color, n: size, flip: !!flip });
    }
    return m;
  }
}
