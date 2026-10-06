import './style.css';
import * as THREE from 'three';
import { Stage, BACKGROUNDS } from './stage.js';
import { Editor, TOOLS } from './editor.js';
import { VoxelModel, GRID_SIZES, PIECES, parseKey, parseVoxel, pieceWorldBoxes } from './model.js';
import { store, refStore, isQuotaError } from './storage.js';
import { ReferenceLayer, REF_SLOTS, prepareImage } from './references.js';
import { WorkPlane, PLANE_AXES } from './workplane.js';
import { SelectionGizmo } from './gizmo.js';
import { BEVELS, setBevel } from './voxel-mesh.js';
import {
  renderModelImage, renderStandalone, exportGLB, download, dataURLToBlob, slugify, ISO_DIRECTION,
} from './exporter.js';
import { PALETTE } from './palette.js';
import { listExamples, loadExample, thumbUrl } from './examples.js';
import { STICKERS, drawSticker } from './stickers.js';
import { icon, mountIcons } from './icons.js';
import { convertTitles, initTooltips } from './tooltip.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- herramientas (se generan antes de montar iconos) ----------
$('#tools').innerHTML = Object.entries(TOOLS).map(([id, t]) => `
  <button class="tool" data-tool="${id}" data-icon="${id}" data-tip="${t.label}" data-key="${t.key.toUpperCase()}" data-desc="${t.desc}" aria-label="${t.label}">
    <kbd>${t.key.toUpperCase()}</kbd>
  </button>`).join('');
mountIcons();
convertTitles();
const tooltips = initTooltips();

const stage = new Stage($('#viewport'));
const editor = new Editor(stage);
const refs = new ReferenceLayer(stage);
const workplane = new WorkPlane(stage);
editor.workplane = workplane;
const gizmo = new SelectionGizmo(stage, editor);
gizmo.addEventListener('blocked', () => toast('No cabe ahí: choca con otra pieza o sale de la cuadrícula'));
gizmo.addEventListener('size', (e) => {
  $('#stat-hover').textContent = e.detail ? `Tamaño ${e.detail.map((v) => +v.toFixed(2)).join(' × ')}` : '';
});
gizmo.addEventListener('mode', () => {
  document.querySelectorAll('#gizmo-mode [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === gizmo.mode));
  prefs.gizmoMode = gizmo.mode;
  store.savePrefs(prefs);
});
$('#gizmo-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) gizmo.setMode(b.dataset.mode);
});

// La píldora sigue a la selección en pantalla (debajo de ella)
const _anchor = new THREE.Vector3();
const _corner = new THREE.Vector3();
// Caja (en el mundo) de las piezas seleccionadas; se recalcula sólo cuando cambia algo
let selBox = null;
const markSelBox = () => { selBox = null; };
editor.addEventListener('selection', markSelBox);
editor.addEventListener('change', markSelBox);
function selectionBox() {
  if (selBox) return selBox;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const k of editor.selection) {
    const v = editor.model.voxels.get(k);
    if (!v) continue;
    for (const [m, s] of pieceWorldBoxes(parseKey(k), parseVoxel(v))) {
      m.forEach((c, i) => { min[i] = Math.min(min[i], c); max[i] = Math.max(max[i], c + s[i]); });
    }
  }
  selBox = min[0] === Infinity ? [] : [min, max];
  return selBox;
}
function placeSelectBar() {
  requestAnimationFrame(placeSelectBar);
  const bar = $('#select-bar');
  if (bar.hidden) return;
  const vp = $('#viewport');
  const w = vp.clientWidth;
  const h = vp.clientHeight;
  const toScreen = (v) => { _anchor.copy(v).project(stage.camera); return [((_anchor.x + 1) / 2) * w, ((1 - _anchor.y) / 2) * h]; };
  let x;
  let top;
  let bottom;
  if (editor.selected) {
    [x, top] = toScreen(editor.frames[0].position);
    bottom = top + 24;
    top -= 24;
  } else {
    // Rectángulo en pantalla de toda la selección
    const [min, max] = selectionBox();
    if (!min) return;
    let x0 = Infinity; let x1 = -Infinity;
    top = Infinity; bottom = -Infinity;
    for (let i = 0; i < 8; i++) {
      const [sx, sy] = toScreen(_corner.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]));
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      top = Math.min(top, sy); bottom = Math.max(bottom, sy);
    }
    x = (x0 + x1) / 2;
    // Que tampoco tape las flechas o aros del gizmo
    if (gizmo.controls.object) {
      const [, py] = toScreen(gizmo.pivot.position);
      top = Math.min(top, py - 110);
      bottom = Math.max(bottom, py + 110);
    }
  }
  const bh = bar.offsetHeight;
  const gap = 14;
  // Abajo de la selección; si no cabe, arriba
  let y = bottom + gap;
  if (y + bh > h - 8 && top - gap - bh >= 8) y = top - gap - bh;
  const half = bar.offsetWidth / 2;
  bar.style.left = `${Math.min(w - half - 8, Math.max(half + 8, x))}px`;
  bar.style.top = `${Math.min(h - bh - 8, Math.max(8, y))}px`;
}
placeSelectBar();
const prefs = store.prefs();
gizmo.setMode(['none', 'translate', 'rotate', 'scale'].includes(prefs.gizmoMode) ? prefs.gizmoMode : 'none');

const current = { id: null, name: '' };
const nameInput = $('#model-name');
const saveStatus = $('#save-status');

// ---------- toasts ----------
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- guardado ----------
let saveTimer = null;

