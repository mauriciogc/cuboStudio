import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  parseKey, parseVoxel, keyOf, isUnit, isZero, FACE_NORMALS, NEIGHBORS, PIECES,
  isCompound, pieceWorldBoxes,
} from './model.js';
import { compoundGeometry } from './compound.js';

const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

function wedgeGeometry() {
  // Prisma triangular: triángulo en XY con la punta en +Y, extruido en Z
  const shape = new THREE.Shape([
    new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0, 0.5),
  ]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g; // ExtrudeGeometry ya es no indexada
}

/** Geometrías de cada pieza, centradas en la celda y apuntando a +Y. */
// Redondeo de las orillas de los cubos (general, se elige en Escena)
export const BEVELS = {
  flat: { label: 'Rectas', r: 0 },
  soft: { label: 'Suaves', r: 0.07 },
  round: { label: 'Redondas', r: 0.18 },
};
let bevel = BEVELS.soft.r;

/** Caja con orillas redondeadas de radio r (o una caja simple si r = 0). */
function roundedBox(sx, sy, sz, segments, r) {
  const g = r > 0 ? new RoundedBoxGeometry(sx, sy, sz, segments, r) : new THREE.BoxGeometry(sx, sy, sz);
  g.computeBoundingSphere();
  return g;
}

export const PIECE_GEOMETRIES = {
  cube: roundedBox(1, 1, 1, 2, bevel),
  sphere: new THREE.SphereGeometry(0.5, 20, 14),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: new THREE.ConeGeometry(0.5, 1, 24),
  pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
  wedge: wedgeGeometry(),
};
for (const g of Object.values(PIECE_GEOMETRIES)) g.computeBoundingSphere();

// Con muchos cubos visibles se usa un bisel más simple (108 triángulos en vez de 300):
// se ve igual de redondeado y aguanta figuras de 128.
let LIGHT_CUBE = roundedBox(1, 1, 1, 1, bevel);
const LIGHT_CUBE_THRESHOLD = 12000;

const _preRotate = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

const _twist = [0, 1, 2, 3].map((t) => new THREE.Quaternion().setFromAxisAngle(_up, (t * Math.PI) / 2));

/** Rotación que lleva +Y a la normal de la cara f, girada t cuartos de vuelta sobre ese eje. */
export function pieceQuaternion(f, t = 0, out = new THREE.Quaternion()) {
  const n = FACE_NORMALS[f] ?? FACE_NORMALS[2];
  out.setFromUnitVectors(_up, new THREE.Vector3(...n));
  // En caras ±Z el triángulo se ve de perfil; girarlo para que su cara quede al frente
  if (n[2] !== 0) out.multiply(_preRotate);
  return out.multiply(_twist[t & 3]);
}

/** Ejes "arriba" (+Y local) y "fondo" (+Z local) de una orientación, en el mundo. */
export function pieceAxes(f, t = 0) {
  const q = pieceQuaternion(f, t);
  const r = (v) => v.applyQuaternion(q).toArray().map(Math.round);
  return { up: r(new THREE.Vector3(0, 1, 0)), back: r(new THREE.Vector3(0, 0, 1)) };
}

/** Orientación {f, t} cuyo "arriba" es up y cuyo eje de fondo es paralelo a back. */
export function orientationFrom(up, back) {
  const f = FACE_NORMALS.findIndex((n) => n[0] === up[0] && n[1] === up[1] && n[2] === up[2]);
  if (f < 0) return { f: 2, t: 0 };
  for (let t = 0; t < 4; t++) {
    const b = pieceAxes(f, t).back;
    if (Math.abs(b[0] * back[0] + b[1] * back[1] + b[2] * back[2]) > 0.5) return { f, t };
  }
  return { f, t: 0 };
}

const _quat = new THREE.Quaternion();
const _rot = new THREE.Matrix4();
const _scaleM = new THREE.Matrix4();

// Cubos con tamaño: geometría a la medida (así el bisel no se deforma al estirarlos)
const sizedCubes = new Map();
function sizedCubeGeometry([sx, sy, sz]) {
  const key = `${sx},${sy},${sz}`;
  let g = sizedCubes.get(key);
  if (!g) {
    g = roundedBox(sx, sy, sz, bevel > 0.1 ? 3 : 2, Math.min(bevel, sx / 2, sy / 2, sz / 2));
    sizedCubes.set(key, g);
  }
  return g;
}

// Piezas compuestas: geometría propia, a la medida (cache por forma y tamaño)
const compounds = new Map();
function compoundGeometryFor(p) {
  const key = `${p.shape}|${p.size.join(',')}`;
  let g = compounds.get(key);
  if (!g) {
    const boxes = pieceWorldBoxes([0, 0, 0], { ...p, offset: [0, 0, 0] }).map(([m, s]) => [...m, ...s]);
    g = compoundGeometry(boxes, bevel);
    compounds.set(key, g);
  }
  return g;
}

