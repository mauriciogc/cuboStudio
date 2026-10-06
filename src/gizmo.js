import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  parseKey, parseVoxel, parseStickerKey, FACE_NORMALS, MIN_PIECE, snapStep, pieceWorldBoxes,
} from './model.js';
import { pieceGeometry, pieceTransform, pieceMatrix } from './voxel-mesh.js';
import { createStickerMesh, placeStickerMesh } from './stickers.js';

const materials = new Map();
function material(color) {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
    materials.set(color, m);
  }
  return m;
}

/**
 * Imán general: v se pega a la meta más cercana (enteros, o el punto donde la pieza toca a
 * otra) y entre dos metas avanza de forma continua. Devuelve { value, snapped }.
 */
const STICK = 0.2; // ancho de la zona donde se queda pegado
function magnet(v, targets) {
  let a = -Infinity;
  let b = Infinity;
  for (const t of targets) {
    if (t <= v && t > a) a = t;
    if (t > v && t < b) b = t;
  }
  if (a === -Infinity || b === Infinity) return { value: v, snapped: false };
  const gap = b - a;
  if (gap < 1e-6) return { value: a, snapped: true };
  const d = Math.min(STICK, gap * 0.3);
  if (v - a < d) return { value: a, snapped: true };
  if (b - v < d) return { value: b, snapped: true };
  return { value: a + ((v - a - d) / (gap - 2 * d)) * gap, snapped: false };
}
const intsAround = (v) => { const f = Math.floor(v); return [f - 1, f, f + 1, f + 2]; };
/** ¿Las cajas se enciman en los ejes indicados? (tocarse de canto no cuenta) */
const overlapOn = (axes, aMin, aMax, bMin, bMax) => axes.every((j) => aMin[j] < bMax[j] - 1e-6 && aMax[j] > bMin[j] + 1e-6);

/**
 * Gizmo clásico (flechas X/Y/Z y aros de giro) sobre las piezas seleccionadas.
 * Mueve de a 0.1, gira de a 90°. Escalar usa manijas en las 6 caras (la cara que arrastras
 * se mueve y la opuesta queda fija) y en las 8 esquinas (crece parejo en diagonal). Pasos de 0.1.
 * Eventos: 'blocked' (choca o sale de la cuadrícula), 'mode', 'size' (medidas al escalar).
 * Al escalar, los tamaños enteros (1, 2, 3…) tienen imán.
 */
export class SelectionGizmo extends EventTarget {
  constructor(stage, editor) {
    super();
    this.stage = stage;
    this.editor = editor;
    this.mode = 'translate';
    this.dragging = false;

    this.pivot = new THREE.Object3D();
    this.preview = new THREE.Group();
    this.pivot.add(this.preview);
    stage.scene.add(this.pivot);

    const tc = new TransformControls(stage.camera, stage.renderer.domElement);
    tc.setTranslationSnap(1);
    tc.setRotationSnap(Math.PI / 2);
    tc.setSize(0.9);
    // Calcomanías: limitar el arrastre para que no se salgan del cubo
    tc.addEventListener('objectChange', () => {
      if (this.dragging && this.target === 'pieces' && this.mode === 'translate' && this.moveRange) {
        // Mover: imán al tocar otra pieza (o al alinear con la cuadrícula), pasos de 0.1
        // y el tope son las orillas de la cuadrícula
        const [lo, hi] = this.moveRange;
        const p = this.pivot.position;
        const raw = [p.x, p.y, p.z].map((v, i) => v - this.start.getComponent(i));
        let snapped = false;
        const d = raw.map((v, i) => {
          if (Math.abs(v) < 1e-9) return 0;
          const m = magnet(v, this.#moveTargets(i, raw));
          snapped ||= m.snapped && Math.abs(m.value) > 1e-6;
          return Math.min(hi[i], Math.max(lo[i], snapStep(m.value)));
        });
        p.set(...d.map((v, i) => this.start.getComponent(i) + v));
        this.#pulseGizmo(snapped);
        return;
      }
      if (this.dragging && this.target === 'pieces' && this.mode === 'scale') {
        // Medidas en pasos de 0.1 dentro de los límites
        const s = this.pivot.scale.toArray().map((v, i) => {
          const size = Math.min(this.editor.model.size, Math.max(MIN_PIECE, snapStep(this.baseSize[i] * Math.abs(v))));
          return size / this.baseSize[i];
        });
        this.pivot.scale.set(...s);
        this.dispatchEvent(new CustomEvent('size', { detail: s.map((v, i) => v * this.baseSize[i]) }));
        return;
      }
      if (!this.dragging || this.target !== 'sticker') return;
      const d = this.#stickerDelta();
      if (this.editor.canMoveSelectedBy(d)) this.lastValid = d;
      else this.pivot.position.copy(this.start).add(new THREE.Vector3(...this.lastValid));
    });
    tc.addEventListener('dragging-changed', (e) => {
      stage.controls.enabled = !e.value;
      if (e.value) this.#begin();
      else this.#end();
    });
    this.controls = tc;
    const helper = tc.getHelper();
    stage.scene.add(helper);
    stage.helpers.push(helper, this.pivot);

    this.#createFaceHandles();

    // Un clic sobre el gizmo no debe seleccionar/deseleccionar piezas
    // (una manija cuenta sólo si de verdad está visible: evita quedar "atorado" con la mano)
    editor.isGizmoActive = () => tc.dragging || tc.axis !== null || this.faceDrag != null
      || (this.hoverHandle != null && this.handles.visible && this.hoverHandle.visible);

    const sync = () => this.sync();
    editor.addEventListener('selection', sync);
    editor.addEventListener('tool', sync);
    editor.addEventListener('change', sync);
    editor.addEventListener('load', sync);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'none') this.controls.setMode(mode);
    this.sync();
    this.dispatchEvent(new Event('mode'));
  }

