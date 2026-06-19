// scanner.js — turn a picked folder (FileList) into a ROM work list.
import { NON_ROM, IMAGE_EXT, SS_SYSTEM_MAP, systemIdsFor } from "./config.js";
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

export function buildPlan(files, { skipExisting = true, forceSys = null } = {}) {
  const hidden = (parts) => parts.some((p) => p.startsWith("."));

  // Index existing cover images by "dir/stem" to skip ROMs already done.
  const haveImage = new Set();
  for (const f of files) {
    const parts = f.webkitRelativePath.split("/");
    if (hidden(parts)) continue;
    if (IMAGE_EXT.has(ext(f.name))) {
      haveImage.add(parts.slice(0, -1).join("/") + "/" + stem(f.name).toLowerCase());
    }
  }

  const roms = [];
  for (const f of files) {
    const parts = f.webkitRelativePath.split("/");
    // Ignore hidden files/folders: any path segment starting with "." (e.g.
    // .DS_Store, ._AppleDouble forks, anything inside .git/.Trash…).
    if (hidden(parts)) continue;
    if (NON_ROM.has(ext(f.name))) continue;
    const dir = parts.slice(0, -1).join("/");
    if (skipExisting && haveImage.has(dir + "/" + stem(f.name).toLowerCase())) continue;

    const sysShort = systemShortcode(parts);
    // Ordered list of candidate systemeids to try (a folder like "gb" may hold
    // GBC games, "msx" may hold MSX2/2+ games…). forceSys overrides everything.
    const systemeids = forceSys ? [forceSys] : systemIdsFor(sysShort);
    const systemeid = systemeids[0] ?? null; // primary, for cache/badge/display
    roms.push({ file: f, parts, sysShort, systemeid, systemeids });
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
