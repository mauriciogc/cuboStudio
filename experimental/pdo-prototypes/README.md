# Prototipos: convertir un .pdo de Pepakura a cubos

Pruebas en Python (numpy, Pillow, scipy) para los estilos de conversión. No forman parte de la app.
`load.py` tiene la ruta de un .pdo de prueba (`GOGETA`); cámbiala por la de tu archivo.
Cada script genera un `.json` de CuboStudio que se abre con **Importar**.

| Archivo | Qué hace |
|---|---|
| `generic.py` | Lector del .pdo (versión 3): busca dónde empieza la figura y la valida completa |
| `load.py` | Carga objetos, caras (con su pieza de papel), UV y texturas |
| `blocks.py` | **Bloques**: una caja deformada por pieza de papel (parte las muy curvas) |
| `boxes.py` | **Cajas por pieza**: lo mismo, pero con cajas rectas |
| `hybrid.py` | **Mezcla**: bloques para lo largo y delgado (pelo, cola), cajas para lo compacto |
| `vblocks.py` | Volumen agrupado en zonas (k-means) → una caja deformada por zona (descartado) |
| `smooth.py` | **Intermedio**: cubos con las esquinas de afuera acercadas a la superficie |
| `sizes.py` | **Cajas finas**: detalle a medio cubo, juntado en cajas rectas de distintos tamaños |
| `merge.py` | Junta los cubos de una figura en cajas del mismo color |
| `mine.py` | **Estilo bloque** (tipo Minecraft): forma de cubos grandes + textura pintada en la superficie |
