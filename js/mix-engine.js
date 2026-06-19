// mix-engine.js — Skraper-style image composition, rendered on a <canvas>.
// Faithful port of the Python engine (compute_box / fallback chains / children /
// IfOrientation). Composes images only (no text). Returns a <canvas>.
import { RESOURCE_MAP, REGION_PREF } from "./config.js";

// --- region flags (Region1 / Region2 slots) --------------------------------
// Region names found in ROM filenames (No-Intro / GoodTools) -> flag codes,
// mirroring Skraper's "extract regions from file name" behaviour.
const REGION_NAME_MAP = {
  world: "wor", usa: "us", us: "us", "united states": "us", europe: "eu",
  japan: "jp", france: "fr", germany: "de", spain: "sp", italy: "it",
  uk: "uk", "united kingdom": "uk", england: "uk", australia: "au",
  korea: "kr", "south korea": "kr", china: "cn", "hong kong": "hk",
  taiwan: "tw", brazil: "br", canada: "ca", netherlands: "nl", holland: "nl",
  sweden: "se", norway: "no", denmark: "dk", finland: "fi", russia: "ru",
  poland: "pl", portugal: "pt", greece: "gr", "czech republic": "cz",
  czech: "cz", hungary: "hu", ireland: "ie", israel: "il", india: "in",
  mexico: "mx", argentina: "ar", chile: "cl", colombia: "co",
  "new zealand": "nz", austria: "at", belgium: "be", switzerland: "ch",
  croatia: "hr", slovenia: "si", slovakia: "sk", serbia: "rs", ukraine: "ua",
  romania: "ro", bulgaria: "bg", estonia: "ee", lithuania: "lt",
  luxembourg: "lu", iceland: "is", "bosnia and herzegovina": "ba",
  albania: "al", armenia: "am", azerbaijan: "az", bolivia: "bo", cuba: "cu",
  honduras: "hn", venezuela: "ve", "south africa": "za",
  "united arab emirates": "ae",
};
// Single-letter GoodTools codes, only when the whole token is one letter.
const REGION_LETTER_MAP = {
  u: "us", e: "eu", j: "jp", w: "wor", f: "fr", g: "de", s: "sp", i: "it",
  a: "au", k: "kr", c: "cn", n: "nl", b: "br",
};

// Ordered region codes from a ROM filename: tokens inside parentheses.
export function extractRegions(fileName) {
  const out = [];
  const add = (code) => { if (code && !out.includes(code)) out.push(code); };
  const groups = (fileName || "").match(/\(([^)]*)\)/g) || [];
  for (const g of groups) {
    for (let tok of g.slice(1, -1).split(/[,/]/)) {
      tok = tok.trim();
      if (!tok) continue;
      const low = tok.toLowerCase();
      if (REGION_NAME_MAP[low]) add(REGION_NAME_MAP[low]);
      else if (tok.length === 1 && REGION_LETTER_MAP[low]) add(REGION_LETTER_MAP[low]);
    }
  }
  return out;
}

// Ordered region codes for a game: filename first, else the game's media
// regions ordered by preference.
export function gameRegionsFor(fileName, jeu) {
  let regs = extractRegions(fileName);
  if (regs.length) return regs;
  const present = [];
  for (const m of (jeu && jeu.medias) || [])
    if (m.region && !present.includes(m.region)) present.push(m.region);
  regs = REGION_PREF.filter((r) => present.includes(r));
  for (const r of present) if (!regs.includes(r)) regs.push(r);
  return regs;
}

// Lazy flag module + decoded-bitmap cache (the base64 module is ~2 MB, so it
// is only imported when a composition actually needs a flag).
let _flagsPromise = null;
const _flagBitmaps = new Map();
async function loadFlagBitmap(code) {
  if (!code) return null;
  if (_flagBitmaps.has(code)) return _flagBitmaps.get(code);
  let bmp = null;
  try {
    _flagsPromise ||= import("./flags.js").then((m) => m.FLAGS);
    const FLAGS = await _flagsPromise;
    const url = FLAGS[code];
    if (url) bmp = await createImageBitmap(await (await fetch(url)).blob());
  } catch (e) {
    bmp = null;
  }
  _flagBitmaps.set(code, bmp);
  return bmp;
}