  /** Coloca el gizmo en el centro de la selección (o lo oculta). */
  sync() {
    if (this.dragging) return;
    const { selection, tool, selected } = this.editor;
    const tc = this.controls;

    // Sólo seleccionar: sin flechas, aros ni manijas
    if (this.mode === 'none') {
      this.#hideHandles();
      tc.detach();
      return;
    }

    if (tool === 'select' && selected) {
      const { p, f } = parseStickerKey(selected);
      const n = FACE_NORMALS[f];
      this.target = 'sticker';
      if (this.mode === 'scale') {
        // Escalar calcomanía: manijas en sus 4 orillas
        tc.detach();
        this.#placeStickerHandles(p, f, this.editor.model.stickers.get(selected).n);
        this.pivot.position.set(...p);
        return;
      }
      this.#hideHandles();
      // Mover calcomanía: sólo las dos flechas de su cara, de a medio cubo
      this.pivot.position.set(...p.map((v, i) => v + n[i] * 0.02));
      this.pivot.quaternion.identity();
      tc.setMode('translate');
      tc.setTranslationSnap(0.1);
      tc.showX = n[0] === 0;
      tc.showY = n[1] === 0;
      tc.showZ = n[2] === 0;
      tc.attach(this.pivot);
      return;
    }

    this.target = 'pieces';
    this.#hideHandles();
    tc.setMode(this.mode === 'scale' ? 'translate' : this.mode);
    tc.setTranslationSnap(null); // los pasos de 0.1 y el imán se aplican al arrastrar
    tc.showX = tc.showY = tc.showZ = true;
    if (tool !== 'select' || !selection.size) {
      tc.detach();
      return;
    }
    this.pivot.scale.set(1, 1, 1);
    if (this.mode === 'scale') {
      // Escalar: una sola pieza, con manijas en sus caras
      tc.detach();
      if (selection.size !== 1) return;
      const [k] = selection;
      const p = parseVoxel(this.editor.model.voxels.get(k));
      const min = parseKey(k).map((v, i) => v + p.offset[i]);
      this.#placeHandles(min, p.size);
      this.pivot.position.set(...min.map((v, i) => v + p.size[i] / 2));
      return;
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const k of selection) {
      parseKey(k).forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); });
    }
    // Centro en el centro de una celda: así los giros de 90° caen en la cuadrícula
    this.pivot.position.set(...min.map((v, i) => Math.floor((v + max[i]) / 2) + 0.5));
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld();
    this.controls.attach(this.pivot);
  }

  // ---------- escalar por caras ----------

  #createFaceHandles() {
    this.handles = new THREE.Group();
    this.handles.visible = false;
    this.stage.scene.add(this.handles);
    this.stage.helpers.push(this.handles);
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const colors = ['#ff4d4d', '#3ecf5a', '#3d8bff'];
    this.handleMeshes = [];
    this.handleLines = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[axis], depthTest: false, transparent: true }));
        mesh.renderOrder = 10;
        mesh.userData = { axis, sign };
        this.handles.add(mesh);
        this.handleMeshes.push(mesh);
        // Línea desde el centro de la pieza hasta la manija (como el gizmo clásico)
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineBasicMaterial({ color: colors[axis], depthTest: false, transparent: true }),
        );
        line.renderOrder = 9;
        this.handles.add(line);
        this.handleLines.push(line);
      }
    }
    // Esquinas (amarillas): agrandan parejo en diagonal, con la esquina opuesta fija
    const cornerGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const cornerMat = new THREE.MeshBasicMaterial({ color: '#ffc21a', depthTest: false, transparent: true });
    this.cornerMeshes = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const mesh = new THREE.Mesh(cornerGeo, cornerMat);
          mesh.renderOrder = 10;
          mesh.userData = { corner: [sx, sy, sz] };
          this.handles.add(mesh);
          this.cornerMeshes.push(mesh);
        }
      }
    }
    this.hoverHandle = null;
    this.faceDrag = null;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    const el = this.stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.#onFaceMove(e));
    // En captura (después del editor): si se toma una manija, nadie más recibe el clic
    el.addEventListener('pointerdown', (e) => this.#onFaceDown(e), { capture: true });
    el.addEventListener('pointerup', (e) => this.#onFaceUp(e));
    el.addEventListener('pointercancel', (e) => this.#onFaceUp(e));
    el.addEventListener('pointerleave', () => { if (!this.faceDrag) this.#clearHover(); });
    // Si el arrastre se interrumpe (soltar fuera de la ventana, cambiar de app), cerrarlo
    el.addEventListener('lostpointercapture', (e) => this.#onFaceUp(e));
    window.addEventListener('blur', () => this.#onFaceUp({ pointerId: -1 }));
  }

  #placeHandles(min, size) {
    const center = min.map((v, i) => v + size[i] / 2);
    this.handleMeshes.forEach((h, i) => {
      const { axis, sign } = h.userData;
      const pos = [...center];
      pos[axis] = sign > 0 ? min[axis] + size[axis] + 0.45 : min[axis] - 0.45;
      h.position.set(...pos);
      h.visible = this.handleLines[i].visible = true;
      this.handleLines[i].geometry.setFromPoints([new THREE.Vector3(...center), new THREE.Vector3(...pos)]);
    });
    for (const c of this.cornerMeshes) {
      const s = c.userData.corner;
      c.position.set(...min.map((v, i) => (s[i] > 0 ? v + size[i] + 0.18 : v - 0.18)));
      c.visible = true;
    }
    this.handles.visible = true;
  }

  /** Manijas de una calcomanía: en sus 4 orillas, apenas despegadas de la cara. */
  #placeStickerHandles(p, f, n) {
    for (const c of this.cornerMeshes) c.visible = false;
    const normal = FACE_NORMALS[f];
    const normalAxis = normal.findIndex((v) => v !== 0);
    const center = p.map((v, i) => v + normal[i] * 0.05);
    this.handleMeshes.forEach((h, i) => {
      const { axis, sign } = h.userData;
      const show = axis !== normalAxis;
      h.visible = this.handleLines[i].visible = show;
      if (!show) return;
      const pos = [...center];
      pos[axis] += sign * (n / 2 + 0.3);
      h.position.set(...pos);
      this.handleLines[i].geometry.setFromPoints([new THREE.Vector3(...center), new THREE.Vector3(...pos)]);
    });
    this.handles.visible = true;
  }

  #setNdc(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
  }

  /** Parámetro t del punto del eje (origen + t·eje) más cercano al rayo del puntero. */
  #axisParam(origin, axis) {
    const d = new THREE.Vector3();
    d.setComponent(axis, 1);
    return this.#dirParam(origin, d);
  }

  /** Igual que #axisParam pero sobre cualquier dirección unitaria (p. ej. una diagonal). */
  #dirParam(origin, d) {
    const { ray } = this.ray;
    const w0 = origin.clone().sub(ray.origin);
    const b = d.dot(ray.direction);
    const denom = 1 - b * b;
    if (denom < 1e-6) return 0;
    return (b * ray.direction.dot(w0) - d.dot(w0)) / denom;
  }

  /** Oculta las manijas y olvida la que estaba bajo el puntero (y el cursor de mano). */
  #hideHandles() {
    if (this.handles) this.handles.visible = false;
    this.#clearHover();
  }

  #clearHover() {
    if (!this.hoverHandle) return;
    this.hoverHandle.scale.setScalar(1);
    this.hoverHandle = null;
    this.stage.renderer.domElement.style.cursor = '';
  }

  #onFaceMove(e) {
    if (!this.handles.visible && !this.faceDrag) {
      this.#clearHover();
      return;
    }
    this.#setNdc(e);
    if (this.faceDrag) {
      this.#updateFaceDrag();
      return;
    }
    this.ray.params.Line.threshold = 0;
    const hit = this.ray.intersectObjects([...this.cornerMeshes, ...this.handleMeshes].filter((m) => m.visible), false)[0];
    const h = hit?.object ?? null;
    if (h !== this.hoverHandle) {
      this.hoverHandle?.scale.setScalar(1);
      h?.scale.setScalar(1.35);
      this.hoverHandle = h;
      this.stage.renderer.domElement.style.cursor = h ? 'grab' : '';
    }
  }

  #onFaceDown(e) {
    if (e.button !== 0 || !this.hoverHandle) return;
    const sticker = this.target === 'sticker' && this.editor.selected;
    if (!sticker && this.editor.selection.size !== 1) return;
    e.stopImmediatePropagation();
    this.stage.controls.enabled = false;
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
    this.#setNdc(e);
    if (sticker) {
      const key = this.editor.selected;
      const { p, f } = parseStickerKey(key);
      const st = this.editor.model.stickers.get(key);
      const { axis, sign } = this.hoverHandle.userData;
      const origin = this.hoverHandle.position.clone();
      this.faceDrag = {
        sticker: true, key, st, f, p0: p, n0: st.n, axis, sign, origin,
        t0: this.#axisParam(origin, axis), last: { p, n: st.n },
      };
      this.hiddenStickers = this.editor.stickerLayer.group.children.filter((m) => m.userData.stickerKey === key);
      this.hiddenStickers.forEach((m) => { m.visible = false; });
      this.editor.transforming = true;
      this.pivot.position.set(0, 0, 0);
      this.pivot.updateMatrixWorld();
      this.#updateFaceDrag();
      return;
    }
    const [key] = this.editor.selection;
    const p = parseVoxel(this.editor.model.voxels.get(key));
    const min0 = parseKey(key).map((v, i) => v + p.offset[i]);
    const { axis, sign, corner } = this.hoverHandle.userData;
    const origin = this.hoverHandle.position.clone();
    if (corner) {
      const dir = new THREE.Vector3(...corner).normalize();
      this.faceDrag = { key, p, corner, dir, origin, min0, size0: p.size, min: min0, size: p.size, t0: this.#dirParam(origin, dir) };
    } else {
      this.faceDrag = { key, p, axis, sign, origin, min0, size0: p.size, min: min0, size: p.size, t0: this.#axisParam(origin, axis) };
    }
    // Imán contra otras piezas: tamaños a los que la cara arrastrada toca a otra
    this.others = this.#otherBoxes();
    const max0 = min0.map((v, i) => v + p.size[i]);
    const d = this.faceDrag;
    if (!corner) {
      const lateral = [0, 1, 2].filter((j) => j !== axis);
      d.contacts = [];
      for (const [bMin, bMax] of this.others) {
        if (!overlapOn(lateral, min0, max0, bMin, bMax)) continue;
        for (const c of [bMin[axis], bMax[axis]]) {
          const s = sign > 0 ? c - min0[axis] : max0[axis] - c;
          if (s >= MIN_PIECE - 1e-6) d.contacts.push(s);
        }
      }
    }
    // Vista previa de la pieza mientras se arrastra (la original se oculta)
    this.preview.clear();
    this.pivot.position.set(0, 0, 0);
    this.pivot.updateMatrixWorld();
    const mesh = new THREE.Mesh(pieceGeometry({ ...p, size: [1, 1, 1], offset: [0, 0, 0] }), material(p.color));
    mesh.matrixAutoUpdate = false;
    this.preview.add(mesh);
    this.faceMesh = mesh;
    this.editor.transforming = true;
    this.editor.setHidden(new Set([key]));
    this.#updateFaceDrag();
  }

  #updateFaceDrag() {
    const d = this.faceDrag;
    if (d.corner) {
      // Esquina: escala pareja (misma proporción) con la esquina opuesta fija
      const diag0 = Math.hypot(...d.size0);
      let factor = Math.max(0, (diag0 + this.#dirParam(d.origin, d.dir) - d.t0) / diag0);
      // Imán en el lado más largo: se pega a los cubos enteros… o cuando algún lado toca otra pieza
      const big = Math.max(...d.size0);
      const rawMin = d.min0.map((v, i) => (d.corner[i] < 0 ? v + d.size0[i] * (1 - factor) : v));
      const rawMax = rawMin.map((v, i) => v + d.size0[i] * factor);
      const targets = intsAround(big * factor);
      for (const [bMin, bMax] of this.others) {
        for (let i = 0; i < 3; i++) {
          if (!overlapOn([0, 1, 2].filter((j) => j !== i), rawMin, rawMax, bMin, bMax)) continue;
          const reach = d.corner[i] > 0 ? bMin[i] - d.min0[i] : d.min0[i] + d.size0[i] - bMax[i];
          if (reach > MIN_PIECE) targets.push((reach / d.size0[i]) * big);
        }
      }
      const mg = magnet(big * factor, targets);
      factor = mg.value / big;
      // Frenar parejo cuando el primer lado toca la orilla de la cuadrícula
      const [blo, bhi] = this.#gridBounds();
      const room = d.size0.map((s, i) => (d.corner[i] < 0 ? d.min0[i] + s - blo[i] : bhi[i] - d.min0[i]));
      factor = Math.min(factor, ...room.map((r, i) => r / d.size0[i]));
      const size = d.size0.map((s, i) => Math.min(room[i], Math.max(MIN_PIECE, snapStep(s * factor))));
      const min = d.min0.map((v, i) => (d.corner[i] < 0 ? snapStep(v + d.size0[i] - size[i]) : v));
      d.size = size;
      d.min = min;
      pieceMatrix(min, { ...d.p, size, offset: [0, 0, 0] }, this.faceMesh.matrix);
      this.#placeHandles(min, size);
      this.#snapFeedback(mg.snapped);
      this.dispatchEvent(new CustomEvent('size', { detail: size }));
      return;
    }
    const raw = this.#axisParam(d.origin, d.axis) - d.t0;
    const delta = snapStep(raw);
    if (d.sticker) {
      // Crece hacia la orilla arrastrada: la orilla opuesta queda fija
      const n = Math.min(16, Math.max(0.1, snapStep(d.n0 + (d.sign > 0 ? delta : -delta))));
      const p = [...d.p0];
      p[d.axis] += (d.sign * (n - d.n0)) / 2;
      d.last = { p, n }; // pueden salirse de la pieza
      this.preview.clear();
      const mesh = createStickerMesh({ ...d.st, n: d.last.n });
      placeStickerMesh(mesh, d.last.p, d.f);
      this.preview.add(mesh);
      this.#placeStickerHandles(d.last.p, d.f, d.last.n);
      this.dispatchEvent(new CustomEvent('size', { detail: [d.last.n, d.last.n] }));
      return;
    }
    const a = d.axis;
    const size = [...d.size0];
    const min = [...d.min0];
    const grow = d.sign > 0 ? raw : -raw;
    // Pasos de 0.1, pero con imán en los cubos enteros (1, 2, 3…)
    // Hasta la orilla de la cuadrícula (la cara opuesta queda fija)
    const [blo, bhi] = this.#gridBounds();
    const room = d.sign > 0 ? bhi[a] - d.min0[a] : d.min0[a] + d.size0[a] - blo[a];
    const want = d.size0[a] + grow;
    const targets = [...intsAround(want), ...(d.contacts ?? [])];
    size[a] = Math.min(room, Math.max(MIN_PIECE, snapStep(magnet(want, targets).value)));
    if (d.sign < 0) min[a] = snapStep(d.min0[a] + d.size0[a] - size[a]); // la cara opuesta queda fija
    d.size = size;
    d.min = min;
    pieceMatrix(min, { ...d.p, size, offset: [0, 0, 0] }, this.faceMesh.matrix);
    this.#placeHandles(min, size);
    this.#snapFeedback(targets.some((t) => Math.abs(t - size[a]) < 1e-6));
    this.dispatchEvent(new CustomEvent('size', { detail: size }));
  }

  /** Al caer en un entero, las manijas dan un pequeño "salto" para que se sienta. */
  #snapFeedback(whole) {
    const d = this.faceDrag;
    if (whole && !d.whole) {
      const meshes = [...this.handleMeshes, ...this.cornerMeshes].filter((m) => m.visible);
      meshes.forEach((m) => m.scale.setScalar(1.7));
      clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(() => meshes.forEach((m) => m.scale.setScalar(1)), 140);
    }
    d.whole = whole;
  }

  #onFaceUp(e) {
    if (!this.faceDrag) return;
    const d = this.faceDrag;
    this.faceDrag = null;
    this.stage.controls.enabled = true;
    const el = this.stage.renderer.domElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    this.preview.clear();
    this.editor.transforming = false;
    this.dispatchEvent(new CustomEvent('size', { detail: null }));
    if (d.sticker) {
      this.hiddenStickers?.forEach((m) => { m.visible = true; });
      const { p, n } = d.last;
      if (n !== d.n0 || p.some((v, i) => v !== d.p0[i])) this.editor.setSelectedSticker(p, n);
      this.editor.refreshHover?.();
      this.sync();
      return;
    }
    this.editor.setHidden(null);
    const changed = d.size.some((v, i) => v !== d.size0[i]) || d.min.some((v, i) => v !== d.min0[i]);
    if (changed && !this.editor.setSelectedBox(d.min, d.size)) this.dispatchEvent(new Event('blocked'));
    this.sync();
  }

  #stickerDelta() {
    return this.pivot.position.clone().sub(this.start).toArray().map(snapStep);
  }

  #begin() {
    this.dragging = true;
    this.start = this.pivot.position.clone();
    if (this.target === 'sticker') {
      // Vista previa: la calcomanía viaja con el gizmo; las originales se ocultan
      const key = this.editor.selected;
      const { p, f } = parseStickerKey(key);
      const mesh = createStickerMesh(this.editor.model.stickers.get(key));
      placeStickerMesh(mesh, p, f);
      mesh.position.sub(this.start);
      this.preview.add(mesh);
      this.lastValid = [0, 0, 0];
      this.editor.transforming = true;
      this.hiddenStickers = this.editor.stickerLayer.group.children.filter((m) => m.userData.stickerKey === key);
      this.hiddenStickers.forEach((m) => { m.visible = false; });
      this.editor.refreshHover?.();
      return;
    }
    // Vista previa: copias reales de las piezas (con su tamaño), que viajan con el gizmo
    for (const k of this.editor.selection) {
      const p = parseVoxel(this.editor.model.voxels.get(k));
      const mesh = new THREE.Mesh(pieceGeometry(p), material(p.color));
      mesh.matrixAutoUpdate = false;
      pieceTransform(parseKey(k), p, mesh.matrix);
      mesh.matrix.elements[12] -= this.start.x;
      mesh.matrix.elements[13] -= this.start.y;
      mesh.matrix.elements[14] -= this.start.z;
      mesh.castShadow = true;
      this.preview.add(mesh);
      this.baseSize = p.size;
    }
    // Las calcomanías pegadas a esas piezas también viajan en la vista previa
    const stickerKeys = new Set(this.editor.attachedStickers);
    for (const sk of stickerKeys) {
      const { p, f } = parseStickerKey(sk);
      const mesh = createStickerMesh(this.editor.model.stickers.get(sk));
      placeStickerMesh(mesh, p, f);
      mesh.position.sub(this.start);
      this.preview.add(mesh);
    }
    this.hiddenStickers = this.editor.stickerLayer.group.children.filter((m) => stickerKeys.has(m.userData.stickerKey));
    this.hiddenStickers.forEach((m) => { m.visible = false; });
    this.editor.transforming = true;
    this.editor.setHidden(new Set(this.editor.selection));
    // Cuánto se puede mover la selección en cada eje sin salirse de la cuadrícula
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const k of this.editor.selection) {
      for (const [m, s] of pieceWorldBoxes(parseKey(k), parseVoxel(this.editor.model.voxels.get(k)))) {
        m.forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v + s[i]); });
      }
    }
    const [blo, bhi] = this.#gridBounds();
    this.moveRange = min[0] === Infinity ? null
      : [blo.map((v, i) => Math.min(0, v - min[i])), bhi.map((v, i) => Math.max(0, v - max[i]))];
    this.selBox = [min, max];
    this.others = this.#otherBoxes();
    this.wasSnapped = false;
  }

  /** Cajas [min, max] de todas las piezas que no están seleccionadas (para el imán). */
  #otherBoxes() {
    const sel = this.editor.selection;
    const out = [];
    for (const [k, v] of this.editor.model.voxels) {
      if (sel.has(k)) continue;
      for (const [m, s] of pieceWorldBoxes(parseKey(k), parseVoxel(v))) out.push([m, m.map((x, i) => x + s[i])]);
    }
    return out;
  }

  /** Metas del imán al mover en el eje i: tocar otra pieza o alinear con la cuadrícula. */
  #moveTargets(i, raw) {
    const [min, max] = this.selBox;
    const cur = (arr) => arr.map((v, j) => v + raw[j]);
    const cMin = cur(min);
    const cMax = cur(max);
    const lateral = [0, 1, 2].filter((j) => j !== i);
    const targets = [0, ...intsAround(cMin[i]).map((n) => n - min[i])];
    for (const [bMin, bMax] of this.others) {
      if (!overlapOn(lateral, cMin, cMax, bMin, bMax)) continue;
      targets.push(bMin[i] - max[i], bMax[i] - min[i]); // pegada por un lado o por el otro
    }
    return targets;
  }

  /** Al pegarse, el gizmo da un pequeño salto (como las manijas al escalar). */
  #pulseGizmo(snapped) {
    if (snapped && !this.wasSnapped) {
      const helper = this.controls.getHelper();
      helper.scale.setScalar(1.25);
      clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(() => helper.scale.setScalar(1), 140);
    }
    this.wasSnapped = snapped;
  }

  /** Esquinas de la cuadrícula: x y z van de -n/2 a n/2, y de 0 a n. */
  #gridBounds() {
    const n = this.editor.model.size;
    return [[-n / 2, 0, -n / 2], [n / 2, n, n / 2]];
  }

  #end() {
    this.dragging = false;
    this.preview.clear();
    this.editor.transforming = false;

    if (this.target === 'sticker') {
      this.hiddenStickers?.forEach((m) => { m.visible = true; });
      const d = this.lastValid;
      if (d.some((v) => v !== 0)) this.editor.moveSelectedBy(d);
      this.editor.setHidden(null);
      this.sync();
      return;
    }

    this.editor.setHidden(null);
    this.hiddenStickers?.forEach((m) => { m.visible = true; });
    this.hiddenStickers = null;

    const c0 = this.start;
    let ok = true;
    if (this.mode === 'scale') {
      const size = this.pivot.scale.toArray().map((v, i) => v * this.baseSize[i]);
      this.pivot.scale.set(1, 1, 1);
      ok = this.editor.resizeSelected(size);
      this.dispatchEvent(new CustomEvent('size', { detail: null }));
    } else if (this.mode === 'translate') {
      const d = this.pivot.position.clone().sub(c0).toArray().map(snapStep);
      if (d.some((v) => v !== 0)) ok = this.editor.transformSelection((c) => c.map((v, i) => v + d[i]));
    } else {
      const m = new THREE.Matrix4().makeRotationFromQuaternion(this.pivot.quaternion);
      const e = m.elements.map(Math.round);
      m.fromArray(e);
      const identity = e.every((v, i) => v === new THREE.Matrix4().elements[i]);
      if (!identity) {
        // Giro exacto (la matriz tiene sólo 0 y ±1) alrededor del centro del gizmo
        const center = c0.toArray();
        ok = this.editor.transformSelection((pt) => new THREE.Vector3(...pt.map((v, i) => v - center[i]))
          .applyMatrix4(m).toArray().map((v, i) => v + center[i]));
      }
    }
    if (!ok) this.dispatchEvent(new Event('blocked'));
    this.sync();
  }
}
