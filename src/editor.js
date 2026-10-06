import * as THREE from 'three';
import {
  VoxelModel, keyOf, parseKey, FACE_NORMALS, faceIndex, stickerKey, parseStickerKey,
  PIECES, ROTATABLE, parseVoxel, makeVoxel, isUnit, isZero, pieceCells, MIN_PIECE, withAlpha, snapStep,
  isCompound, pieceWorldBoxes, makeCompoundShape,
} from './model.js';
import {
  VoxelMesh, PIECE_GEOMETRIES, pieceQuaternion, pieceAxes, orientationFrom,
} from './voxel-mesh.js';
import {
  StickerLayer, createStickerMesh, placeStickerMesh, stickerAxes,
} from './stickers.js';

export const TOOLS = {
  select: { label: 'Seleccionar', key: 'a', desc: 'Clic en una pieza para moverla, girarla o escalarla. Shift+clic suma varias.' },
  marquee: { label: 'Selección rectangular', key: 'r', desc: 'Arrastra un rectángulo: se selecciona todo lo que quede dentro (también lo de atrás). Shift+arrastrar suma.' },
  build: { label: 'Construir', key: 'b', desc: 'Clic en el piso o en una cara para poner una pieza. Ctrl/⌘+arrastrar construye de corrido.' },
  box: { label: 'Caja', key: 'o', desc: 'Arrastra para llenar un área; la rueda del mouse da la altura. Shift+arrastrar borra.' },
  erase: { label: 'Borrar', key: 'e', desc: 'Clic en una pieza para quitarla. Ctrl/⌘+arrastrar borra de corrido.' },
  paint: { label: 'Pintar', key: 'p', desc: 'Clic o mantén el clic y arrastra sobre las piezas para pintarlas de corrido. Conserva su forma.' },
  fill: { label: 'Rellenar', key: 'k', desc: 'Pinta de un clic todas las piezas conectadas del mismo color.' },
  pick: { label: 'Gotero', key: 'i', desc: 'Clic en una pieza para tomar su color. También: Alt+clic.' },
  sticker: { label: 'Calcomanía', key: 's', desc: 'Pega ojos, bocas, mejillas y más sobre las caras de las piezas.' },
};

const HISTORY_LIMIT = 300;
const CLICK_TOLERANCE = 5; // px: más que esto es arrastre (órbita), no clic
const STROKE_TOOLS = new Set(['build', 'erase', 'paint']);

const sameValue = (a, b) => a === b
  || (a && b && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));

const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * Lógica de edición: herramientas, espejo, historial y transformación.
 * Eventos: 'change', 'load', 'tool', 'color', 'mirror', 'sticker', 'piece', 'selection', 'hover', 'notice'.
 */
export class Editor extends EventTarget {
  constructor(stage) {
    super();
    this.stage = stage;
    this.model = new VoxelModel(stage.gridSize);
    this.voxelMesh = new VoxelMesh();
    this.stickerLayer = new StickerLayer();
    stage.scene.add(this.voxelMesh.group, this.stickerLayer.group, this.voxelMesh.edges);
    stage.helpers.push(this.voxelMesh.edges); // el contorno no sale al exportar

    this.tool = 'build';
    this.prevTool = 'build';
    this.color = '#4fa3e0';
    /** Opacidad de lo que se construye o pinta (1 = sólido). */
    this.opacity = 1;
    this.mirror = false;
    this.stickerId = 'eye-tall';
    /** Las calcomanías se pegan en 1×1; se agrandan después con Seleccionar → Escalar. */
    this.stickerSize = 1;
    /** Forma de las piezas nuevas (cube, sphere, cone…). */
    this.piece = 'cube';
    /** Plano de trabajo del modo Espacio 3D (WorkPlane) o null. */
    this.workplane = null;
    /** Piezas seleccionadas con la herramienta Seleccionar (claves de celda). */
    this.selection = new Set();
    /** Calcomanía seleccionada (clave) o null. */
    this.selected = null;

    this.undoStack = [];
    this.redoStack = [];
    /** Mientras hay un trazo, los cambios se acumulan aquí como un solo paso. */
    this.stroke = null;
    /** Arrastre en curso: { type: 'box' | 'stroke', ... } */
    this.drag = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hover = null;
    this.modifiers = { shiftKey: false, altKey: false };

    this.#createGhosts();
    this.#bindPointer();
  }

  // ---------- estado ----------

  setTool(tool) {
    if (!(tool in TOOLS) || tool === this.tool) return;
    if (tool === 'pick') this.prevTool = this.tool;
    if (tool !== 'sticker' && tool !== 'pick' && tool !== 'select') this.select(null);
    if (tool !== 'select' && tool !== 'pick' && tool !== 'marquee') this.clearSelection();
    this.tool = tool;
    this.#emit('tool');
    this.#refreshGhost();
  }

  setColor(color) {
    this.color = color.toLowerCase();
    if (this.selected) this.updateSelected({ c: this.color });
    if (this.selection.size) this.#mapSelection((p) => ({ ...p, fill: withAlpha(this.color, p.opacity) }));
    this.#emit('color');
    this.#refreshGhost();
  }

  /** Opacidad a mostrar: la de la pieza seleccionada, o la de construir. */
  /**
   * Color a mostrar en el panel: el de lo seleccionado (pieza o calcomanía), 'mixed' si
   * las piezas seleccionadas tienen colores distintos, o el de construir si no hay selección.
   */
  get shownColor() {
    if (this.selected) return this.model.stickers.get(this.selected)?.c ?? this.color;
    if (this.selection.size) {
      const colors = new Set();
      for (const k of this.selection) {
        const v = this.model.voxels.get(k);
        if (v) colors.add(parseVoxel(v).color);
      }
      if (colors.size === 1) return [...colors][0];
      if (colors.size > 1) return 'mixed';
    }
    return this.color;
  }

  get shownOpacity() {
    if (this.selection.size) {
      const [k] = this.selection;
      const v = this.model.voxels.get(k);
      if (v) return parseVoxel(v).opacity;
    }
    return this.opacity;
  }

  /** Color + opacidad actuales, tal como se guardan. */
  get fill() { return withAlpha(this.color, this.opacity); }

  /**
   * Con piezas seleccionadas cambia sólo su opacidad; sin selección, la de lo que se construye.
   * live = true mientras se arrastra el slider: los cambios se agrupan en un solo deshacer.
   */
  setOpacity(opacity, { live = false } = {}) {
    if (!this.selection.size) this.opacity = opacity;
    if (this.selection.size) {
      if (live && !this.stroke) this.stroke = [];
      this.#mapSelection((p) => ({ ...p, fill: withAlpha(p.color, opacity) }));
    }
    if (!live && this.stroke) {
      const diff = this.stroke;
      this.stroke = null;
      if (diff.length) {
        this.#pushUndo(diff);
        this.#emit('change');
      }
    }
    this.#emit('color');
    this.#refreshGhost();
  }

  /** Marca el contorno de cada pieza (ayuda para modelar; no se exporta). */
  setEdges(on) {
    this.voxelMesh.showEdges = !!on;
    this.#rebuild();
    this.#emit('edges');
  }

  get showEdges() { return this.voxelMesh.showEdges; }

  setMirror(on) {
    this.mirror = on;
    this.stage.setMirrorVisible(on);
    this.#emit('mirror');
    this.#refreshGhost();
  }

  setSticker({ id = this.stickerId }) {
    this.stickerId = id;
    if (this.selected) this.updateSelected({ s: id });
    this.#emit('sticker');
    this.#refreshGhost();
  }

  setPiece(piece) {
    if (!(piece in PIECES)) return;
    this.piece = piece;
    if (this.selection.size) this.#mapSelection((p) => ({ ...p, shape: piece }));
    this.#emit('piece');
    this.#refreshGhost();
  }

  load(model) {
    this.selected = null;
    this.selection.clear();
    this.model = model;
    this.undoStack = [];
    this.redoStack = [];
    this.stage.setGridSize(model.size);
    this.#rebuild();
    this.#emit('load');
  }

  setGridSize(size) {
    if (size === this.model.size) return true;
    if (!this.model.fits(size)) return false;
    this.model.size = size;
    // El historial podría restaurar cubos fuera de la nueva cuadrícula
    this.undoStack = [];
    this.redoStack = [];
    this.stage.setGridSize(size);
    this.#changed();
    return true;
  }

  // ---------- selección de calcomanías ----------

  select(key) {
    if (key === this.selected) return;
    this.selected = key;
    if (key) {
      const st = this.model.stickers.get(key);
      // El panel muestra el diseño de la seleccionada
      this.stickerId = st.s;
      this.#emit('sticker');
    }
    this.#emit('selection');
    this.#refreshGhost();
  }