function makeThumb() {
  return renderModelImage(stage, editor.model, {
    size: 192, shadow: false, direction: ISO_DIRECTION, margin: 0.03, type: 'image/webp', quality: 0.85,
  }).url;
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!current.id) return false;
  try {
    store.save({ id: current.id, name: current.name, data: { ...editor.model.serialize(), bevel: prefs.bevel ?? 'soft' }, thumb: makeThumb() });
    store.currentId = current.id;
    saveStatus.textContent = 'Guardado';
    return true;
  } catch (err) {
    saveStatus.textContent = 'Sin guardar';
    toast(isQuotaError(err) ? 'El almacenamiento está lleno: borra figuras o exporta a .json' : 'No se pudo guardar', 'error');
    console.error(err);
    return false;
  }
}

function scheduleSave() {
  saveStatus.textContent = 'Guardando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });

// ---------- abrir / crear ----------
function openModel(id) {
  if (saveTimer) saveNow();
  const data = store.load(id);
  if (!data) return false;
  let model;
  try {
    model = VoxelModel.deserialize(data);
  } catch {
    toast('Esa figura está dañada', 'error');
    return false;
  }
  current.id = id;
  current.name = store.entry(id)?.name ?? 'Sin título';
  store.currentId = id;
  editor.load(model);
  nameInput.value = current.name;
  saveStatus.textContent = 'Guardado';
  stage.setView('iso', model.bounds(), false);
  loadRefs(id);
  return true;
}

function createModel(name, model = new VoxelModel(24)) {
  if (saveTimer) saveNow();
  current.id = store.newId();
  current.name = name;
  editor.load(model);
  nameInput.value = name;
  stage.setView('iso', model.bounds(), false);
  loadRefs(null);
  saveNow();
}

function nextUntitled() {
  const names = new Set(store.list().map((e) => e.name));
  let n = 1;
  while (names.has(`Figura ${n}`)) n++;
  return `Figura ${n}`;
}

// ---------- sincronizar interfaz ----------
function syncTools() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === editor.tool));
  syncPanels();
  syncSelectBar();
  $('#btn-mirror').classList.toggle('active', editor.mirror);
}

function swatchHTML(c, extra = '') {
  return `<button class="swatch ${c === editor.color ? 'selected' : ''} ${extra}" data-color="${c}" style="background:${c}" title="${c.toUpperCase()}"></button>`;
}

/** El panel muestra el color de lo seleccionado; si no hay selección, el de construir. */
function syncColor() {
  const c = editor.shownColor;
  const mixed = c === 'mixed';
  syncOpacity();
  const sw = $('#current-swatch');
  sw.classList.toggle('mixed', mixed);
  sw.style.background = mixed ? '' : c;
  if (!mixed) $('#color-input').value = c;
  if (document.activeElement !== $('#hex-input')) {
    $('#hex-input').value = mixed ? '' : c.toUpperCase();
    $('#hex-input').placeholder = mixed ? 'Varios' : '';
  }
  document.querySelectorAll('.swatch[data-color]').forEach((s) => s.classList.toggle('selected', !mixed && s.dataset.color === c));
}

function renderPalette() {
  $('#palette').innerHTML = PALETTE.map((c) => swatchHTML(c)).join('');
}

function renderRecent() {
  // Cada reciente lleva una × para quitarlo de la lista (no cambia la figura)
  $('#recent').innerHTML = prefs.recent.map((c) => `<span class="recent-item">${swatchHTML(c)}`
    + `<button class="recent-x" data-remove="${c}" aria-label="Quitar ${c.toUpperCase()} de recientes">${icon('x')}</button></span>`).join('');
  $('#recent-section').hidden = prefs.recent.length === 0;
}

function removeRecent(c) {
  prefs.recent = c ? prefs.recent.filter((r) => r !== c) : [];
  store.savePrefs(prefs);
  renderRecent();
}
$('#recent').addEventListener('click', (e) => {
  const x = e.target.closest('[data-remove]');
  if (x) removeRecent(x.dataset.remove);
});
$('#recent-clear').addEventListener('click', () => removeRecent(null));

function addRecent(c) {
  if (PALETTE.includes(c)) return;
  prefs.recent = [c, ...prefs.recent.filter((r) => r !== c)].slice(0, 12);
  store.savePrefs(prefs);
  renderRecent();
}

function renderModelColors() {
  const colors = editor.model.colors();
  $('#model-colors').innerHTML = colors.map((c) => swatchHTML(c)).join('');
  $('#model-colors-empty').hidden = colors.length > 0;
}

function syncModel() {
  const n = editor.model.count;
  $('#stat-count').textContent = `${n} ${n === 1 ? 'cubo' : 'cubos'}`;
  $('#btn-undo').disabled = !editor.canUndo;
  $('#btn-redo').disabled = !editor.canRedo;
  syncGridSize();
  renderModelColors();
}

// ---------- calcomanías ----------
function renderStickers() {
  $('#sticker-grid').innerHTML = Object.entries(STICKERS).map(([id, st]) => `
    <button class="sticker-btn ${id === editor.stickerId ? 'active' : ''}" data-sticker="${id}" title="${st.label}">
      <img src="${drawSticker(id, editor.color, false, 96).toDataURL()}" alt="${st.label}">
    </button>`).join('');
}

$('#sticker-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sticker]');
  if (!b) return;
  editor.setSticker({ id: b.dataset.sticker });
  // Con el puntero se está editando la seleccionada: no cambiar de herramienta
  if (editor.tool !== 'select') editor.setTool('sticker');
});
editor.addEventListener('sticker', renderStickers);
editor.addEventListener('selection', () => {
  syncPanels();
  syncSelectBar();
});

