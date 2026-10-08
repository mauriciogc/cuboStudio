# CuboStudio

Editor de figuras hechas de cubos (vóxeles) al estilo *Pokémon Quest* y *Crossy Road*, hecho con
Three.js + Vite, sin frameworks. Todo corre en el navegador y se guarda solo.

**Pruébalo:** https://mauriciogc.github.io/cuboStudio/ · **Guía completa con imágenes:** https://mauriciogc.github.io/cuboStudio/guia/

```bash
npm install
npm run dev       # http://localhost:5173/cuboStudio/
npm run build     # genera dist/ (sitio estático)
npm run preview   # sirve dist/ en http://localhost:4173/cuboStudio/
```

Cada push a `main` se publica solo en GitHub Pages (`.github/workflows/deploy.yml`).

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
- **Brilla:** la pieza da luz de su color e ilumina lo que tiene cerca (lámparas, fuego, lava, ojos…).
  Como la opacidad, se aplica a lo que construyes, pintas o tienes seleccionado.
- **Encimar piezas** está permitido (también varias en la misma casilla).

## El panel

El panel de la derecha muestra sólo lo que sirve para lo que estás haciendo:

| Situación | Se ve |
|---|---|
| Construir o Caja, o piezas seleccionadas | **Color**, **En esta figura** y **Forma de la pieza** |
| Pintar, Rellenar o Calcomanía | **Color** y **En esta figura** (y las calcomanías), además de **Escena** |
| Nada seleccionado (puntero), Borrar o Gotero | **Escena** |

- **Color:** paleta, selector libre y HEX, opacidad y **Brilla**.
- **En esta figura:** los colores que ya usa la figura, del más usado al menos usado.
- Cada opción tiene su **?** con una explicación.

## Seleccionar y editar

- Clic selecciona; **Shift+clic** suma o quita; **Ctrl/⌘+clic** toma una sola pieza de un grupo.
  Clic fuera de las piezas deselecciona.
- La **píldora flotante** sigue a la selección y trae sus modos y acciones:
  - **Sólo seleccionar:** sin flechas ni manijas, para juntar varias piezas sin que estorbe nada.
  - **Mover:** flechas X/Y/Z en pasos de 0.1.
  - **Girar:** aros de 90°.
  - **Escalar:** manijas en las 6 caras (crece hacia ese lado) y en las 8 esquinas amarillas (crece parejo).
  - **Deformar** (cubos y bloques): eliges una cara con los cuadritos blancos; sus **4 orillas** la achican o
    agrandan de ese lado (rampas, techos, pirámides, embudos) y el **centro** la recorre para inclinarla.
    Con imán al tamaño original, al lado recto, a la mitad, al filo (ancho 0), a 45° y al centro.
    El único tope es la orilla de la cuadrícula.
    **Enderezar** la regresa a caja. La deformación se conserva al mover, girar, escalar y copiar.
  - **Extruir** (cubos y bloques): jala directo el **cuadrito morado** de cualquier cara, como al escalar, y sale
    una **pieza nueva** del tamaño y forma de esa cara (aparte, del mismo color y grupo), con imán en largos
    enteros y al tocar otra pieza. Queda seleccionada para seguir extruyendo tramo por tramo.
  - **Agrupar / Desagrupar, Fusionar / Separar, Duplicar, Copiar y Eliminar.**
- **Imanes al arrastrar:** al escalar, el tamaño se pega en los enteros (1, 2, 3…); al mover, en las
  posiciones de la cuadrícula. En los dos casos también se pega cuando la pieza toca a otra. Si sigues
  arrastrando, se suelta y continúa.
- **Topes:** el tamaño máximo de una pieza es el de la cuadrícula, y al mover o escalar se frena en la orilla.
- **Resaltes con la forma real:** al seleccionar o pasar el mouse, esferas, conos, piezas fusionadas y deformadas
  se resaltan con su forma, no con una caja.
- **Copiar / pegar / duplicar** (Ctrl+C / V / D), también entre figuras.
- **Grupos** (Ctrl+G / Ctrl+Shift+G): un clic en cualquier pieza selecciona el grupo completo; al pasar el
  mouse se resalta todo el grupo.
- **Fusionar** (Ctrl+J): une cubos de **un solo color** en una sola pieza (un bloque, o una forma
  compuesta como L, E o T, dibujada como una sola malla con su bisel).
  **Separar** (Ctrl+Shift+J) la regresa a cubos 1×1×1 sueltos; funciona también con cubos estirados.
- **Calcomanías:** se pegan de 1×1 y se agrandan con Escalar; se ven por los dos lados y viajan con
  las piezas al moverlas o girarlas. Al seleccionarlas se pueden mover, escalar o borrar (Supr).

## Ayudas para modelar

