// Tooltips propios: nombre, tecla y una línea de descripción.
// Uso: data-tip="Nombre" [data-key="B"] [data-desc="Qué hace"] [data-tip-pos="right|bottom|top"].
// Los title="Nombre (B)" de las barras se convierten solos (la tecla sale del paréntesis).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DELAY = 1000; // aparece tras 1 s con el puntero encima

/** Pasa title -> data-tip (el título nativo se ve feo y llega tarde). */
export function convertTitles(root = document) {
  root.querySelectorAll('[title]').forEach((el) => {
    if (el.closest('.panel, dialog')) return; // el panel y los modales usan sus propias ayudas
    const m = el.title.match(/^(.*?)\s*\(([^)]+)\)$/);
    el.dataset.tip ??= m ? m[1] : el.title;
    if (m && !el.dataset.key) el.dataset.key = m[2];
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.dataset.tip);
    el.removeAttribute('title');
  });
}

export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;
  let timer = null;
  let warmUntil = 0; // justo después de cerrar uno, el siguiente sale al instante

  const place = (el) => {
    const pos = el.dataset.tipPos
      ?? (el.closest('.toolbar') ? 'right'
        : el.closest('.select-bar, .space-bar') ? 'top'
          : el.closest('.panel') ? 'bottom-start' : 'bottom');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x;
    let y;
    if (pos === 'right') { x = r.right + 10; y = r.top + r.height / 2 - th / 2; }
    else if (pos === 'top') { x = r.left + r.width / 2 - tw / 2; y = r.top - th - 10; }
    else if (pos === 'bottom-start') { x = r.left - 4; y = r.bottom + 8; } // alineado al elemento (panel)
    else { x = r.left + r.width / 2 - tw / 2; y = r.bottom + 10; }
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - th - 8, y));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    tip.dataset.pos = pos;
  };

  const show = (el) => {
    current = el;
    const { tip: title, key, desc } = el.dataset;
    const keys = key ? key.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('<span>+</span>') : '';
    tip.innerHTML = `<div class="tt-head"><b>${esc(title)}</b>${keys ? `<span class="tt-keys">${keys}</span>` : ''}</div>`
      + (desc ? `<div class="tt-desc">${esc(desc)}</div>` : '');
    tip.classList.add('show');
    place(el);
  };

  const hide = () => {
    clearTimeout(timer);
    if (current) warmUntil = performance.now() + 400;
    current = null;
    tip.classList.remove('show');
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    if (el === current) return;
    clearTimeout(timer);
    if (!el) {
      hide();
      return;
    }
    // Si ya había uno abierto (o se acaba de cerrar), el siguiente aparece al instante
    if (current || performance.now() < warmUntil) show(el);
    else {
      timer = setTimeout(() => {
        // Sólo si el puntero sigue encima (si ya se fue, no aparece)
        if (el.isConnected && el.matches(':hover')) show(el);
      }, Number(el.dataset.tipDelay ?? DELAY));
    }
  });
  // Al salir de un elemento con tooltip (aunque sea hacia fuera de la ventana), cancelar
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    hide();
  });
  document.documentElement.addEventListener('pointerleave', hide);
  document.addEventListener('pointerdown', () => { hide(); warmUntil = 0; }, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', hide, true);

  // Si cambia el texto del elemento abierto (p. ej. botón habilitado/deshabilitado), refrescar
  return {
    refresh(el) { if (el === current) show(el); },
  };
}