// --- XML helpers (case-sensitive, like the Python ElementTree version) ---
const childrenByTag = (el, tag) => [...el.children].filter((c) => c.tagName === tag);
const firstChild = (el, tag) => childrenByTag(el, tag)[0] || null;

// --- small parsing helpers (mirror the Python ones) ---
function pct(v, d = 0) {
  if (v == null || v === "") return d;
  v = String(v).trim();
  return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
}

function parseColor(argb) {
  if (!argb) return null;
  const s = argb.replace("#", "");
  const n = (i) => parseInt(s.slice(i, i + 2), 16);
  if (s.length === 8) return `rgba(${n(2)},${n(4)},${n(6)},${(n(0) / 255).toFixed(3)})`;
  if (s.length === 6) return `rgb(${n(0)},${n(2)},${n(4)})`;
  return null;
}

function parseAnchor(anchor) {
  const a = anchor || "TopLeft";
  const v = a.includes("Top") ? 0 : a.includes("Bottom") ? 1 : 0.5;
  const h = a.includes("Left") ? 0 : a.includes("Right") ? 1 : 0.5;
  return [h, v];
}

// Place an image of size (iw,ih) inside `frame` per a <Display> ('contain').
function computeBox(iw, ih, display, frame) {
  const [fx, fy, fw, fh] = frame;
  const attr = (a) => (display ? display.getAttribute(a) : null);
  const maxW = pct(attr("Width"), 1) * fw;
  const maxH = pct(attr("Height"), 1) * fh;
  const ratio = Math.min(maxW / iw, maxH / ih);
  const w = Math.max(1, Math.round(iw * ratio));
  const h = Math.max(1, Math.round(ih * ratio));
  const px = fx + pct(attr("X"), 0) * fw;
  const py = fy + pct(attr("Y"), 0) * fh;
  const [ah, av] = parseAnchor(attr("Anchor"));
  return [Math.round(px - ah * w), Math.round(py - av * h), w, h];
}

function collectChain(item) {
  const chain = [item];
  let fb = firstChild(item, "Fallback");
  while (fb) {
    chain.push(fb);
    fb = firstChild(fb, "Fallback");
  }
  return chain;
}

// --- resolver: Skraper resource type -> ImageBitmap (or null) ---
export class MixResolver {
  // fetchImage: async (url) => ImageBitmap | null
  // gameRegions: ordered region codes for this game (Region1, Region2, ...)
  constructor(jeu, fetchImage, regions = REGION_PREF, gameRegions = []) {
    this.jeu = jeu;
    this.fetchImage = fetchImage;
    this.regions = regions;
    this.gameRegions = gameRegions;
    this.cache = new Map();
    this.index = {};
    for (const m of jeu.medias || []) (this.index[m.type] ||= []).push(m);
  }

  best(ssType) {
    const cands = this.index[ssType];
    if (!cands || !cands.length) return null;
    return [...cands].sort((a, b) => {
      const ra = this.regions.indexOf(a.region);
      const rb = this.regions.indexOf(b.region);
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    })[0];
  }

  async resolve(skraperType) {
    if (this.cache.has(skraperType)) return this.cache.get(skraperType);

    // Region1 / Region2 -> flag of the game's 1st / 2nd region.
    if (skraperType === "Region1" || skraperType === "Region2") {
      const code = this.gameRegions[skraperType === "Region1" ? 0 : 1];
      const flag = await loadFlagBitmap(code);
      this.cache.set(skraperType, flag);
      return flag;
    }

    let img = null;
    for (const ssType of RESOURCE_MAP[skraperType] || []) {
      const media = this.best(ssType);
      if (media && media.url) {
        img = await this.fetchImage(media.url);
        if (img) break;
      }
    }
    this.cache.set(skraperType, img);
    return img;
  }
}

