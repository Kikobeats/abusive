# Cover

The website's cover is a live WebGPU scene rendered with [vgpu](https://vgpu.sh): the abusive magnifying glass, in glass, floats over a wall of addresses that all reach the same inbox. The lens is a real magnifier: it shows the addresses under it enlarged and sharp, bent toward its rim like a convex lens, and it follows the pointer. The lens has no center dot, so nothing hides what it magnifies.

## How it loads

- `_coverpage.md` holds the markup. docsify renders it, and `docs/js/main.js` imports `main.js` once the markup is in the page. `docs/js/main.js` also decides whether the cover can render live, and only then preloads vgpu.
- `main.js` imports `vgpu@0.6.0` from jsdelivr, so nothing is bundled. It renders one fullscreen effect (`shaders/lens.wgsl`, prepared into `shaders.js`) with the glyph atlas (`atlas.png`, laid out by `atlas-layout.js`).
- `scene.js` lays the mark out from `docs/brand/mark.js`, so the glass is the committed logo. `test/cover.js` checks that the shader's copies of the mark geometry, the atlas layout and the line encoding are the same numbers.
- `content.js` holds the inbox lines on the wall.
- Rendering pauses when the cover is off screen or the tab is hidden, and the DPR is capped at 2.
- Without WebGPU, when the adapter fails, or with `prefers-reduced-motion`, the page keeps the static frame from `fallback-*.webp`, and `data-reason` on the cover says why. A cover that is not live 5 seconds after it loads, for example because the CDN stalls, falls back too, with the reason `timeout`. `?fallback=1` forces it. `?timing` collects GPU frame times in `window.__lensGpuMs` where `timestamp-query` exists.
- The theme follows `prefers-color-scheme` and switches live. The layout switches to mobile with the same `max-width: 759px` query as `cover.css`.
- Below the tagline, the npm command has a copy button, and "Copy prompt" copies the prompt for a coding agent. Both announce the result through a status region.

## Rebuild

The build needs Node.js 20.9 or newer because of sharp. The library itself stays on Node.js 18. `shaders.js`, `atlas.png`, and `fallback-*.webp` are generated and committed, since GitHub Pages runs no build. After changing the shader or the scene:

```bash
$ cd docs/cover
$ npm install
$ npm run build
```

`build/atlas.mjs` draws the JetBrains Mono glyph atlas, `build/prepare.mjs` prepares the shader, and `build/render.mjs` renders the fallback frames headlessly with `vgpu/node`, using the copy's measured boxes in `build/text-boxes.json`. `node build/render.mjs <frame>` renders one frame by name (`fallback-dark`, `fallback-light`, `fallback-dark-mobile`, `fallback-light-mobile`), and every still also gets a PNG copy in the ignored `scratch/` folder. `prepare.mjs` strips the local path before writing `shaders.js`, so that file does not depend on the directory the build runs from.
