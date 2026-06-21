// default.lay geometry parser.

export function parseLayout(layText) {
  const doc = new DOMParser().parseFromString(layText, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror') throw new Error("default.lay unreadable");
  const geo = {
    found: false, background_file: 'BackgroundNS.png',
    background_x: 0, background_y: 0, background_width: 0, background_height: 0,
    screen_x: 0, screen_y: 0, screen_width: 0, screen_height: 0,
  };

  const views = Array.from(root.children).filter((x) => x.tagName === 'view');
  let backgroundRef = null;

  function tryView(view) {
    const scr = view.querySelector(':scope > screen');
    if (!scr) return false;
    const sb = scr.querySelector(':scope > bounds'); if (!sb) return false;
    const cand = Object.assign({}, geo);
    cand.screen_x = int(sb.getAttribute('x')); cand.screen_y = int(sb.getAttribute('y'));
    cand.screen_width = int(sb.getAttribute('width')); cand.screen_height = int(sb.getAttribute('height'));
    let ok = false;
    for (const tag of ['element', 'overlay']) {
      for (const e of view.querySelectorAll(':scope > ' + tag)) {
        const a = (JSON.stringify(attrs(e)) || '').toUpperCase();
        if (a.indexOf('GROUND') > -1 || a.indexOf('BG') > -1 || a.indexOf('OVERLAY') > -1) {
          const eb = e.querySelector(':scope > bounds'); if (!eb) continue;
          backgroundRef = e.getAttribute('ref') || e.getAttribute('element');
          cand.background_x = int(eb.getAttribute('x')); cand.background_y = int(eb.getAttribute('y'));
          cand.background_width = int(eb.getAttribute('width')); cand.background_height = int(eb.getAttribute('height'));
          ok = true;
        }
      }
    }
    if (ok) Object.assign(geo, cand, { found: true });
    return ok;
  }

  // pass 1: name contains BACK & ONLY (or "External Layout"), excluding FAN
  for (const v of views) {
    const name = (v.getAttribute('name') || '').toUpperCase();
    if (((name.indexOf('BACK') > -1 && name.indexOf('ONLY') > -1) || (v.getAttribute('name') || '').indexOf('External Layout') > -1) && name.indexOf('FAN') === -1) {
      if (tryView(v)) break;
    }
  }
  // pass 2: any view whose name contains BACK
  if (!geo.found) {
    for (const v of views) {
      const name = (v.getAttribute('name') || '').toUpperCase();
      if (name.indexOf('BACK') > -1) { if (tryView(v)) break; }
    }
  }
  // resolve background image filename from top-level <element name=ref><image file=...>
  if (geo.found && backgroundRef) {
    for (const e of root.querySelectorAll(':scope > element')) {
      if (e.getAttribute('name') === backgroundRef) {
        const img = e.querySelector(':scope > image');
        if (img && img.getAttribute('file')) geo.background_file = img.getAttribute('file');
      }
    }
  }
  return geo;
}

function attrs(e) { const o = {}; for (const a of e.attributes) o[a.name] = a.value; return o; }
function int(v) { return parseInt(v || '0', 10) || 0; }