/** Cambia el redondeo de las orillas ('flat' | 'soft' | 'round'). Después hay que redibujar. */
export function setBevel(id) {
  const r = (BEVELS[id] ?? BEVELS.soft).r;
  if (r === bevel) return false;
  bevel = r;
  const old = [PIECE_GEOMETRIES.cube, LIGHT_CUBE, ...sizedCubes.values(), ...compounds.values()];
  PIECE_GEOMETRIES.cube = roundedBox(1, 1, 1, r > 0.1 ? 3 : 2, r);
  LIGHT_CUBE = roundedBox(1, 1, 1, 1, r);
  sizedCubes.clear();
  compounds.clear();
  // Las mallas viejas se sueltan en el siguiente cuadro (ya redibujadas con las nuevas)
  requestAnimationFrame(() => old.forEach((g) => g.dispose()));
  return true;
}

// Contornos: 12 aristas de una caja (índices de esquina con bits x|y|z)
const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const shapeEdgeCache = new Map();
function shapeEdges(shape) {
  let pos = shapeEdgeCache.get(shape);
  if (!pos) {
    pos = new THREE.EdgesGeometry(PIECE_GEOMETRIES[shape] ?? PIECE_GEOMETRIES.cube, 30).attributes.position.array;
    shapeEdgeCache.set(shape, pos);
  }
  return pos;
}
// Pieza compuesta: sólo su contorno exterior (sin las líneas entre los cubos que la forman)
const compoundEdgeCache = new Map();
function compoundEdgesFor(p) {
  const key = `${p.shape}|${p.size.join(',')}`;
  let pos = compoundEdgeCache.get(key);
  if (!pos) {
    const boxes = pieceWorldBoxes([0, 0, 0], { ...p, offset: [0, 0, 0] }).map(([m, s]) => [...m, ...s]);
    const flat = compoundGeometry(boxes, 0);
    pos = new THREE.EdgesGeometry(flat, 1).attributes.position.array;
    flat.dispose();
    compoundEdgeCache.set(key, pos);
  }
  return pos;
}

const isSizedCube = (p) => p.shape === 'cube' && (!isUnit(p.size) || !isZero(p.offset));
/** Piezas que se dibujan una por una con geometría propia (no instanciadas). */
const ownMesh = (p) => isSizedCube(p) || isCompound(p);

/** Geometría para dibujar una pieza (los cubos estirados y las compuestas tienen la suya). */
export function pieceGeometry(p) {
  if (isCompound(p)) return compoundGeometryFor(p);
  return isSizedCube(p) ? sizedCubeGeometry(p.size) : (PIECE_GEOMETRIES[p.shape] ?? PIECE_GEOMETRIES.cube);
}

/** Matriz que acompaña a pieceGeometry(p). */
export function pieceTransform(cell, p, out = new THREE.Matrix4()) {
  if (ownMesh(p)) return out.makeTranslation(...cell.map((v, i) => v + p.offset[i] + p.size[i] / 2));
  return pieceMatrix(cell, p, out);
}

/**
 * Matriz de una pieza: centro de su caja, tamaño en ejes del mundo y giro.
 * (Escala después de rotar: así "ancho/alto/fondo" son siempre del mundo.)
 */
export function pieceMatrix([x, y, z], p, out = new THREE.Matrix4()) {
  const [sx, sy, sz] = p.size;
  if (p.shape === 'cube') _quat.identity();
  else pieceQuaternion(p.f, p.t, _quat);
  _rot.makeRotationFromQuaternion(_quat);
  _scaleM.makeScale(sx, sy, sz);
  out.multiplyMatrices(_scaleM, _rot);
  const o = p.offset ?? [0, 0, 0];
  out.setPosition(x + o[0] + sx / 2, y + o[1] + sy / 2, z + o[2] + sz / 2);
  return out;
}

/**
 * Dibuja las piezas con un InstancedMesh por forma (pocas draw calls).
 * La capacidad de cada uno crece al doble cuando hace falta.
 */
export class VoxelMesh {
  constructor() {
    this.group = new THREE.Group();
    /** "forma|opacidad" -> { mesh, capacity } (se crean a demanda) */
    this.layers = {};
    this.materials = new Map();
    // Cubos estirados: una malla por pieza (suelen ser pocas)
    this.sized = new THREE.Group();
    this.group.add(this.sized);
    this.sizedMaterials = new Map();
    // Contorno de cada pieza (sólo para modelar: el editor lo trata como ayuda y no se exporta)
    this.showEdges = false;
    this.edges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#1d2030', transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.edges.visible = false;
    this.edges.renderOrder = 2;
  }

