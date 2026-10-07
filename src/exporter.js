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
export function buildSolidMesh(model, include = () => true) {
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
      if (isCube(keyOf(p[0] + f.n[0], p[1] + f.n[1], p[2] + f.n[2]))) continue;
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
