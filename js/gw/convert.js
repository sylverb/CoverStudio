// Orchestrates the full MAME → .gw conversion. UI-agnostic: takes file buffers
// + options + an onLog callback + a target preview canvas, returns { bytes, name }.

import { readZip } from "./zip.js";
import { compressFrame } from "./lz4.js";
import { getMameCpp, parseConsLine, detectCpu, fetchCustom, FLAG_SOUND_R1_PIEZO } from "./mame.js";
import { parseLayout } from "./layout.js";
import { buildBackground, buildSegments, drawPreview } from "./render.js";
import { assembleGw } from "./assemble.js";

export function fmtSize(n) {
  return n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo";
}
function baseName(path) { const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')); return i >= 0 ? path.slice(i + 1) : path; }
function stripExt(name) { if (!name) return 'rom'; const b = baseName(name); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; }

export async function convertGw({ romBuf, romFileName, artBuf, artFileName, opts, onLog, previewCanvas }) {
  const log = (m, c) => onLog && onLog(m, c);
  const t0 = performance.now();

  // 1) read zips (merge rom + artwork; either can be a single combined zip)
  log("» reading archives…", 'info');
  const files = new Map();
  if (romBuf) for (const [k, v] of await readZip(romBuf)) files.set(baseName(k), v);
  if (artBuf) for (const [k, v] of await readZip(artBuf)) files.set(baseName(k), v);
  if (files.size === 0) throw new Error("No usable file in the archives.");

  // 2) determine rom_name (basename of the rom zip, else artwork zip)
  const romName = stripExt(romFileName || artFileName);
  log("  rom_name = " + romName, 't');

  // 3) locate member files
  let programName = null, melodyName = null, svgName = null, layName = null;
  for (const k of files.keys()) {
    const ext = (k.indexOf('.') >= 0) ? k.slice(k.lastIndexOf('.')).toLowerCase() : '';
    if (k.startsWith('.')) continue;
    if (ext === '.program' || ext === '.bin') programName = k;
    if (ext === '') programName = programName || k;
    if (ext === '.melody') melodyName = k;
    if (ext === '.svg') svgName = (k.toLowerCase() === romName.toLowerCase() + '.svg') ? k : (svgName || k);
    if (k.toLowerCase() === 'default.lay') layName = k;
  }
  if (!svgName) throw new Error("Segments .svg file not found.");
  if (!programName) throw new Error("Program file (.program/.bin) not found.");
  if (!layName) throw new Error("default.lay not found (it's in the artwork).");
  log("  program = " + programName + (melodyName ? (", melody = " + melodyName) : "") + ", svg = " + svgName, 't');

  // 4) metadata
  let fullname = (opts.name || '').trim() || null;
  let cpuType = opts.cpu || null;
  let deflicker = 2;
  if ((!fullname || !cpuType) && opts.allowFetch) {
    try {
      log("» MAME metadata (hh_sm510.cpp)…", 'info');
      const cpp = await getMameCpp();
      const cons = parseConsLine(cpp, romName);
      if (cons) {
        if (!fullname) fullname = cons.fullname;
        const cpuInfo = detectCpu(cpp, cons.mame_class, cons.mame_name);
        if (cpuInfo) { if (!cpuType) cpuType = cpuInfo.cpu; deflicker = cpuInfo.deflicker; }
        log("  found: " + cons.fullname + "  [" + (cpuType || '?') + "]", 'ok');
      } else log("  ⚠ MAME entry not found for " + romName + " — use the overrides.", 'warn');
    } catch (e) { log("  ⚠ MAME fetch failed (" + e.message + "). Fill in CPU + name.", 'warn'); }
  }
  if (!fullname) fullname = romName;
  if (!cpuType) throw new Error("Unknown CPU type — set it under Metadata & advanced.");
  log("  CPU = " + cpuType + ", name = " + fullname, 't');

  // 5) inverted-lcd auto from fullname
  let invert = !!opts.invert;
  if (/Panorama Screen|Table Top/i.test(fullname)) invert = true;

  // 6) custom button/RTC (best-effort)
  let btnData = new Array(10).fill(0);
  let rtc = {
    ADD_TIME_HOUR_MSB: 0, ADD_TIME_HOUR_LSB: 0, ADD_TIME_MIN_MSB: 0, ADD_TIME_MIN_LSB: 0,
    ADD_TIME_SEC_MSB: 0, ADD_TIME_SEC_LSB: 0, ADD_TIME_HOUR_MSB_PM_VALUE: 0,
  };
  let dropShadow = !!opts.dropShadow;
  let keepAspect = !!opts.keepAspect;
  if (opts.fetchBtn) {
    log("» button mapping (custom/" + romName + ".py)…", 'info');
    const cust = await fetchCustom(romName);
    if (cust) {
      if (cust.BTN_DATA) { btnData = cust.BTN_DATA; log("  buttons imported (" + btnData.filter((x) => x).length + " active columns)", 'ok'); }
      else log("  ⚠ BTN_DATA not found in the script — buttons not mapped.", 'warn');
      for (const k in cust.time) rtc[k] = cust.time[k];
      if (cust.invert !== null) invert = cust.invert;
      if (cust.aspect !== null && !keepAspect) keepAspect = cust.aspect;
      if (cust.drop === true && !dropShadow) { dropShadow = true; log("  drop shadow enabled by the custom script", 't'); }
    } else log("  ⚠ no custom script for this game — buttons set to 0 (playable but without inputs).", 'warn');
  }

  const segBits = opts.segBits;
  const bgJpeg = opts.bg === 'jpeg';
  const jpegQ = Math.min(100, Math.max(40, opts.jpegQ || 90)) / 100;
  const bgRes = opts.bgRes;

  // 7) geometry from default.lay
  log("» geometry (default.lay)…", 'info');
  const geo = parseLayout(new TextDecoder().decode(files.get(layName)));
  if (!geo.found || !geo.background_width) {
    throw new Error("Could not extract geometry from default.lay.");
  }
  log("  background " + geo.background_width + "×" + geo.background_height +
    " @(" + geo.background_x + "," + geo.background_y + "), screen " + geo.screen_width + "×" + geo.screen_height +
    " @(" + geo.screen_x + "," + geo.screen_y + ")  bg=" + geo.background_file, 't');

  // 8) BACKGROUND → 320×240 → RGB565 (+ optional JPEG)
  log("» processing background…", 'info');
  let bgd565 = null, jpegBytes = null, bgCanvas = null;
  const bgBytes = files.get(geo.background_file) || files.get(baseName(geo.background_file));
  if (bgBytes) {
    const r = await buildBackground(bgBytes, geo, keepAspect, bgRes, bgJpeg, jpegQ);
    bgd565 = r.rgb565; jpegBytes = r.jpeg; bgCanvas = r.canvas;
  } else log("  ⚠ background not found (" + geo.background_file + ")", 'warn');

  // 9) SEGMENTS
  log("» LCD segments (SVG rendering)…" + (dropShadow && !invert ? " + drop shadow" : ""), 'info');
  const svgText = new TextDecoder().decode(files.get(svgName));
  const seg = await buildSegments(svgText, geo, keepAspect, invert, cpuType, segBits, dropShadow);
  log("  " + seg.count + " segments extracted, data " + seg.segData.length + " B", 'ok');

  // 10) preview (background × segments)
  if (previewCanvas) drawPreview(previewCanvas, bgCanvas, seg.previewCanvas, invert);

  // 11) assemble + compress
  log("» assembling the .gw…", 'info');
  const program = files.get(programName);
  const melody = melodyName ? files.get(melodyName) : new Uint8Array(0);

  const gwRaw = assembleGw({
    cpuType, romName, rtc, invert,
    flagSound: FLAG_SOUND_R1_PIEZO, segBits, bgJpeg, deflicker,
    sectionBgd: (bgJpeg ? new Uint8Array(0) : (bgd565 || new Uint8Array(0))),
    sectionSgd: seg.segData, sgo: seg.sgo, sgx: seg.sgx, sgy: seg.sgy, sgh: seg.sgh, sgw: seg.sgw,
    melody, program, btnData,
  });
  log("  uncompressed payload: " + fmtSize(gwRaw.length), 't');

  let compressed = compressFrame(gwRaw);
  // final = lz4 frame (+ jpeg appended if jpeg flag)
  let finalBytes;
  if (bgJpeg && jpegBytes) {
    finalBytes = new Uint8Array(compressed.length + jpegBytes.length);
    finalBytes.set(compressed, 0); finalBytes.set(jpegBytes, compressed.length);
  } else finalBytes = compressed;

  const outName = fullname.replace(/:/g, '').trim() + ".gw";
  const dt = ((performance.now() - t0) / 1000).toFixed(2);
  log("✔ DONE — " + outName + "  (" + fmtSize(finalBytes.length) + ", LZ4 frame)  in " + dt + " s", 'ok');

  return { bytes: finalBytes, name: outName, effectiveKeepAspect: keepAspect };
}
