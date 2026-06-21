// Background + LCD-segment rasterisation and preview compositing.

export const GW_W = 320, GW_H = 240, NB_SEG = 256;

/* ---------- image helpers -------------------------------------------------- */
function loadImageFromBytes(bytes, mime) {
  return new Promise((res, rej) => {
    const blob = new Blob([bytes], { type: mime }); const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image unreadable')); };
    img.src = url;
  });
}
function svgImage(svgText, w, h) {
  return new Promise((res, rej) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image(); img.width = w; img.height = h;
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('SVG unreadable')); };
    img.src = url;
  });
}

/* ---------- background builder --------------------------------------------- */
export async function buildBackground(pngBytes, geo, keepAspect, bgRes, bgJpeg, jpegQ) {
  const img = await loadImageFromBytes(pngBytes, 'image/png');
  const canvas = document.createElement('canvas'); canvas.width = GW_W; canvas.height = GW_H;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, GW_W, GW_H);

  let dw = GW_W, dh = GW_H, dx = 0, dy = 0;
  if (keepAspect) {
    const sx = GW_W / geo.background_width, sy = GW_H / geo.background_height;
    if (sx < sy) { dw = GW_W; dh = Math.round(sx * geo.background_height); dx = 0; dy = Math.round((GW_H - dh) / 2); }
    else { dh = GW_H; dw = Math.round(sy * geo.background_width); dy = 0; dx = Math.round((GW_W - dw) / 2); }
  }
  // draw the artwork composited on white first
  const tmp = document.createElement('canvas'); tmp.width = img.naturalWidth; tmp.height = img.naturalHeight;
  const tctx = tmp.getContext('2d'); tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, tmp.width, tmp.height);
  tctx.drawImage(img, 0, 0);
  ctx.drawImage(tmp, dx, dy, dw, dh);

  // RGB565 little-endian, with optional resolution reduction (matches shrink_it.py rounding)
  const id = ctx.getImageData(0, 0, GW_W, GW_H).data;
  const rgb565 = new Uint8Array(GW_W * GW_H * 2);
  let o = 0;
  for (let i = 0; i < id.length; i += 4) {
    let r = id[i], g = id[i + 1], b = id[i + 2];
    r = bgRes * 8 * Math.round(r / (bgRes * 8)); g = bgRes * 4 * Math.round(g / (bgRes * 4)); b = bgRes * 8 * Math.round(b / (bgRes * 8));
    if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
    const rr = (r >> 3) & 0x1f, gg = (g >> 2) & 0x3f, bb = (b >> 3) & 0x1f;
    const v = ((rr << 11) + (gg << 5) + bb) & 0xffff;
    rgb565[o++] = v & 0xff; rgb565[o++] = (v >> 8) & 0xff;
  }

  let jpeg = null;
  if (bgJpeg) {
    const region = document.createElement('canvas');
    region.width = dw; region.height = dh;
    region.getContext('2d').drawImage(tmp, 0, 0, dw, dh);
    const blob = await new Promise((res) => region.toBlob(res, 'image/jpeg', jpegQ));
    jpeg = new Uint8Array(await blob.arrayBuffer());
  }
  return { rgb565, jpeg, canvas };
}

