import * as THREE from 'three';

// Imágenes guía (como los "image planes" de Maya): frente, lado y atrás.
// Modo 'wall': en las paredes de la cuadrícula. Modo 'cross': cruzadas en el centro.
export const REF_SLOTS = {
  front: { label: 'Frente' },
  side: { label: 'Lado' },
  back: { label: 'Atrás' },
};

const MAX_PX = 1600;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(blob);
  });
}

/** Reduce la imagen (máx. 1600 px) para no llenar el almacenamiento. */
export async function prepareImage(file) {
  const img = await loadImage(file);
  const k = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && file.size < 1.5e6) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
}

const plane = new THREE.PlaneGeometry(1, 1);

export class ReferenceLayer extends EventTarget {
  constructor(stage) {
    super();
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.renderOrder = -1;
    stage.scene.add(this.group);
    stage.helpers.push(this.group);
    this.opacity = 0.6;
    this.mode = 'wall';
    this.visible = true;
    /** slot -> { blob, url, aspect, height, x, y, flip, mesh } */
    this.slots = {};
  }

  get isEmpty() { return Object.keys(this.slots).length === 0; }

  async setImage(slot, blob, settings = {}) {
    const img = await loadImage(blob);
    this.#dispose(slot);
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.Mesh(plane, material);
    mesh.renderOrder = -1;
    this.group.add(mesh);
    this.slots[slot] = {
      blob, url: img.src, aspect: img.naturalWidth / img.naturalHeight,
      height: 16, x: 0, y: 0, flip: false, ...settings, mesh,
    };
    this.update();
  }

  set(slot, props) {
    if (!this.slots[slot]) return;
    Object.assign(this.slots[slot], props);
    this.update();
  }

  setGlobal({ opacity = this.opacity, mode = this.mode, visible = this.visible }) {
    Object.assign(this, { opacity, mode, visible });
    this.update();
  }

  remove(slot) {
    this.#dispose(slot);
    this.update();
  }

  clear() {
    Object.keys(this.slots).forEach((s) => this.#dispose(s));
    this.opacity = 0.6;
    this.mode = 'wall';
    this.visible = true;
    this.update();
  }

  update() {
    const half = this.stage.gridSize / 2;
    const cross = this.mode === 'cross';
    this.group.visible = this.visible;

    for (const [slot, r] of Object.entries(this.slots)) {
      const { mesh } = r;
      const w = r.height * r.aspect;
      // Normal del plano, su "derecha" en pantalla y su posición base
      let normal; let right; let base;
      if (slot === 'front') {
        normal = [0, 0, 1]; right = [1, 0, 0]; base = [0, 0, cross ? 0 : -half - 0.02];
      } else if (slot === 'back') {
        normal = [0, 0, -1]; right = [-1, 0, 0]; base = [0, 0, cross ? 0 : half + 0.02];
      } else {
        normal = [1, 0, 0]; right = [0, 0, -1]; base = [cross ? 0 : -half - 0.02, 0, 0];
      }
      mesh.position.set(
        base[0] + right[0] * r.x,
        r.y + r.height / 2,
        base[2] + right[2] * r.x,
      );
      mesh.lookAt(mesh.position.x + normal[0], mesh.position.y, mesh.position.z + normal[2]);
      mesh.scale.set(w, r.height, 1);

      const tex = mesh.material.map;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = r.flip ? -1 : 1;
      tex.offset.x = r.flip ? 1 : 0;

      // Frente y atrás comparten plano en cruz: cada uno se ve sólo desde su lado.
      // El lado no tiene pareja, así que se ve desde ambos.
      mesh.material.side = cross && slot === 'side' ? THREE.DoubleSide : THREE.FrontSide;
      mesh.material.opacity = this.opacity;
      mesh.material.needsUpdate = true;
    }
    this.dispatchEvent(new Event('change'));
  }

  serialize() {
    const slots = {};
    for (const [slot, { blob, height, x, y, flip }] of Object.entries(this.slots)) {
      slots[slot] = { blob, height, x, y, flip };
    }
    return { opacity: this.opacity, mode: this.mode, visible: this.visible, slots };
  }

  async load(data) {
    this.clear();
    if (!data) return;
    this.opacity = data.opacity ?? 0.6;
    this.mode = data.mode === 'cross' ? 'cross' : 'wall';
    this.visible = data.visible ?? true;
    for (const [slot, { blob, ...settings }] of Object.entries(data.slots ?? {})) {
      if (slot in REF_SLOTS && blob instanceof Blob) {
        try { await this.setImage(slot, blob, settings); } catch { /* imagen dañada: se omite */ }
      }
    }
    this.update();
  }

  #dispose(slot) {
    const r = this.slots[slot];
    if (!r) return;
    this.group.remove(r.mesh);
    r.mesh.material.map.dispose();
    r.mesh.material.dispose();
    URL.revokeObjectURL(r.url);
    delete this.slots[slot];
  }
}
