// config.js — shared constants

export const API = "https://api.screenscraper.fr/api2/";

// App name sent to ScreenScraper alongside the dev credentials.
export const SOFTNAME = "CoverStudio";

// Single-media sources: <select> value -> ScreenScraper media type.
export const SINGLE_MEDIA = { ss: "ss", box: "box-2D" };

const _k = "9336163bb3255b523d175bb6b097294c42b92ebc656c2c14";
const _c = ["akpfQFREBFo=", "AXRYD2sHeA4DCwc="];
const _dec = (s) => {
  const d = atob(s);
  let o = "";
  for (let i = 0; i < d.length; i++) o += String.fromCharCode(d.charCodeAt(i) ^ _k.charCodeAt(i % _k.length));
  return o;
};
export const devCreds = () => ({ devid: _dec(_c[0]), devpassword: _dec(_c[1]) });

// Preferred regions when several variants of a media exist.
export const REGION_PREF = ["wor", "eu", "us", "jp", "fr", "ss"];

// Folder shortcode -> ScreenScraper systemeid.
export const SS_SYSTEM_MAP = {
  nes: 3, snes: 4, sfc: 4, gb: [9, 10], gbc: [10, 9], genesis: 1, megadrive: 1, md: 1,
  sms: 2, gg: 21, sg1000: 109, sg: 109, pce: 31, tg16: 31, wswan: 45, wswanc: 46,
  wsv: 45, a2600: 26, a7800: 41, amstrad: 65, col: 48, videopac: 104,
  mini: 211, gw: 52, pico8: 234,
  msx: [116, 113, 117, 118], msx2: 116, "msx2+": 117, msx2plus: 117,
  msxturbor: 118, turbor: 118,
};

// Normalize a folder shortcode to an ordered list of candidate systemeids
// (tried in order until a game is found). Returns [] for unknown folders.
export function systemIdsFor(shortcode) {
  const v = SS_SYSTEM_MAP[shortcode];
  if (v == null) return [];
  return Array.isArray(v) ? v.slice() : [v];
}

// Systems for the manual picker (id = ScreenScraper systemeid). Same ids as
// SS_SYSTEM_MAP, with readable names; alphabetical for easy scanning.
export const SYSTEMS = [
  { id: 65, name: "Amstrad CPC" },
  { id: 26, name: "Atari 2600" },
  { id: 41, name: "Atari 7800" },
  { id: 48, name: "ColecoVision" },
  { id: 52, name: "Game & Watch" },
  { id: 9, name: "Game Boy" },
  { id: 10, name: "Game Boy Color" },
  { id: 113, name: "MSX" },
  { id: 116, name: "MSX2" },
  { id: 117, name: "MSX2+" },
  { id: 118, name: "MSX Turbo R" },
  { id: 104, name: "Magnavox Odyssey² / Videopac" },
  { id: 3, name: "Nintendo (NES)" },
  { id: 31, name: "PC Engine / TurboGrafx-16" },
  { id: 234, name: "PICO-8" },
  { id: 211, name: "Pokémon Mini" },
  { id: 21, name: "Sega Game Gear" },
  { id: 2, name: "Sega Master System" },
  { id: 1, name: "Sega Megadrive / Genesis" },
  { id: 109, name: "Sega SG-1000" },
  { id: 4, name: "Super Nintendo (SNES)" },
  { id: 45, name: "WonderSwan" },
  { id: 46, name: "WonderSwan Color" },
];

// Extensions that are NOT ROMs (covers, saves, configs…).
export const NON_ROM = new Set([
  ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".img", ".keep", ".txt", ".crc",
  ".sav", ".state", ".sram", ".srm", ".bak", ".cfg", ".config", ".db", ".dat",
  ".lnk", ".xml", ".nfo",
]);

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

// Skraper resource type -> ScreenScraper media type(s), in priority order.
export const RESOURCE_MAP = {
  Screenshot: ["ss"],
  ScreenshotTitle: ["sstitle"],
  Wheel: ["wheel", "wheel-hd"],
  WheelCarbon: ["wheel-carbon"],
  WheelSteel: ["wheel-steel"],
  Marquee: ["screenmarquee", "marquee"],
  Box3D: ["box-3D"],
  Box2D: ["box-2D"],
  Box2DBack: ["box-2D-back"],
  Box2DSide: ["box-2D-side"],
  Support: ["support-2D"],
  Fanart: ["fanart"],
  SystemWallPaper: ["fanart"],
};
