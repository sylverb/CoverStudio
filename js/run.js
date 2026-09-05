// run.js — cover scraping orchestration (no DOM dependencies).
import { stem, canvasToBlob, downloadBlob, formatBytes, ext, coverOutputPath } from "./util.js";
import { SOFTNAME, SINGLE_MEDIA, devCreds, SYSTEMS, IMAGE_EXT, isPceCd, isGbDmg, isPico8 } from "./config.js";
import { extractPico8Label } from "./pico8.js";
import { RateLimiter } from "./rate-limiter.js";
import { createHashers, hashFile } from "./hashing.js";
import { ScreenScraperClient, FatalError, fetchSystems } from "./screenscraper.js";
import { MixResolver, renderComposition, isValidMix, gameRegionsFor } from "./mix-engine.js";
import { BUILTIN_MIXES } from "./mixes.js";
import { buildPlan } from "./scanner.js";
import { cache } from "./cache.js";
import { toGWCover, gwOutputName, MAX_BYTES as GW_MAX_BYTES } from "./gw.js";
import { applyDmgFilter } from "./dmg-filter.js";
import { t } from "./i18n.js";

const SYS_CACHE_KEY = "coverstudio.systems";

function readCreds(ssid, sspassword) {
  const c = { ...devCreds(), softname: SOFTNAME };
  if (ssid?.trim()) {
    c.ssid = ssid.trim();
    c.sspassword = sspassword?.trim() || "";
  }
  return c;
}

async function fetchMediaBlob(client, url, useCache) {
  if (useCache) {
    const cached = await cache.getMedia(url).catch(() => null);
    if (cached) return cached;
  }
  const r = await client.get(url);
  if (!r.ok) return null;
  const blob = await r.blob();
  if (blob.type && blob.type.startsWith("text")) return null;
  if (useCache) await cache.setMedia(url, blob).catch(() => {});
  return blob;
}

function makeImageFetcher(client, useCache) {
  return async (url) => {
    try {
      const blob = await fetchMediaBlob(client, url, useCache);
      return blob ? await createImageBitmap(blob) : null;
    } catch (e) {
      if (e instanceof FatalError || e?.name === "AbortError") throw e;
      return null;
    }
  };
}

// Standalone utility (no API, fully local): convert existing cover images
// (.png/.jpg/.jpeg/.bmp) found anywhere in a folder into Game & Watch retro-go
// ".img" covers, preserving the original folder structure. Triggers a zip
// download and returns { ok, fail, total }.
export async function convertImagesToGW(files, cb = {}) {
  const { onProgress, onLog, shouldCancel } = cb;
  const sortOpts = { numeric: true, sensitivity: "base" };

  const imgs = (files || [])
    .filter((f) => {
      const parts = f.webkitRelativePath.split("/");
      if (parts.some((p) => p.startsWith("."))) return false; // hidden files/folders
      return IMAGE_EXT.has(ext(f.name));
    })
    .sort((a, b) => {
      const da = a.webkitRelativePath.split("/").slice(0, -1).join("/");
      const db = b.webkitRelativePath.split("/").slice(0, -1).join("/");
      if (da !== db) return da.localeCompare(db, undefined, sortOpts);
      return a.name.localeCompare(b.name, undefined, sortOpts);
    });

  if (!imgs.length) return { ok: 0, fail: 0, total: 0 };

  const zip = new window.JSZip();
  let ok = 0;
  let fail = 0;
  let done = 0;
  for (const f of imgs) {
    if (shouldCancel?.()) break;
    try {
      let srcBlob = f;
      if (f.name.toLowerCase().endsWith(".p8.png")) {
        const label = await extractPico8Label(f);
        if (label) srcBlob = label;
      }
      const out = await toGWCover(srcBlob);
      const parts = f.webkitRelativePath.split("/");
      // Mirror the source tree (minus the picked root), just swap the extension.
      const name = [...parts.slice(1, -1), stem(f.name) + ".img"].join("/");
      zip.file(name, out);
      if (out.size > GW_MAX_BYTES) onLog?.(t("gwTooBig", { name: f.name, size: formatBytes(out.size) }));
      ok++;
    } catch (e) {
      onLog?.(t("errGeneric", { name: f.name, msg: e.message }));
      fail++;
    }
    done++;
    onProgress?.(done, imgs.length);
  }

  if (ok > 0) downloadBlob(await zip.generateAsync({ type: "blob" }), "covers.zip");
  return { ok, fail, total: imgs.length };
}