  /** Arma el contorno de las piezas dibujadas ([celda, pieza] de cada una). */
  #buildEdges(pieces) {
    const out = [];
    const E = 0.004; // un pelito afuera de la cara, para que no se pierda contra ella
    const v = new THREE.Vector3();
    for (const [c, p] of pieces) {
      if (p.shape === 'cube' || isCompound(p)) {
        if (isCompound(p)) {
          const pos = compoundEdgesFor(p);
          const ctr = c.map((x, i) => x + p.offset[i] + p.size[i] / 2);
          for (let i = 0; i < pos.length; i += 3) out.push(pos[i] + ctr[0], pos[i + 1] + ctr[1], pos[i + 2] + ctr[2]);
          continue;
        }
        const lo = c.map((x, i) => x + p.offset[i] - E);
        const hi = c.map((x, i) => x + p.offset[i] + p.size[i] + E);
        const P = (i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
        for (const [a, b] of BOX_EDGES) out.push(...P(a), ...P(b));
        continue;
      }
      const pos = shapeEdges(p.shape);
      pieceMatrix(c, p, _matrix);
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).multiplyScalar(1 + E * 2).applyMatrix4(_matrix);
        out.push(v.x, v.y, v.z);
      }
    }
    this.edges.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    this.edges.geometry = g;
  }

  /**
   * Mallas para raycast. Instanciadas: userData.coords[instanceId] = [x,y,z].
   * Cubos estirados: userData.cell = [x,y,z].
   */
  get meshes() {
    return [
      ...Object.values(this.layers).map((l) => l.mesh).filter((m) => m && m.count > 0),
      ...this.sized.children,
    ];
  }

  /** Material compartido por opacidad (los transparentes no escriben profundidad). */
  #material(opacity) {
    let m = this.materials.get(opacity);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        roughness: opacity < 1 ? 0.2 : 0.78, metalness: 0,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      });
      this.materials.set(opacity, m);
    }
    return m;
  }

  #sizedMaterial(color, opacity) {
    const key = `${color}|${opacity}`;
    let m = this.sizedMaterials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color, roughness: opacity < 1 ? 0.2 : 0.78, metalness: 0,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      });
      this.sizedMaterials.set(key, m);
    }
    return m;
  }

  #ensure(key, n) {
    const [shape, op] = key.split('|');
    const opacity = Number(op);
    this.layers[key] ??= { mesh: null, capacity: 0 };
    const layer = this.layers[key];
    if (n <= layer.capacity) return layer.mesh;
    let cap = Math.max(shape === 'cube' ? 512 : 64, layer.capacity);
    while (cap < n) cap *= 2;
    if (layer.mesh) {
      this.group.remove(layer.mesh);
      layer.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(PIECE_GEOMETRIES[shape], this.#material(opacity), cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _color.set('#ffffff')); // crea instanceColor
    mesh.castShadow = opacity >= 0.75;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.userData.coords = [];
    mesh.userData.keys = [];
    mesh.renderOrder = opacity < 1 ? 1 : 0;
    this.group.add(mesh);
    layer.mesh = mesh;
    layer.capacity = cap;
    return mesh;
  }

  /** hidden: claves que no se dibujan (opcional). */
  rebuild(model, hidden = null) {
    const buckets = {};
    for (const key of Object.keys(this.layers)) buckets[key] = [];
    // Un cubo rodeado por cubos en sus 6 caras no se ve: no se dibuja
    const isCube = (k) => {
      const v = model.voxels.get(k);
      return v !== undefined && v.length === 7 && !hidden?.has(k); // cubo sólido de 1×1×1
    };
    this.sized.clear();
    const drawn = this.showEdges ? [] : null;
    for (const [k, v] of model.voxels) {
      if (hidden?.has(k)) continue;
      const p = parseVoxel(v);
      const c = parseKey(k);
      if (ownMesh(p)) {
        drawn?.push([c, p]);
        const mesh = new THREE.Mesh(pieceGeometry(p), this.#sizedMaterial(p.color, p.opacity));
        mesh.position.set(...c.map((v, i) => v + p.offset[i] + p.size[i] / 2));
        mesh.castShadow = p.opacity >= 0.75;
        mesh.receiveShadow = true;
        mesh.renderOrder = p.opacity < 1 ? 1 : 0;
        mesh.userData.cell = c;
        mesh.userData.key = k;
        this.sized.add(mesh);
        continue;
      }
      if (p.shape === 'cube' && isUnit(p.size) && isZero(p.offset)
        && NEIGHBORS.every(([dx, dy, dz]) => isCube(keyOf(c[0] + dx, c[1] + dy, c[2] + dz)))) continue;
      const key = `${p.shape in PIECES ? p.shape : 'cube'}|${p.opacity}`;
      (buckets[key] ??= []).push([c, p, k]);
      drawn?.push([c, p]);
    }
    this.edges.visible = !!drawn;
    if (drawn) this.#buildEdges(drawn);

    for (const [key, items] of Object.entries(buckets)) {
      const layer = this.layers[key];
      if (!items.length && !layer?.mesh) continue;
      const mesh = this.#ensure(key, items.length);
      if (key.startsWith('cube|')) {
        mesh.geometry = items.length > LIGHT_CUBE_THRESHOLD ? LIGHT_CUBE : PIECE_GEOMETRIES.cube;
      }
      const { coords, keys } = mesh.userData;
      coords.length = 0;
      keys.length = 0;
      items.forEach(([c, p, k], i) => {
        keys[i] = k;
        mesh.setMatrixAt(i, pieceMatrix(c, p, _matrix));
        mesh.setColorAt(i, _color.set(p.color));
        coords[i] = c;
      });
      mesh.count = items.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
  }
}
