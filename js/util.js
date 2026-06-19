// util.js — small shared helpers

export const ext = (name) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
};

export const stem = (name) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? name : name.slice(0, i);
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// canvas.toBlob is callback-based; wrap it in a promise.
// `quality` (0..1) is used for image/jpeg and image/webp, ignored for png.
export const canvasToBlob = (canvas, type = "image/png", quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + units[i];
}
