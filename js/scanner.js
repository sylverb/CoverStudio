// scanner.js — turn a picked folder (FileList) into a ROM work list.
import { NON_ROM, IMAGE_EXT, SS_SYSTEM_MAP, systemIdsFor, isPceCd, isPico8, isPico8Rom } from "./config.js";
import { ext, stem } from "./util.js";

// Detect the system from the folder path. We scan the folders from the
// outermost to the innermost and return the FIRST one that matches a known
// system shortcode — so a recognized "umbrella" folder (e.g. "md") applies to
// all its subfolders (e.g. "md/homebrew"). Falls back to the immediate parent
// folder name when no folder in the path is a known system.
function systemShortcode(parts) {
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i].toLowerCase();
    if (SS_SYSTEM_MAP[seg]) return seg;
  }
  return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : null;
}

// Key used to match an existing cover image to a ROM.
// PCE CD: cover sits beside the game folder (…/jeux_1.png for …/jeux_1/jeux_1.cue).
function coverMatchKey(parts, fileName, pceCd) {
  const s = stem(fileName).toLowerCase();
  if (pceCd && parts.length >= 3) {
    return parts.slice(0, -2).join("/") + "/" + s;
  }
  return parts.slice(0, -1).join("/") + "/" + s;
}

export function buildPlan(files, { skipExisting = true, forceSys = null } = {}) {
  const hidden = (parts) => parts.some((p) => p.startsWith("."));

  // Index existing cover images by "dir/stem" to skip ROMs already done.
  const haveImage = new Set();
  for (const f of files) {
    const parts = f.webkitRelativePath.split("/");
    if (hidden(parts)) continue;
    // Don't treat PICO-8 carts (.p8.png) as cover images
    if (IMAGE_EXT.has(ext(f.name)) && !isPico8Rom(f.name)) {
      haveImage.add(parts.slice(0, -1).join("/") + "/" + stem(f.name).toLowerCase());
    }
  }

  const roms = [];
  for (const f of files) {
    const parts = f.webkitRelativePath.split("/");
    // Ignore hidden files/folders: any path segment starting with "." (e.g.
    // .DS_Store, ._AppleDouble forks, anything inside .git/.Trash…).
    if (hidden(parts)) continue;
    const isP8Cart = isPico8Rom(f.name);
    if (!isP8Cart && NON_ROM.has(ext(f.name))) continue;

    const sysShort = systemShortcode(parts);
    // Ordered list of candidate systemeids to try (a folder like "gb" may hold
    // GBC games, "msx" may hold MSX2/2+ games…). forceSys overrides everything.
    const systemeids = forceSys ? [forceSys] : systemIdsFor(sysShort);
    const systemeid = systemeids[0] ?? null; // primary, for cache/badge/display
    const pceCd = isPceCd({ sysShort, systemeid, systemeids });
    const pico8 = isPico8({ sysShort, systemeid, systemeids });

    // PCE CD dumps: only the .cue identifies the game; ignore .bin/.iso/etc.
    if (pceCd && ext(f.name) !== ".cue") continue;

    // PICO-8: only .p8 and .p8.png identify carts; ignore other files in pico8/
    if (pico8 && !isP8Cart) continue;

    if (skipExisting && haveImage.has(coverMatchKey(parts, f.name, pceCd))) continue;

    roms.push({ file: f, parts, sysShort, systemeid, systemeids, pceCd, pico8 });
  }

  // Process ROMs in alphabetical order within each directory (natural numeric
  // sort, so "2" comes before "10"); directories are ordered alphabetically too.
  const opts = { numeric: true, sensitivity: "base" };
  roms.sort((a, b) => {
    const da = a.parts.slice(0, -1).join("/");
    const db = b.parts.slice(0, -1).join("/");
    if (da !== db) return da.localeCompare(db, undefined, opts);
    return a.file.name.localeCompare(b.file.name, undefined, opts);
  });

  return { roms, totalFiles: files.length };
}