/** Muestra en el panel lo que corresponde a la herramienta / selección actual. */
function syncPanels() {
  // Con el puntero sólo aparece lo que corresponde a lo seleccionado (nada si no hay selección)
  const selecting = editor.tool === 'select';
  const stickerSelected = selecting && !!editor.selected;
  const piecesSelected = selecting && !stickerSelected && editor.selection.size > 0;
  $('#sticker-section').hidden = !(editor.tool === 'sticker' || stickerSelected);
  $('#piece-section').hidden = !(['build', 'box'].includes(editor.tool) || piecesSelected);
}

// ---------- barra de selección (herramienta Seleccionar) ----------
function syncSelectBar() {
  const n = editor.selection.size;
  const sticker = editor.tool === 'select' && editor.selected;
  const show = editor.tool === 'select' && (n > 0 || sticker);
  $('#select-bar').hidden = !show;
  if (!show) return;
  // Número de piezas (y calcomanías que van con ellas) cuando hay más de una cosa
  const ns = sticker ? 0 : editor.attachedStickers.length;
  $('#select-count').textContent = !sticker && n + ns > 1 ? (ns ? `${n} + ${ns}` : n) : '';
  if (ns) $('#select-count').dataset.tip = `${n} ${n === 1 ? 'pieza' : 'piezas'} y ${ns} ${ns === 1 ? 'calcomanía' : 'calcomanías'}`;
  else delete $('#select-count').dataset.tip;
  // Calcomanías: Mover y Escalar (no se giran)
  $('#gizmo-mode [data-mode="rotate"]').hidden = !!sticker;
  $('#sel-copy').hidden = !!sticker;
  $('#sel-group').hidden = !!sticker || !editor.canGroup;
  $('#sel-merge').hidden = !!sticker || !editor.canMerge;
  $('#sel-split').hidden = !!sticker || !editor.canSplit;
  $('#sel-ungroup').hidden = !!sticker || !editor.canUngroup;
  $('#sel-duplicate').hidden = !!sticker;
  if (sticker && gizmo.mode === 'rotate') gizmo.setMode('translate');
  // Escalar: una pieza a la vez
  const scaleBtn = $('#gizmo-mode [data-mode="scale"]');
  scaleBtn.disabled = !sticker && n !== 1;
  scaleBtn.dataset.desc = sticker ? 'Arrastra una orilla de la calcomanía para agrandarla o achicarla hacia ese lado.'
    : n === 1 ? 'Caras: crece hacia ese lado. Esquinas amarillas: crece parejo en diagonal. Pasos de 0.1.' : 'Selecciona una sola pieza para escalarla.';
  tooltips.refresh(scaleBtn);
  if (!sticker && n > 1 && gizmo.mode === 'scale') gizmo.setMode('translate');
}

$('#sel-delete').addEventListener('click', () => (editor.selected ? editor.deleteSelected() : editor.deleteSelection()));
editor.addEventListener('notice', (e) => toast(e.detail));
editor.addEventListener('color', renderStickers);

editor.addEventListener('tool', syncTools);
editor.addEventListener('mirror', syncTools);
editor.addEventListener('color', syncColor);
editor.addEventListener('load', syncModel);
editor.addEventListener('change', () => {
  syncModel();
  scheduleSave();
  $('#hint').style.opacity = editor.model.count > 3 ? '0' : '1';
});
editor.addEventListener('hover', (e) => {
  const d = e.detail;
  let text = '';
  if (d?.box) text = `Caja ${d.box.join(' × ')} · rueda = altura`;
  else if (d?.cell) text = `x ${d.cell[0]} · y ${d.cell[1]} · z ${d.cell[2]}${d.label ? ` · ${d.label}` : ''}`;
  else if (d?.label) text = d.label;
  $('#stat-hover').textContent = text;
});

// ---------- controles del panel ----------
document.addEventListener('click', (e) => {
  const sw = e.target.closest('.swatch[data-color]');
  if (sw) {
    editor.setColor(sw.dataset.color);
    if (editor.tool === 'erase' || editor.tool === 'pick') editor.setTool('build');
  }
});

let opacityDragging = false;

/** El slider muestra la opacidad de la pieza seleccionada (o la de construir si no hay). */
function syncOpacity() {
  const o = Math.round(editor.shownOpacity * 100);
  if (!opacityDragging) $('#opacity').value = o;
  $('#opacity-value').textContent = `${o}%`;
}
editor.addEventListener('selection', syncColor);
editor.addEventListener('change', () => { if (editor.selection.size || editor.selected) syncColor(); });
editor.addEventListener('change', syncOpacity);

// Opacidad: mientras se arrastra se ve en vivo; al soltar queda como un solo paso de deshacer
$('#opacity').addEventListener('input', (e) => {
  opacityDragging = true;
  editor.setOpacity(Number(e.target.value) / 100, { live: true });
});
$('#opacity').addEventListener('change', (e) => {
  opacityDragging = false;
  editor.setOpacity(Number(e.target.value) / 100);
});
$('#color-input').addEventListener('input', (e) => editor.setColor(e.target.value));
$('#color-input').addEventListener('change', (e) => addRecent(e.target.value.toLowerCase()));
$('#hex-input').addEventListener('input', (e) => {
  let v = e.target.value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{6}$/i.test(v)) editor.setColor(v);
});
$('#hex-input').addEventListener('change', () => {
  $('#hex-input').value = editor.color.toUpperCase();
  addRecent(editor.color);
});

$('#tools').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) editor.setTool(b.dataset.tool);
});
$('#btn-mirror').addEventListener('click', () => editor.setMirror(!editor.mirror));
function toggleEdges() {
  prefs.showEdges = !editor.showEdges;
  store.savePrefs(prefs);
  applyPrefs();
}
$('#btn-edges').addEventListener('click', toggleEdges);
$('#btn-undo').addEventListener('click', () => editor.undo());
$('#btn-redo').addEventListener('click', () => editor.redo());

