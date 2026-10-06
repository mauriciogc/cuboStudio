import * as THREE from 'three';

// Modo "Espacio 3D": muestra el volumen de la cuadrícula y un plano de trabajo
// (una capa) sobre el que se pueden poner cubos flotantes.
export const PLANE_AXES = [
  { axis: 1, label: 'Horizontal', coord: 'y' },
  { axis: 2, label: 'Frente', coord: 'z' },
  { axis: 0, label: 'Lado', coord: 'x' },
];

export class WorkPlane extends EventTarget {
  constructor(stage) {
    super();
    this.stage = stage;
    this.enabled = false;
    this.axis = 1;
    this.layer = 1;

    this.group = new THREE.Group();
    this.group.visible = false;
    stage.scene.add(this.group);
    stage.helpers.push(this.group);

    this.volume = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25 }),
    );
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#4fa3e0', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.mesh.renderOrder = 1;
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#4fa3e0', transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.group.add(this.volume, this.mesh, this.lines);
  }

  /** Rango válido de capas para el eje actual. */
  range(axis = this.axis) {
    const n = this.stage.gridSize;
    return axis === 1 ? [0, n - 1] : [-n / 2, n / 2 - 1];
  }

  setEnabled(on) {
    this.enabled = on;
    this.update();
  }

  setAxis(axis) {
    if (axis === this.axis) return;
    this.axis = axis;
    this.layer = axis === 1 ? 1 : 0;
    this.update();
  }

  setLayer(layer) {
    const [lo, hi] = this.range();
    this.layer = Math.min(hi, Math.max(lo, layer));
    this.update();
  }

  step(d) { this.setLayer(this.layer + d); }

  update() {
    const n = this.stage.gridSize;
    const h = n / 2;
    const [lo, hi] = this.range();
    this.layer = Math.min(hi, Math.max(lo, this.layer));
    this.group.visible = this.enabled;

    this.volume.geometry.dispose();
    this.volume.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(n, n, n));
    this.volume.position.set(0, h, 0);

    // Plano a media altura de la capa (las celdas de la capa quedan "cortadas" por él)
    const c = this.layer + 0.5;
    const m = this.mesh;
    m.rotation.set(0, 0, 0);
    m.scale.set(n, n, 1);
    if (this.axis === 1) { m.rotation.x = -Math.PI / 2; m.position.set(0, c, 0); }
    else if (this.axis === 2) { m.position.set(0, h, c); }
    else { m.rotation.y = Math.PI / 2; m.position.set(c, h, 0); }

    // Cuadrícula de la capa
    const pts = [];
    const point = (u, v) => {
      if (this.axis === 1) return [u, c, v];
      if (this.axis === 2) return [u, v + h, c];
      return [c, v + h, u];
    };
    for (let i = -h; i <= h; i++) {
      pts.push(...point(i, -h), ...point(i, h), ...point(-h, i), ...point(h, i));
    }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));

    this.dispatchEvent(new Event('change'));
  }

  /** Celda de la capa donde cae el punto de impacto sobre el plano. */
  cellAt(point) {
    const cell = point.map(Math.floor);
    cell[this.axis] = this.layer;
    return cell;
  }

  /** Normal de la capa apuntando hacia la cámara. */
  normalToward(cameraPos) {
    const n = [0, 0, 0];
    n[this.axis] = cameraPos[this.axis] >= this.layer + 0.5 ? 1 : -1;
    return n;
  }
}