// --- Manual search & assign (for the misses list) ----------------------------

function gameDisplayName(jeu) {
  if (!jeu) return "?";
  if (typeof jeu.nom === "string" && jeu.nom.trim()) return jeu.nom.trim();
  const noms = jeu.noms;
  if (Array.isArray(noms)) {
    for (const reg of ["ss", "wor", "us", "eu", "jp", "fr"]) {
      const m = noms.find((n) => n && n.region === reg && (n.text || n.nom));
      if (m) return m.text || m.nom;
    }
    const any = noms.find((n) => n && (n.text || n.nom));
    if (any) return any.text || any.nom;
  } else if (noms && typeof noms === "object") {
    const v =
      noms.nom_eu || noms.nom_us || noms.nom_wor || noms.nom_jp ||
      Object.values(noms).find((x) => typeof x === "string" && x.trim());
    if (v) return v;
  }
  return "?";
}

function gameThumb(client, jeu) {
  for (const ty of ["box-2D", "mixrbv1", "mixrbv2", "ss", "wheel"]) {
    const m = client.pickMedia(jeu, ty);
    if (m) return m.url;
  }
  return null;
}

// Search games by name on ScreenScraper. Returns lightweight results:
// [{ gameId, name, systemId, systemName, thumb, jeu }].
export async function searchGames({ query, systemeid, ssid, sspassword }) {
  const client = new ScreenScraperClient({
    creds: readCreds(ssid, sspassword),
    limiter: new RateLimiter(20),
  });
  const jeux = await client.jeuRecherche({ recherche: query, systemeid: systemeid || undefined });
  if (jeux[0]) console.debug("[search] sample result:", jeux[0]);
  return jeux
    .slice(0, 20)
    .map((jeu) => ({
      gameId: String(jeu.id ?? jeu.jeuid ?? ""),
      name: gameDisplayName(jeu),
      systemId: parseInt(jeu?.systeme?.id, 10) || null,
      systemName: jeu?.systeme?.text || jeu?.systeme?.nom || "",
      thumb: gameThumb(client, jeu),
      jeu,
    }))
    // Drop empty/garbage entries (some "no result" responses include a blank one).
    .filter((r) => r.gameId || (r.name && r.name !== "?"));
}

async function buildCoverFromJeu(client, jeu, { source, mixFile, useCache, fileName, dmgFilter }) {
  if (source.startsWith("mix")) {
    const mixXml = source === "mixcustom" ? await mixFile.text() : BUILTIN_MIXES[source];
    if (!isValidMix(mixXml)) return null;
    const fetchImage = makeImageFetcher(client, useCache);
    const gameRegions = gameRegionsFor(fileName, jeu);
    const realSysId = parseInt(jeu?.systeme?.id, 10);
    const resolver = new MixResolver(jeu, fetchImage, undefined, gameRegions, {
      dmgFilter: dmgFilter && isGbDmg(realSysId),
    });
    const canvas = await renderComposition(mixXml, resolver);
    if ([...resolver.cache.values()].filter(Boolean).length === 0) return null;
    return { blob: await canvasToBlob(canvas, "image/png"), ext: "png" };
  }
  const mediaType = SINGLE_MEDIA[source] || "ss";
  const media = client.pickMedia(jeu, mediaType);
  if (!media) return null;
  const blob = await fetchMediaBlob(client, media.url, useCache);
  if (!blob) return null;
  return { blob, ext: (media.format || "png").toLowerCase() };
}

