import * as db from './db.js';
import { loadCV, detectQuad, warp, filterMat, renderPage, orderQuad, FILTERS, FULL_QUAD } from './scanner.js';

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const tick = () => new Promise(r => setTimeout(r, 40)); // deja que se pinte el indicador antes de trabajo pesado
const abs = p => new URL(p, location.href).href;

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
  back: svg('<polyline points="15 18 9 12 15 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  text: svg('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'),
  share: svg('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>'),
  trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  crop: svg('<path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>'),
  rotL: svg('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  rotR: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  auto: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),
  left: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  right: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  pdf: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 12 18 15 15"/><line x1="12" y1="11" x2="12" y2="18"/>'),
};

const prefs = {
  get(k, d) { try { return localStorage.getItem('escaner.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('escaner.' + k, v); } catch {} },
};

const app = $('#app');
const camIn = $('#camIn'), galIn = $('#galIn');
let target = null; // documento que recibe las nuevas páginas (null = documento nuevo)

// ---------- componentes de interfaz ----------
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2600);
}

const busyEl = $('#busy');
function busy(msg) {
  if (msg === false) { busyEl.hidden = true; return; }
  $('.busy-msg', busyEl).textContent = msg;
  busyEl.hidden = false;
}

function overlay(cls, html) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// Hoja de acciones inferior. Resuelve con la clave elegida o null.
function sheet(title, actions) {
  return new Promise(resolve => {
    const el = overlay('scrim', `<div class="sheet" role="dialog">
      ${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
      ${actions.map(a => `<button class="sheet-btn ${a.danger ? 'danger' : ''}" data-k="${a.k}">${a.icon || ''}<span>${esc(a.label)}</span></button>`).join('')}
      <button class="sheet-btn cancel" data-k="">Cancelar</button></div>`);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (!b && e.target !== el) return;
      el.remove();
      resolve(b ? b.dataset.k || null : null);
    });
  });
}

function ask(title, value = '', okLabel = 'Guardar') {
  return new Promise(resolve => {
    const el = overlay('scrim center', `<form class="dialog">
      <div class="dialog-title">${esc(title)}</div>
      <input class="field" value="${esc(value)}" autocomplete="off">
      <div class="dialog-btns"><button type="button" data-k="no">Cancelar</button><button class="strong">${esc(okLabel)}</button></div></form>`);
    const input = $('input', el);
    setTimeout(() => { input.focus(); input.select(); }, 50);
    $('form', el).onsubmit = e => { e.preventDefault(); el.remove(); resolve(input.value.trim() || null); };
    $('[data-k=no]', el).onclick = () => { el.remove(); resolve(null); };
  });
}

function confirmBox(msg, okLabel = 'Eliminar') {
  return new Promise(resolve => {
    const el = overlay('scrim center', `<div class="dialog">
      <div class="dialog-title">${esc(msg)}</div>
      <div class="dialog-btns"><button data-k="no">Cancelar</button><button class="strong danger" data-k="ok">${esc(okLabel)}</button></div></div>`);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      el.remove();
      resolve(b.dataset.k === 'ok');
    });
  });
}

// ---------- imágenes ----------
async function blobToCanvas(blob, max = 2600) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c, q = 0.85) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

function thumbOf(c) {
  const s = 300 / Math.max(c.width, c.height);
  const t = document.createElement('canvas');
  t.width = Math.round(c.width * s);
  t.height = Math.round(c.height * s);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  const url = t.toDataURL('image/jpeg', 0.75);
  t.width = 0;
  return url;
}

const blobToDataURL = b => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

// ---------- documentos ----------
function newDoc() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const now = Date.now();
  return {
    id: uid(), created: now, updated: now, pageIds: [], thumb: '', texts: {},
    name: `Escaneo ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`,
  };
}

async function touchDoc(doc) {
  doc.updated = Date.now();
  const first = doc.pageIds[0] && await db.getPage(doc.pageIds[0]);
  doc.thumb = first ? first.thumb : '';
  await db.putDoc(doc);
}

async function addPage(docId, orig, r) {
  const doc = (docId && await db.getDoc(docId)) || newDoc();
  const page = {
    id: uid(), docId: doc.id,
    orig: await toBlob(orig, 0.92), out: await toBlob(r.out), thumb: thumbOf(r.out),
    w: r.out.width, h: r.out.height,
    quad: r.quad, rot: r.rot, filter: r.filter, text: '', words: null,
  };
  await db.putPage(page);
  doc.pageIds.push(page.id);
  await touchDoc(doc);
  return doc;
}

