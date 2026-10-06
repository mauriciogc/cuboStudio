import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const BACKGROUNDS = {
  pradera: { label: 'Pradera', color: '#b4e283' },
  cielo: { label: 'Cielo', color: '#cde7f7' },
  arena: { label: 'Arena', color: '#f4e7c9' },
  nube: { label: 'Nube', color: '#f1f1f4' },
  noche: { label: 'Noche', color: '#2b3040' },
};

// Luz de la escena. sun/sunI: color e intensidad del sol; az/el: giro y altura del sol (grados);
// amb/ground/ambI: luz ambiente (cielo y rebote del suelo); shadows/soft: sombras y su suavidad;
// glow: fuerza de la luz de las piezas que brillan.
export const LIGHT_PRESETS = {
  dia: {
    label: 'Día', sun: '#fff4e3', sunI: 2.1, az: 27, el: 58,
    amb: '#ffffff', ground: '#c7b99c', ambI: 1.9, shadows: true, soft: 5, glow: 1,
  },
  atardecer: {
    label: 'Atardecer', sun: '#ffa45c', sunI: 2.6, az: 300, el: 14,
    amb: '#ffd2b8', ground: '#6b4a5c', ambI: 1.1, shadows: true, soft: 4, glow: 1.2,
  },
  noche: {
    label: 'Noche', sun: '#a9c1ff', sunI: 0.5, az: 140, el: 50,
    amb: '#4d5f99', ground: '#151a2b', ambI: 0.45, shadows: true, soft: 6, glow: 1.6,
  },
  estudio: {
    label: 'Estudio', sun: '#ffffff', sunI: 1.4, az: 35, el: 65,
    amb: '#ffffff', ground: '#dedede', ambI: 2.5, shadows: true, soft: 9, glow: 1,
  },
};
export const DEFAULT_LIGHT = 'dia';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const clampNum = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);

/** Posición del sol para una luz y una cuadrícula de n cubos (gira alrededor del centro). */
export function sunPosition(light, n) {
  const a = THREE.MathUtils.degToRad(light.az);
  const e = THREE.MathUtils.degToRad(light.el);
  const r = n * 1.9;
  return [r * Math.cos(e) * Math.sin(a), r * Math.sin(e), r * Math.cos(e) * Math.cos(a)];
}

/** Luz completa y válida a partir de lo guardado (o de un ambiente listo). */
export function normalizeLight(light) {
  const base = LIGHT_PRESETS[light?.preset] ?? LIGHT_PRESETS[DEFAULT_LIGHT];
  const l = { ...base, ...(light && typeof light === 'object' ? light : {}) };
  return {
    preset: light?.preset in LIGHT_PRESETS ? light.preset : (light ? null : DEFAULT_LIGHT),
    sun: HEX_COLOR.test(l.sun) ? l.sun.toLowerCase() : base.sun,
    sunI: clampNum(l.sunI, 0, 5, base.sunI),
    az: ((clampNum(l.az, -720, 720, base.az) % 360) + 360) % 360,
    el: clampNum(l.el, 2, 90, base.el),
    amb: HEX_COLOR.test(l.amb) ? l.amb.toLowerCase() : base.amb,
    ground: HEX_COLOR.test(l.ground) ? l.ground.toLowerCase() : base.ground,
    ambI: clampNum(l.ambI, 0, 5, base.ambI),
    shadows: l.shadows !== false,
    soft: clampNum(l.soft, 1, 12, base.soft),
    glow: clampNum(l.glow, 0, 3, base.glow),
  };
}

const VIEWS = {
  iso: new THREE.Vector3(1, 0.9, 1.25),
  front: new THREE.Vector3(0, 0.22, 1),
  side: new THREE.Vector3(1, 0.22, 0),
  back: new THREE.Vector3(0, 0.22, -1),
  top: new THREE.Vector3(0, 1, 0.001),
};

