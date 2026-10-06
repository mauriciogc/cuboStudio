import { VoxelModel } from './model.js';

// Ejemplos: archivos JSON en public/ejemplos/ (los mismos que exporta la app con "Proyecto .json").
// public/ejemplos/index.json define el orden: [{ id, name, file, thumb?, size?, pieces? }].
// Cada ejemplo se descarga sólo cuando hace falta (al abrirlo o para dibujar su miniatura).

const BASE = `${import.meta.env.BASE_URL}ejemplos/`;

let indexPromise = null;
const files = new Map();

export function listExamples() {
  indexPromise ??= fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return indexPromise;
}

/** Descarga (una vez) el JSON del ejemplo y lo convierte en modelo. */
export async function loadExample(entry) {
  if (!files.has(entry.id)) {
    files.set(entry.id, fetch(BASE + entry.file).then((r) => {
      if (!r.ok) throw new Error(`No se encontró ${entry.file}`);
      return r.json();
    }));
  }
  const data = await files.get(entry.id);
  return VoxelModel.deserialize(data);
}

/** URL de la miniatura ya hecha, o null si hay que dibujarla. */
export const thumbUrl = (entry) => (entry.thumb ? BASE + entry.thumb : null);