// ---------- captura ----------
function capture(docId, camera) {
  target = docId;
  const inp = camera ? camIn : galIn;
  inp.value = '';
  inp.click();
}
camIn.onchange = () => handleFiles([...camIn.files]);
galIn.onchange = () => handleFiles([...galIn.files]);

async function getCV() {
  if (!window.cv?.Mat) busy('Preparando escáner…');
  try { return await loadCV(); } finally { busy(false); }
}

async function handleFiles(files) {
  if (!files.length) return;
  try {
    const cv = await getCV();
    if (files.length === 1) {
      busy('Detectando bordes…');
      await tick();
      const orig = await blobToCanvas(files[0]);
      const quad = detectQuad(cv, orig) || FULL_QUAD;
      busy(false);
      const r = await openEditor({ orig, quad, rot: 0, filter: prefs.get('filter', 'magic') });
      if (!r) return;
      busy('Guardando…');
      const doc = await addPage(target, orig, r);
      busy(false);
      showDoc(doc.id);
    } else {
      let doc = null;
      const filter = prefs.get('filter', 'magic');
      for (let i = 0; i < files.length; i++) {
        busy(`Procesando ${i + 1} de ${files.length}…`);
        await tick();
        const orig = await blobToCanvas(files[i]);
        const quad = detectQuad(cv, orig) || FULL_QUAD;
        const out = renderPage(cv, orig, quad, 0, filter);
        doc = await addPage(doc ? doc.id : target, orig, { out, quad, rot: 0, filter });
        out.width = orig.width = 0;
      }
      busy(false);
      toast(`${files.length} páginas agregadas`);
      showDoc(doc.id);
    }
  } catch (e) {
    busy(false);
    console.error(e);
    toast('Error: ' + e.message);
  }
}

