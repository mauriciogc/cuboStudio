import * as THREE from 'three';
import { parseKey, keyOf, parseVoxel, isUnit, isZero } from './model.js';
import { VoxelMesh, pieceGeometry, pieceTransform, glowClusters, glowPieces, glowLightParams } from './voxel-mesh.js';
import { StickerLayer } from './stickers.js';
import { normalizeLight, sunPosition } from './stage.js';

let exportRenderer = null;

function getRenderer() {
  if (!exportRenderer) {
    exportRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    exportRenderer.setPixelRatio(1);
    exportRenderer.setClearColor(0x000000, 0);
    exportRenderer.shadowMap.enabled = true;
    exportRenderer.shadowMap.type = THREE.PCFShadowMap;
    exportRenderer.toneMapping = THREE.NeutralToneMapping;
  }
  return exportRenderer;
}

export const ISO_DIRECTION = new THREE.Vector3(1, 0.9, 1.25).normalize();

/**
 * Renderiza la figura con cámara ortográfica encuadrada al contenido.
 * size = lado mayor de la imagen en px; el aspecto se ajusta a la figura.
 */
/** Cámara ortográfica ajustada a la figura vista desde direction, y tamaño de imagen. */
function frameModel(model, direction, { size, padding, shadow }) {
  const b = model.bounds() ?? { min: [-1, 0, -1], max: [1, 2, 1] };
  const min = new THREE.Vector3(...b.min);
  const max = new THREE.Vector3(...b.max);
  if (shadow) {
    min.x -= 0.6; min.z -= 0.6; max.x += 0.6; max.z += 0.6;
  }
  const center = min.clone().add(max).multiplyScalar(0.5);
  const reach = min.distanceTo(max) + 10;

  const cam = new THREE.OrthographicCamera();
  cam.position.copy(center).addScaledVector(direction, reach);
  cam.lookAt(center);
  cam.updateMatrixWorld();

  // Proyecta las 8 esquinas al espacio de cámara para un encuadre ajustado
  const v = new THREE.Vector3();
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(cam.matrixWorldInverse);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const pad = Math.max(x1 - x0, y1 - y0) * padding;
  Object.assign(cam, { left: x0 - pad, right: x1 + pad, bottom: y0 - pad, top: y1 + pad, near: 0.1, far: reach * 3 });
  cam.updateProjectionMatrix();

  const aspect = (cam.right - cam.left) / (cam.top - cam.bottom);
  const width = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect));
  const height = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;
  return { cam, width, height };
}

/**
 * Recorta los bordes transparentes de un canvas (deja un margen) y lo escala para que
 * su lado mayor mida `size`. Si se pasa `background`, lo pinta detrás.
 */
function trimToCanvas(src, { size, margin = 0.04, background = null }) {
  const tmp = document.createElement('canvas');
  tmp.width = src.width;
  tmp.height = src.height;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(src, 0, 0);
  const { data } = tctx.getImageData(0, 0, tmp.width, tmp.height);
  let x0 = tmp.width; let y0 = tmp.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < tmp.height; y++) {
    for (let x = 0; x < tmp.width; x++) {
      if (data[(y * tmp.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = tmp.width - 1; y1 = tmp.height - 1; }
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * margin);
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(tmp.width - 1, x1 + m); y1 = Math.min(tmp.height - 1, y1 + m);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const k = size / Math.max(cw, ch);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * k));
  out.height = Math.max(1, Math.round(ch * k));
  const ctx = out.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out;
}

/**
 * Imagen de la figura.
 * - mode 'screen': tal como se ve en pantalla (misma cámara y encuadre).
 * - si no: cámara ortográfica desde `direction`, recortada justo a la figura.
 */