// Confirmación con el mismo estilo de la app (en lugar de confirm() del navegador)
function confirmDialog({ title, message, ok = 'Eliminar' }) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = ok;
  d.showModal();
  $('#confirm-cancel').focus();
  return new Promise((resolve) => {
    const done = (v) => {
      d.close();
      $('#confirm-ok').onclick = null;
      $('#confirm-cancel').onclick = null;
      d.onclose = null;
      resolve(v);
    };
    $('#confirm-ok').onclick = () => done(true);
    $('#confirm-cancel').onclick = () => done(false);
    d.onclose = () => resolve(false);
  });
}

$('#btn-clear').addEventListener('click', async () => {
  if (!editor.model.count) return;
  const ok = await confirmDialog({
    title: '¿Vaciar la figura?', message: 'Se quitan todas las piezas. Puedes deshacerlo con Ctrl+Z.', ok: 'Vaciar',
  });
  if (ok) editor.clear();
});

// Selectores de Escena: un botón que abre su cajita de opciones
function closePops(except = null) {
  document.querySelectorAll('.picker .pop').forEach((p) => { if (p !== except) p.hidden = true; });
}
document.querySelectorAll('.picker > button').forEach((btn) => btn.addEventListener('click', () => {
  const pop = btn.nextElementSibling;
  closePops(pop);
  pop.hidden = !pop.hidden;
}));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.picker')) closePops(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(); });

$('#grid-size').innerHTML = GRID_SIZES.map((s) =>
  `<button class="chip" role="radio" data-size="${s}" data-tip="${s} × ${s} × ${s}" data-tip-delay="300">${s}</button>`).join('');
function syncGridSize() {
  document.querySelectorAll('#grid-size [data-size]').forEach((b) => {
    const on = Number(b.dataset.size) === editor.model.size;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
}
$('#grid-size').addEventListener('click', (e) => {
  const b = e.target.closest('[data-size]');
  if (!b) return;
  const size = Number(b.dataset.size);
  if (size === editor.model.size) return;
  if (!editor.setGridSize(size)) {
    toast('La figura no cabe en esa cuadrícula: céntrala o recórtala primero', 'error');
    return;
  }
  syncGridSize();
  refs.update();
  workplane.update();
  stage.setView('iso', editor.model.bounds());
});

// Fondo: botón con el actual; al darle clic sale la paleta
$('#bg-options').innerHTML = Object.entries(BACKGROUNDS).map(([id, b]) =>
  `<button class="swatch" data-bg="${id}" style="background:${b.color}" data-tip="${b.label}" data-tip-delay="300"></button>`).join('');
$('#bg-options').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bg]');
  if (!b) return;
  prefs.background = b.dataset.bg;
  store.savePrefs(prefs);
  closePops();
  applyPrefs();
});

$('#bevel-mode').innerHTML = Object.entries(BEVELS).map(([id, b]) =>
  `<button class="seg" data-bevel="${id}" data-tip="${b.label}" data-tip-delay="300" aria-label="${b.label}">${icon(`bevel-${id}`)}</button>`).join('');
$('#bevel-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bevel]');
  if (!b) return;
  prefs.bevel = b.dataset.bevel;
  store.savePrefs(prefs);
  applyPrefs();
  // Las orillas viajan con la figura (al guardar, exportar e importar)
  editor.model.bevel = prefs.bevel;
  scheduleSave();
});
// Al abrir o importar una figura que trae sus orillas, se usan ésas
editor.addEventListener('load', () => {
  const b = editor.model.bevel;
  if (b && b !== (prefs.bevel ?? 'soft')) {
    prefs.bevel = b;
    store.savePrefs(prefs);
    applyPrefs();
  }
  editor.model.bevel = prefs.bevel ?? 'soft';
});

$('#show-grid').addEventListener('change', (e) => {
  prefs.showGrid = e.target.checked;
  store.savePrefs(prefs);
  applyPrefs();
});

function applyPrefs() {
  syncEdges();
  stage.setBackground(prefs.background);
  stage.setGridVisible(prefs.showGrid);
  $('#show-grid').checked = prefs.showGrid;
  if (setBevel(prefs.bevel)) editor.redraw();
  document.querySelectorAll('[data-bevel]').forEach((b) => b.classList.toggle('active', b.dataset.bevel === (prefs.bevel in BEVELS ? prefs.bevel : 'soft')));
  document.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('selected', b.dataset.bg === stage.backgroundName));
  $('#bg-dot').style.background = BACKGROUNDS[stage.backgroundName]?.color ?? '';
  $('#bg-name').textContent = BACKGROUNDS[stage.backgroundName]?.label ?? '';
  if (editor.showEdges !== !!prefs.showEdges) editor.setEdges(prefs.showEdges);
  $('#btn-edges').classList.toggle('active', editor.showEdges);
}

// ---------- barras laterales: ocultar / mostrar (se recuerda) ----------
function syncEdges() {
  $('#app').classList.toggle('no-tools', !!prefs.hideTools);
  $('#app').classList.toggle('no-panel', !!prefs.hidePanel);
  const t = $('#toggle-tools');
  const p = $('#toggle-panel');
  t.innerHTML = icon(prefs.hideTools ? 'chevronRight' : 'chevronLeft');
  p.innerHTML = icon(prefs.hidePanel ? 'chevronLeft' : 'chevronRight');
  t.dataset.tip = prefs.hideTools ? 'Mostrar herramientas' : 'Ocultar herramientas';
  p.dataset.tip = prefs.hidePanel ? 'Mostrar panel de colores' : 'Ocultar panel de colores';
  tooltips.refresh(t);
  tooltips.refresh(p);
}
$('#toggle-tools').addEventListener('click', () => {
  prefs.hideTools = !prefs.hideTools;
  store.savePrefs(prefs);
  syncEdges();
});
$('#toggle-panel').addEventListener('click', () => {
  prefs.hidePanel = !prefs.hidePanel;
  store.savePrefs(prefs);
  syncEdges();
});