// ---------- editor: recorte + filtro ----------
function openEditor(draft) {
  return new Promise(resolve => {
    const ed = overlay('editor', '');
    let quad = draft.quad.map(p => [...p]), rot = draft.rot || 0, filter = draft.filter || 'magic';
    let warped = null, cv = null;
    const orig = draft.orig;

    let onResize = () => {};
    const resized = () => onResize();
    window.addEventListener('resize', resized);
    const close = val => {
      if (warped) warped.delete();
      window.removeEventListener('resize', resized);
      ed.remove();
      resolve(val);
    };

    cropStep();

    function cropStep() {
      ed.innerHTML = `
        <header class="bar"><button class="txt" data-a="cancel">Cancelar</button><h1>Ajustar bordes</h1><button class="txt strong" data-a="next">Siguiente</button></header>
        <div class="stage"><div class="frame"><canvas class="img"></canvas><svg class="quad"></svg></div><canvas class="loupe" hidden></canvas></div>
        <footer class="toolbar">
          <button data-a="auto">${ICON.auto}<span>Auto</span></button>
          <button data-a="full">${ICON.full}<span>Todo</span></button>
        </footer>`;
      const stage = $('.stage', ed), frame = $('.frame', ed), img = $('.img', ed), sv = $('.quad', ed), loupe = $('.loupe', ed);
      let dw = 0, dh = 0, active = -1;
      const dpr = Math.min(3, window.devicePixelRatio || 1);

      function layout() {
        const r = stage.getBoundingClientRect();
        const pad = 28;
        const s = Math.min((r.width - pad * 2) / orig.width, (r.height - pad * 2) / orig.height);
        dw = Math.round(orig.width * s); dh = Math.round(orig.height * s);
        frame.style.width = dw + 'px'; frame.style.height = dh + 'px';
        img.width = Math.round(dw * dpr); img.height = Math.round(dh * dpr);
        img.getContext('2d').drawImage(orig, 0, 0, img.width, img.height);
        sv.setAttribute('viewBox', `0 0 ${dw} ${dh}`);
        draw();
      }
      function draw() {
        const pts = quad.map(([x, y]) => [x * dw, y * dh]);
        sv.innerHTML = `<polygon points="${pts.map(p => p.join(',')).join(' ')}"/>` +
          pts.map((p, i) => `<circle class="${i === active ? 'on' : ''}" cx="${p[0]}" cy="${p[1]}" r="11"/>`).join('');
      }
      function showLoupe(i) {
        const size = 120, zoom = 2.5;
        loupe.hidden = false;
        loupe.width = loupe.height = size * dpr;
        loupe.classList.toggle('right', quad[i][0] < 0.5);
        const ctx = loupe.getContext('2d');
        const span = size / (zoom * dw / orig.width); // ancho en píxeles originales
        const cx = quad[i][0] * orig.width, cy = quad[i][1] * orig.height;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, loupe.width, loupe.height);
        ctx.drawImage(orig, cx - span / 2, cy - span / 2, span, span, 0, 0, loupe.width, loupe.height);
        // Líneas del recorte dentro de la lupa
        const toL = ([x, y]) => [((x * orig.width - cx) / span + 0.5) * loupe.width, ((y * orig.height - cy) / span + 0.5) * loupe.height];
        ctx.strokeStyle = '#19c39a'; ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        const p = toL(quad[i]), a = toL(quad[(i + 1) % 4]), b = toL(quad[(i + 3) % 4]);
        ctx.moveTo(...a); ctx.lineTo(...p); ctx.lineTo(...b); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(loupe.width / 2 - 10 * dpr, loupe.height / 2); ctx.lineTo(loupe.width / 2 + 10 * dpr, loupe.height / 2);
        ctx.moveTo(loupe.width / 2, loupe.height / 2 - 10 * dpr); ctx.lineTo(loupe.width / 2, loupe.height / 2 + 10 * dpr);
        ctx.stroke();
      }
      const local = e => {
        const r = frame.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      stage.addEventListener('pointerdown', e => {
        const [x, y] = local(e);
        let best = -1, bd = 56;
        quad.forEach(([qx, qy], i) => {
          const d = Math.hypot(qx * dw - x, qy * dh - y);
          if (d < bd) { bd = d; best = i; }
        });
        if (best < 0) return;
        active = best;
        stage.setPointerCapture(e.pointerId);
        draw(); showLoupe(active);
        e.preventDefault();
      });
      stage.addEventListener('pointermove', e => {
        if (active < 0) return;
        const [x, y] = local(e);
        quad[active] = [Math.min(1, Math.max(0, x / dw)), Math.min(1, Math.max(0, y / dh))];
        draw(); showLoupe(active);
      });
      const end = () => { if (active >= 0) { active = -1; loupe.hidden = true; draw(); } };
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);

      ed.onclick = async e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'cancel') close(null);
        if (a === 'full') { quad = FULL_QUAD.map(p => [...p]); draw(); }
        if (a === 'auto') {
          cv = cv || await getCV();
          const q = detectQuad(cv, orig);
          if (q) { quad = q; draw(); } else toast('No se detectó el documento');
        }
        if (a === 'next') { quad = orderQuad(quad); filterStep(); }
      };
      onResize = layout;
      requestAnimationFrame(layout);
    }

    async function filterStep() {
      busy('Recortando…');
      await tick();
      cv = cv || await loadCV();
      if (warped) warped.delete();
      warped = warp(cv, orig, quad);
      busy(false);
      onResize = () => {};
      ed.innerHTML = `
        <header class="bar"><button class="txt" data-a="back">Atrás</button><h1>Filtro</h1><button class="txt strong" data-a="save">Guardar</button></header>
        <div class="stage"><canvas class="preview"></canvas></div>
        <div class="filters">${FILTERS.map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        <footer class="toolbar">
          <button data-a="rotL">${ICON.rotL}<span>Girar</span></button>
          <button data-a="crop">${ICON.crop}<span>Recortar</span></button>
          <button data-a="rotR">${ICON.rotR}<span>Girar</span></button>
        </footer>`;
      const preview = $('.preview', ed);
      const render = async () => {
        busy('Aplicando filtro…');
        await tick();
        const out = filterMat(cv, warped, filter, rot);
        cv.imshow(preview, out);
        out.delete();
        busy(false);
      };
      await render();
      ed.onclick = async e => {
        const f = e.target.closest('[data-f]')?.dataset.f;
        if (f && f !== filter) {
          filter = f;
          ed.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.f === f));
          await render();
          return;
        }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'back' || a === 'crop') cropStep();
        if (a === 'rotL') { rot = (rot + 270) % 360; await render(); }
        if (a === 'rotR') { rot = (rot + 90) % 360; await render(); }
        if (a === 'save') {
          prefs.set('filter', filter);
          close({ quad, rot, filter, out: preview });
        }
      };
    }
  });
}