export function renderModelImage(stage, model, {
  size = 1024,
  transparent = true,
  shadow = true,
  direction = stage.viewDirection(),
  mode = 'fit',
  margin = 0.04,
  type = 'image/png',
  quality,
} = {}) {
  const r = getRenderer();
  if (mode === 'screen') {
    const vw = stage.container.clientWidth;
    const vh = stage.container.clientHeight;
    const k = size / Math.max(vw, vh);
    const width = Math.round(vw * k);
    const height = Math.round(vh * k);
    r.setSize(width, height, false);
    const restore = stage.prepareExport({ transparent, shadow });
    try {
      r.render(stage.scene, stage.camera);
      return { url: r.domElement.toDataURL(type, quality), width, height };
    } finally {
      restore();
    }
  }
  // Se renderiza más grande y con fondo transparente para recortar exacto
  const { cam, width, height } = frameModel(model, direction, { size: Math.round(size * 1.3), padding: 0.02, shadow });
  r.setSize(width, height, false);
  const restore = stage.prepareExport({ transparent: true, shadow });
  try {
    r.render(stage.scene, cam);
  } finally {
    restore();
  }
  const out = trimToCanvas(r.domElement, { size, margin, background: transparent ? null : stage.backgroundColor });
  return { url: out.toDataURL(type, quality), width: out.width, height: out.height };
}

// Formatos de imagen para redes y pantallas: tamaño fijo en px; y = dónde va el centro de la
// figura (0.5 = al centro; en el fondo de iPhone baja para que no la tape el reloj)
export const IMAGE_FORMATS = {
  square: { label: 'Cuadrado 1:1 · post de Instagram', w: 1080, h: 1080 },
  portrait: { label: 'Vertical 4:5 · feed de Instagram', w: 1080, h: 1350 },
  story: { label: 'Historia 9:16 · Reels, TikTok, WhatsApp', w: 1080, h: 1920 },
  iphone: { label: 'Fondo de iPhone', w: 1179, h: 2556, y: 0.6 },
  classic: { label: 'Clásico 4:3', w: 1600, h: 1200 },
  classicV: { label: 'Clásico vertical 3:4', w: 1200, h: 1600 },
  wide: { label: 'Horizontal 16:9 · YouTube, compu', w: 1920, h: 1080 },
};
/** Qué tanto del lienzo ocupa la figura (de su lado que más ocupa). */
export const FIGURE_SIZES = { small: 0.5, medium: 0.7, large: 0.88 };

/**
 * Imagen en un formato fijo (IMAGE_FORMATS): la figura recortada, centrada y escalada dentro
 * del lienzo, sobre el color de fondo de la escena (o transparente).
 */
export function renderFormatImage(stage, model, {
  format = 'square', figure = 'medium', transparent = false, shadow = true,
  direction = stage.viewDirection(), type = 'image/png', quality,
} = {}) {
  const f = IMAGE_FORMATS[format] ?? IMAGE_FORMATS.square;
  const k = FIGURE_SIZES[figure] ?? FIGURE_SIZES.medium;
  // Encuadre sólo con la figura (sin su sombra): la sombra sigue hasta donde llegue
  // y se corta en la orilla de la imagen
  const { cam } = frameModel(model, direction, { size: 1000, padding: 0, shadow: false });
  const cx = (cam.left + cam.right) / 2;
  const cy = (cam.top + cam.bottom) / 2;
  const px = Math.min((f.w * k) / (cam.right - cam.left), (f.h * k) / (cam.top - cam.bottom)); // px por unidad
  const yc = f.h * (f.y ?? 0.5); // dónde va el centro de la figura (desde arriba)
  Object.assign(cam, {
    left: cx - f.w / 2 / px, right: cx + f.w / 2 / px,
    top: cy + yc / px, bottom: cy - (f.h - yc) / px,
  });
  cam.updateProjectionMatrix();

  // Se renderiza más grande y se reduce: orillas suaves, sin rayitas entre cubos
  const ss = Math.min(2, 4096 / Math.max(f.w, f.h));
  const r = getRenderer();
  r.setSize(Math.round(f.w * ss), Math.round(f.h * ss), false);
  const restore = stage.prepareExport({ transparent, shadow });
  try {
    r.render(stage.scene, cam);
    const out = document.createElement('canvas');
    out.width = f.w;
    out.height = f.h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(r.domElement, 0, 0, f.w, f.h);
    return { url: out.toDataURL(type, quality), width: f.w, height: f.h };
  } finally {
    restore();
  }
}

