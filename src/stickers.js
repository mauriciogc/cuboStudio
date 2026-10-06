import * as THREE from 'three';
import { FACE_NORMALS, parseStickerKey } from './model.js';

// Calcomanías: formas dibujadas en canvas (coordenadas normalizadas 0..1)
// con el color elegido. Se pegan sobre las caras de los cubos.
const TAU = Math.PI * 2;
const WHITE = '#ffffff';

const circle = (g, x, y, r, color) => {
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = color; g.fill();
};
const stroke = (g, color, width, path) => {
  g.beginPath(); path(); g.strokeStyle = color; g.lineWidth = width;
  g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
};

export const STICKERS = {
  'eye-dot': { label: 'Ojo redondo', draw(g, c) { circle(g, 0.5, 0.5, 0.3, c); circle(g, 0.4, 0.4, 0.09, WHITE); } },
  'eye-tall': {
    label: 'Ojo alto',
    draw(g, c) {
      g.beginPath(); g.roundRect(0.32, 0.14, 0.36, 0.72, 0.16); g.fillStyle = c; g.fill();
      circle(g, 0.43, 0.32, 0.08, WHITE);
    },
  },
  'eye-big': {
    label: 'Ojo brillante',
    draw(g, c) { circle(g, 0.5, 0.5, 0.42, c); circle(g, 0.36, 0.34, 0.14, WHITE); circle(g, 0.63, 0.65, 0.06, WHITE); },
  },
  'eye-angry': {
    label: 'Ojo enojado',
    draw(g, c) {
      circle(g, 0.5, 0.56, 0.32, c);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(1, 0); g.lineTo(1, 0.36); g.lineTo(0, 0.62); g.fill();
      g.globalCompositeOperation = 'source-over';
      circle(g, 0.4, 0.62, 0.07, WHITE);
    },
  },
  'eye-happy': {
    label: 'Ojo feliz',
    draw(g, c) { stroke(g, c, 0.14, () => { g.moveTo(0.18, 0.66); g.lineTo(0.5, 0.32); g.lineTo(0.82, 0.66); }); },
  },
  'eye-closed': {
    label: 'Ojo cerrado',
    draw(g, c) { stroke(g, c, 0.12, () => g.arc(0.5, 0.3, 0.34, 0.2 * Math.PI, 0.8 * Math.PI)); },
  },
  'eye-x': {
    label: 'Ojo X',
    draw(g, c) {
      stroke(g, c, 0.13, () => { g.moveTo(0.22, 0.22); g.lineTo(0.78, 0.78); g.moveTo(0.78, 0.22); g.lineTo(0.22, 0.78); });
    },
  },
  brow: {
    label: 'Ceja',
    draw(g, c) { stroke(g, c, 0.15, () => { g.moveTo(0.18, 0.62); g.lineTo(0.82, 0.38); }); },
  },
  'mouth-smile': {
    label: 'Sonrisa',
    draw(g, c) { stroke(g, c, 0.1, () => g.arc(0.5, 0.28, 0.36, 0.15 * Math.PI, 0.85 * Math.PI)); },
  },
  'mouth-open': {
    label: 'Boca abierta',
    draw(g, c) {
      g.beginPath(); g.moveTo(0.14, 0.3); g.arc(0.5, 0.3, 0.36, 0, Math.PI); g.closePath();
      g.fillStyle = c; g.fill();
      g.save(); g.clip(); circle(g, 0.5, 0.78, 0.2, '#f28c9b'); g.restore();
    },
  },
  'mouth-fang': {
    label: 'Colmillo',
    draw(g, c) {
      stroke(g, c, 0.1, () => g.arc(0.5, 0.28, 0.36, 0.15 * Math.PI, 0.85 * Math.PI));
      g.beginPath(); g.moveTo(0.55, 0.6); g.lineTo(0.71, 0.6); g.lineTo(0.63, 0.8); g.closePath();
      g.fillStyle = WHITE; g.fill();
      g.strokeStyle = c; g.lineWidth = 0.03; g.stroke();
    },
  },
  'mouth-cat': {
    label: 'Boca gato',
    draw(g, c) {
      stroke(g, c, 0.09, () => { g.arc(0.33, 0.4, 0.17, 0, Math.PI); g.moveTo(0.84, 0.4); g.arc(0.67, 0.4, 0.17, 0, Math.PI); });
    },
  },
  square: {
    label: 'Cuadro',
    draw(g, c) { g.fillStyle = c; g.fillRect(0.2, 0.2, 0.6, 0.6); },
  },
  'eye-block': {
    label: 'Ojo cuadrado',
    draw(g, c) {
      g.fillStyle = '#f4f1f6'; g.fillRect(0.06, 0.06, 0.88, 0.88);
      g.fillStyle = c; g.fillRect(0.34, 0.3, 0.34, 0.4);
    },
  },
  cheek: { label: 'Mejilla', draw(g, c) { circle(g, 0.5, 0.5, 0.38, c); } },
  nose: {
    label: 'Nariz',
    draw(g, c) { g.beginPath(); g.ellipse(0.5, 0.5, 0.16, 0.11, 0, 0, TAU); g.fillStyle = c; g.fill(); },
  },
  spiral: {
    label: 'Espiral',
    draw(g, c) {
      stroke(g, c, 0.08, () => {
        for (let t = 0; t <= 5.2 * Math.PI; t += 0.1) {
          const r = 0.02 + 0.026 * t;
          g.lineTo(0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t));
        }
      });
    },
  },
  heart: {
    label: 'Corazón',
    draw(g, c) {
      g.beginPath();
      g.moveTo(0.5, 0.84);
      g.bezierCurveTo(0.1, 0.56, 0.12, 0.2, 0.32, 0.2);
      g.bezierCurveTo(0.42, 0.2, 0.48, 0.27, 0.5, 0.34);
      g.bezierCurveTo(0.52, 0.27, 0.58, 0.2, 0.68, 0.2);
      g.bezierCurveTo(0.88, 0.2, 0.9, 0.56, 0.5, 0.84);
      g.fillStyle = c; g.fill();
    },
  },
  star: {
    label: 'Estrella',
    draw(g, c) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.19 : 0.42;
        g.lineTo(0.5 + r * Math.cos(a), 0.53 + r * Math.sin(a));
      }
      g.closePath(); g.fillStyle = c; g.fill();
    },
  },
};

