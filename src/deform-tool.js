import * as THREE from 'three';
import { pieceCorners, deformOffsets, makeDeformShape, snapStep, parseVoxel, parseKey, pieceWorldBoxes } from './model.js';
import { magnet } from './gizmo.js';
import { pieceGeometry, pieceTransform } from './voxel-mesh.js';

const FACES = [];
for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) FACES.push({ axis, sign });

const EDGE = '#ff7a45';
const EXTRUDE_COLOR = '#9b6bff';
const CENTER = '#4fa3e0';

/**
 * Deformar y Extruir (dos modos de la píldora) sobre una cara de un cubo o bloque.
 * - Cuadritos blancos en cada cara: eligen la cara a deformar.
 * Deformar:
 * - 4 manijas en las orillas de la cara: la achican o la agrandan de ese lado.
 * - Manija al centro: recorre la cara (queda inclinada, como paralelogramo).
 * Extruir:
 * - Se jala directo el cuadrito (morado) de cualquier cara, como al escalar: saca de la cara una pieza nueva de su mismo tamaño y forma
 *   (aparte, del mismo color); al soltar queda seleccionada para seguir extruyendo.
 * Imán: tamaño original, lado recto (alineado con la cara de enfrente), mitad, filo (ancho 0),
 * inclinación de 45° y centrado; al extruir, largos enteros y al tocar otra pieza. Pasos de 0.1.
 * El único tope es la orilla de la cuadrícula.
 */