let thumbScene = null;

/** Miniatura de una figura que no está abierta en el editor (p. ej. los ejemplos). */
/** Miniatura de un modelo sin tocar la escena del editor, con la luz que trae la figura. */
export function renderStandalone(model, { size = 192, type = 'image/webp', quality = 0.85 } = {}) {
  if (!thumbScene) {
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight();
    const sun = new THREE.DirectionalLight();
    scene.add(hemi, sun);
    thumbScene = { scene, hemi, sun, voxels: new VoxelMesh(), stickers: new StickerLayer() };
    scene.add(thumbScene.voxels.group, thumbScene.stickers.group);
  }
  const l = normalizeLight(model.light);
  thumbScene.hemi.color.set(l.amb);
  thumbScene.hemi.groundColor.set(l.ground);
  thumbScene.hemi.intensity = l.ambI;
  thumbScene.sun.color.set(l.sun);
  thumbScene.sun.intensity = l.sunI;
  thumbScene.sun.position.set(...sunPosition(l, model.size));
  thumbScene.voxels.setGlowStrength(l.glow);
  thumbScene.voxels.rebuild(model);
  thumbScene.stickers.rebuild(model);
  const { cam, width, height } = frameModel(model, ISO_DIRECTION, { size: size * 2, padding: 0.02, shadow: false });
  const r = getRenderer();
  r.setSize(width, height, false);
  r.render(thumbScene.scene, cam);
  return trimToCanvas(r.domElement, { size, margin: 0.03 }).toDataURL(type, quality);
}

/** Malla sólida sin caras ocultas, con colores por vértice. */
/** include(pieza) elige qué piezas entran (por defecto, todas). */
/** hides(pieza, valorVecino) decide si el vecino tapa la cara (por defecto, un cubo 1×1×1 sólido). */
export function buildSolidMesh(model, include = () => true, { hides = null } = {}) {
  const positions = [];
  const normals = [];
  const colors = [];
  const c = new THREE.Color();
  // Ejes u, v por normal tal que u × v = n (caras hacia afuera, CCW)
  const FACES = [
    { n: [1, 0, 0], base: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { n: [-1, 0, 0], base: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], base: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { n: [0, -1, 0], base: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], base: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], base: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] },
  ];

  // Sólo los cubos tapan caras vecinas (una esfera no tapa nada)
  const isCube = (key) => model.voxels.get(key)?.length === 7; // cubo sólido 1×1×1
  const m = new THREE.Matrix4();

  for (const [k, value] of model.voxels) {
    const p = parseKey(k);
    const piece = parseVoxel(value);
    if (!include(piece)) continue;
    c.set(piece.color);

    if (piece.shape !== 'cube' || !isUnit(piece.size) || !isZero(piece.offset)) {
      // Pieza con forma: se copia su geometría orientada a la celda
      const src = pieceGeometry(piece);
      const g = src.index ? src.toNonIndexed() : src.clone();
      g.applyMatrix4(pieceTransform(p, piece, m));
      const gp = g.getAttribute('position');
      const gn = g.getAttribute('normal');
      for (let i = 0; i < gp.count; i++) {
        positions.push(gp.getX(i), gp.getY(i), gp.getZ(i));
        normals.push(gn.getX(i), gn.getY(i), gn.getZ(i));
        colors.push(c.r, c.g, c.b);
      }
      g.dispose();
      continue;
    }

    for (const f of FACES) {
      const nk = keyOf(p[0] + f.n[0], p[1] + f.n[1], p[2] + f.n[2]);
      if (hides ? hides(piece, model.voxels.get(nk)) : isCube(nk)) continue;
      const corner = (a, b) => [0, 1, 2].map((i) => p[i] + f.base[i] + f.u[i] * a + f.v[i] * b);
      const q = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        positions.push(...q[idx]);
        normals.push(...f.n);
        colors.push(c.r, c.g, c.b);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
}

/**
 * Modelo 3D .glb. Las piezas que brillan van con material emisivo de su color y, si se pasa
 * la luz de la escena, se incluyen el sol y las luces de las piezas que brillan.
 */
export async function exportGLB(model, name = 'figura', lighting = null) {
  const root = new THREE.Group();
  root.name = name;
  const meshes = [];
  const solid = buildSolidMesh(model, (p) => !p.glow);
  solid.name = name;
  meshes.push(solid);
  // Una malla por color que brilla (el brillo en glTF es por material)
  const glowColors = new Set();
  for (const v of model.voxels.values()) if (v.includes('*')) glowColors.add(parseVoxel(v).color);
  for (const color of glowColors) {
    const m = buildSolidMesh(model, (p) => p.glow && p.color === color);
    m.material.dispose();
    m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: color, emissiveIntensity: 1 });
    m.name = `${name} brillo ${color}`;
    meshes.push(m);
  }
  for (const m of meshes) if (m.geometry.getAttribute('position').count) root.add(m);

  if (lighting) {
    // Sol: la luz direccional de glTF apunta hacia su -Z
    const a = THREE.MathUtils.degToRad(lighting.az);
    const e = THREE.MathUtils.degToRad(lighting.el);
    const sun = new THREE.DirectionalLight(lighting.sun, lighting.sunI);
    sun.name = 'Sol';
    sun.position.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(model.size);
    sun.lookAt(0, 0, 0);
    sun.add(sun.target);
    sun.target.position.set(0, 0, -1);
    root.add(sun);
    glowClusters(glowPieces(model)).forEach((z, i) => {
      const { intensity, distance } = glowLightParams(z.count, lighting.glow);
      const light = new THREE.PointLight(z.color, intensity, distance, 2);
      light.name = `Brillo ${i + 1}`;
      light.position.set(...z.pos);
      root.add(light);
    });
  }

  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
  for (const m of meshes) {
    m.geometry.dispose();
    m.material.dispose();
  }
  return new Blob([buffer], { type: 'model/gltf-binary' });
}

