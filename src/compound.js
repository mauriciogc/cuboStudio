import * as THREE from 'three';

// Pieza compuesta: unión de cajas alineadas a los ejes (una L, una E, una T…) dibujada
// como UNA sola malla, sin caras internas y con bisel en las orillas exteriores.
//
// Las cajas vienen como [x, y, z, ancho, alto, fondo] relativas a la esquina mínima de la pieza.

/**
 * Geometría centrada en el centro de la caja envolvente de la unión.
 * @param {number[][]} boxes cajas [x,y,z,w,h,d] ya escaladas al tamaño final
 * @param {number} rMax bisel de las orillas (el mismo de los cubos; 0 = orillas rectas)
 */
export function compoundGeometry(boxes, rMax = 0.07) {
  // 1) Rejilla comprimida: cortes en cada borde de caja, por eje
  const cuts = [0, 1, 2].map((a) => [...new Set(boxes.flatMap((b) => [b[a], b[a] + b[a + 3]]))].sort((p, q) => p - q));
  const n = cuts.map((c) => c.length - 1);
  const occ = new Uint8Array(n[0] * n[1] * n[2]);
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2] ? 0 : occ[(k * n[1] + j) * n[0] + i]);
  for (let k = 0; k < n[2]; k++) {
    for (let j = 0; j < n[1]; j++) {
      for (let i = 0; i < n[0]; i++) {
        const c = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
        if (boxes.some((b) => [0, 1, 2].every((a) => c[a] > b[a] && c[a] < b[a] + b[a + 3]))) occ[(k * n[1] + j) * n[0] + i] = 1;
      }
    }
  }
  // Bisel: como el de los cubos, sin pasarse de la mitad de la celda más delgada
  let minCell = Infinity;
  for (const c of cuts) for (let i = 0; i + 1 < c.length; i++) minCell = Math.min(minCell, c[i + 1] - c[i]);
  const r = Math.min(rMax, minCell * 0.45);

  const size = cuts.map((c) => c[c.length - 1]);
  const half = size.map((s) => s / 2);
  const positions = [];
  const normals = [];
  const pushTri = (a, b, c, nrm) => {
    // Orientar el triángulo hacia afuera
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const pts = cr[0] * nrm[0] + cr[1] * nrm[1] + cr[2] * nrm[2] >= 0 ? [a, b, c] : [a, c, b];
    for (const p of pts) {
      positions.push(p[0] - half[0], p[1] - half[1], p[2] - half[2]);
      normals.push(...nrm);
    }
  };
  const pushQuad = (p0, p1, p2, p3, nrm) => { pushTri(p0, p1, p2, nrm); pushTri(p0, p2, p3, nrm); };
  const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  // Triángulo con normal por vértice (orillas curvas), orientado hacia afuera
  const pushTriN = (a, b, c, na, nb, nc) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const m = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    const flip = cr[0] * m[0] + cr[1] * m[1] + cr[2] * m[2] < 0;
    const pts = flip ? [[a, na], [c, nc], [b, nb]] : [[a, na], [b, nb], [c, nc]];
    for (const [p, n] of pts) {
      positions.push(p[0] - half[0], p[1] - half[1], p[2] - half[2]);
      normals.push(...n);
    }
  };
  // Segmentos de la curva del bisel (más cuanto más redondo)
  const SEG = r > 0.1 ? 4 : 2;

  const dirs = [];
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) dirs.push([a, s]);
  const step = (cell, a, s) => { const c = [...cell]; c[a] += s; return c; };

  for (let k = 0; k < n[2]; k++) {
    for (let j = 0; j < n[1]; j++) {
      for (let i = 0; i < n[0]; i++) {
        if (!at(i, j, k)) continue;
        const cell = [i, j, k];
        const lo = [cuts[0][i], cuts[1][j], cuts[2][k]];
        const hi = [cuts[0][i + 1], cuts[1][j + 1], cuts[2][k + 1]];
        const edge = (a, s) => (s > 0 ? hi[a] : lo[a]);
        const open = (a, s) => !at(...step(cell, a, s));

        for (const [a, s] of dirs) {
          if (!open(a, s)) continue;
          // 2) Cara expuesta, recortada por el bisel donde la orilla es convexa
          const [u, v] = [0, 1, 2].filter((x) => x !== a);
          const u0 = lo[u] + (open(u, -1) ? r : 0);
          const u1 = hi[u] - (open(u, 1) ? r : 0);
          const v0 = lo[v] + (open(v, -1) ? r : 0);
          const v1 = hi[v] - (open(v, 1) ? r : 0);
          const pt = (pu, pv) => { const p = [0, 0, 0]; p[a] = edge(a, s); p[u] = pu; p[v] = pv; return p; };
          const nrm = [0, 0, 0];
          nrm[a] = s;
          pushQuad(pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1), nrm);

          // 3) Tiras de bisel en orillas convexas (una vez por par de caras: eje menor primero)
          for (const t of [u, v]) {
            if (t < a || r <= 0) continue;
            for (const st of [-1, 1]) {
              if (!open(t, st)) continue;
              const w = 3 - a - t;
              const w0 = lo[w] + (open(w, -1) ? r : 0);
              const w1 = hi[w] - (open(w, 1) ? r : 0);
              // Cuarto de cilindro de radio r a lo largo del eje w
              const arc = (k) => {
                const th = (k / SEG) * (Math.PI / 2);
                const n = [0, 0, 0];
                n[a] = s * Math.cos(th);
                n[t] = st * Math.sin(th);
                return n;
              };
              const onArc = (n, pw) => {
                const p = [0, 0, 0];
                p[a] = edge(a, s) - s * r + n[a] * r;
                p[t] = edge(t, st) - st * r + n[t] * r;
                p[w] = pw;
                return p;
              };
              for (let k = 0; k < SEG; k++) {
                const n0 = arc(k);
                const n1 = arc(k + 1);
                pushTriN(onArc(n0, w0), onArc(n0, w1), onArc(n1, w1), n0, n0, n1);
                pushTriN(onArc(n0, w0), onArc(n1, w1), onArc(n1, w0), n0, n1, n1);
              }
              // Si la tira termina contra una celda vecina que no la continúa (esquina interior
              // de una L, T…), se tapa ese extremo para que no quede un hueco
              for (const sw of [-1, 1]) {
                if (open(w, sw)) continue;
                const nb = step(cell, w, sw);
                if (!at(...step(nb, a, s)) && !at(...step(nb, t, st))) continue; // la tira sigue
                const pw = sw < 0 ? w0 : w1;
                const c = [0, 0, 0];
                c[a] = edge(a, s);
                c[t] = edge(t, st);
                c[w] = pw;
                const cn = [0, 0, 0];
                cn[w] = -sw;
                for (let k = 0; k < SEG; k++) pushTriN(c, onArc(arc(k), pw), onArc(arc(k + 1), pw), cn, cn, cn);
              }
            }
          }
        }

        // 4) Triángulos en esquinas convexas (tres caras expuestas)
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const sg = [sx, sy, sz];
              if (r <= 0 || !(open(0, sx) && open(1, sy) && open(2, sz))) continue;
              // Octavo de esfera de radio r, subdividido en una rejilla triangular
              const cc = [0, 1, 2].map((ax) => edge(ax, sg[ax]) - sg[ax] * r);
              const dir = (i, j) => {
                const k = SEG - i - j;
                // seno de cada parte: en las orillas cae en los mismos ángulos que las tiras
                const q = Math.PI / 2 / SEG;
                return unit([sg[0] * Math.sin(i * q), sg[1] * Math.sin(j * q), sg[2] * Math.sin(k * q)]);
              };
              const pt = (n) => cc.map((v, ax) => v + n[ax] * r);
              for (let i = 0; i < SEG; i++) {
                for (let j = 0; j < SEG - i; j++) {
                  const d0 = dir(i, j);
                  const d1 = dir(i + 1, j);
                  const d2 = dir(i, j + 1);
                  pushTriN(pt(d0), pt(d1), pt(d2), d0, d1, d2);
                  if (i + j < SEG - 1) {
                    const d3 = dir(i + 1, j + 1);
                    pushTriN(pt(d1), pt(d3), pt(d2), d1, d3, d2);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