// ---------- OCR ----------
let ocrWorker = null, ocrProgress = null;
async function getOCR() {
  if (ocrWorker) return ocrWorker;
  busy('Cargando reconocimiento de texto…');
  if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
  ocrWorker = await Tesseract.createWorker(['spa', 'eng'], 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/'),
    langPath: abs('vendor/tesseract/lang'),
    workerBlobURL: false,
    logger: m => ocrProgress && ocrProgress(m),
  });
  return ocrWorker;
}

async function ocrPages(doc, pages) {
  const todo = pages.filter(p => !p.words);
  if (!todo.length) return;
  try {
    const worker = await getOCR();
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      const label = todo.length > 1 ? `Leyendo texto (${i + 1}/${todo.length})` : 'Leyendo texto';
      busy(label + '…');
      ocrProgress = m => { if (m.status === 'recognizing text') busy(`${label}… ${Math.round(m.progress * 100)}%`); };
      const { data } = await worker.recognize(p.out);
      p.text = data.text.trim();
      p.words = (data.words || []).filter(w => w.confidence > 30)
        .map(w => [w.text, w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1]);
      await db.putPage(p);
      doc.texts[p.id] = p.text;
    }
    await db.putDoc(doc);
  } finally {
    ocrProgress = null;
    busy(false);
  }
}

async function showText(doc, pages) {
  await ocrPages(doc, pages);
  const text = pages.map((p, i) => (pages.length > 1 ? `— Página ${doc.pageIds.indexOf(p.id) + 1} —\n` : '') + (p.text || '(sin texto)')).join('\n\n');
  const el = overlay('editor', `
    <header class="bar"><button class="icon" data-a="close" aria-label="Cerrar">${ICON.close}</button><h1>Texto</h1><span class="spacer"></span></header>
    <textarea class="ocr-text">${esc(text)}</textarea>
    <footer class="toolbar">
      <button data-a="copy">${ICON.copy}<span>Copiar</span></button>
      <button data-a="share">${ICON.share}<span>Compartir</span></button>
    </footer>`);
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const val = $('.ocr-text', el).value;
    if (a === 'close') el.remove();
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(val); toast('Texto copiado'); }
      catch { $('.ocr-text', el).select(); document.execCommand('copy'); toast('Texto copiado'); }
    }
    if (a === 'share') {
      try { await navigator.share({ title: doc.name, text: val }); }
      catch (err) { if (err.name !== 'AbortError') toast('No se pudo compartir'); }
    }
  };
}

// ---------- PDF y compartir ----------
export async function buildPdf(doc) {
  if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const pages = await db.getPages(doc);
  let pdf = null;
  for (const p of pages) {
    const pw = 595.28, ph = pw * p.h / p.w; // ancho A4, alto proporcional
    const orient = pw > ph ? 'l' : 'p';
    if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [pw, ph], orientation: orient, compress: true });
    else pdf.addPage([pw, ph], orient);
    pdf.addImage(await blobToDataURL(p.out), 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
    if (p.words?.length) {
      // Capa de texto invisible: el PDF queda con texto buscable y seleccionable.
      const k = pw / p.w;
      for (const [t, x0, y0, x1, y1] of p.words) {
        try {
          const size = Math.max(1, (y1 - y0) * k);
          pdf.setFontSize(size);
          const natural = pdf.getTextWidth(t) || 1;
          pdf.text(t, x0 * k, y1 * k, { renderingMode: 'invisible', baseline: 'bottom', horizontalScale: ((x1 - x0) * k) / natural });
        } catch {}
      }
    }
  }
  return pdf.output('blob');
}