export class DeformTool {
  constructor(stage, editor, gizmo) {
    this.stage = stage;
    this.editor = editor;
    this.gizmo = gizmo;
    this.face = { axis: 1, sign: 1 }; // de entrada, la cara de arriba
    this.hover = null;
    this.drag = null;

    this.group = new THREE.Group();
    this.group.visible = false;
    stage.scene.add(this.group);
    stage.helpers.push(this.group);

    const mat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const handle = (color, size, opacity) => {
      const m = new THREE.Mesh(box, mat(color, opacity));
      m.renderOrder = 12;
      m.userData.size = size;
      m.scale.setScalar(size);
      this.group.add(m);
      return m;
    };
    this.selectors = FACES.map((f) => Object.assign(handle('#ffffff', 0.16, 0.9), { userData: { size: 0.16, kind: 'face', face: f } }));
    this.edges = [0, 1, 2, 3].map((i) => Object.assign(handle(EDGE, 0.2), { userData: { size: 0.2, kind: 'edge', index: i } }));
    this.center = Object.assign(handle(CENTER, 0.24), { userData: { size: 0.24, kind: 'center' } });
    // Vista previa de la pieza que sale al extruir
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.75 }));
    this.preview.matrixAutoUpdate = false;
    this.preview.visible = false;
    stage.scene.add(this.preview);
    stage.helpers.push(this.preview);
    this.outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: EDGE, depthTest: false, transparent: true }));
    this.outline.renderOrder = 11;
    this.group.add(this.outline);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.#onMove(e));
    el.addEventListener('pointerdown', (e) => this.#onDown(e), { capture: true });
    el.addEventListener('pointerup', (e) => this.#onUp(e));
    el.addEventListener('pointercancel', (e) => this.#onUp(e));

    const prev = editor.isGizmoActive ?? (() => false);
    editor.isGizmoActive = () => prev() || (this.active && (this.hover != null || this.drag != null));

    const sync = () => this.sync();
    for (const ev of ['selection', 'change', 'tool', 'load']) editor.addEventListener(ev, sync);
    gizmo.addEventListener('mode', sync);
  }

  /** 'deform' (orillas y centro) o 'extrude' (cubito para sacar piezas nuevas). */
  get mode() { return this.gizmo.mode; }

  get active() {
    return ['deform', 'extrude'].includes(this.gizmo.mode) && this.editor.tool === 'select'
      && !this.editor.selected && !!this.editor.deformTarget;
  }

  /** Coloca las manijas sobre la pieza seleccionada. */
  sync() {
    if (this.drag) return;
    const on = this.active;
    this.group.visible = on;
    if (!on) { this.#setHover(null); return; }
    const { cell, p } = this.editor.deformTarget;
    const P = pieceCorners(cell, p);
    const avg = (ids) => [0, 1, 2].map((a) => ids.reduce((s, i) => s + P[i][a], 0) / ids.length);
    const extruding = this.mode === 'extrude';
    for (const s of this.selectors) {
      const { axis, sign } = s.userData.face;
      const c = avg(faceCorners(axis, sign));
      c[axis] += sign * (extruding ? 0.3 : 0.18);
      s.position.set(...c);
      // Extruir: todas las caras, en morado (se jalan directo). Deformar: eligen la cara (blancos)
      const isActive = axis === this.face.axis && sign === this.face.sign;
      s.visible = extruding || !isActive;
      s.material.color.set(extruding ? EXTRUDE_COLOR : '#ffffff');
      s.userData.size = extruding ? 0.24 : 0.16;
      if (s !== this.hover) s.scale.setScalar(s.userData.size);
    }
    const { axis, sign } = this.face;
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    const ids = faceCorners(axis, sign);
    const lift = (c) => { c[axis] += sign * 0.06; return c; };
    // Orillas: u-baja, u-alta, v-baja, v-alta
    const edgeIds = [[u, 0], [u, 1], [v, 0], [v, 1]].map(([w, b]) => ids.filter((i) => ((i >> w) & 1) === b));
    this.edges.forEach((h, k) => {
      h.position.set(...lift(avg(edgeIds[k])));
      h.userData.edge = { w: k < 2 ? u : v, b: k % 2, ids: edgeIds[k] };
    });
    this.center.position.set(...lift(avg(ids)));
    // Deformar: orillas y centro. Extruir: sólo el cubito
    const deforming = this.mode === 'deform';
    for (const h of [...this.edges, this.center]) h.visible = deforming;
    this.outline.visible = deforming;
    // Contorno de la cara activa (en orden alrededor)
    const ring = [ids.find((i) => !((i >> u) & 1) && !((i >> v) & 1)), ids.find((i) => ((i >> u) & 1) && !((i >> v) & 1)),
      ids.find((i) => ((i >> u) & 1) && ((i >> v) & 1)), ids.find((i) => !((i >> u) & 1) && ((i >> v) & 1))];
    this.outline.geometry.setFromPoints(ring.map((i) => lift([...P[i]])).map((c) => new THREE.Vector3(...c)));
  }

  #setNdc(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
  }

  #pickHandle() {
    const list = [...this.selectors, ...this.edges, this.center].filter((m) => m.visible);
    // Zona de agarre un poco más grande que el dibujo
    list.forEach((m) => m.scale.setScalar(m.userData.size * 1.8));
    list.forEach((m) => m.updateMatrixWorld());
    const hit = this.raycaster.intersectObjects(list, false)[0]?.object ?? null;
    list.forEach((m) => m.scale.setScalar(m.userData.size * (m === this.hover ? 1.4 : 1)));
    return hit;
  }

  #setHover(h) {
    if (h === this.hover) return;
    this.hover?.scale.setScalar(this.hover.userData.size);
    this.hover = h;
    h?.scale.setScalar(h.userData.size * 1.4);
    const pointer = h?.userData.kind === 'face' && this.mode !== 'extrude';
    this.stage.renderer.domElement.style.cursor = h ? (pointer ? 'pointer' : 'grab') : '';
  }

  #onMove(e) {
    if (!this.active && !this.drag) return;
    this.#setNdc(e);
    if (this.drag) { this.#updateDrag(); return; }
    this.#setHover(this.#pickHandle());
  }

  #onDown(e) {
    if (!this.active || e.button !== 0) return;
    this.#setNdc(e);
    const h = this.#pickHandle();
    if (!h) return;
    e.stopImmediatePropagation();
    if (h.userData.kind === 'face') {
      this.face = { ...h.userData.face };
      if (this.mode !== 'extrude') {
        this.#setHover(null);
        this.sync();
        return;
      }
    }
    const { cell, p } = this.editor.deformTarget;
    const min = cell.map((c, i) => c + p.offset[i]);
    const drag = { kind: h.userData.kind, p, min, off0: deformOffsets(p.shape), size: p.size, origin: h.position.clone() };
    if (drag.kind === 'face') drag.kind = 'extrude'; // Extruir: el cuadrito de la cara se jala directo
    if (drag.kind === 'extrude') {
      drag.t0 = this.#axisParam(drag.origin, this.face.axis);
      drag.length = 0;
      drag.contacts = this.#contacts(cell, p);
    } else if (drag.kind === 'edge') {
      drag.edge = h.userData.edge;
      drag.t0 = this.#axisParam(drag.origin, drag.edge.w);
    } else {
      drag.plane = new THREE.Plane(new THREE.Vector3().setComponent(this.face.axis, 1), -h.position.getComponent(this.face.axis));
      drag.start = this.raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3()) ?? h.position.clone();
    }
    drag.shape = p.shape;
    this.drag = drag;
    this.stage.controls.enabled = false;
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
    this.stage.renderer.domElement.style.cursor = 'grabbing';
  }

  #onUp(e) {
    if (!this.drag) return;
    const { shape, kind, length } = this.drag;
    this.drag = null;
    if (kind === 'extrude') {
      this.preview.visible = false;
      this.stage.controls.enabled = true;
      const el = this.stage.renderer.domElement;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = '';
      // La pieza nueva queda seleccionada con la misma cara activa: se puede seguir extruyendo
      if (length >= 0.1) this.editor.extrudeSelected(this.face.axis, this.face.sign, length);
      this.sync();
      return;
    }
    this.stage.controls.enabled = true;
    const el = this.stage.renderer.domElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.style.cursor = '';
    this.editor.setSelectedShape(shape, { live: false }); // un solo paso de deshacer
    this.sync();
  }

  /** Parámetro t del punto del eje (origen + t·eje) más cercano al rayo del puntero. */
  #axisParam(origin, axis) {
    const d = new THREE.Vector3().setComponent(axis, 1);
    const { ray } = this.raycaster;
    const w0 = origin.clone().sub(ray.origin);
    const b = d.dot(ray.direction);
    const denom = 1 - b * b;
    if (denom < 1e-6) return 0;
    return (b * ray.direction.dot(w0) - d.dot(w0)) / denom;
  }

  /** Coordenada (local, desde la esquina mínima) en el eje w del promedio de unas esquinas. */
  #coord(off, size, ids, w) {
    return ids.reduce((s, i) => s + ((i >> w) & 1) * size[w] + off[i * 3 + w] * size[w], 0) / ids.length;
  }

  /** Distancias desde la cara activa hasta otras piezas que tiene enfrente (para el imán). */
  #contacts(cell, p) {
    const { axis, sign } = this.face;
    const P = pieceCorners(cell, p);
    const ids = faceCorners(axis, sign);
    const plane = P[ids[0]][axis];
    const lat = [0, 1, 2].filter((a) => a !== axis);
    const lo = lat.map((a) => Math.min(...ids.map((i) => P[i][a])));
    const hi = lat.map((a) => Math.max(...ids.map((i) => P[i][a])));
    const [key] = this.editor.selection;
    const out = [];
    for (const [k, v] of this.editor.model.voxels) {
      if (k === key) continue;
      for (const [m, s] of pieceWorldBoxes(parseKey(k), parseVoxel(v))) {
        if (!lat.every((a, j) => m[a] < hi[j] - 1e-6 && m[a] + s[a] > lo[j] + 1e-6)) continue;
        const dist = sign > 0 ? m[axis] - plane : plane - (m[axis] + s[axis]);
        if (dist > 0.05) out.push(dist);
      }
    }
    return out;
  }

  #updateDrag() {
    const d = this.drag;
    const { axis, sign } = this.face;
    if (d.kind === 'extrude') {
      // Largo de la pieza nueva: pasos de 0.1, imán en enteros y al tocar otra pieza
      const raw = sign * (this.#axisParam(d.origin, axis) - d.t0);
      const f = Math.floor(raw);
      let len = snapStep(magnet(raw, [f - 1, f, f + 1, f + 2, ...d.contacts]).value);
      len = Math.max(0, len);
      const res = len >= 0.1 ? this.editor.extrudePreview(axis, sign, len) : null;
      if (!res && len >= 0.1) return; // se saldría de la cuadrícula: se queda en el último que cabía
      d.length = res ? len : 0;
      this.preview.visible = !!res;
      if (res) {
        const p = parseVoxel(res[1]);
        this.preview.geometry = pieceGeometry(p);
        this.preview.material.color.set(p.color);
        pieceTransform(res[0], p, this.preview.matrix);
      }
      return;
    }
    const off = [...d.off0];
    const n = this.stage.gridSize ?? 24;
    const lo = [-n / 2, 0, -n / 2];
    const hi = [n / 2, n, n / 2];
    const ids = faceCorners(axis, sign);
    const opp = faceCorners(axis, -sign);
    const depth = d.size[axis];

    if (d.kind === 'edge') {
      // Una orilla de la cara: se mueve sola (achica o agranda ese lado)
      const { w, b, ids: edgeIds } = d.edge;
      const sw = d.size[w];
      const e0 = this.#coord(d.off0, d.size, edgeIds, w);
      const other = this.#coord(d.off0, d.size, ids.filter((i) => !edgeIds.includes(i)), w);
      const oppEdge = this.#coord(d.off0, d.size, opp.filter((i) => ((i >> w) & 1) === b), w);
      const raw = e0 + (this.#axisParam(d.origin, w) - d.t0);
      const targets = [b * sw, oppEdge, other, sw / 2, oppEdge + depth, oppEdge - depth];
      let e = magnet(raw, targets).value;
      e = snapStep(d.min[w] + e) - d.min[w];
      // Sin cruzar la otra orilla de la cara, sin pasarse mucho de la caja ni salir de la cuadrícula
      e = b ? Math.max(e, other) : Math.min(e, other);
      e = Math.min(hi[w] - d.min[w], Math.max(lo[w] - d.min[w], e)); // el tope es la cuadrícula
      for (const i of edgeIds) off[i * 3 + w] = d.off0[i * 3 + w] + (e - e0) / sw;
    } else {
      // Toda la cara se recorre sobre su plano (la pieza queda inclinada)
      const hit = this.raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
      if (!hit) return;
      for (const w of [0, 1, 2].filter((a) => a !== axis)) {
        const sw = d.size[w];
        const loF = this.#coord(d.off0, d.size, ids.filter((i) => !((i >> w) & 1)), w);
        const hiF = this.#coord(d.off0, d.size, ids.filter((i) => (i >> w) & 1), w);
        const loO = this.#coord(d.off0, d.size, opp.filter((i) => !((i >> w) & 1)), w);
        const hiO = this.#coord(d.off0, d.size, opp.filter((i) => (i >> w) & 1), w);
        const raw = hit.getComponent(w) - d.start.getComponent(w);
        const targets = [0, loO - loF, hiO - hiF, (loO + hiO) / 2 - (loF + hiF) / 2,
          loO - loF + depth, loO - loF - depth, hiO - hiF + depth, hiO - hiF - depth];
        let s = magnet(raw, targets).value;
        s = snapStep(s);
        s = Math.min(hi[w] - d.min[w] - hiF, Math.max(lo[w] - d.min[w] - loF, s)); // el tope es la cuadrícula
        for (const i of ids) off[i * 3 + w] = d.off0[i * 3 + w] + s / sw;
      }
    }
    const shape = makeDeformShape(off);
    if (shape === d.shape) return;
    d.shape = shape;
    this.editor.setSelectedShape(shape, { live: true });
    this.#follow();
  }

  /** Durante el arrastre, las manijas siguen a la cara (sin cambiar su punto de partida). */
  #follow() {
    const drag = this.drag;
    this.drag = null;
    this.sync();
    this.drag = drag;
  }
}

/** Esquinas (índices 0..7) de la cara con normal en `axis` y lado `sign`. */
function faceCorners(axis, sign) {
  const out = [];
  for (let i = 0; i < 8; i++) if (((i >> axis) & 1) === (sign > 0 ? 1 : 0)) out.push(i);
  return out;
}