// Build the cover for a chosen search result, with the same source/convert
// settings as a normal run. Returns { previewBlob, zipBlob, outputPath } | null.
// previewBlob = original cover (for the gallery), zipBlob = what goes to disk.
// We re-fetch the full game record by id (jeuRecherche results are lightweight
// and often lack the medias needed to compose the cover).
export async function assignCover({ gameId, jeu, source, mixFile, useCache, convert, dmgFilter, ssid, sspassword, parts, fileName, sysShort, systemeid }) {
  const client = new ScreenScraperClient({
    creds: readCreds(ssid, sspassword),
    limiter: new RateLimiter(20),
  });
  let full = jeu;
  if (gameId) {
    try {
      const r = await client.jeuInfos({ gameid: gameId });
      if (r.ok) {
        const j = (await r.json()).response.jeu;
        if (j) full = j;
      }
    } catch (e) {}
  }
  const built = await buildCoverFromJeu(client, full, { source, mixFile, useCache, fileName, dmgFilter });
  if (!built) return null;
  const baseName = stem(fileName);
  const pceCd = isPceCd({ sysShort, systemeid });
  const realSysId = parseInt(full?.systeme?.id, 10) || systemeid;
  let previewBlob = built.blob;
  let fileExt = built.ext;
  // Whole-image tint only for standalone screenshots (mixes tint screenshots inside the resolver).
  if (dmgFilter && source === "ss" && isGbDmg(realSysId)) {
    previewBlob = await applyDmgFilter(previewBlob);
    fileExt = "png";
  }
  let zipBlob = previewBlob;
  let outputPath;
  if (convert === "gw") {
    zipBlob = await toGWCover(previewBlob);
    outputPath = gwOutputName(parts, baseName, { pceCd });
  } else {
    outputPath = coverOutputPath(parts, baseName, fileExt, { pceCd });
  }
  return { previewBlob, zipBlob, outputPath };
}

// Read the account quota without running a scrape (for the live display).
export async function fetchAccount(ssid, sspassword) {
  const creds = readCreds(ssid, sspassword);
  const client = new ScreenScraperClient({ creds, limiter: new RateLimiter(20) });
  return client.userQuota(); // { status, perMin, perDay, today }
}

export async function loadSystems() {
  let list = SYSTEMS;
  try {
    const obj = JSON.parse(localStorage.getItem(SYS_CACHE_KEY) || "null");
    if (obj && Array.isArray(obj.list) && obj.list.length) return obj.list;
  } catch (e) {}
  try {
    const apiList = await fetchSystems({ ...devCreds(), softname: SOFTNAME });
    if (apiList.length) {
      localStorage.setItem(SYS_CACHE_KEY, JSON.stringify({ list: apiList }));
      return apiList;
    }
  } catch (e) {}
  return list;
}

/**
 * @param {object} opts
 * @param {File[]} opts.files
 * @param {string} opts.source
 * @param {File|null} opts.mixFile
 * @param {boolean} opts.useCache
 * @param {string} opts.convert — "none" | "gw"
 * @param {boolean} opts.dmgFilter — green LCD tint for GB DMG screenshots
 * @param {string} opts.ssid
 * @param {string} opts.sspassword
 * @param {boolean} opts.skipExisting
 * @param {number|null} opts.forceSys
 * @param {boolean} opts.ignoreEmbeddedPico8Covers
 * @param {object} cb
 * @param {(msg: string) => void} cb.onLog
 * @param {(done: number, total: number) => void} cb.onProgress
 * @param {(text: string) => void} cb.onStatus
 * @param {(cover: { id: string, name: string, blob: Blob, outputPath: string }) => void} cb.onCover
 * @param {(miss: { id: string, name: string, reason: string }) => void} [cb.onMiss]
 * @param {() => boolean} cb.shouldCancel
 */
