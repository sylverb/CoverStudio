import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";

const ASPECT = 1.3; // card width : height (fits 4:3 screenshots and box art)
const SIDE = 4; // number of covers shown on each side of the center

// Look & feel knobs (all easy to tweak):
const CENTER_FRACTION = 0.5; // center card width as a fraction of the viewport
const FIRST_OFFSET = 0.55; // 1st neighbour distance, as a fraction of card width
const GAP = 0.5; // extra distance per further neighbour, fraction of card width
const ROTATE = 48; // side tilt in degrees
const DEPTH = 120; // how far back each step recedes (px)
const SCALE_BASE = 0.84; // 1st neighbour scale
const SCALE_STEP = 0.1; // shrink per further neighbour

export default function CoverFlow({
  covers,
  selectedId,
  onSelect,
  getUrl,
  urlReady,
  systemLabel,
  t,
}) {
  // Center on the selected cover only when its image is ready.
  const focusIndex = useMemo(() => {
    if (!covers.length) return 0;
    if (selectedId) {
      const i = covers.findIndex((c) => c.id === selectedId);
      if (i >= 0 && getUrl(selectedId)) return i;
    }
    for (let i = covers.length - 1; i >= 0; i--) {
      if (getUrl(covers[i].id)) return i;
    }
    return 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covers, selectedId, getUrl, urlReady]);

  const focused = covers[focusIndex] ?? null;

  // Real aspect ratio (w/h) of each cover's image, learned once it loads.
  // Cards size to this so images are never letterboxed. Clamped to keep the
  // layout sane for extreme panoramas / strips.
  const [aspects, setAspects] = useState({});
  const onImgLoad = useCallback((id, e) => {
    const { naturalWidth: w, naturalHeight: h } = e.target;
    if (!w || !h) return;
    const ratio = Math.max(0.6, Math.min(1.8, w / h));
    setAspects((prev) =>
      Math.abs((prev[id] ?? 0) - ratio) < 0.001 ? prev : { ...prev, [id]: ratio }
    );
  }, []);

  const go = useCallback(
    (delta) => {
      if (!covers.length) return;
      const next = Math.min(covers.length - 1, Math.max(0, focusIndex + delta));
      onSelect(covers[next].id);
    },
    [covers, focusIndex, onSelect]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (!covers.length) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covers.length, go]);

  // Measure the viewport so card size / spacing scale with the available space.
  const vpRef = useRef(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const update = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Horizontal trackpad swipe -> navigate covers, and block the browser's
  // back/forward navigation gesture over the coverflow.
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    let accum = 0;
    let lastTs = 0;
    let cooling = false;
    const THRESHOLD = 55;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical -> ignore
      e.preventDefault(); // stop macOS swipe-to-go-back/forward
      if (e.timeStamp - lastTs > 300) accum = 0; // new gesture
      lastTs = e.timeStamp;
      if (cooling) return;
      accum += e.deltaX;
      if (Math.abs(accum) >= THRESHOLD) {
        go(accum > 0 ? 1 : -1); // swipe left -> next, swipe right -> previous
        accum = 0;
        cooling = true;
        setTimeout(() => { cooling = false; }, 220);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go]);

  const ready = vp.w > 0 && vp.h > 0;
  const cardW = ready
    ? Math.min(vp.w * CENTER_FRACTION, vp.h * 0.86 * ASPECT, 300 * ASPECT)
    : 230 * ASPECT;
  const cardH = cardW / ASPECT;
  const gap = cardW * GAP;

  // Single, consistent transform per card (no CSS width/margin animation).
  const layout = (offset) => {
    const a = Math.abs(offset);
    const s = Math.sign(offset);
    if (a === 0) return { x: 0, z: 0, ry: 0, sc: 1 };
    const x = s * (cardW * FIRST_OFFSET + (a - 1) * gap);
    return {
      x,
      z: -a * DEPTH,
      ry: -s * ROTATE,
      sc: Math.max(0.55, SCALE_BASE - (a - 1) * SCALE_STEP),
    };
  };

  // Clicking anywhere on the stage selects the cover whose center is closest to
  // the click — positional, so it works regardless of 3D stacking/overlap (the
  // center card no longer "captures" clicks meant for a background cover).
  const onStageClick = (e) => {
    const el = vpRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clickX = e.clientX - rect.left - rect.width / 2;
    let best = null;
    let bestDist = Infinity;
    covers.forEach((cover, index) => {
      const offset = index - focusIndex;
      if (Math.abs(offset) > SIDE || !getUrl(cover.id)) return;
      const d = Math.abs(layout(offset).x - clickX);
      if (d < bestDist) { bestDist = d; best = cover; }
    });
    if (best) onSelect(best.id);
  };

  return (
    <section className="card coverflow-card">
      <div className="coverflow-card__head">
        <h2>{t("galleryLegend")}</h2>
        <span className="coverflow-count">
          {covers.length ? t("galleryCount", { count: covers.length }) : ""}
        </span>
      </div>

      {focused && (
        <p className="coverflow-title">
          {systemLabel && <span className="sys-badge">{systemLabel(focused)}</span>}
          {focused.name}
        </p>
      )}

      <div className="coverflow-stage" aria-live="polite">
        {covers.length === 0 ? (
          <div className="coverflow-empty">{t("galleryEmpty")}</div>
        ) : (
          <>
            <button
              type="button"
              className="coverflow-nav coverflow-nav--prev"
              onClick={() => go(-1)}
              disabled={focusIndex <= 0}
              aria-label={t("coverflowPrev")}
            >
              ‹
            </button>

            <div className="coverflow-viewport" ref={vpRef} onClick={onStageClick}>
              <div className="coverflow-track">
                {covers.map((cover, index) => {
                  const offset = index - focusIndex;
                  if (Math.abs(offset) > SIDE) return null;
                  const url = getUrl(cover.id);
                  const a = Math.abs(offset);
                  const isCenter = offset === 0;
                  const { x, z, ry, sc } = layout(offset);
                  const ratio = aspects[cover.id] ?? ASPECT;
                  return (
                    <button
                      key={cover.id}
                      type="button"
                      className={`coverflow-item${isCenter ? " coverflow-item--active" : ""}`}
                      style={{
                        width: `${cardH * ratio}px`,
                        height: `${cardH}px`,
                        transform: `translate(-50%, -50%) translateX(${x}px) translateZ(${z}px) rotateY(${ry}deg) scale(${sc})`,
                        zIndex: 100 - a,
                        opacity: url ? Math.max(0, 1 - a * 0.12) : 0.4,
                        pointerEvents: "none",
                      }}
                      title={cover.name}
                      disabled={!url}
                    >
                      {url ? (
                        <img
                          src={url}
                          alt=""
                          draggable={false}
                          onLoad={(e) => onImgLoad(cover.id, e)}
                        />
                      ) : (
                        <span className="coverflow-item__placeholder" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="coverflow-nav coverflow-nav--next"
              onClick={() => go(1)}
              disabled={focusIndex >= covers.length - 1}
              aria-label={t("coverflowNext")}
            >
              ›
            </button>
          </>
        )}
      </div>

      {covers.length > 1 && (
        <p className="coverflow-hint">
          {focusIndex + 1} / {covers.length} — {t("coverflowHint")}
        </p>
      )}
    </section>
  );
}