export const STICKER_SIZES = [1, 2, 3, 4];
export const STICKER_OFFSET = 0.012;

/** Dibuja una calcomanía en un canvas cuadrado. */
export function drawSticker(id, color, flip = false, px = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const g = canvas.getContext('2d');
  g.scale(px, px);
  if (flip) { g.translate(1, 0); g.scale(-1, 1); }
  STICKERS[id]?.draw(g, color);
  return canvas;
}

const textures = new Map();
const materials = new Map();
const geometries = new Map();

/** Resolución del dibujo según el tamaño en cubos (para que no se vea borrosa al agrandarla). */
const resolutionFor = (n) => (n <= 1 ? 256 : n <= 2 ? 512 : n <= 4 ? 1024 : 2048);

function material(id, color, flip, px = 256) {
  const key = `${id}|${color}|${flip ? 1 : 0}|${px}`;
  let m = materials.get(key);
  if (!m) {
    let tex = textures.get(key);
    if (!tex) {
      tex = new THREE.CanvasTexture(drawSticker(id, color, flip, px));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      textures.set(key, tex);
    }
    m = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.05, roughness: 0.7, side: THREE.DoubleSide, // se ve por ambos lados
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    materials.set(key, m);
  }
  return m;
}

function geometry(size) {
  let g = geometries.get(size);
  if (!g) { g = new THREE.PlaneGeometry(size, size); geometries.set(size, g); }
  return g;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Ejes de la cara f en el mundo: "derecha" y "arriba" de la calcomanía. */
export function stickerAxes(f) {
  const n = FACE_NORMALS[f];
  let up = [0, 1, 0];
  if (n[1] > 0) up = [0, 0, -1];
  else if (n[1] < 0) up = [0, 0, 1];
  // derecha = arriba × normal
  const right = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  return { right, up };
}

/** Orienta un plano sobre la cara f, con "arriba" = +Y (o -Z en caras horizontales). */
export function placeStickerMesh(mesh, p, f) {
  const n = FACE_NORMALS[f];
  _z.set(...n);
  if (n[1] > 0) _y.set(0, 0, -1);
  else if (n[1] < 0) _y.set(0, 0, 1);
  else _y.set(0, 1, 0);
  _x.crossVectors(_y, _z);
  mesh.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  mesh.position.set(p[0] + n[0] * STICKER_OFFSET, p[1] + n[1] * STICKER_OFFSET, p[2] + n[2] * STICKER_OFFSET);
}

export function createStickerMesh({ s, c, n, flip }) {
  return new THREE.Mesh(geometry(n), material(s, c, flip, resolutionFor(n)));
}

/** Capa con todas las calcomanías del modelo (una malla por calcomanía). */
export class StickerLayer {
  constructor() {
    this.group = new THREE.Group();
  }

  rebuild(model) {
    this.group.clear();
    for (const [key, st] of model.stickers) {
      if (!STICKERS[st.s]) continue;
      const { p, f } = parseStickerKey(key);
      const mesh = createStickerMesh(st);
      placeStickerMesh(mesh, p, f);
      mesh.receiveShadow = true;
      mesh.userData.stickerKey = key;
      this.group.add(mesh);
    }
  }
}