/** Escena, cámara, luces, piso y bucle de render. */
export class Stage {
  constructor(container) {
    this.container = container;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.minDistance = 4;
    controls.maxDistance = 400;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.addEventListener('start', () => { this.anim = null; });
    this.controls = controls;

    /** Objetos auxiliares que se ocultan al exportar. */
    this.helpers = [];
    this.anim = null;

    this.#buildLights();
    this.lighting = normalizeLight(null);
    this.#buildFloor();
    this.setBackground('pradera');
    this.setGridSize(24);
    this.setView('iso', null, false);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    renderer.setAnimationLoop(() => this.#tick());
  }

  #buildLights() {
    this.hemi = new THREE.HemisphereLight('#ffffff', '#c7b99c', 1.9);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight('#fff4e3', 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 5;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  #buildFloor() {
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    // Loseta visible del área de construcción (también sirve para el raycast)
    this.floorMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.floor = new THREE.Mesh(plane, this.floorMaterial);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Sólo sombra, para exportar con fondo transparente
    this.shadowCatcher = new THREE.Mesh(plane, new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.position.y = 0.001;
    this.shadowCatcher.visible = false;
    this.scene.add(this.shadowCatcher);

    // Plano del espejo (x = 0)
    this.mirrorPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: '#ff5fa2', transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.mirrorPlane.visible = false;
    this.scene.add(this.mirrorPlane);

    this.helpers.push(this.floor, this.mirrorPlane);
  }

  setGridSize(n) {
    this.gridSize = n;
    this.floor.scale.set(n, 1, n);
    this.shadowCatcher.scale.set(n * 3, 1, n * 3);
    this.mirrorPlane.scale.set(1, n, n);
    this.mirrorPlane.position.y = n / 2;

    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
      this.helpers = this.helpers.filter((h) => h !== this.grid);
    }
    this.grid = new THREE.GridHelper(n, n, '#000000', '#000000');
    this.grid.material.transparent = true;
    this.grid.material.opacity = n > 48 ? 0.07 : 0.12;
    this.grid.material.depthWrite = false;
    this.grid.position.y = 0.003;
    this.grid.visible = this.showGrid ?? true;
    this.scene.add(this.grid);
    this.helpers.push(this.grid);

    const s = this.sun.shadow.camera;
    s.left = s.bottom = -n * 0.9;
    s.right = s.top = n * 0.9;
    s.near = 0.5;
    s.far = n * 5;
    s.updateProjectionMatrix();
    this.#placeSun();
    this.controls.maxDistance = Math.max(400, n * 8);
    this.camera.far = Math.max(2000, n * 20);
    this.camera.updateProjectionMatrix();
  }

  /** Aplica la luz de la escena (ver LIGHT_PRESETS). Devuelve la luz ya validada. */
  setLighting(light) {
    const l = normalizeLight(light);
    this.lighting = l;
    this.hemi.color.set(l.amb);
    this.hemi.groundColor.set(l.ground);
    this.hemi.intensity = l.ambI;
    this.sun.color.set(l.sun);
    this.sun.intensity = l.sunI;
    this.sun.castShadow = l.shadows;
    this.sun.shadow.radius = l.soft;
    this.#placeSun();
    return l;
  }

  /** El sol gira alrededor del centro de la cuadrícula según su giro y altura. */
  #placeSun() {
    this.sun.position.set(...sunPosition(this.lighting ?? normalizeLight(null), this.gridSize ?? 24));
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  setGridVisible(v) {
    this.showGrid = v;
    this.grid.visible = v;
  }

  setMirrorVisible(v) {
    this.mirrorPlane.visible = v;
  }

  setBackground(name) {
    const bg = BACKGROUNDS[name] ?? BACKGROUNDS.pradera;
    this.backgroundName = name in BACKGROUNDS ? name : 'pradera';
    this.backgroundColor = bg.color;
    this.scene.background = new THREE.Color(bg.color);
    const dark = name === 'noche';
    this.floorMaterial.color.set(bg.color).lerp(new THREE.Color(dark ? '#4a5266' : '#ffffff'), dark ? 0.5 : 0.28);
    this.grid?.material.color.set(dark ? '#ffffff' : '#000000');
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Dirección actual de la cámara (desde el objetivo hacia la cámara). */
  viewDirection() {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  setView(name, bounds, animate = true) {
    this.#fit(VIEWS[name].clone().normalize(), bounds, animate);
  }

  frame(bounds) {
    this.#fit(this.viewDirection(), bounds, true);
  }

  #fit(dir, bounds, animate) {
    let center;
    let radius;
    if (bounds) {
      const box = new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      center = sphere.center;
      radius = Math.max(sphere.radius, 4);
    } else {
      center = new THREE.Vector3(0, 2, 0);
      radius = this.gridSize * 0.42;
    }
    const fov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    let dist = (radius / Math.sin(fov)) * 1.45;
    if (this.camera.aspect < 1) dist /= this.camera.aspect;
    const pos = center.clone().addScaledVector(dir, dist);

    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(center);
      this.controls.update();
      return;
    }
    this.anim = {
      t0: performance.now(),
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pos,
      toTarget: center,
    };
  }

  /** Oculta ayudas y prepara la escena para exportar. Devuelve la función que restaura. */
  prepareExport({ transparent = true, shadow = true, background } = {}) {
    const saved = this.helpers.map((o) => [o, o.visible]);
    this.helpers.forEach((o) => { o.visible = false; });
    const prevBg = this.scene.background;
    this.scene.background = transparent ? null : new THREE.Color(background ?? this.backgroundColor);
    this.shadowCatcher.visible = shadow;
    return () => {
      saved.forEach(([o, v]) => { o.visible = v; });
      this.scene.background = prevBg;
      this.shadowCatcher.visible = false;
    };
  }

  #tick() {
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / 380);
      const e = 1 - (1 - t) ** 3;
      this.camera.position.lerpVectors(this.anim.fromPos, this.anim.toPos, e);
      this.controls.target.lerpVectors(this.anim.fromTarget, this.anim.toTarget, e);
      if (t === 1) this.anim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
