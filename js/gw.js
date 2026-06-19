// gw.js — convert a cover image to the Game & Watch Retro-Go SD format:
// a small JPEG (saved as .img) that fits the retro-go cover box and weighs
// under 10 KB. Faithful port of the resolution / quality logic in gencovers.py.
import { canvasToBlob } from "./util.js";

// retro-go limits: COVER_MAX_WIDTH 186, COVER_MAX_HEIGHT 100.
export const MAX_W = 186;
export const MAX_H = 100;
// Same defaults as gencovers.py (--width 128, --height None -> auto).
const TARGET_W = 128;
const TARGET_H = null;
export const MAX_BYTES = 10 * 1024; // target: < 10 KB

// Port of gencovers.py calculate_new_size: fit within the target box (itself
// capped at the retro-go max), preserving the aspect ratio. int() -> floor.
export function gwSize(w, h, targetW = TARGET_W, targetH = TARGET_H) {
  let tw = targetW == null ? MAX_W : targetW;
  let th = targetH == null ? MAX_H : targetH;
  tw = Math.min(tw, MAX_W);
  th = Math.min(th, MAX_H);
  const scale = Math.min(tw / w, th / h);
  return {
    w: Math.max(1, Math.floor(w * scale)),
    h: Math.max(1, Math.floor(h * scale)),
  };
}

// Output path inside the archive: covers/<full subfolder tree>/<rom>.img
// (the ROM's path minus the picked root and the filename), mirroring the
// non-converted output so the tree is preserved.
export function gwOutputName(parts, baseName) {
  const tree = parts.slice(1, -1); // strip picked root + filename
  return ["covers", ...tree, baseName + ".img"].join("/");
}

// Convert any image blob to a retro-go cover blob (JPEG, < 10 KB if possible).
export async function toGWCover(blob) {
  const bmp = await createImageBitmap(blob);
  const { w, h } = gwSize(bmp.width, bmp.height);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000"; // JPEG has no alpha; flatten transparency onto black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();

  // Lower quality until the file fits, mirroring gencovers.py _save_jpeg_rgb
  // (start 85, floor 25, step 6; keep the smallest if none fits).
  let q = 0.85;
  const minQ = 0.25;
  const step = 0.06;
  let best = null;
  while (q >= minQ) {
    const out = await canvasToBlob(canvas, "image/jpeg", q);
    if (out && (!best || out.size < best.size)) best = out;
    if (out && out.size <= MAX_BYTES) return out;
    q -= step;
  }
  return best; // even at min quality it may exceed 10 KB (rare)
}
