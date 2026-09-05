// pico8.js — extract 128x128 cart labels from PICO-8 carts (.p8 / .p8.png)
import { canvasToBlob } from "./util.js";

// PICO-8 16-color standard palette
export const PICO8_PALETTE = [
  [0, 0, 0],        // 0  black
  [29, 43, 83],     // 1  dark-blue
  [126, 37, 83],    // 2  dark-purple
  [0, 135, 81],     // 3  dark-green
  [171, 82, 54],    // 4  brown
  [95, 87, 79],     // 5  dark-grey
  [194, 195, 199],  // 6  light-grey
  [255, 241, 232],  // 7  white
  [255, 0, 77],     // 8  red
  [255, 163, 0],    // 9  orange
  [255, 236, 39],   // 10 yellow
  [0, 228, 54],     // 11 green
  [41, 173, 255],   // 12 blue
  [131, 118, 156],  // 13 lavender
  [255, 119, 168],  // 14 pink
  [255, 204, 170],  // 15 light-peach
];

// PICO-8 extended palette (colors 128-143, indices 16-31)
export const PICO8_PALETTE_EXT = [
  [41, 24, 20],     // 16 / 128 / -1
  [17, 29, 53],     // 17 / 129 / -2
  [66, 33, 54],     // 18 / 130 / -3
  [18, 83, 89],     // 19 / 131 / -4
  [116, 47, 41],    // 20 / 132 / -5
  [73, 51, 59],     // 21 / 133 / -6
  [162, 136, 121],  // 22 / 134 / -7
  [243, 239, 125],  // 23 / 135 / -8
  [190, 18, 80],    // 24 / 136 / -9
  [255, 108, 36],   // 25 / 137 / -10
  [168, 231, 46],   // 26 / 138 / -11
  [0, 181, 67],     // 27 / 139 / -12
  [6, 90, 181],     // 28 / 140 / -13
  [117, 70, 101],   // 29 / 141 / -14
  [255, 110, 89],   // 30 / 142 / -15
  [255, 157, 129],  // 31 / 143 / -16
];

export const PICO8_FULL_PALETTE = [...PICO8_PALETTE, ...PICO8_PALETTE_EXT];

// Find closest PICO-8 palette color (undoes steganography LSB noise in .p8.png)
export function closestPaletteIndex(r, g, b) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PICO8_FULL_PALETTE.length; i++) {
    const p = PICO8_FULL_PALETTE[i];
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Extract 128x128 label from a .p8.png cart image
export async function extractLabelFromP8Png(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    let srcX = 16;
    let srcY = 24;
    const side = 128;

    if (w >= srcX + side && h >= srcY + side) {
      // Standard PICO-8 cart image (160x205)
    } else if (w >= side && h >= side) {
      // Direct 128x128 label image or similar
      srcX = 0;
      srcY = 0;
    } else {
      if (bmp.close) bmp.close();
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, srcX, srcY, side, side, 0, 0, side, side);
    if (bmp.close) bmp.close();

    // Snap pixels back to clean PICO-8 palette colors
    const imgData = ctx.getImageData(0, 0, side, side);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const idx = closestPaletteIndex(data[i], data[i + 1], data[i + 2]);
      const pal = PICO8_FULL_PALETTE[idx];
      data[i] = pal[0];
      data[i + 1] = pal[1];
      data[i + 2] = pal[2];
      data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    return await canvasToBlob(canvas, "image/png");
  } catch (e) {
    return null;
  }
}

// Extract 128x128 label from a .p8 text file's __label__ section
export async function extractLabelFromP8Text(file) {
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    let inLabel = false;
    const labelLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (line === "__label__") {
        inLabel = true;
        continue;
      }
      if (inLabel) {
        if (line.startsWith("__")) {
          break;
        }
        labelLines.push(line);
      }
    }

    if (labelLines.length < 128) {
      return null;
    }

    const side = 128;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(side, side);
    const data = imgData.data;

    for (let y = 0; y < side; y++) {
      const row = labelLines[y] || "";
      for (let x = 0; x < side; x++) {
        const c = (x < row.length ? row[x] : "0").toLowerCase();
        let idx = 0;
        if (c >= "0" && c <= "9") {
          idx = c.charCodeAt(0) - 48;
        } else if (c >= "a" && c <= "f") {
          idx = 10 + c.charCodeAt(0) - 97;
        } else if (c >= "g" && c <= "v") {
          idx = 16 + c.charCodeAt(0) - 103;
        }
        const pal = PICO8_FULL_PALETTE[idx] || PICO8_FULL_PALETTE[0];
        const offset = (y * side + x) * 4;
        data[offset] = pal[0];
        data[offset + 1] = pal[1];
        data[offset + 2] = pal[2];
        data[offset + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return await canvasToBlob(canvas, "image/png");
  } catch (e) {
    return null;
  }
}

// Extract label from any PICO-8 cart file (.p8 or .p8.png)
export async function extractPico8Label(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".p8.png") || name.endsWith(".png")) {
    return extractLabelFromP8Png(file);
  }
  if (name.endsWith(".p8")) {
    return extractLabelFromP8Text(file);
  }
  return null;
}