  deleteSelected() {
    if (!this.selected) return false;
    const keys = this.#stickerKeysWithMirror(this.selected);
    this.selected = null;
    this.apply(new Map(keys.map((k) => [k, null])));
    this.#emit('selection');
    return true;
  }

  /** Cambia diseño, tamaño o color de la seleccionada (y su reflejo). */
  updateSelected(props) {
    if (!this.selected) return;
    this.#rekeySelected((st, p, f) => {
      const next = { ...st, ...props };
      if (props.n != null && props.n !== st.n) {
        // Re-alinear el centro a la cuadrícula para el nuevo tamaño
        const axis = FACE_NORMALS[f].findIndex((v) => v !== 0);
        p = p.map((c, i) => (i === axis ? c : Math.round(c - next.n / 2) + next.n / 2));
      }
      return [next, p];
    });
  }

  /** Mueve la seleccionada sobre su cara (dx = derecha, dy = arriba, en cubos). */
  moveSelected(dx, dy) {
    if (!this.selected) return false;
    const { right, up } = stickerAxes(parseStickerKey(this.selected).f);
    return this.moveSelectedBy(right.map((r, i) => r * dx + up[i] * dy));
  }

  /** Mueve la seleccionada d (vector en el mundo); el reflejo se mueve simétrico. */
  moveSelectedBy(d) {
    if (!this.selected) return false;
    const ok = this.#rekeySelected((st, p, f, isMirror) => [st, p.map((c, i) => c + (isMirror && i === 0 ? -d[0] : d[i]))]);
    if (!ok) this.#notice('La calcomanía no puede salirse del cubo');
    return ok;
  }

  /** Pone la seleccionada en el centro p con tamaño n (el reflejo, simétrico). Falla si se sale. */
  setSelectedSticker(p, n) {
    if (!this.selected) return false;
    return this.#rekeySelected((st, pp, f, isMirror) => [{ ...st, n }, isMirror ? [-p[0], p[1], p[2]] : p]);
  }

  /** Las calcomanías se pueden mover libremente sobre su plano (pueden salirse de la pieza). */
  canMoveSelectedBy() {
    return !!this.selected;
  }

  /** Reescribe la seleccionada y su reflejo con fn(st, p, f, esReflejo) -> [st, p]. */
  #rekeySelected(fn) {
    const keys = this.#stickerKeysWithMirror(this.selected);
    const changes = new Map();
    const adds = [];
    for (const [i, k] of keys.entries()) {
      const { p, f } = parseStickerKey(k);
      const [st, np] = fn(this.model.stickers.get(k), p, f, i > 0);
      const nk = stickerKey(np, f);
      changes.set(k, null);
      adds.push([nk, st]);
    }
    for (const [k, v] of adds) changes.set(k, v);
    this.selected = adds[0][0];
    this.apply(changes);
    this.#emit('selection');
    return true;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ---------- cambios + historial ----------

  /** Aplica cambios (Map clave -> valor|null) como un paso deshacible. */
  apply(changes) {
    const diff = [];
    for (const [k, after] of changes) {
      const before = this.model.getKey(k);
      if (sameValue(before, after)) continue;
      diff.push([k, before, after]);
      this.model.setKey(k, after);
    }
    if (!diff.length) return false;
    if (this.stroke) {
      this.stroke.push(...diff);
    } else {
      this.#pushUndo(diff);
    }
    this.#changed();
    return true;
  }

  #pushUndo(diff) {
    this.undoStack.push(diff);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const diff = this.undoStack.pop();
    if (!diff) return;
    // En reversa: un trazo puede tocar la misma clave varias veces
    for (let i = diff.length - 1; i >= 0; i--) this.model.setKey(diff[i][0], diff[i][1]);
    this.redoStack.push(diff);
    this.#changed();
  }

  redo() {
    const diff = this.redoStack.pop();
    if (!diff) return;
    for (const [k, , after] of diff) this.model.setKey(k, after);
    this.undoStack.push(diff);
    this.#changed();
  }

  clear() {
    const changes = new Map();
    for (const k of this.model.voxels.keys()) changes.set(k, null);
    for (const k of this.model.stickers.keys()) changes.set(k, null);
    return this.apply(changes);
  }

  /**
   * Pieza k transformada por la función afín de puntos `point`.
   * Devuelve [celda, valor] o null si sale de la cuadrícula.
   */
  #movedPiece(k, point) {
    const p = parseVoxel(this.model.voxels.get(k));
    if (isCompound(p)) return this.#movedCompound(k, p, point);
    const center = parseKey(k).map((c, i) => c + p.offset[i] + p.size[i] / 2);
    const mc = point(center);
    const lin = (d) => point(center.map((c, i) => c + d[i])).map((c, i) => c - mc[i]);
    // Tamaño: se permuta con el giro (pasos de 0.1)
    const size = lin(p.size).map((v) => snapStep(Math.abs(v)));
    if (p.shape !== 'cube') {
      const round = (v) => lin(v).map(Math.round);
      const { up, back } = pieceAxes(p.f, p.t);
      Object.assign(p, orientationFrom(round(up), round(back)));
    }
    // Esquina mínima = celda + desplazamiento fino (pasos de 0.1)
    const min = mc.map((c, i) => snapStep(c - size[i] / 2));
    const cell = min.map((v) => Math.floor(v + 1e-6));
    const offset = min.map((v, i) => snapStep(v - cell[i]));
    if (!pieceCells(cell, size, offset).every((c) => this.model.inBounds(...c))) return null;
    return [cell, makeVoxel(p.fill, p.shape, p.f, p.t, size, offset, p.group)];
  }

  /** Pieza compuesta movida/girada: se transforman sus cajas y se recalcula su forma. */
  #movedCompound(k, p, point) {
    const world = pieceWorldBoxes(parseKey(k), p).map(([m, s]) => {
      const a = point(m);
      const b = point(m.map((v, i) => v + s[i]));
      return [a.map((v, i) => Math.min(v, b[i])), a.map((v, i) => Math.abs(b[i] - v))];
    });
    const min = [0, 1, 2].map((i) => snapStep(Math.min(...world.map(([m]) => m[i]))));
    const max = [0, 1, 2].map((i) => snapStep(Math.max(...world.map(([m, s]) => m[i] + s[i]))));
    const size = max.map((v, i) => snapStep(v - min[i]));
    const rel = world.map(([m, s]) => [...m.map((v, i) => snapStep(v - min[i])), ...s.map(snapStep)]);
    const cell = min.map((v) => Math.floor(v + 1e-6));
    const offset = min.map((v, i) => snapStep(v - cell[i]));
    if (!pieceCells(cell, size, offset).every((c) => this.model.inBounds(...c))) return null;
    return [cell, makeVoxel(p.fill, makeCompoundShape(rel), 2, 0, size, offset, p.group)];
  }

  /**
   * Transforma toda la figura con una función afín de puntos (coordenadas continuas).
   * Falla (sin cambios) si algún cubo sale de la cuadrícula.
   */
  transform(point, toggleFlip = false) {
    const adds = [];
    const taken = new Set();
    for (const k of this.model.voxels.keys()) {
      const moved = this.#movedPiece(k, point);
      if (!moved) return false;
      const base = keyOf(...moved[0]);
      let nk = base;
      for (let i = 1; taken.has(nk); i++) nk = `${base}#${i}`;
      taken.add(nk);
      adds.push([nk, moved[1]]);
    }
    for (const [k, st] of this.model.stickers) {
      const { p, f } = parseStickerKey(k);
      const n = FACE_NORMALS[f];
      const mp = point(p);
      const tip = point(p.map((v, i) => v + n[i]));
      const mn = tip.map((v, i) => Math.round(v - mp[i]));
      adds.push([stickerKey(mp, faceIndex(mn)), toggleFlip ? { ...st, flip: !st.flip } : st]);
    }
    const changes = new Map();
    for (const k of this.model.voxels.keys()) changes.set(k, null);
    for (const k of this.model.stickers.keys()) changes.set(k, null);
    for (const [k, v] of adds) changes.set(k, v);
    this.apply(changes);
    return true;
  }

  shift(dx, dy, dz) { return this.transform(([x, y, z]) => [x + dx, y + dy, z + dz]); }
  rotateY() { return this.transform(([x, y, z]) => [-z, y, x]); }
  flipX() { return this.transform(([x, y, z]) => [-x, y, z], true); }

  /** Baja la figura hasta el piso y la centra en X/Z. */
  center() {
    const b = this.model.bounds();
    if (!b) return false;
    const dx = -Math.floor((b.min[0] + b.max[0]) / 2);
    const dz = -Math.floor((b.min[2] + b.max[2]) / 2);
    return this.shift(dx, -b.min[1], dz);
  }

  // ---------- construcción de cambios ----------

  #effectiveTool(mods = this.modifiers) {
    // En Seleccionar, Shift suma a la selección (no borra)
    if (this.tool === 'select' && !mods.altKey) return 'select';
    if (this.tool === 'marquee') return 'marquee';
    if (mods.shiftKey) return 'erase';
    if (mods.altKey) return 'pick';
    return this.tool;
  }

  #mirrorCell(c) { return [-c[0] - 1, c[1], c[2]]; }

  /** La celda y, si el espejo está activo, su reflejo en x = 0. */
  #withMirror(cell) {
    return this.mirror ? [cell, this.#mirrorCell(cell)] : [cell];
  }

  #mirrorStickerKey(key) {
    const { p, f } = parseStickerKey(key);
    const n = FACE_NORMALS[f];
    return stickerKey([-p[0], p[1], p[2]], faceIndex([-n[0], n[1], n[2]]));
  }

  /** La calcomanía y su reflejo (si existe y el espejo está activo). */
  #stickerKeysWithMirror(key) {
    const keys = [key];
    if (this.mirror) {
      const mk = this.#mirrorStickerKey(key);
      if (mk !== key && this.model.stickers.has(mk)) keys.push(mk);
    }
    return keys;
  }

  /** Orientación reflejada en x = 0. */
  #mirrorOrientation({ f, t }) {
    const flip = (v) => [-v[0], v[1], v[2]];
    const { up, back } = pieceAxes(f, t);
    return orientationFrom(flip(up), flip(back));
  }

  /** Celda + orientación {f, t} y, con espejo, su reflejo. */
  /** [[celda, orientación, desplazamiento|null], …] con el reflejo si el espejo está activo. */
  #pieceEntries(cell, normal, offset = null) {
    const o = { f: faceIndex(normal), t: 0 };
    const entries = [[cell, o, offset]];
    if (this.mirror) {
      if (offset?.[0]) {
        // Reflejo de una pieza recorrida en x: su caja va de -(x+dx+1) a -(x+dx)
        const min = -(cell[0] + offset[0] + 1);
        const mc = [Math.floor(min + 1e-6), cell[1], cell[2]];
        entries.push([mc, this.#mirrorOrientation(o), [snapStep(min - mc[0]), offset[1], offset[2]]]);
      } else {
        entries.push([this.#mirrorCell(cell), this.#mirrorOrientation(o), offset]);
      }
    }
    return entries;
  }

  /** ¿Se puede construir esta entrada? (las recorridas se revisan por su caja real) */
  #canBuild(c, off) {
    const m = this.model;
    if (off) return m.boxFree(c.map((v, i) => v + off[i]), [1, 1, 1]);
    return m.inBounds(...c) && !m.occupied(...c);
  }

  /** entries: [[celda, {f, t}], ...] — orienta conos, pirámides y triángulos. */
  #buildChanges(entries) {
    const m = this.model;
    const changes = new Map();
    const cells = new Set();
    for (const [c, o, off] of entries) {
      if (!this.#canBuild(c, off)) continue;
      if (off) {
        // Pegado a una cara que no está en la orilla de su casilla: comparte casilla con otra pieza
        const k = m.freeKey(c, changes);
        changes.set(k, makeVoxel(this.fill, this.piece, o.f, o.t, [1, 1, 1], off));
      } else {
        changes.set(keyOf(...c), makeVoxel(this.fill, this.piece, o.f, o.t));
      }
      cells.add(keyOf(...c));
    }
    // Las calcomanías que queden tapadas por cubos nuevos se quitan
    for (const k of m.stickersOn(cells, 'front')) changes.set(k, null);
    return changes;
  }

  /** items: celdas [x,y,z] o claves de pieza. */
  #eraseChanges(items) {
    const m = this.model;
    const changes = new Map();
    for (const it of items) {
      const k = typeof it === 'string' ? it : keyOf(...it);
      if (m.voxels.has(k)) changes.set(k, null);
    }
    // Una calcomanía se va sólo si ya no le queda ninguna pieza detrás
    const removed = (cellKey) => {
      const owner = m.pieceAt(...parseKey(cellKey));
      return owner !== null && changes.has(owner);
    };
    for (const k of m.stickers.keys()) {
      const cells = m.stickerFootprint(k);
      if (!cells.some(removed)) continue;
      if (!cells.some((c) => m.pieceAt(...parseKey(c)) !== null && !removed(c))) changes.set(k, null);
    }
    return changes;
  }

  /**
   * Dónde pegar la calcomanía sobre la cara apuntada. Si con el tamaño elegido se saldría,
   * se recorre un poco para que entre; si aun así no cabe, se achica (hasta 0.5).
   * Devuelve { p, f, size } o null si no hay espacio.
   */
  #stickerPlacement(hit) {
    const n = hit.normal;
    const axis = n.findIndex((v) => v !== 0);
    // Plano de la cara (con el punto exacto: sirve también en piezas escaladas o desplazadas)
    const p = hit.point.map((v, i) => (i === axis ? snapStep(v) : Math.floor(v) + 0.5));
    return { p, f: faceIndex(n), size: this.stickerSize };
  }

  /** Cambios para pegar una calcomanía; vacío si no hay espacio en esa cara. */
  #stickerChanges(hit) {
    const spot = this.#stickerPlacement(hit);
    if (!spot) return new Map();
    const { p, f, size } = spot;
    const st = { s: this.stickerId, c: this.color, n: size, flip: false };
    const key = stickerKey(p, f);
    const changes = new Map([[key, st]]);
    if (this.mirror) {
      const mk = this.#mirrorStickerKey(key);
      if (mk !== key) changes.set(mk, { ...st, flip: true });
    }
    return changes;
  }

  /** Clave de la pieza apuntada y, con espejo, la de su reflejo. */
  #hitKeys(hit) {
    const keys = [hit.key ?? keyOf(...hit.voxel)];
    if (this.mirror) {
      const mk = keyOf(...this.#mirrorCell(hit.voxel));
      if (mk !== keys[0]) keys.push(mk);
    }
    return keys;
  }

  #changesFor(tool, hit) {
    const m = this.model;
    switch (tool) {
      case 'build':
      case 'box':
        return hit.place ? this.#buildChanges(this.#pieceEntries(hit.place, hit.normal, tool === 'build' ? hit.placeOffset : null)) : null;
      case 'erase':
        return hit.voxel ? this.#eraseChanges(this.#hitKeys(hit)) : null;
      case 'paint':
      case 'fill': {
        if (!hit.voxel) return null;
        const changes = new Map();
        for (const hk of this.#hitKeys(hit)) {
          if (!m.voxels.has(hk)) continue;
          const keys = tool === 'fill' && !hk.includes('#') ? m.floodSameColor(parseKey(hk)) : [hk];
          // Cambia el color, conserva la forma y orientación
          for (const k of keys) {
            const p = parseVoxel(m.voxels.get(k));
            changes.set(k, makeVoxel(this.fill, p.shape, p.f, p.t, p.size, p.offset, p.group));
          }
        }
        return changes;
      }
      case 'sticker':
        return hit.voxel ? this.#stickerChanges(hit) : null;
      default:
        return null;
    }
  }

  #act(mods) {
    const hit = this.#pick();
    const tool = this.#effectiveTool(mods);
    // Seleccionar: un clic fuera de las piezas (piso o cielo) deselecciona
    if (tool === 'select') {
      this.#selectHit(hit, mods.shiftKey, mods.ctrlKey || mods.metaKey);
      return;
    }
    if (!hit) return;
    if (tool === 'pick') {
      const color = hit.sticker ? this.model.stickers.get(hit.sticker).c
        : hit.voxel && parseVoxel(this.model.voxels.get(hit.key ?? keyOf(...hit.voxel))).color;
      if (!color) return;
      this.setColor(color);
      if (this.tool === 'pick') this.setTool(this.prevTool === 'pick' ? 'build' : this.prevTool);
      return;
    }
    if (tool === 'sticker') {
      // Clic sobre una calcomanía: cambiarle diseño y color. Sobre una pieza: pegar una nueva.
      if (hit.sticker) {
        const keys = this.#stickerKeysWithMirror(hit.sticker);
        this.apply(new Map(keys.map((k) => [k, { ...this.model.stickers.get(k), s: this.stickerId, c: this.color }])));
      } else if (hit.voxel) {
        this.apply(this.#stickerChanges(hit));
      }
      this.hover = this.#pick();
      this.#refreshGhost();
      return;
    }
    const changes = this.#changesFor(tool, hit);
    if (changes) this.apply(changes);
    this.hover = this.#pick();
    this.#refreshGhost();
  }

  // ---------- raycast ----------

  /**
   * Qué hay bajo el puntero. Con Construir/Caja el rayo atraviesa las piezas transparentes
   * (se construye dentro del agua); con Seleccionar se prefiere lo que está dentro de ellas.
   */
  #pick(tool = this.#effectiveTool()) {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const wp = this.workplane?.enabled ? this.workplane : null;
    const voxelMeshes = this.voxelMesh.meshes;
    const targets = [...this.stickerLayer.group.children, ...voxelMeshes, this.stage.floor];
    if (wp) targets.push(wp.mesh);
    const seeThrough = tool === 'build' || tool === 'box';
    const hits = this.raycaster.intersectObjects(targets, false);
    const cellOf = (h) => (h.instanceId != null ? h.object.userData.coords?.[h.instanceId] : h.object.userData.cell);
    const keyOfHit = (h) => (h.instanceId != null ? h.object.userData.keys?.[h.instanceId] : h.object.userData.key);
    const isPiece = (h) => voxelMeshes.includes(h.object) && cellOf(h);
    for (let i = 0; i < hits.length; i++) {
      let h = hits[i];
      if (isPiece(h) && h.object.material.transparent) {
        if (seeThrough) continue;
        if (tool === 'select') {
          // ¿Hay una pieza sólida dentro de esta transparente? Seleccionar esa
          const c = cellOf(h);
          const { size, offset } = parseVoxel(this.model.voxels.get(keyOfHit(h)));
          const inside = (pt) => pt.toArray().every((v, j) => v >= c[j] + offset[j] - 1e-3 && v <= c[j] + offset[j] + size[j] + 1e-3);
          const inner = hits.slice(i + 1).find((o) => isPiece(o) && !o.object.material.transparent && inside(o.point));
          if (inner) h = inner;
        }
      }
      const point = h.point.toArray();
      const { stickerKey: sk } = h.object.userData;
      if (sk) {
        const normal = [...FACE_NORMALS[parseStickerKey(sk).f]];
        // El cubo justo detrás del punto apuntado (no el del centro de la calcomanía)
        const cell = point.map((v, i) => Math.floor(v - normal[i] * 0.5));
        const owner = this.model.pieceAt(...cell);
        const voxel = owner ? parseKey(owner) : null;
        return { sticker: sk, voxel, key: owner, normal, point, place: voxel && voxel.map((v, i) => v + normal[i]) };
      }
      if (isPiece(h)) {
        const cell = cellOf(h);
        const key = keyOfHit(h);
        const { size, offset } = parseVoxel(this.model.voxels.get(key));
        // Normal de la cara: eje dominante del punto relativo al centro de la pieza
        // (en piezas con geometría propia, la normal real del triángulo apuntado)
        const d = h.instanceId == null && h.face
          ? h.face.normal.toArray()
          : point.map((v, i) => (v - cell[i] - offset[i] - size[i] / 2) / (size[i] / 2));
        const axis = d.map(Math.abs).reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0);
        const normal = [0, 0, 0];
        normal[axis] = Math.sign(d[axis]) || 1;
        // Celda vecina por esa cara (sirve para piezas de cualquier tamaño)
        if (isUnit(size) && isZero(offset)) return { voxel: cell, key, normal, point, place: cell.map((c, i) => c + normal[i]) };
        // Si la cara no cae en la orilla de su casilla (pieza aplastada o desplazada), el cubo
        // nuevo va pegado a ella: placeOffset lo recorre dentro de su casilla
        const face = snapStep(point[axis]);
        const lo = normal[axis] > 0 ? face : face - 1;
        const place = point.map(Math.floor);
        place[axis] = Math.floor(lo + 1e-6);
        const shift = snapStep(lo - place[axis]);
        let placeOffset = null;
        if (shift > 0) {
          placeOffset = [0, 0, 0];
          placeOffset[axis] = shift;
        }
        return { voxel: cell, key, normal, point, place, placeOffset };
      }
      if (wp && h.object === wp.mesh) {
        // Capa del espacio 3D: permite cubos flotantes
        const cell = wp.cellAt(point);
        if (!this.model.inBounds(...cell) || this.model.occupied(...cell)) continue;
        return { voxel: null, normal: wp.normalToward(this.stage.camera.position.toArray()), point, place: cell };
      }
      if (h.object === this.stage.floor) {
        const cell = [Math.floor(point[0]), 0, Math.floor(point[2])];
        if (this.model.inBounds(...cell)) return { voxel: null, normal: [0, 1, 0], point, place: cell };
      }
    }
    return null;
  }

  /** Celda donde el rayo cruza la capa `layer` del eje `axis` (para caja y trazos planos). */
  #planeCell(axis, layer) {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const n = [0, 0, 0];
    n[axis] = 1;
    _plane.set(new THREE.Vector3(...n), -(layer + 0.5));
    if (!this.raycaster.ray.intersectPlane(_plane, _hit)) return null;
    const cell = _hit.toArray().map(Math.floor);
    cell[axis] = layer;
    return cell;
  }

  // ---------- arrastres: caja y trazo ----------

  #boxRange(d) {
    const lo = [];
    const hi = [];
    for (let i = 0; i < 3; i++) {
      const a = d.anchor[i];
      const b = i === d.axis ? a + d.dir * (d.depth - 1) : d.end[i];
      lo[i] = Math.min(a, b);
      hi[i] = Math.max(a, b);
    }
    return { lo, hi };
  }

  /** Celdas de la caja con su cara (orientación) y reflejo si el espejo está activo. */
  #boxEntries(d) {
    const { lo, hi } = this.#boxRange(d);
    const normal = [0, 0, 0];
    normal[d.axis] = d.dir;
    const entries = [];
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) entries.push(...this.#pieceEntries([x, y, z], normal));
      }
    }
    return entries;
  }

  #startDrag(e) {
    if (this.tool === 'marquee') {
      this.drag = { type: 'marquee', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive: e.shiftKey };
      this.#showMarquee();
      return true;
    }
    const tool = this.#effectiveTool(e);
    const hit = this.#pick();
    if (!hit) return false;

    if (this.tool === 'box' && !e.altKey) {
      const erase = e.shiftKey;
      const anchor = erase ? hit.voxel : hit.place;
      if (!anchor) return false;
      const axis = hit.normal.findIndex((v) => v !== 0);
      const dir = hit.normal[axis] * (erase ? -1 : 1);
      this.drag = { type: 'box', erase, anchor, end: anchor, axis, dir, depth: 1 };
      return true;
    }

    // Pintar: mantener el clic sobre una pieza y arrastrar pinta de corrido (sin Ctrl).
    // Arrastrar desde el piso o el cielo sigue girando la cámara.
    const paintStroke = tool === 'paint' && hit.voxel && !e.altKey;
    if (((e.ctrlKey || e.metaKey) && STROKE_TOOLS.has(tool)) || paintStroke) {
      this.stroke = [];
      const drag = { type: 'stroke', tool };
      if (tool === 'build' && hit.place) {
        drag.axis = hit.normal.findIndex((v) => v !== 0);
        drag.layer = hit.place[drag.axis];
        drag.normal = hit.normal;
      }
      this.drag = drag;
      const changes = this.#changesFor(tool, hit);
      if (changes) this.apply(changes);
      return true;
    }
    return false;
  }

  #moveDrag() {
    const d = this.drag;
    if (d.type === 'marquee') {
      d.x1 = this.lastClient.x;
      d.y1 = this.lastClient.y;
      this.#showMarquee();
      return;
    }
    if (d.type === 'box') {
      d.end = this.#planeCell(d.axis, d.anchor[d.axis]) ?? d.end;
    } else if (d.tool === 'build') {
      if (d.axis == null) return;
      const cell = this.#planeCell(d.axis, d.layer);
      if (cell) this.apply(this.#buildChanges(this.#pieceEntries(cell, d.normal)));
    } else {
      const hit = this.#pick();
      const changes = hit && this.#changesFor(d.tool, hit);
      if (changes) this.apply(changes);
    }
  }

  #endDrag() {
    const d = this.drag;
    this.drag = null;
    if (d.type === 'marquee') {
      this.#finishMarquee(d);
      return;
    }
    if (d.type === 'box') {
      const entries = this.#boxEntries(d);
      this.apply(d.erase ? this.#eraseChanges(entries.map(([c]) => c)) : this.#buildChanges(entries));
    } else {
      const diff = this.stroke;
      this.stroke = null;
      if (diff.length) {
        this.#pushUndo(diff);
        this.#emit('change');
      }
    }
  }

  // ---------- selección rectangular ----------

  #showMarquee() {
    const d = this.drag;
    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.className = 'marquee';
      this.stage.container.appendChild(this.marqueeEl);
    }
    const r = this.stage.container.getBoundingClientRect();
    const x = Math.min(d.x0, d.x1) - r.left;
    const y = Math.min(d.y0, d.y1) - r.top;
    Object.assign(this.marqueeEl.style, {
      display: 'block', left: `${x}px`, top: `${y}px`,
      width: `${Math.abs(d.x1 - d.x0)}px`, height: `${Math.abs(d.y1 - d.y0)}px`,
    });
    const n = this.#piecesInRect(d).length;
    this.#emit('hover', { label: n ? `${n} ${n === 1 ? 'pieza' : 'piezas'} dentro` : 'Arrastra para encerrar piezas' });
  }

  /** Piezas cuyo centro, visto desde la cámara, cae dentro del rectángulo (incluye las de atrás). */
  #piecesInRect(d) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const x0 = Math.min(d.x0, d.x1) - r.left;
    const x1 = Math.max(d.x0, d.x1) - r.left;
    const y0 = Math.min(d.y0, d.y1) - r.top;
    const y1 = Math.max(d.y0, d.y1) - r.top;
    const v = new THREE.Vector3();
    const keys = [];
    for (const [k, value] of this.model.voxels) {
      if (this.hiddenKeys?.has(k)) continue;
      const { size, offset } = parseVoxel(value);
      v.set(...parseKey(k).map((c, i) => c + offset[i] + size[i] / 2)).project(this.stage.camera);
      if (v.z > 1) continue; // detrás de la cámara
      const sx = ((v.x + 1) / 2) * r.width;
      const sy = ((1 - v.y) / 2) * r.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) keys.push(k);
    }
    return keys;
  }

  #finishMarquee(d) {
    if (this.marqueeEl) this.marqueeEl.style.display = 'none';
    // Casi sin arrastrar: funciona como un clic de Seleccionar
    if (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4) {
      this.#selectHit(this.#pick('select'), d.additive);
      if (this.selection.size || this.selected) this.setTool('select');
      return;
    }
    const keys = new Set(this.#piecesInRect(d));
    // Una pieza de un grupo trae a todo su grupo
    for (const k of [...keys]) {
      const { group } = parseVoxel(this.model.voxels.get(k));
      if (group) this.model.groupKeys(group).forEach((g) => keys.add(g));
    }
    this.select(null);
    if (!d.additive) this.selection.clear();
    keys.forEach((k) => this.selection.add(k));
    this.#emit('selection');
    // Listo para mover / girar / copiar con el gizmo
    if (this.selection.size) this.setTool('select');
    this.#refreshGhost();
  }

  // ---------- fantasma (vista previa) ----------

  #createGhosts() {
    const box = new THREE.BoxGeometry(1.04, 1.04, 1.04);
    const edges = new THREE.EdgesGeometry(box);
    this.ghostGroup = new THREE.Group();
    this.ghostBox = box;
    this.ghosts = [0, 1].map(() => {
      const mesh = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45 })));
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.ghostGroup.add(mesh);
      return mesh;
    });
    this.stickerGhosts = new THREE.Group();
    this.ghostGroup.add(this.stickerGhosts);

    // Marcos: [0,1] selección (+reflejo), [2] hover
    const square = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));
    this.frames = ['#4fa3e0', '#4fa3e0', '#ffffff'].map((color) => {
      const frame = new THREE.LineSegments(square, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      frame.renderOrder = 5;
      frame.visible = false;
      // Relleno translúcido: las líneas WebGL siempre miden 1 px
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }),
      );
      fill.renderOrder = 4;
      frame.add(fill);
      this.ghostGroup.add(frame);
      return frame;
    });

    // Resaltado de piezas seleccionadas
    this.selMesh = null;
    this.stage.scene.add(this.ghostGroup);
    this.stage.helpers.push(this.ghostGroup);
  }

  /** Cajas translúcidas sobre varias piezas (selección o grupo bajo el puntero). */
  #showBoxes(name, keys, color, opacity) {
    const n = keys.length;
    let mesh = this[name];
    if (!mesh || mesh.instanceMatrix.count < n) {
      if (mesh) { this.ghostGroup.remove(mesh); mesh.dispose(); }
      let cap = 64;
      while (cap < n) cap *= 2;
      mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
        cap,
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.ghostGroup.add(mesh);
      this[name] = mesh;
    }
    const m = new THREE.Matrix4();
    keys.forEach((k, i) => {
      const c = parseKey(k);
      const { size, offset } = parseVoxel(this.model.voxels.get(k) ?? '#000000');
      // Margen fijo de 0.05 por lado (no proporcional: en piezas grandes no se infla)
      m.makeScale(...size.map((s) => s + 0.1)).setPosition(...c.map((v, j) => v + offset[j] + size[j] / 2));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  #showSelection() {
    this.#showBoxes('selMesh', [...this.selection], '#4fa3e0', 0.3).visible = !this.transforming;
  }

  /** piece/f opcionales: muestra la forma de la pieza en vez de una caja. */
  #showGhost(i, lo, hi, color, opacity, piece = 'cube', o = { f: 2, t: 0 }) {
    const g = this.ghosts[i];
    const shaped = piece !== 'cube';
    g.geometry = shaped ? PIECE_GEOMETRIES[piece] : this.ghostBox;
    g.children[0].visible = !shaped;
    if (shaped) pieceQuaternion(o.f, o.t, g.quaternion);
    else g.quaternion.identity();
    g.material.color.set(color);
    g.material.opacity = opacity;
    g.scale.set(hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1);
    if (shaped) g.scale.multiplyScalar(1.04);
    g.position.set((lo[0] + hi[0] + 1) / 2, (lo[1] + hi[1] + 1) / 2, (lo[2] + hi[2] + 1) / 2);
    g.visible = true;
  }

  #showFrame(i, key) {
    const st = this.model.stickers.get(key);
    if (!st) return;
    const { p, f } = parseStickerKey(key);
    const frame = this.frames[i];
    placeStickerMesh(frame, p, f);
    frame.scale.setScalar(st.n + 0.08);
    frame.visible = true;
  }

  #refreshGhost() {
    this.ghosts.forEach((g) => { g.visible = false; });
    if (this.hoverMesh) this.hoverMesh.count = 0;
    this.frames.forEach((fr) => { fr.visible = false; });
    this.stickerGhosts.clear();
    if (this.selected && !this.transforming) {
      this.#stickerKeysWithMirror(this.selected).forEach((k, i) => this.#showFrame(i, k));
    }
    if (this.selection.size || this.selMesh) this.#showSelection();

    const d = this.drag;
    if (d?.type === 'box') {
      const { lo, hi } = this.#boxRange(d);
      const color = d.erase ? '#ff3d3d' : this.color;
      const boxOpacity = d.erase ? 0.4 : 0.5;
      this.#showGhost(0, lo, hi, color, boxOpacity);
      if (this.mirror) {
        const mlo = [-hi[0] - 1, lo[1], lo[2]];
        const mhi = [-lo[0] - 1, hi[1], hi[2]];
        if (mlo[0] > hi[0] || mhi[0] < lo[0]) this.#showGhost(1, mlo, mhi, color, boxOpacity);
      }
      const size = hi.map((v, i) => v - lo[i] + 1);
      this.#emit('hover', { box: size });
      return;
    }

    const hit = this.hover;
    const tool = this.#effectiveTool();
    if (tool === 'marquee') {
      // Mientras se arrastra, el contador de piezas lo pone #showMarquee
      if (this.drag?.type !== 'marquee') this.#emit('hover', { label: 'Arrastra un rectángulo para seleccionar · Shift suma' });
      return;
    }
    if (!hit) { this.#emit('hover', null); return; }

    if (tool === 'select') {
      if (hit.sticker) {
        if (hit.sticker !== this.selected) this.#showFrame(2, hit.sticker);
        this.#emit('hover', { label: 'Clic para seleccionar la calcomanía' });
      } else if (hit.voxel && !this.selection.has(hit.key ?? keyOf(...hit.voxel))) {
        // El resaltado cubre la pieza completa (bloque estirado, cono, etc.)
        const c = hit.voxel;
        const value = this.model.voxels.get(hit.key ?? keyOf(...c));
        if (!value) { this.#emit('hover', null); return; } // la pieza cambió de lugar
        const { size, offset, group } = parseVoxel(value);
        const single = this.modifiers.ctrlKey || this.modifiers.metaKey;
        if (group && !single) {
          // Pieza agrupada: se resalta el grupo completo
          const keys = this.model.groupKeys(group);
          this.#showBoxes('hoverMesh', keys, '#ffffff', 0.35); // blanco: distinto del azul de la selección
          this.#emit('hover', { label: `Grupo: ${keys.length} piezas · clic lo selecciona · ⌘/Ctrl+clic sólo esta` });
          return;
        }
        this.#showGhost(0, c, c, '#ffffff', 0.3);
        this.ghosts[0].scale.set(...size.map((v) => v + 0.06));
        this.ghosts[0].position.set(...c.map((v, j) => v + offset[j] + size[j] / 2));
        this.#emit('hover', { cell: c, label: group ? 'sólo esta pieza del grupo' : 'clic selecciona · Shift+clic suma' });
      } else {
        this.#emit('hover', hit.voxel ? { cell: hit.voxel } : null);
      }
      return;
    }
    if (tool === 'sticker') {
      if (hit.sticker) {
        this.#showFrame(2, hit.sticker);
        this.#emit('hover', { label: 'Clic para cambiarle el diseño y el color' });
        return;
      }
      if (!hit.voxel) { this.#emit('hover', null); return; }
      for (const [k, st] of this.#stickerChanges(hit)) {
        const mesh = createStickerMesh(st);
        placeStickerMesh(mesh, parseStickerKey(k).p, parseStickerKey(k).f);
        mesh.position.addScaledVector(new THREE.Vector3(...FACE_NORMALS[parseStickerKey(k).f]), 0.004);
        this.stickerGhosts.add(mesh);
      }
      this.#emit('hover', { cell: hit.voxel });
      return;
    }

    const building = tool === 'build' || tool === 'box';
    const cell = building ? hit.place : hit.voxel;
    if (!cell || !this.model.inBounds(...cell)) { this.#emit('hover', null); return; }
    this.#emit('hover', { cell });

    const [color, opacity] = {
      build: [this.color, 0.55],
      box: [this.color, 0.55],
      erase: ['#ff3d3d', 0.45],
      paint: [this.color, 0.75],
      fill: [this.color, 0.75],
      pick: ['#ffffff', 0.25],
    }[tool];

    const entries = building
      ? this.#pieceEntries(cell, hit.normal, tool === 'build' ? hit.placeOffset : null)
      : this.#hitKeys(hit).map((k) => [parseKey(k), null, k]);
    entries.forEach(([c, o, k], i) => {
      if (building ? !this.#canBuild(c, k) : !this.model.voxels.has(k)) return;
      this.#showGhost(i, c, c, color, opacity, building ? this.piece : 'cube', o);
      if (building && k) this.ghosts[i].position.add(_v.set(...k)); // pegado a la cara
      if (!building) {
        // Pieza con tamaño: el resaltado cubre su caja real
        const { size, offset } = parseVoxel(this.model.voxels.get(k));
        if (!isUnit(size) || !isZero(offset)) {
          this.ghosts[i].scale.set(...size.map((s) => s + 0.04));
          this.ghosts[i].position.set(...c.map((v, j) => v + offset[j] + size[j] / 2));
        }
      }
    });
  }

  // ---------- puntero ----------

  #bindPointer() {
    const el = this.stage.renderer.domElement;
    const controls = this.stage.controls;
    let down = null;

    const updatePointer = (e) => {
      this.lastClient = { x: e.clientX, y: e.clientY };
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.modifiers = { shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    };

    // En captura: corre antes que OrbitControls y puede quedarse con el arrastre
    el.addEventListener('pointerdown', (e) => {
      updatePointer(e);
      // Seleccionar con Shift: siempre suma/quita la pieza, aunque el gizmo esté encima
      if (this.tool === 'select' && e.shiftKey && e.button === 0) {
        e.stopImmediatePropagation();
        down = { x: e.clientX, y: e.clientY, button: e.button };
        return;
      }
      // Arrastrando el gizmo de la selección: no es un clic de herramienta
      if (this.isGizmoActive?.()) { down = null; return; }
      if (e.button === 0 && this.#startDrag(e)) {
        e.stopImmediatePropagation();
        controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        this.#refreshGhost();
        return;
      }
      down = { x: e.clientX, y: e.clientY, button: e.button };
    }, { capture: true });

    el.addEventListener('pointermove', (e) => {
      updatePointer(e);
      this.pointerInside = true;
      if (this.transforming) return; // el gizmo manda mientras se arrastra
      if (this.drag) {
        this.#moveDrag();
      } else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE) {
        this.hover = null; // orbitando
      } else {
        // Raycast como mucho una vez por cuadro (figuras grandes)
        if (!this.hoverQueued) {
          this.hoverQueued = true;
          requestAnimationFrame(() => {
            this.hoverQueued = false;
            if (!this.pointerInside || this.drag) return;
            this.hover = this.#pick();
            this.#refreshGhost();
          });
        }
        return;
      }
      this.#refreshGhost();
    });

    const finish = (e) => {
      if (this.drag) {
        this.#endDrag();
        controls.enabled = true;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        this.hover = this.#pick();
        this.#refreshGhost();
        return;
      }
      if (!down) return;
      const isClick = e.type === 'pointerup' && down.button === 0
        && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_TOLERANCE;
      down = null;
      updatePointer(e);
      if (isClick) this.#act(this.modifiers);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', (e) => { if (this.drag) finish(e); });
    window.addEventListener('blur', () => {
      down = null;
      if (this.drag) finish({ type: 'pointercancel', pointerId: -1, clientX: 0, clientY: 0, shiftKey: false, altKey: false });
    });

    // Rueda durante una caja: cambia la altura en vez de hacer zoom
    el.addEventListener('wheel', (e) => {
      if (this.drag?.type !== 'box') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const d = this.drag;
      d.depth = Math.min(this.model.size, Math.max(1, d.depth + (e.deltaY < 0 ? 1 : -1)));
      this.#refreshGhost();
    }, { capture: true, passive: false });

    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      if (this.drag) return;
      this.hover = null;
      this.#refreshGhost();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Shift/Alt cambian la herramienta efectiva: actualizar el fantasma al vuelo
    const onKey = (e) => {
      if (!['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) return;
      this.modifiers = { shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
      this.#refreshGhost();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', () => {
      this.modifiers = { shiftKey: false, altKey: false };
      this.#refreshGhost();
    });
  }

  // ---------- selección de piezas ----------

  #selectHit(hit, additive, single = false) {
    if (hit?.sticker && !additive) {
      this.clearSelection();
      this.select(hit.sticker);
      return;
    }
    if (!hit?.voxel) {
      if (!additive) { this.clearSelection(); this.select(null); }
      return;
    }
    this.select(null);
    const k = hit.key ?? keyOf(...hit.voxel);
    // Una pieza agrupada trae a todo su grupo (Ctrl/⌘+clic: sólo esa pieza)
    const { group } = parseVoxel(this.model.voxels.get(k) ?? '#000000');
    const keys = group && !single ? this.model.groupKeys(group) : [k];
    if (!additive) this.selection.clear();
    if (additive && this.selection.has(k)) keys.forEach((x) => this.selection.delete(x));
    else keys.forEach((x) => this.selection.add(x));
    this.#emit('selection');
    this.#refreshGhost();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.#emit('selection');
    this.#refreshGhost();
  }

  /** Reescribe cada pieza seleccionada con fn(pieza) -> pieza. */
  #mapSelection(fn) {
    const changes = new Map();
    for (const k of this.selection) {
      const p = fn(parseVoxel(this.model.voxels.get(k)));
      changes.set(k, makeVoxel(p.fill, p.shape, p.f, p.t, p.size, p.offset, p.group));
    }
    this.apply(changes);
  }

  // ---------- fusionar ----------

  /** ¿Hay al menos 2 cubos seleccionados para fusionar? */
  /** Piezas seleccionadas que se pueden fusionar: cubos, bloques o compuestas (no conos, esferas…). */
  #mergeable(p) { return p.shape === 'cube' || isCompound(p); }

  /** Fusionar: 2+ piezas, TODAS cubos/bloques y TODAS del mismo color (y opacidad). */
  get canMerge() {
    if (this.selection.size < 2) return false;
    let fill = null;
    for (const k of this.selection) {
      const p = parseVoxel(this.model.voxels.get(k));
      if (!this.#mergeable(p)) return false;
      if (fill !== null && p.fill !== fill) return false;
      fill = p.fill;
    }
    return true;
  }

  /** Separar: una sola pieza compuesta seleccionada. */
  /** ¿Hay alguna pieza que se pueda partir en cubos? (fusionada, o un cubo estirado) */
  get canSplit() {
    return [...this.selection].some((k) => this.#splittable(parseVoxel(this.model.voxels.get(k))));
  }

  #splittable(p) {
    return isCompound(p) || (p.shape === 'cube' && p.size.some((v) => v > 1 + 1e-6));
  }

  /**
   * Fusiona los cubos seleccionados (mismo color) en UNA sola pieza: un bloque si forman una
   * caja completa, o una pieza compuesta (L, E, T…) si no. Devuelve { compound, from } o { error }.
   */
  mergeSelection() {
    if (!this.canMerge) return { error: 'Para fusionar, todo debe ser cubos del mismo color' };
    const m = this.model;
    const items = [...this.selection].map((k) => [k, parseVoxel(m.voxels.get(k))]);
    const fill = items[0][1].fill;
    const boxes = items.flatMap(([k, p]) => pieceWorldBoxes(parseKey(k), p));

    // Rejilla para rasterizar: de 1 si todo está en cubos enteros; si no, de 0.1
    const integral = boxes.every(([a, sz]) => [...a, ...sz].every((v) => Number.isInteger(snapStep(v))));
    const step = integral ? 1 : 0.1;
    const lo = [0, 1, 2].map((i) => Math.min(...boxes.map(([a]) => a[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...boxes.map(([a, sz]) => a[i] + sz[i])));
    const n = hi.map((v, i) => Math.round((v - lo[i]) / step));
    if (n[0] * n[1] * n[2] > 400000) return { error: 'Es demasiado grande para fusionar con piezas de tamaño fino' };
    const idx = (x, y, z) => (z * n[1] + y) * n[0] + x;
    const grid = new Uint8Array(n[0] * n[1] * n[2]);
    for (const [a, sz] of boxes) {
      const i0 = a.map((v, i) => Math.round((v - lo[i]) / step));
      const i1 = a.map((v, i) => Math.round((v + sz[i] - lo[i]) / step));
      for (let z = i0[2]; z < i1[2]; z++) for (let y = i0[1]; y < i1[1]; y++) for (let x = i0[0]; x < i1[0]; x++) grid[idx(x, y, z)] = 1;
    }
    // Cajas mínimas (unión voraz en x, luego y, luego z)
    const used = new Uint8Array(grid.length);
    const free = (x, y, z) => grid[idx(x, y, z)] && !used[idx(x, y, z)];
    const out = [];
    for (let z = 0; z < n[2]; z++) {
      for (let y = 0; y < n[1]; y++) {
        for (let x = 0; x < n[0]; x++) {
          if (!free(x, y, z)) continue;
          let w = 1;
          while (x + w < n[0] && free(x + w, y, z)) w++;
          let h = 1;
          grow: while (y + h < n[1]) {
            for (let dx = 0; dx < w; dx++) if (!free(x + dx, y + h, z)) break grow;
            h++;
          }
          let d = 1;
          deep: while (z + d < n[2]) {
            for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (!free(x + dx, y + dy, z + d)) break deep;
            d++;
          }
          for (let dz = 0; dz < d; dz++) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) used[idx(x + dx, y + dy, z + dz)] = 1;
          out.push([x * step, y * step, z * step, w * step, h * step, d * step].map(snapStep));
        }
      }
    }

    const min = lo.map(snapStep);
    const size = hi.map((v, i) => snapStep(v - lo[i]));
    const cell = min.map((v) => Math.floor(v + 1e-6));
    const offset = min.map((v, i) => snapStep(v - cell[i]));
    const compound = out.length > 1;
    const shape = compound ? makeCompoundShape(out) : 'cube';
    const changes = new Map();
    for (const [k] of items) changes.set(k, null);
    const k = m.freeKey(cell, new Set(items.map(([key]) => key)));
    changes.set(k, makeVoxel(fill, shape, 2, 0, size, offset, null));
    this.selection = new Set([k]);
    this.apply(changes);
    this.#emit('selection');
    return { compound, from: items.length };
  }

  /** Separa una pieza compuesta en sus bloques (quedan agrupados). */
  /**
   * Parte las piezas fusionadas o estiradas en cubos 1×1×1 sueltos (cortando en las líneas
   * de la cuadrícula; si la pieza mide fracciones, la orilla queda como una tira delgada).
   * Si la pieza estaba en un grupo, sus cubos siguen en ese grupo. Devuelve cuántos cubos salieron.
   */
  splitSelection() {
    if (!this.canSplit) return false;
    const m = this.model;
    const changes = new Map();
    const removed = new Set();
    const taken = new Set();
    const busy = (key) => (m.voxels.has(key) && !removed.has(key)) || taken.has(key);
    const freeKey = (cell) => {
      const base = keyOf(...cell);
      let key = base;
      for (let i = 1; busy(key); i++) key = `${base}#${i}`;
      return key;
    };
    const keys = [];
    const kept = [];
    const cuts = (a, b) => {
      const out = [a];
      for (let c = Math.floor(a + 1e-6) + 1; c < b - 1e-6; c++) out.push(c);
      out.push(b);
      return out;
    };
    for (const k of this.selection) {
      const p = parseVoxel(m.voxels.get(k));
      if (!this.#splittable(p)) {
        kept.push(k);
        continue;
      }
      changes.set(k, null);
      removed.add(k);
    }
    for (const k of removed) {
      const p = parseVoxel(m.voxels.get(k));
      for (const [min, size] of pieceWorldBoxes(parseKey(k), p)) {
        const [xs, ys, zs] = min.map((v, i) => cuts(snapStep(v), snapStep(v + size[i])));
        for (let i = 0; i + 1 < xs.length; i++) {
          for (let j = 0; j + 1 < ys.length; j++) {
            for (let l = 0; l + 1 < zs.length; l++) {
              const lo = [xs[i], ys[j], zs[l]];
              const s = [snapStep(xs[i + 1] - xs[i]), snapStep(ys[j + 1] - ys[j]), snapStep(zs[l + 1] - zs[l])];
              if (s.some((v) => v < MIN_PIECE - 1e-6)) continue;
              const cell = lo.map((v) => Math.floor(v + 1e-6));
              const offset = lo.map((v, a) => snapStep(v - cell[a]));
              const nk = freeKey(cell);
              taken.add(nk);
              keys.push(nk);
              changes.set(nk, makeVoxel(p.fill, 'cube', 2, 0, s, offset, p.group));
            }
          }
        }
      }
    }
    this.selection = new Set([...kept, ...keys]);
    this.apply(changes);
    this.#emit('selection');
    return keys.length;
  }

  // ---------- grupos ----------

  /** ¿La selección se puede agrupar? (2+ piezas que no sean ya un único grupo) */
  get canGroup() {
    if (this.selection.size < 2) return false;
    const groups = new Set([...this.selection].map((k) => parseVoxel(this.model.voxels.get(k)).group));
    return groups.size > 1 || groups.has(null);
  }

  /** ¿Alguna pieza seleccionada está en un grupo? */
  get canUngroup() {
    return [...this.selection].some((k) => parseVoxel(this.model.voxels.get(k)).group);
  }

  groupSelection() {
    if (!this.canGroup) return false;
    const group = this.model.newGroupId();
    this.#mapSelection((p) => ({ ...p, group }));
    this.#emit('selection');
    return true;
  }

  ungroupSelection() {
    if (!this.canUngroup) return false;
    this.#mapSelection((p) => ({ ...p, group: null }));
    this.#emit('selection');
    return true;
  }

  // ---------- copiar / pegar ----------

  /**
   * Copia las piezas seleccionadas (y las calcomanías pegadas a ellas) relativas a su esquina.
   * Devuelve { items: [[dx,dy,dz, valor]], stickers: [[dp, cara, datos]], size, origin } o null.
   */
  copySelection() {
    if (!this.selection.size) return null;
    const m = this.model;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const k of this.selection) {
      const p = parseVoxel(m.voxels.get(k));
      for (const c of pieceCells(parseKey(k), p.size, p.offset)) {
        c.forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v + 1); });
      }
    }
    const items = [...this.selection].map((k) => [...parseKey(k).map((v, i) => v - min[i]), m.voxels.get(k)]);
    const stickers = [];
    for (const [sk, st] of m.stickers) {
      const owner = m.pieceAt(...m.stickerCell(sk, 'behind'));
      if (!owner || !this.selection.has(owner)) continue;
      const { p, f } = parseStickerKey(sk);
      stickers.push([p.map((v, i) => v - min[i]), f, st]);
    }
    return { items, stickers, size: max.map((v, i) => v - min[i]), origin: min };
  }

  /**
   * Pega lo copiado. Busca un lugar libre al lado de `near` (o del origen copiado) que quepa
   * en la cuadrícula; lo pegado queda seleccionado para acomodarlo con el gizmo.
   */
  paste(clip, near = clip?.origin) {
    if (!clip?.items?.length) return false;
    const m = this.model;
    const [w, h, d] = clip.size;
    const fits = (o) => clip.items.every(([dx, dy, dz, v]) => {
      const p = parseVoxel(v);
      return pieceCells([o[0] + dx, o[1] + dy, o[2] + dz], p.size, p.offset).every((c) => m.inBounds(...c));
    });
    const base = near ?? [0, 0, 0];
    const tries = [[w, 0, 0], [-w, 0, 0], [0, 0, d], [0, 0, -d], [0, h, 0], [0, 0, 0]].map((t) => base.map((v, i) => v + t[i]));
    // Si viene de otra figura y no cabe donde estaba, probar desde el centro del piso
    const half = Math.floor(m.size / 2);
    tries.push([-Math.floor(w / 2), 0, -Math.floor(d / 2)], [-half, 0, -half]);
    const origin = tries.find(fits);
    if (!origin) return false;
    const changes = new Map();
    const taken = new Set();
    const keys = [];
    const regroup = new Map();
    for (const [dx, dy, dz, v] of clip.items) {
      const k = m.freeKey([origin[0] + dx, origin[1] + dy, origin[2] + dz], taken);
      taken.add(k);
      keys.push(k);
      const p = parseVoxel(v);
      if (p.group && !regroup.has(p.group)) regroup.set(p.group, m.newGroupId(regroup.values()));
      changes.set(k, p.group ? makeVoxel(p.fill, p.shape, p.f, p.t, p.size, p.offset, regroup.get(p.group)) : v);
    }
    for (const [dp, f, st] of clip.stickers ?? []) {
      changes.set(stickerKey(dp.map((v, i) => v + origin[i]), f), st);
    }
    this.select(null);
    this.selection = new Set(keys);
    this.apply(changes);
    this.#emit('selection');
    this.#refreshGhost();
    return true;
  }

  /** Copia y pega en un paso. */
  duplicateSelection() {
    const clip = this.copySelection();
    return clip ? this.paste(clip) : false;
  }

  deleteSelection() {
    if (!this.selection.size) return false;
    const keys = [...this.selection];
    this.selection.clear();
    this.apply(this.#eraseChanges(keys));
    this.#emit('selection');
    return true;
  }

  /** Mueve las piezas seleccionadas; falla si chocan con otras o salen de la cuadrícula. */
  moveSelection(dx, dy, dz) {
    return this.transformSelection((c) => [c[0] + dx, c[1] + dy, c[2] + dz]);
  }

  /** Tamaño de la única pieza seleccionada, o null. */
  get selectedSize() {
    if (this.selection.size !== 1) return null;
    const [k] = this.selection;
    return parseVoxel(this.model.voxels.get(k)).size;
  }

  /** Coloca la pieza seleccionada en la caja (esquina mínima, tamaño). Falla si sale de la cuadrícula. */
  setSelectedBox(min, size) {
    if (this.selection.size !== 1) return false;
    const [k] = this.selection;
    const p = parseVoxel(this.model.voxels.get(k));
    const s = size.map((v) => Math.min(this.model.size, Math.max(MIN_PIECE, snapStep(v))));
    const q = min.map(snapStep);
    const cell = q.map((v) => Math.floor(v + 1e-6));
    const offset = q.map((v, i) => snapStep(v - cell[i]));
    if (!pieceCells(cell, s, offset).every((c) => this.model.inBounds(...c))) return false;
    const same = keyOf(...parseKey(k)) === keyOf(...cell);
    const nk = same ? k : this.model.freeKey(cell);
    const changes = new Map();
    if (nk !== k) changes.set(k, null);
    changes.set(nk, makeVoxel(p.fill, p.shape, p.f, p.t, s, offset, p.group));
    this.selection = new Set([nk]);
    this.apply(changes);
    this.#emit('selection');
    return true;
  }

  /** Cambia el tamaño de la pieza seleccionada (pasos de 0.1). Falla si sale de la cuadrícula. */
  resizeSelected(size) {
    if (this.selection.size !== 1) return false;
    const [k] = this.selection;
    const p = parseVoxel(this.model.voxels.get(k));
    const s = size.map((v) => Math.min(this.model.size, Math.max(MIN_PIECE, snapStep(v))));
    if (s.every((v, i) => v === p.size[i])) return true;
    // Puede encimarse sobre otras piezas; sólo no debe salir de la cuadrícula
    if (!pieceCells(parseKey(k), s, p.offset).every((c) => this.model.inBounds(...c))) return false;
    this.apply(new Map([[k, makeVoxel(p.fill, p.shape, p.f, p.t, s, p.offset, p.group)]]));
    return true;
  }

  /**
   * Transforma la selección: cell(c) da la celda nueva; axes(v), si se pasa,
   * gira los ejes de conos/triángulos. Falla si choca o sale de la cuadrícula.
   */
  /** Calcomanías pegadas a las piezas seleccionadas (viajan con ellas). */
  get attachedStickers() {
    if (!this.selection.size) return [];
    const out = [];
    for (const sk of this.model.stickers.keys()) {
      const owner = this.model.pieceAt(...this.model.stickerCell(sk, 'behind'));
      if (owner && this.selection.has(owner)) out.push(sk);
    }
    return out;
  }

  transformSelection(point) {
    const stickers = this.attachedStickers; // antes de mover: aún saben a qué pieza están pegadas
    const moved = [];
    for (const k of this.selection) {
      const res = this.#movedPiece(k, point);
      if (!res) return false;
      moved.push(res);
    }
    // Claves nuevas: si otra pieza ya empieza en esa celda, se comparte ("x,y,z#n")
    const taken = new Set();
    const others = (k) => this.model.voxels.has(k) && !this.selection.has(k);
    const resolved = moved.map(([cell, v]) => {
      const base = keyOf(...cell);
      let nk = base;
      for (let i = 1; others(nk) || taken.has(nk); i++) nk = `${base}#${i}`;
      taken.add(nk);
      return [nk, v];
    });
    moved.length = 0;
    moved.push(...resolved);
    const changes = new Map();
    for (const k of this.selection) changes.set(k, null);
    // Las calcomanías de esas piezas se mueven / giran con ellas
    const stickerAdds = [];
    for (const sk of stickers) {
      const { p, f } = parseStickerKey(sk);
      const n = FACE_NORMALS[f];
      const mp = point(p).map((v) => Math.round(v * 1000) / 1000); // limpiar decimales sin correrla
      const tip = point(p.map((v, i) => v + n[i]));
      const mn = tip.map((v, i) => Math.round(v - mp[i]));
      changes.set(sk, null);
      stickerAdds.push([stickerKey(mp, faceIndex(mn)), this.model.stickers.get(sk)]);
    }
    for (const [k, v] of moved) changes.set(k, v);
    for (const [k, v] of stickerAdds) changes.set(k, v);
    this.selection = new Set(moved.map(([k]) => k));
    this.apply(changes);
    this.#emit('selection');
    return true;
  }

  /** Recalcula el fantasma (p. ej. al mover el plano de trabajo). */
  refreshHover() {
    if (!this.pointerInside) return;
    this.hover = this.#pick();
    this.#refreshGhost();
  }

  // ---------- util ----------

  /** Oculta piezas (p. ej. mientras el gizmo muestra su vista previa). */
  setHidden(keys) {
    this.hiddenKeys = keys;
    this.voxelMesh.rebuild(this.model, keys);
    this.#refreshGhost();
  }

  /** Redibuja las piezas (p. ej. tras cambiar el redondeo de las orillas). */
  redraw() {
    this.#rebuild();
    this.#refreshGhost();
  }

  #rebuild() {
    this.voxelMesh.rebuild(this.model, this.hiddenKeys);
    this.stickerLayer.rebuild(this.model);
  }

  #changed() {
    this.#rebuild();
    if (this.selected && !this.model.stickers.has(this.selected)) {
      this.selected = null;
      this.#emit('selection');
    }
    // Quitar de la selección piezas que ya no existen (p. ej. tras deshacer)
    let pruned = false;
    for (const k of this.selection) if (!this.model.voxels.has(k)) { this.selection.delete(k); pruned = true; }
    if (pruned) this.#emit('selection');
    this.#refreshGhost();
    // Durante un trazo, 'change' (y el autoguardado) se emite al terminar
    if (!this.stroke) this.#emit('change');
  }

  #notice(message) {
    this.#emit('notice', message);
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
