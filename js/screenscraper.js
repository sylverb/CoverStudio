// screenscraper.js — ScreenScraper API client
import { API, REGION_PREF } from "./config.js";

export class FatalError extends Error {}

export class ScreenScraperClient {
  constructor({ creds, limiter, signal = null }) {
    this.creds = creds;            // {devid, devpassword, softname, ssid?, sspassword?}
    this.limiter = limiter;
    this.signal = signal;          // optional AbortSignal for immediate stop
    this.requestsMade = 0;
  }

  params(extra = {}) {
    return new URLSearchParams({ output: "json", ...this.creds, ...extra });
  }

  // Single choke point: throttled + counted. Throws FatalError on stop codes,
  // and AbortError (from the signal) for an immediate stop.
  async get(url) {
    await this.limiter.acquire(this.signal);
    if (this.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    this.requestsMade += 1;
    const r = await fetch(url, this.signal ? { signal: this.signal } : undefined);
    if ([423, 426, 430, 431].includes(r.status)) {
      throw new FatalError(`Code ${r.status} (quota/accès)`);
    }
    return r;
  }

  async jeuInfos(extra) {
    return this.get(API + "jeuInfos.php?" + this.params(extra));
  }

  // Search games by name. Returns an array of game objects (response.jeux),
  // each with its medias, ranked by relevance. [] on no result / error.
  async jeuRecherche({ recherche, systemeid }) {
    const extra = { recherche };
    if (systemeid) extra.systemeid = systemeid;
    let r;
    try {
      r = await this.get(API + "jeuRecherche.php?" + this.params(extra));
    } catch (e) {
      return [];
    }
    if (!r.ok) return [];
    try {
      const jeux = (await r.json()).response.jeux;
      return Array.isArray(jeux) ? jeux : [];
    } catch (e) {
      return [];
    }
  }

  // Read the account's limits AND validate the user login.
  // Returns { status: "ok"|"bad"|"unknown", perMin, perDay, today }.
  //   ok      = valid ssuser block returned
  //   bad     = login rejected (401/403/400 or "Erreur de login" body)
  //   unknown = network / server error, no verdict on the credentials
  async userQuota() {
    const none = { perMin: null, perDay: null, today: null };
    let r;
    try {
      r = await this.get(API + "ssuserInfos.php?" + this.params());
    } catch (e) {
      return { status: "unknown", ...none };
    }
    if ([400, 401, 403].includes(r.status)) return { status: "bad", ...none };
    if (!r.ok) return { status: "unknown", ...none }; // 5xx etc. -> no verdict

    let text;
    try {
      text = await r.text();
    } catch (e) {
      return { status: "unknown", ...none };
    }
    if (/^\s*Erreur de login/i.test(text)) return { status: "bad", ...none };

    let u = null;
    try {
      u = JSON.parse(text).response.ssuser;
    } catch (e) {
      u = null;
    }
    if (!u || typeof u !== "object") return { status: "bad", ...none };

    const gi = (...keys) => {
      for (const k of keys) {
        const v = parseInt(u[k], 10);
        if (!isNaN(v)) return v;
      }
      return null;
    };
    return {
      status: "ok",
      perMin: gi("maxrequestspermin", "maxrequestsperdmin"),
      perDay: gi("maxrequestsperday"),
      today: gi("requeststoday"),
    };
  }

  // Pick the best media of a given ScreenScraper type (by region preference).
  pickMedia(jeu, ssType, regions = REGION_PREF) {
    const cands = (jeu.medias || []).filter((m) => m.type === ssType && m.url);
    cands.sort((a, b) => {
      const ra = regions.indexOf(a.region);
      const rb = regions.indexOf(b.region);
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
    return cands[0] || null;
  }
}

// Pick a readable name from a system's `noms` block, with fallbacks (the exact
// key names vary across ScreenScraper versions, so stay defensive).
function systemName(sys) {
  const n = sys.noms || {};
  const pick =
    n.nom_eu || n.nom_us || n.nom_jp || n.noms_commun || n.nom_recalbox ||
    Object.values(n).find((v) => typeof v === "string" && v.trim());
  return String(pick || sys.nom || `System ${sys.id}`).trim();
}

// Fetch the full list of systems from ScreenScraper -> [{id, name}] sorted by
// name. `creds` = {devid, devpassword, softname, ssid?, sspassword?}.
export async function fetchSystems(creds) {
  const params = new URLSearchParams({ output: "json", ...creds });
  const r = await fetch(API + "systemesListe.php?" + params);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  let list = data && data.response && data.response.systemes;
  if (!Array.isArray(list)) list = list ? Object.values(list) : [];
  return list
    .map((s) => ({ id: parseInt(s.id, 10), name: systemName(s) }))
    .filter((s) => s.id && s.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