const fileName = (doc, ext) => doc.name.replace(/[\\/:*?"<>|]+/g, '-') + '.' + ext;

// iOS exige que share() venga de un toque directo; si el trabajo previo tardó
// demasiado, se ofrece un segundo botón para compartir.
async function shareFiles(files, title) {
  const data = { files, title };
  if (!navigator.canShare?.(data)) return download(files[0]);
  try {
    await navigator.share(data);
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (e.name === 'NotAllowedError') {
      const k = await sheet('Listo para compartir', [{ k: 'go', label: 'Compartir', icon: ICON.share }]);
      if (k) return navigator.share(data).catch(() => {});
      return;
    }
    download(files[0]);
  }
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function sharePdf(doc, save) {
  busy('Generando PDF…');
  try {
    const blob = await buildPdf(doc);
    const file = new File([blob], fileName(doc, 'pdf'), { type: 'application/pdf' });
    busy(false);
    if (save) download(file); else await shareFiles([file], doc.name);
  } catch (e) {
    console.error(e);
    toast('Error al generar PDF');
  } finally {
    busy(false);
  }
}

// ---------- pantalla: inicio ----------
async function showHome() {
  target = null;
  const docs = await db.listDocs();
  app.innerHTML = `
    <header class="bar main"><h1>Escáner</h1></header>
    <div class="search">${svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}<input type="search" placeholder="Buscar en nombres y texto" aria-label="Buscar"></div>
    <ul class="docs"></ul>
    <div class="empty" ${docs.length ? 'hidden' : ''}>${ICON.doc}<p>Aún no hay documentos</p><small>Toca el botón de la cámara para escanear tu primer documento.</small></div>
    <div class="fabs">
      <button class="fab small" data-a="gallery" aria-label="Importar de fotos">${ICON.image}</button>
      <button class="fab" data-a="camera" aria-label="Escanear">${ICON.camera}</button>
    </div>`;
  const list = $('.docs', app);
  const renderList = q => {
    q = q.trim().toLowerCase();
    const shown = !q ? docs : docs.filter(d => (d.name + ' ' + Object.values(d.texts || {}).join(' ')).toLowerCase().includes(q));
    list.innerHTML = shown.map(d => `
      <li data-doc="${d.id}">
        <div class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : ''}</div>
        <div class="meta"><b>${esc(d.name)}</b><small>${new Date(d.updated).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.pageIds.length} ${d.pageIds.length === 1 ? 'página' : 'páginas'}</small></div>
        <button class="icon" data-more="${d.id}" aria-label="Opciones">${ICON.more}</button>
      </li>`).join('') || (q ? `<li class="none">Sin resultados para “${esc(q)}”</li>` : '');
  };
  renderList('');
  $('.search input', app).oninput = e => renderList(e.target.value);
  app.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) return capture(null, a === 'camera');
    const more = e.target.closest('[data-more]')?.dataset.more;
    if (more) return docMenu(docs.find(d => d.id === more), showHome);
    const li = e.target.closest('[data-doc]');
    if (li) showDoc(li.dataset.doc);
  };
}

async function docMenu(doc, after) {
  const k = await sheet(doc.name, [
    { k: 'share', label: 'Compartir PDF', icon: ICON.share },
    { k: 'save', label: 'Guardar PDF', icon: ICON.pdf },
    { k: 'rename', label: 'Renombrar', icon: ICON.text },
    { k: 'del', label: 'Eliminar documento', icon: ICON.trash, danger: true },
  ]);
  if (k === 'share' || k === 'save') return sharePdf(doc, k === 'save');
  if (k === 'rename') {
    const name = await ask('Nombre del documento', doc.name);
    if (name) { doc.name = name; await db.putDoc(doc); after(); }
  }
  if (k === 'del' && await confirmBox(`¿Eliminar “${doc.name}”?`)) {
    await db.deleteDoc(doc);
    toast('Documento eliminado');
    showHome();
  }
}

// ---------- pantalla: documento ----------
async function showDoc(id) {
  const doc = await db.getDoc(id);
  if (!doc) return showHome();
  if (!doc.pageIds.length) { await db.deleteDoc(doc); return showHome(); }
  target = doc.id;
  const pages = await db.getPages(doc);
  app.innerHTML = `
    <header class="bar"><button class="icon" data-a="home" aria-label="Volver">${ICON.back}</button><h1 data-a="rename">${esc(doc.name)}</h1><button class="icon" data-a="menu" aria-label="Opciones">${ICON.more}</button></header>
    <div class="pages">${pages.map((p, i) => `
      <button class="page" data-p="${i}"><img src="${p.thumb}" alt="Página ${i + 1}"><span>${i + 1}</span></button>`).join('')}
    </div>
    <footer class="toolbar">
      <button data-a="gallery">${ICON.image}<span>Fotos</span></button>
      <button data-a="text">${ICON.text}<span>Texto</span></button>
      <button class="primary" data-a="camera" aria-label="Escanear otra página">${ICON.camera}</button>
      <button data-a="pdf">${ICON.pdf}<span>PDF</span></button>
      <button data-a="share">${ICON.share}<span>Compartir</span></button>
    </footer>`;
  app.onclick = async e => {
    const pi = e.target.closest('[data-p]')?.dataset.p;
    if (pi !== undefined) return showPage(doc, +pi);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'home') showHome();
    if (a === 'camera' || a === 'gallery') capture(doc.id, a === 'camera');
    if (a === 'menu') docMenu(doc, () => showDoc(doc.id));
    if (a === 'rename') {
      const name = await ask('Nombre del documento', doc.name);
      if (name) { doc.name = name; await db.putDoc(doc); showDoc(doc.id); }
    }
    if (a === 'text') showText(doc, pages).catch(err => { console.error(err); toast('Error al leer el texto'); });
    if (a === 'pdf') sharePdf(doc, true);
    if (a === 'share') sharePdf(doc, false);
  };
}