/** Caja (en celdas) de cada pieza: la celda si es un cubo 1×1×1; si no, la de su geometría. */
function pieceBoxes(model) {
  const boxes = [];
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  for (const [k, value] of model.voxels) {
    const p = parseKey(k);
    const piece = parseVoxel(value);
    if (piece.shape === 'cube' && isUnit(piece.size) && isZero(piece.offset)) {
      boxes.push({ min: p, max: p.map((v) => v + 1) });
      continue;
    }
    const g = pieceGeometry(piece);
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(pieceTransform(p, piece, m));
    boxes.push({ min: box.min.toArray(), max: box.max.toArray() });
  }
  return boxes;
}

/**
 * Revisión antes de imprimir: medidas en mm y piezas que flotan (grupos de piezas que no se
 * tocan entre sí ni tocan la base de la figura).
 */
export function printCheck(model, mmPerCube) {
  const boxes = pieceBoxes(model);
  if (!boxes.length) return { size: [0, 0, 0], floating: 0, parts: 0, stickers: model.stickers.size };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); }

  // Unir piezas que se tocan, con las celdas que ocupan (y sus vecinas) como puente
  const parent = boxes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const owner = new Map();
  const eps = 1e-4;
  boxes.forEach((b, i) => {
    const lo = b.min.map((v) => Math.floor(v + eps));
    const hi = b.max.map((v) => Math.ceil(v - eps) - 1);
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = `${x},${y},${z}`;
      if (owner.has(k)) parent[find(owner.get(k))] = find(i);
      else owner.set(k, i);
    }
  });
  for (const [k, i] of owner) {
    const [x, y, z] = k.split(',').map(Number);
    for (const n of [`${x + 1},${y},${z}`, `${x},${y + 1},${z}`, `${x},${y},${z + 1}`]) {
      const j = owner.get(n);
      if (j !== undefined) parent[find(j)] = find(i);
    }
  }
  // Un grupo flota si ninguna de sus piezas llega a la base
  const grounded = new Set();
  const roots = new Set();
  boxes.forEach((b, i) => { const r = find(i); roots.add(r); if (b.min[1] <= min[1] + eps) grounded.add(r); });
  return {
    size: [0, 1, 2].map((i) => (max[i] - min[i]) * mmPerCube), // ancho (x), alto (y), fondo (z)
    parts: roots.size,
    floating: roots.size - grounded.size,
    stickers: model.stickers.size,
  };
}

