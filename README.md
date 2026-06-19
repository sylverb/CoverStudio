# webskraper

Static web app to fetch game covers from ScreenScraper. Runs entirely in the browser.

## Development

```bash
npm install
npm run dev
```

## GitHub Pages

The site is built with Vite + React and deployed automatically on every push to `main`.

1. In the repo **Settings → Pages**, set **Source** to **GitHub Actions**.
2. After the workflow runs, the site is at:  
   **https://sylverb.github.io/webskraper/**

`?target=gw` still works, e.g.  
`https://sylverb.github.io/webskraper/?target=gw`

## Local production preview

```bash
npm run build
npm run preview
```