export async function runCovers(opts, cb) {
  const {
    files,
    source,
    mixFile,
    useCache,
    convert,
    dmgFilter,
    ssid,
    sspassword,
    skipExisting,
    forceSys,
    ignoreEmbeddedPico8Covers = false,
  } = opts;
  const { onLog, onProgress, onStatus, onCover, onMiss, shouldCancel, signal, onAccount } = cb;

  const isMix = source.startsWith("mix");
  const creds = readCreds(ssid, sspassword);
  const hasAccount = !!(creds.ssid && creds.sspassword);
  const limiter = new RateLimiter(20);
  const client = new ScreenScraperClient({ creds, limiter, signal });
  const fetchImage = makeImageFetcher(client, useCache);

  const q = await client.userQuota();
  if (hasAccount && q.status === "bad") {
    return { error: "badAccount" };
  }
  if (q?.perMin) {
    limiter.max = Math.max(1, q.perMin); // full per-minute rate, no safety margin
    onLog(`rate: ${q.perMin} req/min · quota ${q.today ?? 0}/${q.perDay ?? "?"} today`);
  }
  onAccount?.({
    perMin: q?.perMin ?? null,
    perDay: q?.perDay ?? null,
    today: q?.today ?? null,
    used: q?.today ?? 0,
  });

  const { roms, totalFiles } = buildPlan(files, { skipExisting, forceSys });
  onLog(t("plan", { total: totalFiles, count: roms.length, source }));

  const mixXml = source === "mixcustom"
    ? await mixFile.text()
    : isMix ? BUILTIN_MIXES[source] : null;

  if (isMix && !isValidMix(mixXml)) {
    onLog(t("mixInvalid"));
    return { error: "mixInvalid" };
  }

  const hashers = await createHashers();
  const zip = new window.JSZip();
  let coverSeq = 0;
  let missSeq = 0;

  const reportMiss = (rom, reason) => {
    onMiss?.({
      id: `miss:${missSeq++}:${rom.file.name}`,
      name: rom.file.name,
      reason,
      systemeid: rom.systemeid,
      systemeids: rom.systemeids,
      sysShort: rom.sysShort,
      parts: rom.parts,
    });
  };

  async function addCover(rom, blob, defaultName) {
    let preview = blob;
    let name = defaultName;
    // DMG LCD tint: screenshots of original Game Boy only (after system id is known).
    if (dmgFilter && source === "ss" && isGbDmg(rom.systemeid)) {
      preview = await applyDmgFilter(blob);
      if (convert !== "gw") {
        name = coverOutputPath(rom.parts, stem(rom.file.name), "png", { pceCd: rom.pceCd });
      }
    }
    let out = preview;
    if (convert === "gw") {
      out = await toGWCover(preview);
      name = gwOutputName(rom.parts, stem(rom.file.name), { pceCd: rom.pceCd });
      if (out && out.size > GW_MAX_BYTES)
        onLog(t("gwTooBig", { name: rom.file.name, size: formatBytes(out.size) }));
    }
    zip.file(name, out);
    onCover({
      id: `${coverSeq++}:${rom.file.name}`,
      name: rom.file.name,
      blob: preview,
      outputPath: name,
      systemeid: rom.systemeid,
      sysShort: rom.sysShort,
    });
  }

  let ok = 0, miss = 0, fail = 0, done = 0;
  onProgress(0, roms.length);

  try {
    for (const rom of roms) {
      if (shouldCancel()) {
        onLog(t("stopped"));
        break;
      }
      done++;
      onProgress(done, roms.length);
      onAccount?.({
        perMin: q?.perMin ?? null,
        perDay: q?.perDay ?? null,
        today: q?.today ?? null,
        used: (q?.today || 0) + client.requestsMade,
      });

      if (!rom.systemeid) {
        onLog(t("sysUnknown", { name: rom.file.name, folder: rom.sysShort }));
        reportMiss(rom, "no_system");
        fail++;
        continue;
      }

      if (rom.pico8 || isPico8(rom)) {
        // PICO-8: carts contain their own 128x128 label; extract that unless user opted to scrape remotely
        if (!ignoreEmbeddedPico8Covers) {
          try {
            const labelBlob = await extractPico8Label(rom.file);
            if (shouldCancel()) { onLog(t("stopped")); break; }
            if (labelBlob) {
              const baseName = stem(rom.file.name);
              const outName = coverOutputPath(rom.parts, baseName, "png", { pceCd: false });
              await addCover(rom, labelBlob, outName);
              onLog(t("pico8Ok", { name: rom.file.name }));
              ok++;
              continue;
            }
            // No embedded label found in cart (e.g. .p8 without __label__), fall-back to scraping it
            onLog(t("pico8NoCoverFallback", { name: rom.file.name }));
          } catch (e) {
            if (e?.name === "AbortError" || shouldCancel()) { onLog(t("stopped")); break; }
            onLog(t("errGeneric", { name: rom.file.name, msg: e.message }));
          }
        } else {
          onLog(t("pico8IgnoredFallback", { name: rom.file.name }));
        }
      }

      try {
        const h = await hashFile(rom.file, hashers);
        if (shouldCancel()) { onLog(t("stopped")); break; }
        // Cache by hash (system-agnostic): the md5 identifies the game whatever
        // candidate system it ends up matching.
        const gameKey = `game:${h.md5}`;

        let jeu = useCache ? await cache.getGame(gameKey).catch(() => null) : null;
        if (!jeu) {
          let httpError = null;
          // Try each candidate systemeid in order (e.g. gb -> [9,10],
          // msx -> [113,116,117]) until one returns a game.
          for (const sid of rom.systemeids) {
            if (shouldCancel()) break;
            const r = await client.jeuInfos({
              systemeid: sid,
              romtype: "rom",
              romnom: rom.file.name,
              romtaille: h.size,
              crc: h.crc,
              md5: h.md5,
              sha1: h.sha1,
            });
            if (r.status === 404) continue; // not on this system, try next candidate
            if (!r.ok) { httpError = r.status; break; } // server error, stop trying
            try { jeu = (await r.json()).response.jeu; } catch (e) { jeu = null; }
            if (jeu) break; // found
          }
          if (shouldCancel()) { onLog(t("stopped")); break; }
          if (httpError) { onLog(t("httpErr", { status: httpError, name: rom.file.name })); reportMiss(rom, "http_error"); fail++; continue; }
          if (!jeu) { onLog(t("noResult", { name: rom.file.name })); reportMiss(rom, "no_result"); miss++; continue; }
          if (useCache) await cache.setGame(gameKey, jeu).catch(() => {});
        }

        // Reflect the game's actual system in the badge (a GB game found in the
        // "gbc" folder shows "Game Boy", not the folder's primary guess).
        const realSysId = parseInt(jeu?.systeme?.id, 10);
        if (realSysId) rom.systemeid = realSysId;

        const baseName = stem(rom.file.name);
        const outName = (fileExt) =>
          coverOutputPath(rom.parts, baseName, fileExt, { pceCd: rom.pceCd });

        if (isMix) {
          const gameRegions = gameRegionsFor(rom.file.name, jeu);
          const resolver = new MixResolver(jeu, fetchImage, undefined, gameRegions, {
            dmgFilter: dmgFilter && isGbDmg(rom.systemeid),
          });
          const canvas = await renderComposition(mixXml, resolver);
          const got = [...resolver.cache.values()].filter(Boolean).length;
          if (got === 0) {
            onLog(t("mixEmpty", { name: rom.file.name }));
            reportMiss(rom, "mix_empty");
            miss++;
            continue;
          }
          const blob = await canvasToBlob(canvas, "image/png");
          await addCover(rom, blob, outName("png"));
          onLog(t("mixOk", { name: rom.file.name, n: got }));
          ok++;
        } else {
          const mediaType = SINGLE_MEDIA[source] || "ss";
          const media = client.pickMedia(jeu, mediaType);
          if (!media) { onLog(t("noMedia", { type: mediaType, name: rom.file.name })); reportMiss(rom, "no_media"); miss++; continue; }
          const blob = await fetchMediaBlob(client, media.url, useCache);
          if (!blob) { onLog(t("imgFailed", { status: "?", name: rom.file.name })); reportMiss(rom, "image_failed"); fail++; continue; }
          const fmt = (media.format || "png").toLowerCase();
          await addCover(rom, blob, outName(fmt));
          onLog(t("ssOk", { name: rom.file.name }));
          ok++;
        }
      } catch (e) {
        if (e?.name === "AbortError" || shouldCancel()) { onLog(t("stopped")); break; }
        if (e instanceof FatalError) throw e;
        onLog(t("errGeneric", { name: rom.file.name, msg: e.message }));
        reportMiss(rom, "error");
        fail++;
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") onLog(t("stopped"));
    else onLog(e instanceof FatalError ? t("fatalStop", { msg: e.message }) : t("errRun", { msg: e.message }));
  }

  onLog(t("done", { ok, miss, fail, req: client.requestsMade }));
  if (ok > 0) {
    onLog(t("zipGen"));
    downloadBlob(await zip.generateAsync({ type: "blob" }), "covers.zip");
    onLog(t("zipDone"));
  } else {
    onLog(t("noImages"));
  }

  return { ok, miss, fail, requests: client.requestsMade };
}
