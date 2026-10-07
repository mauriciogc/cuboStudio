import * as THREE from 'three';

/**
 * Sol que se arrastra en la escena para orientar la luz.
 * Se mueve sobre las caras del cubo del espacio de trabajo (los 4 lados y el techo), sin
 * salirse: la luz va del sol al centro del piso. Es una ayuda (no sale al exportar).
 * Eventos: 'start' al agarrarlo; 'change' { az, el, done } mientras se arrastra y al soltar (done = true).
 */
export class SunGizmo extends EventTarget {
  constructor(stage, editor) {
    super();
    this.stage = stage;
    this.enabled = false;
    this.dragging = false;
    this.hovering = false;

    const yellow = '#ffc23d';
    this.group = new THREE.Group();
    this.group.visible = false;
    stage.scene.add(this.group);
    stage.helpers.push(this.group);

    const onTop = (m) => { m.renderOrder = 20; return m; };
    // El sol (se dibuja encima de todo para poder agarrarlo aunque quede detrás de la figura)
    this.sun = onTop(new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: yellow, depthTest: false, transparent: true, opacity: 0.95 }),
    ));
    this.halo = onTop(new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 24, 16),
      new THREE.MeshBasicMaterial({ color: yellow, depthTest: false, transparent: true, opacity: 0.22 }),
    ));
    // Zona de agarre más grande que el dibujo (invisible)
    this.grip = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.sun.add(this.halo, this.grip);

    // Línea punteada del sol al centro del piso
    this.ray = onTop(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineDashedMaterial({ color: yellow, dashSize: 0.5, gapSize: 0.35, depthTest: false, transparent: true, opacity: 0.8 }),
    ));
    // Cubo del espacio de trabajo: por sus caras se mueve el sol
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(unit),
      new THREE.LineBasicMaterial({ color: yellow, transparent: true, opacity: 0.55 }),
    );
    this.walls = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({
      color: yellow, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false,
    }));
    this.group.add(this.cage, this.walls, this.sun, this.ray);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.#onMove(e));
    el.addEventListener('pointerdown', (e) => this.#onDown(e), { capture: true });
    el.addEventListener('pointerup', (e) => this.#onUp(e));
    el.addEventListener('pointercancel', (e) => this.#onUp(e));

    // Un clic sobre el sol no debe construir, borrar ni seleccionar
    const prev = editor.isGizmoActive ?? (() => false);
    editor.isGizmoActive = () => prev() || (this.enabled && (this.dragging || this.hovering));
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled;
    if (!this.enabled) this.#setHover(false);
    this.update();
  }

  /** Cubo del espacio de trabajo: x y z de -n/2 a n/2, y de 0 a n. */
  get box() {
    const n = this.stage.gridSize ?? 24;
    return new THREE.Box3(new THREE.Vector3(-n / 2, 0, -n / 2), new THREE.Vector3(n / 2, n, n / 2));
  }

  /** Recoloca el sol según la luz actual: donde su dirección sale del cubo. */
  update() {
    if (!this.enabled) return;
    const n = this.stage.gridSize ?? 24;
    this.cage.scale.setScalar(n);
    this.walls.scale.setScalar(n);
    const { az, el } = this.stage.lighting;
    const a = THREE.MathUtils.degToRad(az);
    const e = THREE.MathUtils.degToRad(el);
    const d = new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    // Desde el centro del piso, hasta tocar un lado o el techo
    const t = Math.min(
      Math.abs(d.x) > 1e-6 ? n / 2 / Math.abs(d.x) : Infinity,
      Math.abs(d.z) > 1e-6 ? n / 2 / Math.abs(d.z) : Infinity,
      d.y > 1e-6 ? n / d.y : Infinity,
    );
    const pos = d.multiplyScalar(t);
    this.sun.position.copy(pos);
    this.sun.scale.setScalar(Math.max(0.35, n * 0.028));
    this.ray.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), pos]);
    this.ray.computeLineDistances();
  }

  #setNdc(e) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
  }

  #setHover(on) {
    if (on === this.hovering) return;
    this.hovering = on;
    this.halo.material.opacity = on ? 0.4 : 0.22;
    this.stage.renderer.domElement.style.cursor = on ? 'grab' : '';
  }

  #onMove(e) {
    if (!this.enabled) return;
    this.#setNdc(e);
    if (this.dragging) {
      this.#drag();
      return;
    }
    this.#setHover(this.raycaster.intersectObject(this.grip, false).length > 0);
  }

  #onDown(e) {
    if (!this.enabled || e.button !== 0) return;
    this.#setNdc(e);
    if (!this.raycaster.intersectObject(this.grip, false).length) return;
    e.stopImmediatePropagation();
    this.dragging = true;
    this.dispatchEvent(new Event('start'));
    this.stage.controls.enabled = false;
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
    this.stage.renderer.domElement.style.cursor = 'grabbing';
  }

  #onUp(e) {
    if (!this.dragging) return;
    this.dragging = false;
    this.stage.controls.enabled = true;
    const el = this.stage.renderer.domElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.style.cursor = this.hovering ? 'grab' : '';
    const { az, el: elev } = this.stage.lighting;
    this.dispatchEvent(new CustomEvent('change', { detail: { az, el: elev, done: true } }));
  }

  /** Punto del cubo bajo el puntero → giro y altura del sol (vistos desde el centro del piso). */
  #drag() {
    const { ray } = this.raycaster;
    const box = this.box;
    const hit = new THREE.Vector3();
    if (!ray.intersectBox(box, hit) || hit.y < 1e-3) {
      // Fuera del cubo: el punto del rayo más cercano al centro (luego se pega a una cara)
      ray.closestPointToPoint(box.getCenter(new THREE.Vector3()), hit);
    }
    const flat = Math.hypot(hit.x, hit.z);
    const az = (THREE.MathUtils.radToDeg(Math.atan2(hit.x, hit.z)) + 360) % 360;
    const el = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.atan2(Math.max(0, hit.y), flat)), 2, 90);
    this.dispatchEvent(new CustomEvent('change', { detail: { az: Math.round(az), el: Math.round(el), done: false } }));
  }
}