// --- rendering ---
function pasteImage(cx, img, display, frame) {
  cx.imageSmoothingEnabled = !(display && display.getAttribute("Antialiasing") === "None");
  const [x, y, w, h] = computeBox(img.width, img.height, display, frame);
  const t = display ? display.getAttribute("Transparency") : null;
  cx.save();
  if (t != null && t !== "") cx.globalAlpha = parseFloat(t);
  cx.drawImage(img, x, y, w, h);
  cx.restore();
  return [x, y, w, h];
}

async function drawChildren(parentNode, cx, ambient, parentBox, ctx) {
  const children = firstChild(parentNode, "Children");
  if (!children) return;
  const ref = children.getAttribute("Reference");
  const frame = ref === "Parent" && parentBox ? parentBox : ambient;
  for (const child of childrenByTag(children, "Item")) {
    await drawItem(child, cx, frame, ctx);
  }
}

async function drawItem(item, cx, frame, ctx) {
  const itype = item.getAttribute("Type");
  const display = firstChild(item, "Display");
  const orient = item.getAttribute("IfOrientation");

  if (!itype || itype === "NoResource") {
    await drawChildren(item, cx, frame, null, ctx);
    return;
  }

  // Resolve through the fallback chain (image fallbacks only; Text ignored).
  let img = null;
  let node = null;
  for (const n of collectChain(item)) {
    if (n.getAttribute("Type") === "Text") continue;
    const r = await ctx.resolver.resolve(n.getAttribute("Type"));
    if (r) {
      img = r;
      node = n;
      break;
    }
  }

  // IfOrientation is evaluated against THIS item's own resolved image.
  if (orient) {
    const ro = img ? (img.height > img.width ? "IsPortrait" : "IsLandscape") : ctx.orientation;
    if (orient !== ro) return;
  }

  let box = null;
  if (img) box = pasteImage(cx, img, display, frame);
  if (box && node) await drawChildren(node, cx, frame, box, ctx);
}

// Quick validity check for a mix XML (used to fail fast before the loop).
export function isValidMix(xmlText) {
  if (!xmlText) return false;
  const doc = new DOMParser().parseFromString(xmlText.replace(/^\uFEFF/, ""), "application/xml");
  if (doc.querySelector("parsererror")) return false;
  return !!doc.documentElement && doc.documentElement.tagName === "ImageComposition";
}

// Render a Skraper ImageComposition XML string. Returns a <canvas>.
export async function renderComposition(xmlText, resolver) {
  const doc = new DOMParser().parseFromString((xmlText || "").replace(/^\uFEFF/, ""), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML de mix invalide");
  const root = doc.documentElement;

  const vp = firstChild(root, "Viewport");
  const W = parseInt(vp?.getAttribute("Width") || "1280", 10);
  const H = parseInt(vp?.getAttribute("Height") || "720", 10);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const cx = canvas.getContext("2d");

  const bg = parseColor(vp?.getAttribute("Color"));
  if (bg) {
    cx.fillStyle = bg;
    cx.fillRect(0, 0, W, H);
  }

  // Overall orientation comes from the screenshot.
  let orientation = "IsLandscape";
  const ss = (await resolver.resolve("Screenshot")) || (await resolver.resolve("ScreenshotTitle"));
  if (ss && ss.height > ss.width) orientation = "IsPortrait";

  const ctx = { resolver, orientation };
  const drawings = firstChild(root, "Drawings");
  if (drawings) {
    for (const item of childrenByTag(drawings, "Item")) {
      await drawItem(item, cx, [0, 0, W, H], ctx);
    }
  }
  return canvas;
}
