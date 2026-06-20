import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useI18n } from "./hooks/useI18n.js";
import { useObjectUrls } from "./hooks/useObjectUrls.js";
import CoverFlow from "./components/CoverFlow.jsx";
import { runCovers, loadSystems, fetchAccount, convertImagesToGW, searchGames, assignCover } from "../js/run.js";
import { clearCache, cacheStats } from "../js/cache.js";
import { formatBytes, ext } from "../js/util.js";
import { IMAGE_EXT } from "../js/config.js";

const ACCOUNT_KEY = "coverstudio.account";

function loadAccount() {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
    if (a?.ssid) return { ssid: a.ssid, sspassword: a.sspassword || "", remember: true };
  } catch (e) {}
  return { ssid: "", sspassword: "", remember: false };
}

export default function App() {
  const { lang, setLang, t } = useI18n();
  const cancelRef = useRef(false);
  const abortRef = useRef(null);

  const [skipExisting, setSkipExisting] = useState(true);
  const [useCache, setUseCache] = useState(true);
  const [source, setSource] = useState("mix4");
  const [mixFile, setMixFile] = useState(null);
  const [convert, setConvert] = useState("none");
  const [ssid, setSsid] = useState(() => loadAccount().ssid);
  const [sspassword, setSspassword] = useState(() => loadAccount().sspassword);
  const [remember, setRemember] = useState(() => loadAccount().remember);
  const [forceSys, setForceSys] = useState("");
  const [systems, setSystems] = useState([]);

  // id -> readable system name, to label covers and misses.
  const systemsById = useMemo(() => {
    const m = new Map();
    for (const s of systems) m.set(s.id, s.name);
    return m;
  }, [systems]);
  const systemLabel = useCallback(
    (item) =>
      systemsById.get(item?.systemeid) ||
      (item?.sysShort ? item.sysShort.toUpperCase() : "?"),
    [systemsById]
  );

  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("scraper"); // "scraper" | "tools"
  const [testing, setTesting] = useState(false);
  const [account, setAccount] = useState(null); // { perDay, today, used }
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [status, setStatus] = useState("");
  const [cacheLine, setCacheLine] = useState("");

  const [sessionCovers, setSessionCovers] = useState([]);
  const [sessionMisses, setSessionMisses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const autoFollowRef = useRef(true);
  const folderFilesRef = useRef([]);
  const [folderCount, setFolderCount] = useState(0);
  const { getUrl, urlReady } = useObjectUrls(sessionCovers);

  const refreshCacheStats = useCallback(async () => {
    try {
      const s = await cacheStats();
      setCacheLine(t("cacheStatsLine", {
        games: s.games,
        media: s.media,
        size: formatBytes(s.bytes),
      }));
    } catch (e) {
      setCacheLine("");
    }
  }, [lang, t]);

  useEffect(() => {
    loadSystems().then(setSystems);
  }, []);

  // Warn before leaving (refresh, close, or a stray swipe-back) while there are
  // covers in the current session that would be lost.
  useEffect(() => {
    if (!sessionCovers.length) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionCovers.length]);

  useEffect(() => {
    refreshCacheStats();
  }, [refreshCacheStats]);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search || "");
      if ((p.get("target") || "").toLowerCase() === "gw") setConvert("gw");
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!remember) return localStorage.removeItem(ACCOUNT_KEY);
    if (ssid.trim()) localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ssid, sspassword }));
  }, [remember, ssid, sspassword]);

  const appendLog = (msg) => console.debug("[scrape]", msg);

  const revokeSession = () => {
    setSessionCovers([]);
    setSessionMisses([]);
    setSelectedId(null);
    autoFollowRef.current = true;
  };

  // Auto-follow: jump to the latest cover once its blob URL is ready (not before).
  useEffect(() => {
    if (!autoFollowRef.current || !sessionCovers.length) return;
    const last = sessionCovers[sessionCovers.length - 1];
    if (last && getUrl(last.id)) setSelectedId(last.id);
  }, [sessionCovers, urlReady, getUrl]);

  const handleRun = async (e) => {
    e.preventDefault();
    if (!folderFilesRef.current.length) return alert(t("alertFolder"));
    if (source === "mixcustom" && !mixFile) return alert(t("alertMix"));

    cancelRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    autoFollowRef.current = true;
    revokeSession();
    setProgress({ done: 0, total: 0 });
    setStatus("");
    setRunning(true);

    const result = await runCovers(
      {
        files: folderFilesRef.current,
        source,
        mixFile,
        useCache,
        convert,
        ssid,
        sspassword,
        skipExisting,
        forceSys: parseInt(forceSys, 10) || null,
      },
      {
        onLog: appendLog,
        onProgress: (done, total) => setProgress({ done, total }),
        onStatus: setStatus,
        onAccount: setAccount,
        onCover: (cover) => {
          setSessionCovers((prev) => [...prev, cover]);
        },
        onMiss: (miss) => {
          setSessionMisses((prev) => [...prev, miss]);
        },
        shouldCancel: () => cancelRef.current,
        signal: controller.signal,
      }
    );

    if (result?.error === "badAccount") alert(t("badAccount"));
    else if (result?.error === "mixInvalid") alert(t("mixInvalid"));
    else if (result)
      setStatus(
        t("done", {
          ok: result.ok,
          miss: result.miss,
          fail: result.fail,
          req: result.requests,
        })
      );
    setRunning(false);
    refreshCacheStats();
  };

  const handleStop = () => {
    cancelRef.current = true;
    abortRef.current?.abort();
  };

  // --- Standalone PNG/JPG -> G&W .img converter (local, no API) ---
  const convInputRef = useRef(null);
  const convFilesRef = useRef([]);
  const [convCount, setConvCount] = useState(0);
  const [converting, setConverting] = useState(false);
  const [convProgress, setConvProgress] = useState({ done: 0, total: 0 });
  const [convStatus, setConvStatus] = useState("");

  const onConvPick = (e) => {
    const imgs = Array.from(e.target.files || []).filter((f) => {
      const parts = f.webkitRelativePath.split("/");
      if (parts.some((p) => p.startsWith("."))) return false;
      return IMAGE_EXT.has(ext(f.name));
    });
    convFilesRef.current = imgs;
    setConvCount(imgs.length);
    setConvStatus("");
  };

  const handleConvert = async () => {
    if (!convFilesRef.current.length) return alert(t("gwConvertNone"));
    setConverting(true);
    setConvProgress({ done: 0, total: convFilesRef.current.length });
    setConvStatus("");
    const res = await convertImagesToGW(convFilesRef.current, {
      onProgress: (done, total) => setConvProgress({ done, total }),
      onLog: (m) => console.debug("[gw]", m),
    });
    setConvStatus(t("gwConvertDone", { ok: res.ok, fail: res.fail, total: res.total }));
    setConverting(false);
  };
  const convPct = convProgress.total
    ? Math.round((convProgress.done / convProgress.total) * 100)
    : 0;

  // --- Manual search & assign for misses ---
  const [searchFor, setSearchFor] = useState(null); // the miss whose panel is open
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchSys, setSearchSys] = useState(""); // selected systemeid for the search ("" = all)
  const [preview, setPreview] = useState(null); // { url, x, y } hover preview
  const assignedZipRef = useRef(null);
  const [assignedCount, setAssignedCount] = useState(0);
  const [assigning, setAssigning] = useState(false);

  const queryFromName = (name) =>
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[([].*?[)\]]/g, "")
      .replace(/[_.]+/g, " ")
      .trim();

  const openSearch = (miss) => {
    setSearchFor(miss);
    setSearchQuery(queryFromName(miss.name));
    setSearchResults([]);
    setSearchError("");
    setSearchSys(String(miss.systemeids?.[0] ?? miss.systemeid ?? ""));
  };

  const runSearch = async (miss, query) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchResults([]);
    setSearchError("");
    try {
      const res = await searchGames({
        query,
        systemeid: searchSys || null,
        ssid,
        sspassword,
      });
      setSearchResults(res);
      if (res.length === 0) setSearchError(t("searchNoResult"));
    } catch (e) {
      setSearchError(t("searchError"));
    } finally {
      setSearching(false);
    }
  };

  const pickResult = async (miss, result) => {
    setAssigning(true);
    try {
      const built = await assignCover({
        gameId: result.gameId,
        jeu: result.jeu,
        source,
        mixFile,
        useCache,
        convert,
        ssid,
        sspassword,
        parts: miss.parts,
        fileName: miss.name,
      });
      if (!built) {
        alert(t("assignFailed"));
        return;
      }
      setSessionCovers((prev) => [
        ...prev,
        {
          id: `manual:${Date.now()}:${miss.name}`,
          name: miss.name,
          blob: built.previewBlob,
          outputPath: built.outputPath,
          systemeid: result.systemId ?? miss.systemeid,
          sysShort: miss.sysShort,
        },
      ]);
      if (!assignedZipRef.current) assignedZipRef.current = new window.JSZip();
      assignedZipRef.current.file(built.outputPath, built.zipBlob);
      setAssignedCount((c) => c + 1);
      setSessionMisses((prev) => prev.filter((m) => m.id !== miss.id));
      setSearchFor(null);
      setSearchResults([]);
    } catch (e) {
      alert(t("assignFailed"));
    } finally {
      setAssigning(false);
    }
  };

  const downloadAssigned = async () => {
    if (!assignedZipRef.current || assignedCount === 0) return;
    const blob = await assignedZipRef.current.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "covers.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const q = await fetchAccount(ssid, sspassword);
      if (!q || q.status === "unknown") {
        alert(t("testError"));
      } else if (q.status === "bad") {
        setAccount(null);
        alert(t("badAccount"));
      } else {
        const used = q.today ?? 0;
        setAccount({ perDay: q.perDay ?? null, today: q.today ?? null, used });
        alert(
          q.perDay
            ? t("testOk", { used, perDay: q.perDay })
            : t("testOkNoQuota")
        );
      }
    } catch (e) {
      alert(t("testError"));
    }
    setTesting(false);
  };

  const handleClearCache = async () => {
    try {
      await clearCache();
      appendLog(t("cacheCleared"));
    } catch (e) {
      appendLog(t("previewErr2", { msg: e.message }));
    }
    refreshCacheStats();
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <div className="bg-glow bg-glow--red" aria-hidden />
      <div className="bg-glow bg-glow--green" aria-hidden />

      <header className="header">
        <div className="header__brand">
          <div className="header__icon" aria-hidden />
          <div>
            <h1>{t("title")}</h1>
          </div>
        </div>
        <label className="lang-picker">
          <span>{t("langLabel")}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </label>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={`tab${tab === "scraper" ? " tab--active" : ""}`}
          onClick={() => setTab("scraper")}
        >
          {t("tabScraper")}
        </button>
        <button
          type="button"
          className={`tab${tab === "tools" ? " tab--active" : ""}`}
          onClick={() => setTab("tools")}
        >
          {t("tabTools")}
        </button>
      </nav>

      {tab === "scraper" && (
      <div className="layout">
        <aside className="panel panel--config">
          <section className="card">
            <h2>{t("folderLegend")}</h2>
            <input
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => {
                folderFilesRef.current = Array.from(e.target.files || []);
                setFolderCount(folderFilesRef.current.length);
              }}
            />
            {folderCount > 0 && (
              <p className="hint">{folderCount} file(s) selected</p>
            )}
            <label className="field">
              <span>{t("forceSysLabel")}</span>
              <select value={forceSys} onChange={(e) => setForceSys(e.target.value)}>
                <option value="">{t("forceSysAuto")}</option>
                {systems.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
              {t("skipExisting")}
            </label>
            <label className="check">
              <input type="checkbox" checked={useCache} onChange={(e) => setUseCache(e.target.checked)} />
              {t("useCacheLabel")}
            </label>
            <button type="button" className="btn btn--muted" onClick={handleClearCache}>
              {t("clearCache")}
            </button>
            {cacheLine && <p className="note">{cacheLine}</p>}
          </section>

          <section className="card">
            <h2>{t("outputLegend")}</h2>
            <label className="field">
              <span>{t("sourceLabel")}</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="ss">{t("sourceSs")}</option>
                <option value="box">{t("sourceBox")}</option>
                <option value="mix3">{t("sourceMix3")}</option>
                <option value="mix4">{t("sourceMix4")}</option>
                <option value="mix5">{t("sourceMix5")}</option>
                <option value="mixcustom">{t("sourceMixCustom")}</option>
              </select>
            </label>
            {source === "mixcustom" && (
              <label className="field">
                <span>{t("mixLabel")}</span>
                <input type="file" accept=".xml" onChange={(e) => setMixFile(e.target.files?.[0] || null)} />
              </label>
            )}
            <label className="field">
              <span>{t("convertLabel")}</span>
              <select value={convert} onChange={(e) => setConvert(e.target.value)}>
                <option value="none">{t("convertNone")}</option>
                <option value="gw">{t("convertGW")}</option>
              </select>
            </label>
          </section>

          <form className="card" onSubmit={handleRun}>
            <h2>{t("credsLegend")}</h2>
            {account && account.perDay != null && (
              <div className="quota">
                <div className="quota__head">
                  <span>{t("quotaLabel")}</span>
                  <span className="quota__nums">
                    {account.used ?? 0} / {account.perDay}
                  </span>
                </div>
                <div className="quota__bar">
                  <div
                    className="quota__fill"
                    style={{
                      width: `${Math.min(100, Math.round(((account.used ?? 0) / account.perDay) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
            <div className="row">
              <label className="field">
                <span>{t("ssidLabel")}</span>
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t("sspasswordLabel")}</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={sspassword}
                  onChange={(e) => setSspassword(e.target.value)}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {t("rememberLabel")}
            </label>
            <button
              type="button"
              className="btn btn--muted"
              onClick={handleTest}
              disabled={testing || running}
            >
              {testing ? t("testing") : t("testBtn")}
            </button>
            <p className="note" dangerouslySetInnerHTML={{ __html: t("credsNote") }} />

            <div className="actions">
              <button type="submit" className="btn btn--primary" disabled={running}>
                {t("runBtn")}
              </button>
              <button
                type="button"
                className="btn btn--muted"
                disabled={!running}
                onClick={handleStop}
              >
                {t("stopBtn")}
              </button>
            </div>
          </form>
        </aside>

        <main className="panel panel--work">
          <CoverFlow
            covers={sessionCovers}
            selectedId={selectedId}
            onSelect={(id) => {
              // Re-arm auto-follow only when returning to the latest cover;
              // selecting any older one pins the view there.
              const last = sessionCovers[sessionCovers.length - 1];
              autoFollowRef.current = !!last && id === last.id;
              setSelectedId(id);
            }}
            getUrl={getUrl}
            urlReady={urlReady}
            systemLabel={systemLabel}
            t={t}
          />

          {(running || progress.total > 0 || status) && (
            <div className="progress-wrap">
              {(running || progress.total > 0) && (
                <>
                  <div className="progress-head">
                    <span>{t("progressLabel")}</span>
                    <span className="progress-nums">
                      {progress.done} / {progress.total} · {pct}%
                    </span>
                  </div>
                  <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
                  </div>
                </>
              )}
              {status && <p className="status">{status}</p>}
            </div>
          )}

          <section className="card misses-card">
            <div className="misses-card__head">
              <h2>{t("missesLegend")}</h2>
              <span className="misses-count">
                {sessionMisses.length
                  ? t("missesCount", { count: sessionMisses.length })
                  : t("missesEmpty")}
              </span>
            </div>
            {assignedCount > 0 && (
              <button type="button" className="btn btn--muted assigned-dl" onClick={downloadAssigned}>
                {t("assignedDownload", { count: assignedCount })}
              </button>
            )}
            {sessionMisses.length > 0 && (
              <ul className="misses-list">
                {sessionMisses.map((m) => (
                  <li key={m.id} className="misses-item">
                    <div className="misses-item__row">
                      <span className="sys-badge">{systemLabel(m)}</span>
                      <span className="misses-item__name">{m.name}</span>
                      <span className="misses-item__reason">
                        {t(`missReason_${m.reason}`)}
                      </span>
                      <button
                        type="button"
                        className="misses-item__search"
                        onClick={() => (searchFor?.id === m.id ? setSearchFor(null) : openSearch(m))}
                      >
                        {searchFor?.id === m.id ? "✕" : t("searchBtn")}
                      </button>
                    </div>
                    {searchFor?.id === m.id && (
                      <div className="search-panel">
                        {(m.systemeids?.length ?? 0) > 1 && (
                          <select
                            className="search-sys"
                            value={searchSys}
                            onChange={(e) => setSearchSys(e.target.value)}
                          >
                            {m.systemeids.map((sid) => (
                              <option key={sid} value={String(sid)}>
                                {systemsById.get(sid) || `#${sid}`}
                              </option>
                            ))}
                            <option value="">{t("searchAllSystems")}</option>
                          </select>
                        )}
                        <div className="search-bar">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && runSearch(m, searchQuery)}
                            placeholder={t("searchPlaceholder")}
                          />
                          <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => runSearch(m, searchQuery)}
                            disabled={searching || assigning}
                          >
                            {searching ? t("searching") : t("searchBtn")}
                          </button>
                        </div>
                        {searchError && <p className="search-error">{searchError}</p>}
                        {searchResults.length > 0 && (
                          <ul className="search-results">
                            {searchResults.map((r) => (
                              <li key={r.gameId}>
                                <button
                                  type="button"
                                  className="search-result"
                                  onClick={() => pickResult(m, r)}
                                  disabled={assigning}
                                  title={r.name}
                                >
                                  {r.thumb ? (
                                    <img
                                      src={r.thumb}
                                      alt=""
                                      loading="lazy"
                                      onMouseEnter={(e) => setPreview({ url: r.thumb, x: e.clientX, y: e.clientY })}
                                      onMouseMove={(e) => setPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))}
                                      onMouseLeave={() => setPreview(null)}
                                    />
                                  ) : (
                                    <span className="search-result__noimg" />
                                  )}
                                  <span className="search-result__name">{r.name}</span>
                                  {r.systemName && (
                                    <span className="search-result__sys">{r.systemName}</span>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>{t("notesLegend")}</h2>
            <p className="note" dangerouslySetInnerHTML={{ __html: t("notes") }} />
          </section>
        </main>
      </div>
      )}

      {tab === "tools" && (
        <div className="tools-view">
          <section className="card">
            <h2>{t("gwConvertLegend")}</h2>
            <p className="note" dangerouslySetInnerHTML={{ __html: t("gwConvertNote") }} />
            <input
              ref={convInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: "none" }}
              onChange={onConvPick}
            />
            <button
              type="button"
              className="btn btn--muted"
              onClick={() => convInputRef.current?.click()}
              disabled={converting}
            >
              {t("gwConvertChoose")}
            </button>
            {convCount > 0 && (
              <p className="hint">{t("gwImagesFound", { count: convCount })}</p>
            )}
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleConvert}
              disabled={converting || convCount === 0}
            >
              {converting ? t("gwConverting") : t("gwConvertBtn")}
            </button>
            {converting && (
              <div className="progress-wrap">
                <div className="progress-head">
                  <span>{t("gwConverting")}</span>
                  <span className="progress-nums">
                    {convProgress.done} / {convProgress.total} · {convPct}%
                  </span>
                </div>
                <div className="progress-bar" role="progressbar" aria-valuenow={convPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-bar__fill" style={{ width: `${convPct}%` }} />
                </div>
              </div>
            )}
            {convStatus && <p className="status">{convStatus}</p>}
          </section>
        </div>
      )}

      {preview && (
        <div
          className="hover-preview"
          style={{
            left: Math.min(preview.x + 18, window.innerWidth - 260),
            top: Math.min(preview.y + 18, window.innerHeight - 340),
          }}
        >
          <img src={preview.url} alt="" />
        </div>
      )}
    </div>
  );
}
