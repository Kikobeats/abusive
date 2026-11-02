# Cover

The website's cover is a live WebGPU scene rendered with [vgpu](https://vgpu.sh): the abusive magnifying glass, in glass, floats over a wall of addresses that all reach the same inbox. The lens is a real magnifier: it shows the addresses under it enlarged and sharp, bent toward its rim like a convex lens, and it follows the pointer. The lens has no center dot, so nothing hides what it magnifies.

## How it loads

- `_coverpage.md` holds the markup. docsify renders it, and `docs/js/main.js` imports `main.js` once the markup is in the page.
- `main.js` imports `vgpu@0.6.0` from jsdelivr, so nothing is bundled. It renders one fullscreen effect (`shaders/lens.wgsl`, prepared into `shaders.js`) with the glyph atlas (`atlas.png`, laid out by `atlas-layout.js`).
- `scene.js` lays the mark out from `docs/brand/mark.js`, so the glass is the committed logo. `test/cover.js` checks that the shader's copy of the geometry is the same numbers.
- `content.js` holds the inbox lines on the wall and the same-inbox addresses behind the status pill. `test/cover.js` checks every pill address against the real `findSibling`.
- Rendering pauses when the cover is off screen or the tab is hidden, and the DPR is capped at 2.
- Without WebGPU, when the adapter fails, or with `prefers-reduced-motion`, the page keeps the static frame from `fallback-*.webp`. `?fallback=1` forces it. `?timing` collects GPU frame times in `window.__lensGpuMs` where `timestamp-query` exists.
- The theme follows `prefers-color-scheme` and `data-theme`, and switches live.
- Below the tagline, the npm command has a copy button, and "Copy prompt" copies the prompt for a coding agent.

## Rebuild

The build needs Node.js 20.9 or newer because of sharp. The library itself stays on Node.js 18. `shaders.js`, `atlas.png`, and `fallback-*.webp` are generated and committed, since GitHub Pages runs no build. After changing the shader or the scene:

```bash
$ cd docs/cover
$ npm install
$ npm run build
```

`build/atlas.mjs` draws the JetBrains Mono glyph atlas, `build/prepare.mjs` prepares the shader, and `build/render.mjs` renders the fallback frames headlessly with `vgpu/node`, using the copy's measured boxes in `build/text-boxes.json`. `prepare.mjs` strips the local path before writing `shaders.js`, so that file does not depend on the directory the build runs from.
