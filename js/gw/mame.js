// MAME metadata (hh_sm510.cpp) + best-effort custom button/RTC script parsing.

export const MAME_CPP_COMMIT = "aaef28cd47db02b2b66359a49ca50c4ffaed464c"; // pinned, same as the tool
export const MAME_CPP_URL = "https://raw.githubusercontent.com/mamedev/mame/" + MAME_CPP_COMMIT + "/src/mame/drivers/hh_sm510.cpp";
export const SHRINKER_CUSTOM_URL = (name) => "https://raw.githubusercontent.com/bzhxx/LCD-Game-Shrinker/main/custom/" + name + ".py";

export const FLAG_SOUND_R1_PIEZO = 1;

let mameCppText = null;
export async function getMameCpp() {
  if (mameCppText) return mameCppText;
  const resp = await fetch(MAME_CPP_URL);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  mameCppText = await resp.text();
  return mameCppText;
}

// Parse the CONS(...) line for rom_name; return {fullname, mame_name, mame_class}
export function parseConsLine(cpp, romName) {
  const lines = cpp.split('\n');
  for (const line of lines) {
    if (line.indexOf('CONS') === -1) continue;
    const parts = line.split(',');
    if (parts.length < 8) continue;
    if (parts[0].indexOf('CONS') > -1 && parts[1].trim() === romName) {
      const q = line.split('"');
      return {
        fullname: q.length > 3 ? q[3] : "'unknown game'",
        mame_name: parts[1].trim(),
        mame_class: parts[6].trim(),
      };
    }
  }
  return null;
}

// From the machine_config block, detect CPU type + deflicker level (mirrors rom_parser.py)
export function detectCpu(cpp, mame_class, mame_name) {
  const lines = cpp.split('\n');
  let found = false;
  const map = [
    ['sm510_common', 'SM510__', 1], ['sm511_common', 'SM511__', 1], ['sm512_common', 'SM512__', 1],
    ['sm5a_common', 'SM5A___', 2], ['kb1013vk12_common', 'SM5A___', 2],
    ['sm510_tiger', 'SM510__', 1], ['sm511_tiger2bit', 'SM511__', 1],
    ['sm510_dualv', 'SM510__', 1], ['sm510_dualh', 'SM510__', 1],
    ['sm511_dualv', 'SM511__', 1], ['sm511_dualh', 'SM511__', 1],
    ['sm512_dualv', 'SM512__', 1], ['sm512_dualh', 'SM512__', 1],
  ];
  for (const line of lines) {
    if (line.indexOf(mame_class) > -1 && line.indexOf(mame_name) > -1 && line.indexOf('machine_config') > -1) found = true;
    if (found) {
      for (const [needle, cpu, defl] of map) {
        if (line.indexOf(needle) > -1) return { cpu, deflicker: defl };
      }
    }
  }
  return null;
}

/* ---------- best-effort custom script parse (buttons / RTC) ---------------- */
export async function fetchCustom(romName) {
  try {
    const r = await fetch(SHRINKER_CUSTOM_URL(romName));
    if (!r.ok) return null;
    const txt = await r.text();
    const res = { BTN_DATA: null, time: {}, sound: null, invert: null, aspect: null, drop: null };
    res.BTN_DATA = parseButtons(txt);
    const grabHex = (key) => { const m = txt.match(new RegExp(key + "\\s*=\\s*([0-9A-Fa-fxX]+)")); return m ? parseInt(m[1]) : null; };
    ['ADD_TIME_HOUR_MSB', 'ADD_TIME_HOUR_LSB', 'ADD_TIME_MIN_MSB', 'ADD_TIME_MIN_LSB',
      'ADD_TIME_SEC_MSB', 'ADD_TIME_SEC_LSB', 'ADD_TIME_HOUR_MSB_PM_VALUE'].forEach((k) => {
      const v = grabHex(k); if (v !== null) res.time[k] = v;
    });
    if (/flag_rendering_lcd_inverted\s*=\s*True/.test(txt)) res.invert = true;
    if (/keep_aspect_ratio\s*=\s*True/.test(txt)) res.aspect = true;
    // drop_shadow = True only if the line isn't commented out
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#')) continue;
      if (/(^|\.)drop_shadow\s*=\s*True/.test(t)) { res.drop = true; break; }
    }
    return res;
  } catch (e) { return null; }
}