nameInput.addEventListener('change', () => {
  current.name = nameInput.value.trim() || 'Sin título';
  nameInput.value = current.name;
  saveNow();
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

document.querySelector('.views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  if (b.dataset.view === 'frame') stage.frame(editor.model.bounds());
  else stage.setView(b.dataset.view, editor.model.bounds());
});

// ---------- modales ----------
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});

// Galería
function formatDate(t) {
  return new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderGallery() {
  if (saveTimer) saveNow();
  const list = store.list();
  const kb = Math.round(store.usage() / 1024);
  $('#gallery-note').textContent = `${list.length} ${list.length === 1 ? 'figura' : 'figuras'} · ${kb} KB usados`;
  $('#gallery').innerHTML = list.length ? list.map((e) => `
    <div class="card ${e.id === current.id ? 'current' : ''}" data-id="${e.id}" tabindex="0">
      <div class="thumb checker">${e.thumb ? `<img src="${e.thumb}" alt="">` : ''}</div>
      <div class="meta">
        <div class="name">${esc(e.name)}</div>
        <div class="muted small">${e.count} piezas · ${formatDate(e.updatedAt)}</div>
      </div>
      <div class="actions">
        <button class="btn" data-action="duplicate" title="Duplicar">${icon('copy')}</button>
        <button class="btn" data-action="delete" title="Eliminar">${icon('trash')}</button>
      </div>
    </div>`).join('') : '<div class="gallery-empty">Aún no tienes figuras.</div>';
}

$('#gallery').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const { id } = card.dataset;
  const action = e.target.closest('[data-action]')?.dataset.action;
  const entry = store.entry(id);

  if (action === 'duplicate') {
    const data = store.load(id);
    try {
      const newId = store.newId();
      store.save({ id: newId, name: `${entry.name} (copia)`, data, thumb: entry.thumb });
      flushRefs();
      refStore.get(id).then((r) => r && refStore.set(newId, r));
    } catch (err) {
      toast(isQuotaError(err) ? 'Almacenamiento lleno' : 'No se pudo duplicar', 'error');
    }
    renderGallery();
  } else if (action === 'delete') {
    const ok = await confirmDialog({
      title: `¿Eliminar "${entry.name}"?`, message: 'La figura se borra de este navegador. No se puede deshacer.',
    });
    if (!ok) return;
    store.remove(id);
    refStore.remove(id);
    if (id === current.id) {
      clearTimeout(refsSave.timer);
      refsSave.timer = null;
      clearTimeout(saveTimer);
      saveTimer = null;
      const next = store.list()[0];
      if (!next || !openModel(next.id)) createModel(nextUntitled());
    }
    renderGallery();
  } else {
    openModel(id);
    $('#gallery-dialog').close();
  }
});
$('#gallery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('card')) e.target.click();
});

// Ejemplos (public/ejemplos/*.json): abrir uno crea una copia; el original no se toca.
// Si un ejemplo no trae miniatura, se dibuja una vez y se recuerda mientras la página esté abierta.
const drawnThumbs = new Map();

async function renderExamples() {
  const list = await listExamples();
  $('#examples').innerHTML = list.length ? list.map((ex) => {
    const src = thumbUrl(ex) ?? drawnThumbs.get(ex.id)?.url ?? '';
    const info = drawnThumbs.get(ex.id);
    const size = ex.size ?? info?.size;
    const pieces = ex.pieces ?? info?.pieces;
    return `<div class="card example" data-example="${ex.id}" tabindex="0" title="Abrir una copia de ${esc(ex.name)}">
      <div class="thumb">${src ? `<img src="${src}" alt="">` : ''}</div>
      <span class="badge">${size ? `${size}×${size}` : 'Ejemplo'}</span>
      <div class="meta"><div class="name">${esc(ex.name)}</div><div class="muted small">${pieces != null ? `${pieces.toLocaleString('es')} piezas` : '&nbsp;'}</div></div>
    </div>`;
  }).join('') : '<div class="gallery-empty">No se encontraron ejemplos.</div>';

  // Miniaturas que faltan: se dibujan una por una sin bloquear
  for (const ex of list) {
    if (thumbUrl(ex) || drawnThumbs.has(ex.id)) continue;
    try {
      const model = await loadExample(ex);
      drawnThumbs.set(ex.id, { url: renderStandalone(model), size: model.size, pieces: model.count });
      const card = $(`#examples [data-example="${ex.id}"]`);
      if (card) {
        card.querySelector('.thumb').innerHTML = `<img src="${drawnThumbs.get(ex.id).url}" alt="">`;
        card.querySelector('.badge').textContent = `${model.size}×${model.size}`;
        card.querySelector('.meta .small').textContent = `${model.count.toLocaleString('es')} piezas`;
      }
    } catch { /* ejemplo dañado o ausente: se queda sin miniatura */ }
  }
}

$('#examples').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-example]')?.dataset.example;
  const ex = (await listExamples()).find((x) => x.id === id);
  if (!ex) return;
  try {
    createModel(ex.name, await loadExample(ex));
  } catch {
    toast('No se pudo abrir ese ejemplo', 'error');
    return;
  }
  $('#gallery-dialog').close();
  toast(`Copia de "${ex.name}" creada: edítala libremente`);
});
$('#examples').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('card')) e.target.click();
});