/**
 * Archivo .stl para impresora 3D (un solo color): la figura en milímetros, con la base sobre la
 * cama (Z hacia arriba) y la esquina en el origen.
 */
const isUnitCube = (v) => {
  if (!v) return false;
  const p = parseVoxel(v);
  return p.shape === 'cube' && isUnit(p.size) && isZero(p.offset);
};

/** Pasa la figura a coordenadas de impresora: mm, Z hacia arriba y la esquina en el origen. */
function toPrinterSpace(geos, mmPerCube) {
  const box = new THREE.Box3();
  for (const g of geos) {
    // Y (arriba en la app) → Z (arriba en la impresora); el frente de la figura queda hacia el
    // frente de la cama (-Y). Es un giro, no un espejo: la figura no se invierte.
    g.rotateX(Math.PI / 2);
    g.scale(mmPerCube, mmPerCube, mmPerCube);
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  for (const g of geos) g.translate(-box.min.x, -box.min.y, -box.min.z);
}

export async function exportSTL(model, mmPerCube = 5) {
  const mesh = buildSolidMesh(model, () => true, { hides: (_, v) => isUnitCube(v) });
  const geo = mesh.geometry;
  geo.deleteAttribute('color');
  toPrinterSpace([geo], mmPerCube);
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
  const data = new STLExporter().parse(mesh, { binary: true });
  geo.dispose();
  mesh.material.dispose();
  return new Blob([data], { type: 'model/stl' });
}

/** Distancia entre colores, aproximada a la vista ("redmean"). */
function colorDistance(a, b) {
  const ca = new THREE.Color(a); const cb = new THREE.Color(b);
  const r = ((ca.r + cb.r) / 2) * 255;
  const dr = (ca.r - cb.r) * 255; const dg = (ca.g - cb.g) * 255; const db = (ca.b - cb.b) * 255;
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

/**
 * Colores para imprimir: los de la figura con cuántas piezas usan cada uno, y si hay más que
 * maxColors, se eligen los maxColors más representativos de la paleta (por uso y por qué tan
 * distintos son) y cada color se cambia por el más parecido de ésos.
 * Devuelve { colors: [{ color, count }], map: Map(colorOriginal → colorFinal), total }.
 */
export function printColors(model, maxColors = Infinity) {
  // Peso de cada color: el volumen que ocupa (una pieza grande pesa más que un cubito)
  const stats = new Map();
  for (const v of model.voxels.values()) {
    const p = parseVoxel(v);
    const c = p.color.toLowerCase();
    const st = stats.get(c) ?? { count: 0, volume: 0 };
    st.count += 1;
    st.volume += p.size[0] * p.size[1] * p.size[2];
    stats.set(c, st);
  }
  const palette = [...stats].map(([color, st]) => ({ color, ...st }));
  const total = palette.length;
  const k = Math.max(1, Math.min(maxColors, total));
  const dist = palette.map((a) => palette.map((b) => colorDistance(a.color, b.color)));
  const nearest = (centers) => palette.map((_, i) => centers.reduce((best, c) => (dist[i][c] < dist[i][best] ? c : best), centers[0]));

  // Inicio: el más usado, y después el que más "falta" (uso × distancia al elegido más cercano)
  const byUse = palette.map((_, i) => i).sort((a, b) => palette[b].volume - palette[a].volume);
  let centers = [byUse[0]];
  while (centers.length < k) {
    let best = -1; let score = -1;
    palette.forEach((p, i) => {
      if (centers.includes(i)) return;
      const d = Math.min(...centers.map((c) => dist[i][c]));
      if (p.volume * d > score) { score = p.volume * d; best = i; }
    });
    centers.push(best);
  }
  // Ajuste: en cada grupo, el centro es el color que menos cambia a los demás (pesado por uso)
  for (let iter = 0; iter < 20; iter++) {
    const owner = nearest(centers);
    const next = centers.map((c) => {
      const members = palette.map((_, i) => i).filter((i) => owner[i] === c);
      return members.reduce((best, m) => {
        const cost = (x) => members.reduce((sum, i) => sum + palette[i].volume * dist[i][x], 0);
        return cost(m) < cost(best) ? m : best;
      }, c);
    });
    if (next.every((c, i) => c === centers[i])) break;
    centers = next;
  }
  const owner = nearest(centers);
  const map = new Map(palette.map((p, i) => [p.color, palette[owner[i]].color]));
  const colors = centers
    .map((c) => {
      const mine = palette.filter((_, i) => owner[i] === c);
      return { color: palette[c].color, count: mine.reduce((n, p) => n + p.count, 0), volume: mine.reduce((n, p) => n + p.volume, 0) };
    })
    .sort((a, b) => b.volume - a.volume);
  return { colors, map, total };
}

/** Malla con índices (vértices sin repetir), como la pide 3MF. */
function indexedMesh(geo) {
  const pos = geo.getAttribute('position');
  const ids = new Map();
  const vertices = [];
  const triangles = [];
  const vid = (i) => {
    const x = +pos.getX(i).toFixed(4); const y = +pos.getY(i).toFixed(4); const z = +pos.getZ(i).toFixed(4);
    const k = `${x},${y},${z}`;
    let id = ids.get(k);
    if (id === undefined) { id = vertices.length; ids.set(k, id); vertices.push([x, y, z]); }
    return id;
  };
  for (let i = 0; i < pos.count; i += 3) {
    const t = [vid(i), vid(i + 1), vid(i + 2)];
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) triangles.push(t);
  }
  return { vertices, triangles };
}

/** ZIP sin compresión (lo que necesita un .3mf), con su CRC-32. */
function zipStore(files) {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text);
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local, nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true); cen.setUint32(42, offset, true);
    central.push(cen, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'model/3mf' });
}

