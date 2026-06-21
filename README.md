# CoverStudio

> **The Game & Watch Retro-Go SD toolkit** — a web app (React + Vite) to fetch, compose and convert retro game cover art, and prepare an SD card for the *Retro-Go* port on the Game & Watch.

Everything runs **in the browser**: covers are fetched from [ScreenScraper.fr](https://www.screenscraper.fr), composed locally, and exported as a `.zip` ready to copy onto the SD card. No data is sent to any third party other than the ScreenScraper API calls.

---

## Features

The UI is organized into three tabs.

### 1. Scraper (main tab)
- Pick a folder of ROMs (including subfolders); the **system** is detected automatically from the folder tree (`nes/`, `snes/`, `gb/`, `md/`, `msx/`…).
- Cover fetching through the ScreenScraper API (MD5 hash lookup, then the `jeuInfos` record).
- **Skraper-style mix composition** (cover + logo + screenshot) or a single media (box-2D, wheel, etc.).
- Interactive **CoverFlow gallery** (keyboard, trackpad swipe, click a background cover to bring it to the front).
- Optional **Game & Watch Retro-Go conversion**: each cover is converted to `.img` (resized JPEG), preserving the folder tree.
- **Multi-candidate systems** handling (e.g. `gb` → Game Boy / Game Boy Color, `msx` → MSX / MSX2 / MSX2+ / MSX Turbo R) with automatic fallback.
- **Manual search** for missed covers: search by name (`jeuRecherche`), pick a result (with an enlarged hover preview), choose the system, then assign the cover to the ROM.
- Progress bar, ScreenScraper account quota, immediate stop.

### 2. Tools
- **Images → G&W Retro-Go SD (.img)** converter: pick a folder of existing images (PNG/JPG/BMP) and they're converted to `.img`, **preserving the original folder tree**. Fully local, no API.

### 3. GW Shrinker
- A browser reimplementation of [LCD-Game-Shrinker](https://github.com/bzhxx/LCD-Game-Shrinker): converts a **MAME ROM + artwork** (Game & Watch, Konami, Tiger, Elektronika…) into a **`.gw`** file for [LCD-Game-Emulator](https://github.com/bzhxx/LCD-Game-Emulator).
- Native SVG rendering of the LCD segments, RGB565/JPEG background, experimental drop shadow, LZ4 frame compatible with `lz4.frame`.
- Metadata pulled from MAME's `hh_sm510.cpp` (pinned commit); button/RTC mapping from the `custom/<rom>.py` scripts.

The UI is **bilingual (EN / FR)**, switchable via the language selector.

---

## Requirements

- **Node.js 18+** (tested with Node 20) and npm.
- A **ScreenScraper.fr account** + **developer credentials** (devid / devpassword) for the Scraper tab. See [Configuration](#configuration).

---

## Install & npm commands

```bash
# Install dependencies
npm install

# Start the dev server (hot-reload)
npm run dev

# Build the production bundle into dist/
npm run build

# Preview the production build locally
npm run preview
```

- `npm run dev` starts Vite; the app is served at `http://localhost:5173/coverstudio/` (the `/coverstudio/` sub-path comes from `base` in `vite.config.js`).
- `npm run build` outputs the static files to `dist/`.
- `npm run preview` serves the contents of `dist/` to check the final result before deploying.

---

## Configuration

### System mapping
The `SS_SYSTEM_MAP` dictionary (in `js/config.js`) maps a folder shortcode to a ScreenScraper `systemeid`. A value can be a **single id** or an **array of candidates** tried in order:

```js
gb: [9, 10],            // Game Boy, then Game Boy Color
msx: [116, 113, 117, 118],
wsv: 207,               // Watara Supervision
// …
```

The readable `SYSTEMS` list is the offline fallback for the picker and badges; it's supplemented at runtime by `systemesListe` (cached for 30 days).

---

## Deployment (GitHub Pages)

Use ```npm run deploy``` command to publish the changes to the website.
The app is available at `https://sylverb.github.io/coverstudio/`.

> If you rename the repository, update `base` in `vite.config.js` accordingly.

---

## Project structure

```
.
├── index.html                 # HTML entry point
├── vite.config.js             # Vite config (base = /coverstudio/)
├── package.json
├── src/                       # React application
│   ├── main.jsx
│   ├── App.jsx                # Tabs, global state, wiring
│   ├── App.css
│   ├── components/
│   │   ├── CoverFlow.jsx      # 3D gallery
│   │   ├── GwShrinker.jsx     # GW Shrinker tab
│   │   └── GwShrinker.css
│   └── hooks/
│       ├── useI18n.js         # Internationalization (EN/FR)
│       └── useObjectUrls.js   # Object URLs for covers
└── js/                        # Business logic (ES modules, no React)
    ├── config.js              # Credentials + system mapping
    ├── run.js                 # Scraping + conversion + search orchestration
    ├── screenscraper.js       # ScreenScraper API client
    ├── scanner.js             # ROM folder scan
    ├── hashing.js             # MD5/CRC/SHA1
    ├── mix-engine.js, mixes.js# Mix composition
    ├── gw.js                  # Cover → G&W .img conversion
    ├── rate-limiter.js, cache.js, util.js, flags.js, i18n.js
    └── gw/                    # GW Shrinker (MAME → .gw), split by responsibility
        ├── convert.js         # convertGw() orchestrator
        ├── zip.js             # ZIP reader (STORE/DEFLATE)
        ├── lz4.js             # LZ4 frame compressor
        ├── mame.js            # hh_sm510.cpp metadata + buttons/RTC
        ├── layout.js          # default.lay geometry
        ├── render.js          # Background + LCD segments + preview
        └── assemble.js        # Byte-exact .gw assembly
```

---

## Credits & licenses

- **GW Shrinker** is a reimplementation of [LCD-Game-Shrinker](https://github.com/bzhxx/LCD-Game-Shrinker) by **bzhxx** (GPL-3.0). Target: [LCD-Game-Emulator](https://github.com/bzhxx/LCD-Game-Emulator).
- Covers come from [ScreenScraper.fr](https://www.screenscraper.fr); respect its terms of use and your account's quotas.

---

## Notes

Personal / hobby project. Provided "as is", without warranty. If you make it public, mind the security (credentials) and license (flags) notes above.