/** Galería con dos pestañas separadas: Mis figuras y Ejemplos. */
function showGalleryTab(tab) {
  const examples = tab === 'examples';
  if (examples) renderExamples();
  else renderGallery();
  $('#gallery').hidden = examples;
  $('#examples').hidden = !examples;
  $('#btn-new').hidden = examples;
  document.querySelectorAll('#gallery-tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (examples) $('#gallery-note').textContent = 'Al abrir uno se crea una copia para editar';
}

function openGallery(tab = 'mine') {
  $('#gallery-dialog').showModal();
  showGalleryTab(tab);
}

$('#gallery-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) showGalleryTab(b.dataset.tab);
});
$('#btn-gallery').addEventListener('click', () => openGallery('mine'));
$('#empty-examples').addEventListener('click', () => openGallery('examples'));

// Figura vacía: un aviso con acceso a los ejemplos
function syncEmptyHint() {
  $('#empty-hint').hidden = editor.model.count > 0;
}
editor.addEventListener('change', syncEmptyHint);
editor.addEventListener('load', syncEmptyHint);
$('#btn-new').addEventListener('click', () => {
  createModel(nextUntitled());
  $('#gallery-dialog').close();
  toast('Nueva figura creada');
});

// Exportar
let lastExport = null;

function renderExportPreview() {
  const size = Number($('#export-size').value);
  lastExport = renderModelImage(stage, editor.model, {
    size,
    transparent: $('#export-transparent').checked,
    shadow: $('#export-shadow').checked,
    direction: $('#export-angle').value === 'iso' ? ISO_DIRECTION : stage.viewDirection(),
    mode: $('#export-angle').value === 'screen' ? 'screen' : 'fit',
  });
  $('#export-img').src = lastExport.url;
  $('#export-dims').textContent = `${lastExport.width} × ${lastExport.height} px`;
  $('#export-preview').classList.toggle('checker', $('#export-transparent').checked);
}

['#export-size', '#export-angle', '#export-transparent', '#export-shadow'].forEach((s) =>
  $(s).addEventListener('change', renderExportPreview));

function openExport() {
  if (!editor.model.count) {
    toast('Agrega algunos cubos antes de exportar');
    return;
  }
  renderExportPreview();
  $('#export-dialog').showModal();
}