/**
 * Archivo .3mf a color para impresora 3D: una parte cerrada por color, todas juntas como una
 * sola figura (en el programa de impresión se le asigna un filamento a cada parte).
 */
export function export3MF(model, mmPerCube = 5, maxColors = Infinity, name = 'figura') {
  const { colors, map } = printColors(model, maxColors);
  const finalColor = (p) => map.get(p.color.toLowerCase());
  const geos = colors.map(({ color }) => {
    const mesh = buildSolidMesh(model, (p) => finalColor(p) === color, {
      // Sólo tapa un cubo de la misma parte: así cada parte queda cerrada
      hides: (_, v) => isUnitCube(v) && finalColor(parseVoxel(v)) === color,
    });
    mesh.material.dispose();
    return mesh.geometry;
  });
  toPrinterSpace(geos, mmPerCube);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const objects = [];
  geos.forEach((g, i) => {
    const { vertices, triangles } = indexedMesh(g);
    g.dispose();
    objects.push(`<object id="${i + 2}" name="${esc(`${name} ${colors[i].color}`)}" type="model" pid="1" pindex="${i}"><mesh><vertices>`
      + vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')
      + '</vertices><triangles>'
      + triangles.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')
      + '</triangles></mesh></object>');
  });
  const groupId = colors.length + 2;
  const model3d = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<model unit="millimeter" xml:lang="es" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + `<metadata name="Title">${esc(name)}</metadata><metadata name="Application">CuboStudio</metadata>`
    + '<resources><basematerials id="1">'
    + colors.map(({ color }) => `<base name="${color}" displaycolor="${color.toUpperCase()}FF"/>`).join('')
    + '</basematerials>'
    + objects.join('')
    + `<object id="${groupId}" name="${esc(name)}" type="model"><components>`
    + colors.map((_, i) => `<component objectid="${i + 2}"/>`).join('')
    + '</components></object>'
    + `</resources><build><item objectid="${groupId}"/></build></model>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ['3D/3dmodel.model', model3d],
  ]);
}

export function download(href, filename) {
  const a = document.createElement('a');
  const isBlob = href instanceof Blob;
  a.href = isBlob ? URL.createObjectURL(href) : href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (isBlob) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

export function slugify(name) {
  return (name || 'figura')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figura';
}
