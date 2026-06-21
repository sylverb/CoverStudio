import { useState, useRef, useEffect, useCallback } from "react";
import { convertGw, fmtSize } from "../../js/gw/convert.js";
import "./GwShrinker.css";

const DEFAULT_OPTS = {
  segBits: 4, bg: "rgb565", jpegQ: 90, bgRes: 1,
  keepAspect: false, invert: false, dropShadow: false,
  cpu: "", name: "", fetchBtn: true, allowFetch: true,
};

export default function GwShrinker({ t }) {
  const [rom, setRom] = useState(null); // { name, size }
  const [art, setArt] = useState(null);
  const [drag, setDrag] = useState({ rom: false, art: false });
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [log, setLog] = useState([]);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState(null); // { name, size }
  const [advOpen, setAdvOpen] = useState(false);

  const romBufRef = useRef(null);
  const artBufRef = useRef(null);
  const resultBytesRef = useRef(null);
  const romInputRef = useRef(null);
  const artInputRef = useRef(null);
  const previewRef = useRef(null);
  const consoleRef = useRef(null);

  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [log]);

  const loadFile = useCallback(async (file, which) => {
    const buf = await file.arrayBuffer();
    const info = { name: file.name, size: buf.byteLength };
    if (which === "rom") { romBufRef.current = buf; setRom(info); }
    else { artBufRef.current = buf; setArt(info); }
  }, []);

  const slotProps = (which) => ({
    onClick: () => (which === "rom" ? romInputRef : artInputRef).current?.click(),
    onDragEnter: (e) => { e.preventDefault(); setDrag((d) => ({ ...d, [which]: true })); },
    onDragOver: (e) => { e.preventDefault(); setDrag((d) => ({ ...d, [which]: true })); },
    onDragLeave: (e) => { e.preventDefault(); setDrag((d) => ({ ...d, [which]: false })); },
    onDrop: (e) => {
      e.preventDefault();
      setDrag((d) => ({ ...d, [which]: false }));
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f, which);
    },
  });

  const onConvert = async () => {
    setLog([]);
    setResult(null);
    setConverting(true);
    const append = (text, cls) => setLog((l) => [...l, { text, cls }]);
    try {
      const r = await convertGw({
        romBuf: romBufRef.current,
        romFileName: rom?.name,
        artBuf: artBufRef.current,
        artFileName: art?.name,
        opts,
        onLog: append,
        previewCanvas: previewRef.current,
      });
      resultBytesRef.current = r.bytes;
      setResult({ name: r.name, size: r.bytes.length });
      if (r.effectiveKeepAspect && !opts.keepAspect) setOpt("keepAspect", true);
    } catch (e) {
      append("✖ " + (e && e.message ? e.message : e), "err");
    } finally {
      setConverting(false);
    }
  };

  const onDownload = () => {
    const bytes = resultBytesRef.current;
    if (!bytes) return;
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = result.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const slot = (which, info, dropTxt, hintTxt, label) => (
    <div className={`gw-slot${info ? " has" : ""}${drag[which] ? " drag" : ""}`} {...slotProps(which)}>
      <div className="gw-ico">{label}</div>
      <div className="gw-meta">
        <b>{info ? info.name : dropTxt}</b>
        <small>{info ? `${fmtSize(info.size)} — ${t("gwshReady")}` : hintTxt}</small>
      </div>
    </div>
  );

  return (
    <div className="gw-shrinker">
      <header className="gw-hero">
        <div className="gw-badge"><b>.gw</b></div>
        <div>
          <h1>GW <span>{t("gwshTitle")}</span></h1>
          <p>{t("gwshDesc")}</p>
        </div>
      </header>

      <div className="gw-grid">
        {/* LEFT: inputs + options */}
        <div>
          <div className="gw-panel">
            <h2><span className="gw-num">01</span> {t("gwshS01")}</h2>
            {slot("rom", rom, t("gwshRomDrop"), t("gwshRomHint"), "ROM")}
            <input ref={romInputRef} type="file" accept=".zip" hidden
              onChange={(e) => e.target.files[0] && loadFile(e.target.files[0], "rom")} />
            {slot("art", art, t("gwshArtDrop"), t("gwshArtHint"), "ART")}
            <input ref={artInputRef} type="file" accept=".zip" hidden
              onChange={(e) => e.target.files[0] && loadFile(e.target.files[0], "art")} />
            <p className="gw-hint">{t("gwshCombinedHint")}</p>
          </div>

          <div className="gw-panel" style={{ marginTop: 18 }}>
            <h2><span className="gw-num">02</span> {t("gwshS02")}</h2>
            <div className="gw-opts">
              <div>
                <label className="gw-field">{t("gwshSegRes")}</label>
                <select value={opts.segBits} onChange={(e) => setOpt("segBits", parseInt(e.target.value, 10))}>
                  <option value={8}>{t("gwshSeg8")}</option>
                  <option value={4}>{t("gwshSeg4")}</option>
                  <option value={2}>{t("gwshSeg2")}</option>
                </select>
              </div>
              <div>
                <label className="gw-field">{t("gwshBg")}</label>
                <select value={opts.bg} onChange={(e) => setOpt("bg", e.target.value)}>
                  <option value="rgb565">{t("gwshBgRgb")}</option>
                  <option value="jpeg">{t("gwshBgJpeg")}</option>
                </select>
              </div>
              <div>
                <label className="gw-field">{t("gwshJpegQ")}</label>
                <input type="number" min="40" max="100" value={opts.jpegQ}
                  onChange={(e) => setOpt("jpegQ", parseInt(e.target.value, 10) || 90)} />
              </div>
              <div>
                <label className="gw-field">{t("gwshBgReduce")}</label>
                <select value={opts.bgRes} onChange={(e) => setOpt("bgRes", parseInt(e.target.value, 10))}>
                  <option value={1}>RGB565 (none)</option>
                  <option value={2}>RGB454</option>
                  <option value={4}>RGB343</option>
                  <option value={8}>RGB232</option>
                </select>
              </div>
              <div className="gw-full">
                <label className="gw-check"><input type="checkbox" checked={opts.keepAspect}
                  onChange={(e) => setOpt("keepAspect", e.target.checked)} /> {t("gwshKeepAspect")}</label>
                <label className="gw-check"><input type="checkbox" checked={opts.invert}
                  onChange={(e) => setOpt("invert", e.target.checked)} /> {t("gwshInvert")}</label>
                <label className="gw-check"><input type="checkbox" checked={opts.dropShadow}
                  onChange={(e) => setOpt("dropShadow", e.target.checked)} /> {t("gwshShadow")}</label>
              </div>
            </div>

            <details open={advOpen} onToggle={(e) => setAdvOpen(e.target.open)}>
              <summary>{t("gwshAdvanced")}</summary>
              <div className="gw-hint" style={{ paddingTop: 10 }}>{t("gwshAdvHint")}</div>
              <div className="gw-opts" style={{ marginTop: 8 }}>
                <div>
                  <label className="gw-field">{t("gwshCpuOverride")}</label>
                  <select value={opts.cpu} onChange={(e) => setOpt("cpu", e.target.value)}>
                    <option value="">{t("gwshAuto")}</option>
                    <option value="SM510__">SM510</option>
                    <option value="SM511__">SM511</option>
                    <option value="SM512__">SM512</option>
                    <option value="SM500__">SM500</option>
                    <option value="SM5A___">SM5A / KB1013VK12</option>
                  </select>
                </div>
                <div>
                  <label className="gw-field">{t("gwshNameOverride")}</label>
                  <input type="text" placeholder="Game & Watch: ..." value={opts.name}
                    onChange={(e) => setOpt("name", e.target.value)} />
                </div>
                <div className="gw-full">
                  <label className="gw-check"><input type="checkbox" checked={opts.fetchBtn}
                    onChange={(e) => setOpt("fetchBtn", e.target.checked)} /> {t("gwshFetchBtn")}</label>
                  <label className="gw-check"><input type="checkbox" checked={opts.allowFetch}
                    onChange={(e) => setOpt("allowFetch", e.target.checked)} /> {t("gwshAllowFetch")}</label>
                </div>
              </div>
            </details>

            <button className="gw-cta" onClick={onConvert} disabled={converting || (!rom && !art)}>
              {converting ? t("gwshConverting") : t("gwshConvert")}
            </button>
          </div>
        </div>

        {/* RIGHT: preview + console + result */}
        <div>
          <div className="gw-panel">
            <h2><span className="gw-num">03</span> {t("gwshS03")}</h2>
            <div className="gw-screen">
              <div className="gw-scr-label"><span>{t("gwshLcdPreview")}</span><span>320×240</span></div>
              <canvas ref={previewRef} width="320" height="240" />
            </div>
            <div className="gw-console" ref={consoleRef}>
              {log.length === 0 ? (
                <span className="t">{t("gwshConsoleReady")}</span>
              ) : (
                log.map((line, i) => (
                  <span key={i} className={line.cls || ""}>{line.text}{"\n"}</span>
                ))
              )}
            </div>

            {result && (
              <div className="gw-result show">
                <button className="gw-dl" onClick={onDownload}>
                  {t("gwshDownload")}
                  <small>{result.name} — {fmtSize(result.size)}</small>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="gw-foot">{t("gwshFoot1")}<br />{t("gwshFoot2")}</p>
    </div>
  );
}
