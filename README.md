# Escáner

Escáner de documentos tipo CamScanner que funciona como web app (PWA). Es gratis, sin anuncios y sin servidor: todo el procesamiento ocurre en el teléfono.

## Funciones

- Captura con la cámara o importación de fotos (varias a la vez).
- Detección automática de bordes, ajuste manual de esquinas con lupa y corrección de perspectiva.
- Filtros: Original, Mejorado (quita sombras), Gris y Blanco y negro.
- Documentos de varias páginas: reordenar, editar y eliminar páginas.
- OCR en español e inglés para copiar o compartir el texto.
- PDF con capa de texto invisible, para que sea buscable y seleccionable.
- Compartir PDF, imagen o texto con el menú nativo (WhatsApp, correo, Archivos…).
- Búsqueda por nombre y por el texto leído con OCR.
- Funciona sin internet una vez instalada.

## Instalar en iPhone

1. Abre el enlace de la app en **Safari**.
2. Toca **Compartir** → **Agregar a pantalla de inicio**.
3. Ábrela desde el ícono. Instalada así, iOS no borra tus documentos por inactividad.

## Librerías (incluidas en `vendor/`)

- [OpenCV.js](https://opencv.org) 4.9.0: visión por computadora.
- [Tesseract.js](https://tesseract.projectnaptha.com) 5.1.1: OCR.
- [jsPDF](https://github.com/parallax/jsPDF) 2.5.1: generación de PDF.

## Desarrollo local

```sh
python3 -m http.server 8765
# abrir http://localhost:8765
```

Al cambiar archivos de la app, sube `VERSION` en `sw.js` para que los teléfonos instalados descarguen la versión nueva.
