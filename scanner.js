// Procesamiento de imagen con OpenCV.js: detección de bordes, perspectiva y filtros.

export const FULL_QUAD = [[0, 0], [1, 0], [1, 1], [0, 1]];

let cvPromise = null;

export function loadCV() {
  if (!cvPromise) {
    cvPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/opencv.js';
      s.async = true;
      s.onload = () => {
        const cv = window.cv;
        // El Module de Emscripten es "thenable": nunca se pasa directo a resolve()
        // porque provoca un ciclo infinito; se quita .then y se envuelve.
        const done = () => { try { delete cv.then; } catch {} resolve({ cv }); };
        if (cv.Mat) done(); else cv.onRuntimeInitialized = done;
      };
      s.onerror = () => { cvPromise = null; reject(new Error('No se pudo cargar el motor de escaneo')); };
      document.head.appendChild(s);
    }).then(({ cv }) => cv);
  }
  return cvPromise;
}

// Ordena 4 puntos como [arriba-izq, arriba-der, abajo-der, abajo-izq].
export function orderQuad(pts) {
  const sum = p => p[0] + p[1], diff = p => p[0] - p[1];
  const by = (f, max) => pts.reduce((a, b) => ((max ? f(b) > f(a) : f(b) < f(a)) ? b : a));
  const tl = by(sum, false), br = by(sum, true), tr = by(diff, true), bl = by(diff, false);
  const set = new Set([tl, tr, br, bl]);
  if (set.size < 4) {
    // Caso degenerado: ordenar por ángulo alrededor del centro.
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
    const s = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    const start = s.indexOf(s.reduce((a, b) => (sum(b) < sum(a) ? b : a)));
    return [0, 1, 2, 3].map(i => s[(start + i) % 4]);
  }
  return [tl, tr, br, bl];
}

function quadFromContours(cv, bin, minArea) {
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  let best = null, bestArea = minArea;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area > bestArea) {
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const d = approx.data32S;
        best = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
        bestArea = area;
      }
      approx.delete();
    }
    c.delete();
  }
  contours.delete(); hier.delete();
  return best;
}

// Devuelve las 4 esquinas del documento normalizadas (0..1) o null si no encuentra.
export function detectQuad(cv, canvas) {
  const scale = Math.min(1, 500 / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);

  const src = cv.imread(small), gray = new cv.Mat(), bin = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const minArea = small.width * small.height * 0.15;
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

  // 1) Bordes de Canny; 2) umbral de Otsu (papel claro sobre fondo oscuro).
  cv.Canny(gray, bin, 50, 150);
  cv.dilate(bin, bin, kernel);
  let quad = quadFromContours(cv, bin, minArea);
  if (!quad) {
    cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);
    quad = quadFromContours(cv, bin, minArea);
  }
  const sw = small.width, sh = small.height;
  src.delete(); gray.delete(); bin.delete(); kernel.delete();
  small.width = 0;
  return quad ? orderQuad(quad.map(([x, y]) => [x / sw, y / sh])) : null;
}

// Endereza el área del cuadrilátero. Devuelve un Mat RGBA (hay que liberarlo).
export function warp(cv, canvas, quad, maxSide = 2200) {
  const p = orderQuad(quad).map(([x, y]) => [x * canvas.width, y * canvas.height]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.max(d(p[0], p[1]), d(p[3], p[2]));
  let h = Math.max(d(p[0], p[3]), d(p[1], p[2]));
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(10, Math.round(w * s)); h = Math.max(10, Math.round(h * s));

  const src = cv.imread(canvas), dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, p.flat());
  // Un pequeño margen hacia afuera deja fuera el borde de la mesa que queda en la orilla.
  const m = Math.round(Math.max(w, h) * 0.006);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [-m, -m, w + m, -m, w + m, h + m, -m, h + m]);
  const M = cv.getPerspectiveTransform(from, to);
  cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  src.delete(); from.delete(); to.delete(); M.delete();
  return dst;
}

// Quita sombras e iluminación dispareja: divide la imagen entre su fondo estimado.
function flatten(cv, rgb) {
  const f = Math.min(1, 500 / Math.max(rgb.cols, rgb.rows));
  const small = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat();
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  cv.resize(rgb, small, new cv.Size(0, 0), f, f, cv.INTER_AREA);
  cv.dilate(small, small, k);
  cv.medianBlur(small, small, 15);
  cv.resize(small, bg, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR);
  cv.divide(rgb, bg, out, 255);
  small.delete(); bg.delete(); k.delete();
  return out;
}

export const FILTERS = [
  ['original', 'Original'],
  ['magic', 'Mejorado'],
  ['gray', 'Gris'],
  ['bw', 'B/N'],
];

// Aplica un filtro y la rotación (0/90/180/270). Devuelve un Mat nuevo.
export function filterMat(cv, src, filter, rot = 0) {
  let out = new cv.Mat();
  if (filter === 'original') {
    src.copyTo(out);
  } else {
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const norm = flatten(cv, rgb);
    rgb.delete();
    if (filter === 'magic') {
      norm.convertTo(out, -1, 1.15, -20);
    } else {
      const g = new cv.Mat();
      cv.cvtColor(norm, g, cv.COLOR_RGB2GRAY);
      if (filter === 'gray') {
        g.convertTo(out, -1, 1.2, -30);
      } else {
        let block = Math.max(15, Math.round(Math.max(g.cols, g.rows) / 60));
        if (block % 2 === 0) block++;
        cv.adaptiveThreshold(g, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 10);
      }
      g.delete();
    }
    norm.delete();
  }
  const code = { 90: cv.ROTATE_90_CLOCKWISE, 180: cv.ROTATE_180, 270: cv.ROTATE_90_COUNTERCLOCKWISE }[rot];
  if (code !== undefined) {
    const r = new cv.Mat();
    cv.rotate(out, r, code);
    out.delete();
    out = r;
  }
  return out;
}

// Proceso completo sin interfaz (usado en lotes).
export function renderPage(cv, canvas, quad, rot, filter) {
  const w = warp(cv, canvas, quad);
  const out = filterMat(cv, w, filter, rot);
  const c = document.createElement('canvas');
  cv.imshow(c, out);
  w.delete(); out.delete();
  return c;
}