$('#btn-export').addEventListener('click', openExport);
$('#btn-download-png').addEventListener('click', () => {
  download(lastExport.url, `${slugify(current.name)}.png`);
});
$('#btn-copy-png').addEventListener('click', async () => {
  try {
    const blob = await dataURLToBlob(lastExport.url);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Imagen copiada al portapapeles');
  } catch {
    toast('Tu navegador no permitió copiar la imagen', 'error');
  }
});
$('#btn-download-glb').addEventListener('click', async () => {
  try {
    download(await exportGLB(editor.model, current.name), `${slugify(current.name)}.glb`);
  } catch (err) {
    console.error(err);
    toast('No se pudo exportar el modelo 3D', 'error');
  }
});
$('#btn-download-json').addEventListener('click', () => {
  const data = { ...editor.model.serialize(), bevel: prefs.bevel ?? 'soft', name: current.name };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${slugify(current.name)}.cubos.json`);
});

// Importar
async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const model = VoxelModel.deserialize(data);
    const name = (typeof data.name === 'string' && data.name.trim()) || file.name.replace(/(\.cubos)?\.json$/i, '');
    createModel(name.slice(0, 40), model);
    toast(`"${name}" importada`);
  } catch {
    toast('Ese archivo no es una figura de CuboStudio', 'error');
  }
}

$('#btn-import').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importFile(file);
  e.target.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('#drop-overlay').classList.add('show');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop-overlay').classList.remove('show');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').classList.remove('show');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.type.startsWith('image/')) {
    const free = Object.keys(REF_SLOTS).find((k) => !refs.slots[k]) ?? 'front';
    const slot = e.target.closest?.('.ref-slot')?.dataset.slot ?? free;
    setRefPanel(true);
    addRefImage(slot, file);
  } else {
    importFile(file);
  }
});

// Ayuda
$('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());

// ---------- teclado ----------
const TOOL_KEYS = Object.fromEntries(Object.entries(TOOLS).map(([id, t]) => [t.key, id]));
const VIEW_KEYS = { 1: 'iso', 2: 'front', 3: 'side', 4: 'back', 5: 'top' };

window.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, select, textarea');
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (mod && key === 's') { e.preventDefault(); if (saveNow()) toast('Guardado'); return; }
  if (typing || document.querySelector('dialog[open]')) return;

  if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); editor.redo(); return; }
  if (mod && key === 'c') { if (copySelected()) e.preventDefault(); return; }
  if (mod && key === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (mod && key === 'j') { e.preventDefault(); if (e.shiftKey) splitSelected(); else mergeSelected(); return; }
  if (mod && key === 'g') {
    e.preventDefault();
    if (e.shiftKey ? editor.ungroupSelection() : editor.groupSelection()) toast(e.shiftKey ? 'Grupo deshecho' : 'Agrupado');
    return;
  }
  if (mod && key === 'e') { e.preventDefault(); openExport(); return; }
  if (mod || e.altKey) return;

  if (editor.selection.size) {
    const mv = {
      arrowleft: [-1, 0, 0], arrowright: [1, 0, 0], arrowup: [0, 0, -1], arrowdown: [0, 0, 1],
      pageup: [0, 1, 0], pagedown: [0, -1, 0],
    }[key];
    if (mv) { e.preventDefault(); editor.moveSelection(...mv); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); editor.deleteSelection(); return; }
    if (key === 'escape') { editor.clearSelection(); return; }
  }
  if (editor.selected) {
    const nudge = { arrowleft: [-0.5, 0], arrowright: [0.5, 0], arrowup: [0, 0.5], arrowdown: [0, -0.5] }[key];
    if (nudge) { e.preventDefault(); editor.moveSelected(...nudge); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); editor.deleteSelected(); return; }
    if (key === 'escape') { editor.select(null); return; }
  }

  const moves = {
    arrowleft: [-1, 0, 0], arrowright: [1, 0, 0], arrowup: [0, 0, -1], arrowdown: [0, 0, 1],
    pageup: [0, 1, 0], pagedown: [0, -1, 0],
  };
  if (moves[key]) {
    e.preventDefault();
    if (!editor.shift(...moves[key]) && editor.model.count) toast('Llegaste al borde de la cuadrícula');
    return;
  }
  if (TOOL_KEYS[key]) editor.setTool(TOOL_KEYS[key]);
  else if (VIEW_KEYS[key]) stage.setView(VIEW_KEYS[key], editor.model.bounds());
  else if (key === 'm') editor.setMirror(!editor.mirror);
  else if (key === 'l') toggleEdges();
  else if (key === 'f') stage.frame(editor.model.bounds());
  else if (key === 'g') $('#btn-gallery').click();
  else if (key === 'h') refs.setGlobal({ visible: !refs.visible });
  else if (key === 'v') setSpace(!workplane.enabled);
  else if (workplane.enabled && (key === 'q' || key === 'w')) workplane.step(key === 'w' ? 1 : -1);
  else if (key === '?') $('#help-dialog').showModal();
});

// ---------- forma de la pieza ----------
const PIECE_ICONS = {
  cube: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/>',
  cylinder: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/>',
  cone: '<path d="M12 3 4 18.5"/><path d="M12 3l8 15.5"/><ellipse cx="12" cy="18.5" rx="8" ry="3"/>',
  pyramid: '<path d="M12 3 3 19h18Z"/><path d="M12 3v16"/>',
  wedge: '<path d="M12 4 3 20h18Z"/>',
};

function renderPieces() {
  $('#piece-grid').innerHTML = Object.entries(PIECES).map(([id, label]) => `
    <button class="piece-btn ${id === editor.piece ? 'active' : ''}" data-piece="${id}" title="${label}" aria-label="${label}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${PIECE_ICONS[id]}</svg>
    </button>`).join('');
}
$('#piece-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-piece]');
  if (b) editor.setPiece(b.dataset.piece);
});
editor.addEventListener('piece', renderPieces);
renderPieces();

// ---------- espacio 3D ----------
$('#space-axis').innerHTML = PLANE_AXES.map((a) => `<button class="seg" data-axis="${a.axis}">${a.label}</button>`).join('');

function setSpace(on) {
  workplane.setEnabled(on);
  $('#btn-space').classList.toggle('active', on);
  $('#space-bar').hidden = !on;
  if (on) toast('Espacio 3D: clic en el plano azul para poner cubos flotantes');
}

workplane.addEventListener('change', () => {
  const { coord } = PLANE_AXES.find((a) => a.axis === workplane.axis);
  $('#space-layer').textContent = `${coord} = ${workplane.layer}`;
  document.querySelectorAll('#space-axis [data-axis]').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.axis) === workplane.axis));
  editor.refreshHover();
});
$('#space-axis').addEventListener('click', (e) => {
  const b = e.target.closest('[data-axis]');
  if (b) workplane.setAxis(Number(b.dataset.axis));
});
$('#space-down').addEventListener('click', () => workplane.step(-1));
$('#space-up').addEventListener('click', () => workplane.step(1));
$('#btn-space').addEventListener('click', () => setSpace(!workplane.enabled));
editor.addEventListener('load', () => workplane.update());

// ---------- copiar / pegar (el portapapeles se guarda: sirve entre figuras) ----------
const CLIP_KEY = 'cubostudio:clipboard';
let clipboard = (() => { try { return JSON.parse(localStorage.getItem(CLIP_KEY)); } catch { return null; } })();

function syncPaste() {
  $('#btn-paste').disabled = !clipboard?.items?.length;
}

function copySelected() {
  const clip = editor.copySelection();
  if (!clip) return false;
  clipboard = clip;
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* sólo en memoria */ }
  syncPaste();
  const n = clip.items.length;
  toast(`Copiado: ${n} ${n === 1 ? 'pieza' : 'piezas'}`);
  return true;
}

function pasteClipboard() {
  if (!clipboard?.items?.length) {
    toast('No hay nada copiado: selecciona piezas y usa Copiar');
    return;
  }
  editor.setTool('select');
  if (!editor.paste(clipboard)) toast('No cabe en esta cuadrícula: agrándala en Escena', 'error');
}

function duplicateSelected() {
  if (!editor.selection.size) return;
  if (!editor.duplicateSelection()) toast('No hay espacio para duplicar aquí', 'error');
}

$('#btn-paste').addEventListener('click', pasteClipboard);
$('#sel-copy').addEventListener('click', copySelected);
$('#sel-duplicate').addEventListener('click', duplicateSelected);
$('#sel-group').addEventListener('click', () => { if (editor.groupSelection()) toast('Agrupado'); });

function mergeSelected() {
  if (!editor.selection.size) return;
  const r = editor.mergeSelection();
  if (r.error) { toast(r.error, 'error'); return; }
  toast(r.compound ? `${r.from} piezas fusionadas en una sola pieza` : `${r.from} piezas fusionadas en un solo bloque`);
}

function splitSelected() {
  const n = editor.splitSelection();
  if (n) toast(`Separada en ${n} ${n === 1 ? 'cubo' : 'cubos'}`);
}

$('#sel-merge').addEventListener('click', mergeSelected);
$('#sel-split').addEventListener('click', splitSelected);
$('#sel-ungroup').addEventListener('click', () => { if (editor.ungroupSelection()) toast('Grupo deshecho'); });
syncPaste();

// ---------- imágenes guía ----------
const refsSave = { timer: null, id: null, loading: false };

function flushRefs() {
  if (!refsSave.timer) return;
  clearTimeout(refsSave.timer);
  refsSave.timer = null;
  refStore.set(refsSave.id, refs.serialize()).catch(() => toast('No se pudieron guardar las imágenes guía', 'error'));
}

refs.addEventListener('change', () => {
  syncRefsGlobal();
  if (refsSave.loading || !current.id) return;
  clearTimeout(refsSave.timer);
  refsSave.id = current.id;
  refsSave.timer = setTimeout(flushRefs, 400);
});

async function loadRefs(id) {
  flushRefs();
  refsSave.loading = true;
  try {
    await refs.load(id ? await refStore.get(id) : null);
  } finally {
    refsSave.loading = false;
  }
  renderRefSlots();
}

async function addRefImage(slot, file) {
  if (!file?.type.startsWith('image/')) {
    toast('Eso no es una imagen', 'error');
    return;
  }
  try {
    const blob = await prepareImage(file);
    const b = editor.model.bounds();
    const height = b ? b.max[1] : Math.round(editor.model.size * 0.75);
    await refs.setImage(slot, blob, { height });
    renderRefSlots();
  } catch {
    toast('No se pudo cargar la imagen', 'error');
  }
}

function setRefPanel(open) {
  $('#ref-panel').hidden = !open;
  $('#btn-refs').classList.toggle('active', open);
  if (open) renderRefSlots();
}

function syncRefsGlobal() {
  document.querySelectorAll('#ref-mode [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === refs.mode));
  $('#ref-opacity').value = refs.opacity;
  $('#ref-visible').checked = refs.visible;
}

function rangeField(label, prop, value, min, max, step) {
  return `<label class="field"><span>${label}</span>
    <input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function renderRefSlots() {
  const size = editor.model.size;
  $('#ref-slots').innerHTML = Object.entries(REF_SLOTS).map(([slot, { label }]) => {
    const r = refs.slots[slot];
    return `<div class="ref-slot" data-slot="${slot}">
      <div class="ref-head">
        <button class="ref-thumb ${r ? 'has' : ''}" data-action="load" data-tip="Elegir imagen" data-desc="Clic para escoger una imagen, o arrástrala aquí." aria-label="Elegir imagen"
          ${r ? `style="background-image:url('${r.url}')"` : ''}>${r ? '' : '+'}</button>
        <div><b>${label}</b><div class="muted small">${r ? 'Clic para cambiar' : 'Clic o arrastra una imagen'}</div></div>
        ${r ? `<button class="btn icon sm" data-action="remove" data-tip="Quitar imagen" aria-label="Quitar imagen">${icon('trash')}</button>` : ''}
      </div>
      ${r ? `
        ${rangeField('Altura', 'height', r.height, 1, size * 2, 0.5)}
        ${rangeField('Horizontal', 'x', r.x, -size, size, 0.25)}
        ${rangeField('Vertical', 'y', r.y, -size / 2, size, 0.25)}
        <label class="field check"><input type="checkbox" data-prop="flip" ${r.flip ? 'checked' : ''}><span>Voltear</span></label>` : ''}
    </div>`;
  }).join('');
}

let refTarget = 'front';
$('#ref-slots').addEventListener('click', (e) => {
  const slot = e.target.closest('.ref-slot')?.dataset.slot;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'load') {
    refTarget = slot;
    $('#ref-file').click();
  } else if (action === 'remove') {
    refs.remove(slot);
    renderRefSlots();
  }
});
$('#ref-slots').addEventListener('input', (e) => {
  const { prop } = e.target.dataset;
  const slot = e.target.closest('.ref-slot')?.dataset.slot;
  if (!prop || !slot) return;
  refs.set(slot, { [prop]: prop === 'flip' ? e.target.checked : Number(e.target.value) });
});
$('#ref-slots').addEventListener('dragover', (e) => {
  e.target.closest('.ref-slot')?.classList.add('drop');
});
$('#ref-slots').addEventListener('dragleave', (e) => {
  e.target.closest('.ref-slot')?.classList.remove('drop');
});
$('#ref-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) addRefImage(refTarget, file);
  e.target.value = '';
});
$('#ref-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) refs.setGlobal({ mode: b.dataset.mode });
});
$('#ref-opacity').addEventListener('input', (e) => refs.setGlobal({ opacity: Number(e.target.value) }));
$('#ref-visible').addEventListener('change', (e) => refs.setGlobal({ visible: e.target.checked }));
$('#btn-refs').addEventListener('click', () => setRefPanel($('#ref-panel').hidden));
$('#ref-close').addEventListener('click', () => setRefPanel(false));
window.addEventListener('beforeunload', flushRefs);
syncRefsGlobal();

// ---------- arranque ----------
renderPalette();
renderRecent();
renderStickers();
applyPrefs();
syncTools();
syncColor();

const startId = store.currentId;
if (!(startId && openModel(startId))) {
  const first = store.list()[0];
  if (!(first && openModel(first.id))) {
    // Primera vez: figura vacía y la ventana de ejemplos abierta (al cerrarla, a construir)
    createModel('Figura 1');
    editor.setMirror(true);
    openGallery('examples');
    $('#gallery-note').textContent = '¡Bienvenido! Abre un ejemplo para ver cómo se hace, o cierra para empezar en blanco';
  }
}

// Acceso desde la consola para depurar
window.cubo = { stage, editor, store, refs, renderStandalone, VoxelModel, setBevel };
