// Recorrido por la pantalla: un globito por paso que señala una parte de la app (el resto se
// oscurece). Siguiente / Atrás / Saltar; también con las flechas del teclado y Esc.
//
// steps: [{ target?: selector, title, text, before?: () => void }]
// Sin target, el globito va al centro (para la bienvenida y el cierre).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function startTour(steps, { onEnd } = {}) {
  let i = 0;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-spot"></div><div class="tour-bubble" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  const spot = root.querySelector('.tour-spot');
  const bubble = root.querySelector('.tour-bubble');

  const place = () => {
    const step = steps[i];
    const el = step.target ? document.querySelector(step.target) : null;
    const r = el?.getBoundingClientRect();
    const visible = r && r.width > 0 && r.height > 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (visible) {
      const pad = 8;
      Object.assign(spot.style, {
        left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`, opacity: 1,
      });
    } else {
      // Sin parte que señalar: todo oscuro y el globito al centro
      Object.assign(spot.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px', opacity: 1 });
    }
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    let x = (vw - bw) / 2;
    let y = (vh - bh) / 2;
    if (visible) {
      const gap = 18;
      // El lado con más espacio: derecha, izquierda, abajo o arriba
      const room = { right: vw - r.right, left: r.left, below: vh - r.bottom, above: r.top };
      if (room.right >= bw + gap * 2) { x = r.right + gap; y = r.top + r.height / 2 - bh / 2; }
      else if (room.left >= bw + gap * 2) { x = r.left - gap - bw; y = r.top + r.height / 2 - bh / 2; }
      else if (room.below >= bh + gap * 2) { x = r.left + r.width / 2 - bw / 2; y = r.bottom + gap; }
      else { x = r.left + r.width / 2 - bw / 2; y = r.top - gap - bh; }
    }
    bubble.style.left = `${Math.max(12, Math.min(vw - bw - 12, x))}px`;
    bubble.style.top = `${Math.max(12, Math.min(vh - bh - 12, y))}px`;
  };

  const show = () => {
    const step = steps[i];
    step.before?.();
    const last = i === steps.length - 1;
    bubble.innerHTML = `
      <div class="tour-count">${i + 1} de ${steps.length}</div>
      <h3>${esc(step.title)}</h3>
      <p>${step.html ?? esc(step.text)}</p>
      <div class="tour-actions">
        ${last ? '' : '<button class="tour-skip" data-act="end">Saltar recorrido</button>'}
        <span class="tour-spacer"></span>
        ${i > 0 ? '<button class="btn" data-act="prev">Atrás</button>' : ''}
        <button class="btn primary" data-act="${last ? 'end' : 'next'}">${last ? (step.done ?? '¡Listo!') : 'Siguiente'}</button>
      </div>`;
    // Esperar un cuadro: el paso puede mostrar partes del panel (p. ej. cambiar de herramienta)
    requestAnimationFrame(() => {
      place();
      bubble.querySelector('.btn.primary')?.focus({ preventScroll: true });
    });
  };

  const end = () => {
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    onEnd?.();
  };
  const go = (d) => {
    i = Math.max(0, Math.min(steps.length - 1, i + d));
    show();
  };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (i < steps.length - 1) go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
    else if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') e.stopPropagation(); // durante el recorrido no corren los atajos
  }
  bubble.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next') go(1);
    else if (act === 'prev') go(-1);
    else if (act === 'end') end();
  });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey, true);
  show();
  return end;
}