- **Espejo X (M):** lo que construyes, pintas o borras se repite del otro lado. Además, cada pieza tiene
  su **pareja** (la idéntica en la posición reflejada), que se resalta en un azul más claro y cambia con ella:
  - Mover: a los lados al revés; arriba/abajo y adelante/atrás igual. Girar y escalar, reflejados.
  - Color, opacidad, brillo, forma, eliminar, fusionar y separar: igual en las dos.
  - Agrupar: un grupo por lado. Copiar toma un lado; pegar crea también el reflejo.
  - Las piezas al centro (su propia pareja) no se corren a los lados y crecen parejo.
  - Una pieza sin otra idéntica del lado contrario no tiene pareja y se edita sola. Con el espejo apagado, todo se edita solo.
- **Marcar orillas (L):** dibuja el contorno de cada pieza para distinguirlas (útil con orillas rectas).
  Sólo se ve al modelar, no sale al exportar.
- **Espacio 3D (V):** un plano para poner cubos flotantes; Q / W cambian de capa.
- **Imágenes guía (H):** frente, lado y atrás, al fondo (como los *image planes* de Maya) o en cruz.
  Altura, posición, volteo y opacidad ajustables. Se guardan por figura.

## Luz

Está en **Escena**: un selector de ambiente (como el de Fondo) y el botón **Ajustar**.

- **Ambientes listos:** Día, Atardecer (sol bajo y cálido), Noche (azulada y tenue, con cielo de noche) y
  Estudio (pareja, ideal para exportar).
- **Ajustar luz:**
  - **Sol:** color, intensidad, giro y altura (de dónde caen las sombras), sombras y su suavidad.
  - **Ambiente:** color e intensidad.
  - **Piezas que brillan:** fuerza de su luz.
- **Mover el sol (U):** botón de la barra de herramientas que muestra el cubo del espacio de trabajo y un sol
  sobre él. Arrástralo por los lados y el techo del cubo (sin salirse): la luz va del sol al centro del piso,
  con las sombras en vivo. No sale al exportar.
- Las piezas que brillan cercanas comparten luz: hay hasta 8 luces, repartidas por zonas.
- La luz se **guarda con cada figura** y sale en las imágenes exportadas. El `.glb` lleva el sol, las luces
  de las piezas que brillan y su material emisivo.

## Escena

Sale cuando no estás creando ni editando piezas (es lo de toda la figura).

- **Cuadrícula:** 8, 16, 24, 32, 48, 64 o 128.
- **Fondo:** pradera, cielo, arena, nube o noche. Se guarda con la figura.
- **Luz:** ambiente y ajustes (ver arriba).
- **Orillas:** rectas (pixel puro), suaves o redondas. Se guardan con la figura y viajan al exportar e importar.
- **Líneas del piso:** mostrar u ocultar la cuadrícula del piso.

## Figuras, ejemplos y archivos

- **Mis figuras (G):** varias figuras con miniatura (con su luz y su fondo), guardadas solas en el navegador; se pueden duplicar o eliminar.
- **Ejemplos:** pestaña dentro de Mis figuras; al abrir uno se crea una copia editable.
- **Exportar (Ctrl+E):**
  - Imagen PNG ajustada a la figura, tal como se ve en pantalla, o en un **formato fijo** para redes y
    pantallas: cuadrado 1:1, vertical 4:5, historia 9:16, fondo de iPhone, clásico 4:3 / 3:4 y horizontal 16:9.
    En los formatos fijos la figura va centrada (chica, mediana o grande) sobre el fondo de la escena, con su
    luz; la sombra sigue hasta donde llegue y se corta en la orilla de la imagen.
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
  "background": "pradera",    // fondo (opcional)
  "light": { "preset": "noche", "sun": "#a9c1ff", "sunI": 0.5, "az": 140, "el": 50,
             "amb": "#4d5f99", "ground": "#151a2b", "ambI": 0.45,
             "shadows": true, "soft": 6, "glow": 1.6 },   // luz (opcional)
  "palette": ["#4fa3e0", "#ffe066/cube/2/0/3,1,1/0,0.5,0", "…"],
  "voxels": [x, y, z, índiceDePaleta, …],
  "stickers": [[px, py, pz, cara, diseño, color, tamaño, volteo], …],
  "name": "Mi figura"
}
```

Cada entrada de la paleta describe una pieza:

```text
#rrggbb[aa][*]/forma/cara/giro/ancho,alto,fondo/dx,dy,dz|gN
```

- `aa`: opacidad; `*`: la pieza brilla.
- `forma`: `cube`, `sphere`, `cylinder`, `cone`, `pyramid`, `wedge`, `compound:x,y,z,w,h,d;…` (piezas fusionadas)
  o `deform:dx,dy,dz,…` (cubo deformado: cuánto se corre cada una de sus 8 esquinas, en fracciones de su tamaño).
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
| `src/sun-gizmo.js` | Sol arrastrable para orientar la luz |
| `src/deform-tool.js` | Deformar y Extruir caras de cubos y bloques (manijas e imanes) |
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
| `public/guia/` | Guía para usuarios (página con capturas y animaciones de la app) |

Para depurar, en la consola del navegador está `window.cubo`
(`stage`, `editor`, `store`, `refs`, `renderStandalone`, `VoxelModel`, `setBevel`).
