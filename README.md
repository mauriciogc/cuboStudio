# CuboStudio

Editor de figuras hechas de cubos (vóxeles) al estilo *Pokémon Quest* y *Crossy Road*, hecho con
Three.js + Vite, sin frameworks. Todo corre en el navegador y se guarda solo.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/ (sitio estático)
npm run preview   # sirve dist/ en http://localhost:4173
```

## Primeros pasos

- La primera vez se abre una figura vacía con la ventana de **Ejemplos**: abre uno para ver cómo se hace
  (se crea una copia para editar) o cierra para empezar en blanco.
- Con la figura vacía aparece un aviso con el botón **Ver ejemplos**.
- Haz clic en el piso con **Construir (B)** para poner tu primer cubo.

## Construir

| Herramienta | Tecla | Qué hace |
|---|---|---|
| Seleccionar | A | Selecciona piezas para moverlas, girarlas, escalarlas o editarlas |
| Selección rectangular | R | Arrastra un rectángulo: selecciona todo lo que quede dentro (también lo de atrás) |
| Construir | B | Pone una pieza en el piso o sobre una cara |
| Caja | O | Arrastra para llenar un área; la rueda del mouse da la altura |
| Borrar | E | Quita la pieza |
| Pintar | P | Clic, o mantener el clic y arrastrar sobre las piezas para pintarlas de corrido |
| Rellenar | K | Pinta de un clic las piezas conectadas del mismo color |
| Gotero | I | Toma el color de una pieza |
| Calcomanía | S | Pega ojos, bocas, mejillas y más sobre las caras |

- **Atajos al vuelo:** Shift+clic borra, Alt+clic toma el color, Shift+caja borra en caja.
- **Trazo continuo:** Ctrl/⌘ + arrastrar construye o borra de corrido (un solo paso de deshacer).
- **Formas de pieza:** cubo, esfera, cilindro, cono, pirámide y cuña. Apuntan hacia afuera de la cara donde haces clic.
- **Pegado a la cara real:** si construyes sobre una pieza aplastada o desplazada, el cubo nuevo queda
  pegado a su cara, sin dejar hueco.
- **Opacidad** por pieza (10–100 %) para agua o vidrio: se puede construir dentro de las piezas transparentes.
- **Encimar piezas** está permitido (también varias en la misma casilla).

## Seleccionar y editar

- Clic selecciona; **Shift+clic** suma o quita; **Ctrl/⌘+clic** toma una sola pieza de un grupo.
  Clic fuera de las piezas deselecciona.
- La **píldora flotante** sigue a la selección y trae sus modos y acciones:
  - **Sólo seleccionar:** sin flechas ni manijas, para juntar varias piezas sin que estorbe nada.
  - **Mover:** flechas X/Y/Z en pasos de 0.1.
  - **Girar:** aros de 90°.
  - **Escalar:** manijas en las 6 caras (crece hacia ese lado) y en las 8 esquinas amarillas (crece parejo).
  - **Agrupar / Desagrupar, Fusionar / Separar, Duplicar, Copiar y Eliminar.**
- **Imanes al arrastrar:** al escalar, el tamaño se pega en los enteros (1, 2, 3…); al mover, en las
  posiciones de la cuadrícula. En los dos casos también se pega cuando la pieza toca a otra. Si sigues
  arrastrando, se suelta y continúa.
- **Topes:** el tamaño máximo de una pieza es el de la cuadrícula, y al mover o escalar se frena en la orilla.
- **Copiar / pegar / duplicar** (Ctrl+C / V / D), también entre figuras.
- **Grupos** (Ctrl+G / Ctrl+Shift+G): un clic en cualquier pieza selecciona el grupo completo; al pasar el
  mouse se resalta todo el grupo.
- **Fusionar** (Ctrl+J): une cubos de **un solo color** en una sola pieza (un bloque, o una forma
  compuesta como L, E o T, dibujada como una sola malla con su bisel).
  **Separar** (Ctrl+Shift+J) la regresa a cubos 1×1×1 sueltos; funciona también con cubos estirados.
- **Calcomanías:** se pegan de 1×1 y se agrandan con Escalar; se ven por los dos lados y viajan con
  las piezas al moverlas o girarlas. Al seleccionarlas se pueden mover, escalar o borrar (Supr).

## Ayudas para modelar

- **Espejo X (M):** lo que construyes, pintas o borras se repite del otro lado.
- **Marcar orillas (L):** dibuja el contorno de cada pieza para distinguirlas (útil con orillas rectas).
  Sólo se ve al modelar, no sale al exportar.
- **Espacio 3D (V):** un plano para poner cubos flotantes; Q / W cambian de capa.
- **Imágenes guía (H):** frente, lado y atrás, al fondo (como los *image planes* de Maya) o en cruz.
  Altura, posición, volteo y opacidad ajustables. Se guardan por figura.

## Escena

- **Cuadrícula:** 8, 16, 24, 32, 48, 64 o 128.
- **Fondo:** pradera, cielo, arena, nube o noche.
- **Orillas:** rectas (pixel puro), suaves o redondas. Se guardan con la figura y viajan al exportar e importar.
- **Líneas del piso:** mostrar u ocultar la cuadrícula del piso.

## Figuras, ejemplos y archivos

- **Mis figuras (G):** varias figuras con miniatura, guardadas solas en el navegador; se pueden duplicar o eliminar.
- **Ejemplos:** pestaña dentro de Mis figuras; al abrir uno se crea una copia editable.
- **Exportar (Ctrl+E):**
  - Imagen PNG tal como se ve en pantalla, o recortada a la figura (vista actual o isométrica).
  - Fondo transparente o de color, sombra opcional, de 512 a 2048 px; también copiar al portapapeles.
  - Modelo 3D `.glb`.
  - Proyecto `.json`.
- **Importar:** un `.json` con el botón o arrastrándolo a la ventana.
- **Deshacer / rehacer:** Ctrl+Z y Ctrl+Shift+Z (300 pasos). **Ctrl+S** guarda al momento.

## Cámara

Arrastrar gira, clic derecho desplaza, la rueda hace zoom. Vistas **1–5** (iso, frente, lado, atrás,
arriba) y **F** para encuadrar. Las flechas y PgUp/PgDn mueven la figura completa.

La ayuda (**?**) tiene la lista completa de atajos.

## Formato del proyecto (`.json`)

```jsonc
{
  "format": "cubostudio",
  "version": 2,
  "size": 24,                 // cuadrícula
  "bevel": "soft",            // orillas: flat | soft | round (opcional)
  "palette": ["#4fa3e0", "#ffe066/cube/2/0/3,1,1/0,0.5,0", "…"],
  "voxels": [x, y, z, índiceDePaleta, …],
  "stickers": [[px, py, pz, cara, diseño, color, tamaño, volteo], …],
  "name": "Mi figura"
}
```

Cada entrada de la paleta describe una pieza:

```text
#rrggbb[aa]/forma/cara/giro/ancho,alto,fondo/dx,dy,dz|gN
```

- `aa`: opacidad.
- `forma`: `cube`, `sphere`, `cylinder`, `cone`, `pyramid`, `wedge` o `compound:x,y,z,w,h,d;…` (piezas fusionadas).
- `ancho,alto,fondo` / `dx,dy,dz`: tamaño y desplazamiento dentro de la casilla (pasos de 0.1).
- `|gN`: grupo.

Un cubo normal es sólo su color.

## Ejemplos

Viven en `public/ejemplos/` como `.json` (el mismo formato que exporta la app) con su miniatura `.webp`.
El orden y los datos de la galería salen de `public/ejemplos/index.json`:

```json
{ "id": "gato", "name": "Gato", "file": "gato.json", "thumb": "gato.webp", "size": 24, "pieces": 428 }
```

Para agregar uno:

1. Exporta el proyecto `.json` desde la app.
2. Cópialo a `public/ejemplos/` y agrégalo a `index.json`.
3. Genera su miniatura de 256 px con `window.cubo.renderStandalone(modelo, { size: 256, type: 'image/webp' })`
   y aplica antes sus orillas con `window.cubo.setBevel(data.bevel ?? 'soft')`.

Cada ejemplo se descarga sólo cuando hace falta.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/model.js` | Datos: mapa disperso de piezas, formas, tamaños, grupos, ocupación, calcomanías y serialización |
| `src/voxel-mesh.js` | Dibuja las piezas (`InstancedMesh` por forma y opacidad, mallas propias para bloques y fusionadas), orillas y contornos |
| `src/compound.js` | Geometría de piezas fusionadas: unión de cajas en una malla con bisel curvo |
| `src/editor.js` | Herramientas, raycast, vista previa, selección, grupos, fusionar, copiar/pegar e historial |
| `src/gizmo.js` | Gizmo de mover/girar, manijas de escalar e imanes |
| `src/stage.js` | Renderer, cámara, luces, piso, fondos y vistas |
| `src/exporter.js` | PNG (pantalla o recortado), GLB y miniaturas |
| `src/stickers.js` | Calcomanías: diseños en canvas, texturas y colocación por cara |
| `src/references.js` | Imágenes guía |
| `src/workplane.js` | Plano del Espacio 3D |
| `src/storage.js` | `localStorage` (figuras y preferencias) + IndexedDB (imágenes guía) |
| `src/examples.js` | Carga de ejemplos desde `public/ejemplos/` |
| `src/tooltip.js` | Tooltips con nombre, atajo y descripción |
| `src/icons.js` / `src/palette.js` | Íconos de la interfaz y paleta de colores |
| `src/main.js` | Interfaz: paneles, píldora de selección, galería, modales, atajos y autoguardado |

Para depurar, en la consola del navegador está `window.cubo`
(`stage`, `editor`, `store`, `refs`, `renderStandalone`, `VoxelModel`, `setBevel`).