// ---------- visor de página ----------
async function showPage(doc, idx) {
  const page = await db.getPage(doc.pageIds[idx]);
  const url = URL.createObjectURL(page.out);
  const n = doc.pageIds.length;
  const el = overlay('editor viewer', `
    <header class="bar"><button class="icon" data-a="close" aria-label="Cerrar">${ICON.close}</button><h1>Página ${idx + 1} de ${n}</h1><button class="icon danger" data-a="del" aria-label="Eliminar página">${ICON.trash}</button></header>
    <div class="stage"><img src="${url}" alt=""></div>
    <footer class="toolbar">
      <button data-a="left" ${idx === 0 ? 'disabled' : ''}>${ICON.left}<span>Mover</span></button>
      <button data-a="edit">${ICON.crop}<span>Editar</span></button>
      <button data-a="text">${ICON.text}<span>Texto</span></button>
      <button data-a="share">${ICON.share}<span>Imagen</span></button>
      <button data-a="right" ${idx === n - 1 ? 'disabled' : ''}>${ICON.right}<span>Mover</span></button>
    </footer>`);
  const close = () => { URL.revokeObjectURL(url); el.remove(); };
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') { close(); showDoc(doc.id); }
    if (a === 'left' || a === 'right') {
      const j = a === 'left' ? idx - 1 : idx + 1;
      [doc.pageIds[idx], doc.pageIds[j]] = [doc.pageIds[j], doc.pageIds[idx]];
      await touchDoc(doc);
      close();
      await showDoc(doc.id);
      showPage(doc, j);
    }
    if (a === 'text') showText(doc, [page]).catch(err => { console.error(err); toast('Error al leer el texto'); });
    if (a === 'share') {
      const f = new File([page.out], fileName(doc, 'jpg').replace(/\.jpg$/, ` - p${idx + 1}.jpg`), { type: 'image/jpeg' });
      shareFiles([f], doc.name);
    }
    if (a === 'del' && await confirmBox('¿Eliminar esta página?')) {
      doc.pageIds.splice(idx, 1);
      delete doc.texts[page.id];
      await db.deletePage(page.id);
      await touchDoc(doc);
      close();
      showDoc(doc.id);
    }
    if (a === 'edit') {
      try {
        await getCV();
        const orig = await blobToCanvas(page.orig);
        const r = await openEditor({ orig, quad: page.quad, rot: page.rot, filter: page.filter });
        if (!r) return;
        busy('Guardando…');
        Object.assign(page, {
          out: await toBlob(r.out), thumb: thumbOf(r.out), w: r.out.width, h: r.out.height,
          quad: r.quad, rot: r.rot, filter: r.filter, text: '', words: null,
        });
        await db.putPage(page);
        delete doc.texts[page.id];
        await touchDoc(doc);
        busy(false);
        close();
        await showDoc(doc.id);
        showPage(doc, idx);
      } catch (err) {
        busy(false);
        console.error(err);
        toast('Error: ' + err.message);
      }
    }
  };
}

// ---------- arranque ----------
showHome();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
navigator.storage?.persist?.().catch(() => {});
// Precarga el motor de escaneo en segundo plano para que la primera captura sea rápida.
setTimeout(() => loadCV().catch(() => {}), 1500);
