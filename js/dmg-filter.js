// dmg-filter.js — remaps an image to the classic Game Boy DMG-01 LCD greens.
import { canvasToBlob } from "./util.js";

// Official-looking DMG palette, lightest → darkest.
const DMG_PALETTE = [
  [155, 188, 15], // #9BBC0F
  [139, 172, 15], // #8BAC0F
  [48, 98, 48],   // #306230
  [15, 56, 15],   // #0F380F
];

// Skraper mix item types that are in-game screenshots.
export const DMG_SCREENSHOT_TYPES = new Set(["Screenshot", "ScreenshotTitle"]);

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function samplePalette(t) {
  // t in [0,1]: 0 = lightest, 1 = darkest
  const n = DMG_PALETTE.length - 1;
  const x = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const c0 = DMG_PALETTE[i];
  const c1 = DMG_PALETTE[i + 1];
  return [
    Math.round(lerp(c0[0], c1[0], f)),
    Math.round(lerp(c0[1], c1[1], f)),
    Math.round(lerp(c0[2], c1[2], f)),
  ];
}

function remapImageData(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    // Rec. 601 luminance, then invert so bright pixels stay light on the LCD.
    const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    const [r, g, b] = samplePalette(1 - y);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

function bitmapToTintedCanvas(bmp) {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  remapImageData(img);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Remap luminance to the DMG green ramp. Returns a PNG blob.
export async function applyDmgFilter(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = bitmapToTintedCanvas(bmp);
  if (bmp.close) bmp.close();
  return canvasToBlob(canvas, "image/png");
}

// Same tint for an ImageBitmap (used inside mix compositions).
export async function applyDmgFilterToBitmap(bmp) {
  const canvas = bitmapToTintedCanvas(bmp);
  if (bmp.close) bmp.close();
  return createImageBitmap(canvas);
}