// rom_config constants used by custom scripts
function btnConsts() {
  return {
    BTN_LEFT: 0x1, BTN_UP: 0x2, BTN_RIGHT: 0x4, BTN_DOWN: 0x8, BTN_A: 0x10, BTN_B: 0x20, BTN_TIME: 0x40, BTN_GAME: 0x80,
    BTN_SHORTCUT_B_TIME: 0, BTN_SHORTCUT_B_GAME: 0,
    S1: 0, S2: 1, S3: 2, S4: 3, S5: 4, S6: 5, S7: 6, S8: 7, S9: 8, BA: 8, B: 9,
    R1: 0, R2: 1, R3: 2, R4: 3, R5: 4,
    FLAG_SOUND_R1_PIEZO: 1, FLAG_SOUND_R2_PIEZO: 2, FLAG_SOUND_R1R2_PIEZO: 3, FLAG_SOUND_R1S1_PIEZO: 4, FLAG_SOUND_S1R1_PIEZO: 5,
    True: 1, False: 0, None: 0,
  };
}

// small integer expression evaluator ( | & ^ + - * << >> ~ () )
function evalIntExpr(expr, scope) {
  const s = expr; const toks = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '<' && s[i + 1] === '<') { toks.push('<<'); i += 2; continue; }
    if (ch === '>' && s[i + 1] === '>') { toks.push('>>'); i += 2; continue; }
    if ('|&^+-*()~'.indexOf(ch) >= 0) { toks.push(ch); i++; continue; }
    let m = /^(?:0[xX][0-9a-fA-F]+|\d+)/.exec(s.slice(i));
    if (m) { toks.push({ n: parseInt(m[0]) | 0 }); i += m[0].length; continue; }
    m = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
    if (m) {
      const name = m[0].replace(/^rom\./, '');
      if (!(name in scope)) throw new Error('unknown identifier');
      toks.push({ n: scope[name] | 0 }); i += m[0].length; continue;
    }
    throw new Error('bad char');
  }
  let p = 0; const peek = () => toks[p], next = () => toks[p++];
  function atom() {
    const t = next();
    if (t === '(') { const v = or(); if (next() !== ')') throw new Error('paren'); return v | 0; }
    if (t === '-') return (-atom()) | 0;
    if (t === '~') return (~atom()) | 0;
    if (t && typeof t === 'object') return t.n | 0;
    throw new Error('atom');
  }
  function mulp() { let v = atom(); while (peek() === '*') { next(); v = (v * atom()) | 0; } return v; }
  function add() { let v = mulp(); while (peek() === '+' || peek() === '-') { const o = next(), r = mulp(); v = (o === '+' ? v + r : v - r) | 0; } return v; }
  function sh() { let v = add(); while (peek() === '<<' || peek() === '>>') { const o = next(), r = add(); v = (o === '<<' ? v << r : v >> r); } return v; }
  function and() { let v = sh(); while (peek() === '&') { next(); v = v & sh(); } return v; }
  function xor() { let v = and(); while (peek() === '^') { next(); v = v ^ and(); } return v; }
  function or() { let v = xor(); while (peek() === '|') { next(); v = v | xor(); } return v; }
  const out = or();
  if (p !== toks.length) throw new Error('trailing');
  return out >>> 0;
}

function parseButtons(src) {
  const scope = btnConsts();
  const arr = new Array(10).fill(0);
  let found = false;
  for (let raw of src.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    // BTN_DATA[idx] = val
    let m = line.match(/^(?:rom\.)?BTN_DATA\s*\[\s*([^\]]+?)\s*\]\s*=\s*(.+)$/);
    if (m) {
      try {
        const idx = evalIntExpr(m[1], scope), val = evalIntExpr(m[2], scope);
        if (idx >= 0 && idx < 10) { arr[idx] = val; found = true; }
      } catch (e) { /* ignore */ }
      continue;
    }
    // BTN_DATA = [ ... ] (list literal)
    m = line.match(/^(?:rom\.)?BTN_DATA\s*=\s*\[(.*)\]\s*$/);
    if (m) {
      m[1].split(',').map((x) => x.trim()).filter((x) => x.length).forEach((it, k) => {
        if (k < 10) { try { arr[k] = evalIntExpr(it, scope); found = true; } catch (e) { /* ignore */ } }
      });
      continue;
    }
    // generic scalar assignment (locals like K1, or rom.NAME overrides) → scope
    m = line.match(/^((?:rom\.)?[A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (m) {
      const name = m[1].replace(/^rom\./, '');
      try { scope[name] = evalIntExpr(m[2], scope); } catch (e) { /* ignore */ }
      continue;
    }
  }
  return found ? arr : null;
}