/* ---------- segments builder ----------------------------------------------- */
export async function buildSegments(svgText, geo, keepAspect, invert, cpuType, segBits, dropShadow) {
  const parser = new DOMParser();
  const sdoc = parser.parseFromString(svgText, 'image/svg+xml');
  const srcSvg = sdoc.documentElement;
  if (srcSvg.nodeName === 'parsererror') throw new Error("Segments SVG unreadable");

  const vb = (srcSvg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let vbw = vb[2], vbh = vb[3];
  if (!vbw || !vbh) { vbw = parseFloat(srcSvg.getAttribute('width')) || geo.screen_width; vbh = parseFloat(srcSvg.getAttribute('height')) || geo.screen_height; }

  // affine: original svg user space -> final 320×240, through MAME background space
  let a = (geo.screen_width / vbw) * (GW_W / geo.background_width);
  let d = (geo.screen_height / vbh) * (GW_H / geo.background_height);
  let e = (geo.screen_x - geo.background_x) * (GW_W / geo.background_width);
  let f = (geo.screen_y - geo.background_y) * (GW_H / geo.background_height);
  // aspect-ratio variant: scale the whole MAME figure uniformly into 320×240 and center
  if (keepAspect) {
    const sx = GW_W / geo.background_width, sy = GW_H / geo.background_height;
    const s = Math.min(sx, sy);
    const mvx = (GW_W - s * geo.background_width) / 2, mvy = (GW_H - s * geo.background_height) / 2;
    a = (geo.screen_width / vbw) * s; d = (geo.screen_height / vbh) * s;
    e = (geo.screen_x - geo.background_x) * s + mvx; f = (geo.screen_y - geo.background_y) * s + mvy;
  }
  const matrix = `matrix(${a},0,0,${d},${e},${f})`;

  // --- drop shadow (experimental): faithful port of LCD-Game-Shrinker ---------
  const shadow = !!dropShadow && !invert; // original only shadows non-inverted LCDs
  const ssx = vbw / geo.screen_width, ssy = vbh / geo.screen_height; // MAME-screen unit → local unit
  const SH_OFFSET = 19, SH_BLUR = 6;
  const shDx = SH_OFFSET * ssx, shDy = SH_OFFSET * ssy;     // feOffset in local units
  const shBX = SH_BLUR * ssx, shBY = SH_BLUR * ssy;         // feGaussianBlur (per-axis) in local units
  const SHADOW_FILTER =
    `<filter id="gw_drop_shadow" x="0" y="0" width="200%" height="200%">` +
    `<feFlood flood-opacity="0.4" flood-color="rgb(0,0,0)" result="flood"/>` +
    `<feComposite in="SourceGraphic" in2="flood" operator="in" result="composite1"/>` +
    `<feGaussianBlur in="composite1" stdDeviation="${shBX} ${shBY}" result="blur"/>` +
    `<feOffset in="blur" dx="${shDx}" dy="${shDy}" result="offset"/>` +
    `<feComposite in="SourceGraphic" in2="offset" operator="over"/>` +
    `</filter>`;
  const filterDefs = shadow ? `<defs>${SHADOW_FILTER}</defs>` : '';
  // render-region margins in FINAL px = actual shadow extent (offset + ~3σ blur)
  const finOffX = shDx * a, finOffY = shDy * d, finBlX = shBX * a, finBlY = shBY * d;
  const mLx = shadow ? Math.ceil(3 * finBlX) + 3 : 0, mTy = shadow ? Math.ceil(3 * finBlY) + 3 : 0;
  const mRx = shadow ? Math.ceil(finOffX + 3 * finBlX) + 3 : 0, mBy = shadow ? Math.ceil(finOffY + 3 * finBlY) + 3 : 0;

  // gather <defs> markup (for gradient/filter references in segments)
  let defsMarkup = '';
  for (const defs of srcSvg.querySelectorAll('defs')) defsMarkup += defs.outerHTML;

  // Build a hidden, scaled SVG to measure each segment's bbox in final px.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + GW_W + 'px;height:' + GW_H + 'px;';
  const measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  measureSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  measureSvg.setAttribute('width', GW_W); measureSvg.setAttribute('height', GW_H);
  measureSvg.setAttribute('viewBox', `0 0 ${GW_W} ${GW_H}`);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', matrix);
  for (const child of Array.from(srcSvg.childNodes)) g.appendChild(document.importNode(child, true));
  measureSvg.appendChild(g);
  host.appendChild(measureSvg);
  document.body.appendChild(host);

  // find segment elements: those with exactly one <title> child whose text is "x.y.z"
  const tab_x = new Array(NB_SEG).fill(0), tab_y = new Array(NB_SEG).fill(0),
    tab_w = new Array(NB_SEG).fill(0), tab_h = new Array(NB_SEG).fill(0),
    tab_off = new Array(NB_SEG).fill(0);
  const segElems = new Array(NB_SEG).fill(null);
  const svgRect = measureSvg.getBoundingClientRect();
  const pxPerUnit = svgRect.width / GW_W; // ~1

  const titled = measureSvg.querySelectorAll('title');
  const isSM5A = (cpuType === 'SM5A___');
  let count = 0;
  titled.forEach((titleEl) => {
    const txt = (titleEl.textContent || '').trim();
    const m = txt.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return;
    const owner = titleEl.parentNode;
    if (!owner || owner === measureSvg) return;
    if (owner.getElementsByTagName('title').length !== 1) return;
    const x = +m[1], y = +m[2], z = +m[3];
    const segPos = isSM5A ? (8 * x + 2 * y + z) : (64 * x + 4 * y + z);
    if (segPos < 0 || segPos >= NB_SEG) return;
    let r;
    try { r = owner.getBoundingClientRect(); } catch (_) { return; }
    if (r.width <= 0 || r.height <= 0) return;
    const fx = (r.left - svgRect.left) / pxPerUnit, fy = (r.top - svgRect.top) / pxPerUnit;
    const fw = r.width / pxPerUnit, fh = r.height / pxPerUnit;
    segElems[segPos] = owner;
    tab_x[segPos] = Math.trunc(fx); tab_y[segPos] = Math.trunc(fy);
    tab_w[segPos] = fw; tab_h[segPos] = fh; // refined below from raster
    count++;
  });

  // rasterize each present segment individually (white/black bg per invert)
  const segChunks = []; let totalLen = 0;
  const bgColor = invert ? '#000000' : '#FFFFFF';
  for (let pos = 0; pos < NB_SEG; pos++) {
    if (!segElems[pos]) continue;
    const x0 = tab_x[pos], y0 = tab_y[pos];
    let w = Math.max(1, Math.ceil(tab_w[pos])), h = Math.max(1, Math.ceil(tab_h[pos]));

    if (!shadow) {
      // ---- standard path: region = the segment's snapped bbox ----
      const one =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}">` +
        `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${bgColor}"/>` +
        `<g transform="${matrix}">${defsMarkup}${serialize(segElems[pos])}</g></svg>`;
      const img = await svgImage(one, w, h);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = bgColor; cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      const data = cx.getImageData(0, 0, w, h).data;

      let cropRight = 0, cropBottom = 0, cropLeft = 0, cropTop = 0, X = x0, Y = y0;
      if (X + w > GW_W) cropRight = (X + w) - GW_W;
      if (Y + h > GW_H) cropBottom = (Y + h) - GW_H;
      if (X < 0) { cropLeft = -X; X = 0; }
      if (Y < 0) { cropTop = -Y; Y = 0; }
      const fw2 = Math.max(1, w - cropLeft - cropRight), fh2 = Math.max(1, h - cropTop - cropBottom);

      const bytes = new Uint8Array(fw2 * fh2);
      let k = 0;
      for (let yy = cropTop; yy < cropTop + fh2; yy++) {
        for (let xx = cropLeft; xx < cropLeft + fw2; xx++) {
          bytes[k++] = data[(yy * w + xx) * 4 + 1]; // green channel
        }
      }
      tab_x[pos] = X; tab_y[pos] = Y; tab_w[pos] = fw2; tab_h[pos] = fh2;
      tab_off[pos] = totalLen;
      segChunks.push(bytes); totalLen += bytes.length;
      continue;
    }

    // ---- drop-shadow path: render an expanded region, then crop to content ----
    const rx = x0 - mLx, ry = y0 - mTy, rw = w + mLx + mRx, rh = h + mTy + mBy;
    const elClone = segElems[pos].cloneNode(true);
    elClone.setAttribute('filter', 'url(#gw_drop_shadow)');
    const one =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" viewBox="${rx} ${ry} ${rw} ${rh}">` +
      `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${bgColor}"/>` +
      `<g transform="${matrix}">${defsMarkup}${filterDefs}${serialize(elClone)}</g></svg>`;
    const img = await svgImage(one, rw, rh);
    const c = document.createElement('canvas'); c.width = rw; c.height = rh;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = bgColor; cx.fillRect(0, 0, rw, rh);
    cx.drawImage(img, 0, 0, rw, rh);
    const data = cx.getImageData(0, 0, rw, rh).data;

    let maxX = -1, maxY = -1;
    for (let yy = 0; yy < rh; yy++) {
      for (let xx = 0; xx < rw; xx++) {
        if (data[(yy * rw + xx) * 4 + 1] !== 255) { if (xx > maxX) maxX = xx; if (yy > maxY) maxY = yy; }
      }
    }
    if (maxX < 0) continue; // nothing rendered
    const startX = mLx, startY = mTy;               // no-shadow top-left, in region px
    maxX = Math.max(maxX, startX); maxY = Math.max(maxY, startY);
    const cw = maxX - startX + 1, ch = maxY - startY + 1;

    let X = x0, Y = y0, cropRight = 0, cropBottom = 0, cropLeft = 0, cropTop = 0;
    if (X + cw > GW_W) cropRight = (X + cw) - GW_W;
    if (Y + ch > GW_H) cropBottom = (Y + ch) - GW_H;
    if (X < 0) { cropLeft = -X; X = 0; }
    if (Y < 0) { cropTop = -Y; Y = 0; }
    const fw2 = Math.max(1, cw - cropLeft - cropRight), fh2 = Math.max(1, ch - cropTop - cropBottom);

    const bytes = new Uint8Array(fw2 * fh2);
    let k = 0;
    for (let yy = startY + cropTop; yy < startY + cropTop + fh2; yy++) {
      for (let xx = startX + cropLeft; xx < startX + cropLeft + fw2; xx++) {
        bytes[k++] = data[(yy * rw + xx) * 4 + 1];
      }
    }
    tab_x[pos] = X; tab_y[pos] = Y; tab_w[pos] = fw2; tab_h[pos] = fh2;
    tab_off[pos] = totalLen;
    segChunks.push(bytes); totalLen += bytes.length;
  }

  // concat 8-bit data
  let segData8 = new Uint8Array(totalLen); { let p = 0; for (const c of segChunks) { segData8.set(c, p); p += c.length; } }
  // pad to even for sub-byte packing
  if (segData8.length % 2 !== 0) { const t = new Uint8Array(segData8.length + 1); t.set(segData8); t[segData8.length] = 0x50; segData8 = t; }

  // produce requested resolution
  let segData = segData8;
  if (segBits === 4) {
    segData = new Uint8Array(segData8.length >> 1);
    for (let i = 0, j = 0; i + 1 < segData8.length; i += 2, j++) { segData[j] = ((segData8[i] >> 4) << 4) | (segData8[i + 1] >> 4); }
  } else if (segBits === 2) {
    const n = segData8.length >> 2; segData = new Uint8Array(n);
    for (let i = 0, j = 0; i + 3 < segData8.length; i += 4, j++) {
      const a2 = segData8[i] >> 6, b2 = segData8[i + 1] >> 6, c2 = segData8[i + 2] >> 6, d2 = segData8[i + 3] >> 6;
      segData[j] = (d2 << 6) | (c2 << 4) | (b2 << 2) | a2;
    }
  }

  // coordinate tables (256 entries)
  const sgx = u16tab(tab_x), sgy = u16tab(tab_y), sgw = u16tab(tab_w), sgh = u16tab(tab_h), sgo = u32tab(tab_off);

  // build the composite preview of all segments (full scaled svg) for the screen panel
  let previewInner;
  if (shadow) {
    for (let pos = 0; pos < NB_SEG; pos++) if (segElems[pos]) segElems[pos].setAttribute('filter', 'url(#gw_drop_shadow)');
    previewInner = filterDefs + innerSerialize(g);
  } else {
    previewInner = innerSerialize(srcSvg);
  }
  const previewSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GW_W}" height="${GW_H}" viewBox="0 0 ${GW_W} ${GW_H}">` +
    `<rect width="${GW_W}" height="${GW_H}" fill="${bgColor}"/>` +
    `<g transform="${matrix}">${previewInner}</g></svg>`;
  const previewImg = await svgImage(previewSvg, GW_W, GW_H);
  const pc = document.createElement('canvas'); pc.width = GW_W; pc.height = GW_H;
  const pcx = pc.getContext('2d'); pcx.fillStyle = bgColor; pcx.fillRect(0, 0, GW_W, GW_H); pcx.drawImage(previewImg, 0, 0);

  document.body.removeChild(host);

  return { count, segData, sgo, sgx, sgy, sgh, sgw, previewCanvas: pc };
}

function serialize(node) { return new XMLSerializer().serializeToString(node); }
function innerSerialize(root) { let s = ''; for (const c of root.childNodes) s += new XMLSerializer().serializeToString(c); return s; }
function u16tab(arr) {
  const b = new Uint8Array(NB_SEG * 2); const dv = new DataView(b.buffer);
  for (let i = 0; i < NB_SEG; i++) dv.setUint16(i * 2, (arr[i] | 0) & 0xffff, true); return b;
}
function u32tab(arr) {
  const b = new Uint8Array(NB_SEG * 4); const dv = new DataView(b.buffer);
  for (let i = 0; i < NB_SEG; i++) dv.setUint32(i * 4, (arr[i] >>> 0), true); return b;
}

/* ---------- preview render ------------------------------------------------- */
export function drawPreview(target, bgCanvas, segCanvas, invert) {
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, GW_W, GW_H);
  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
  else { ctx.fillStyle = invert ? '#000' : '#a7b27a'; ctx.fillRect(0, 0, GW_W, GW_H); }
  if (segCanvas) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(segCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}
