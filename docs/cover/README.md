# Cover

The website's cover is a live WebGPU scene rendered with [vgpu](https://vgpu.sh): the abusive magnifying glass, in glass, floats over a wall of addresses that all reach the same inbox. The lens is a real magnifier: it shows the addresses under it enlarged and sharp, bent toward its rim like a convex lens, and it follows the pointer. The lens has no center dot, so nothing hides what it magnifies.

## How it loads

- `_coverpage.md` holds the markup. When `docs/js/main.js` runs, it decides whether the cover can render live and, if so, preloads vgpu right away. Each time docsify puts a cover in the page, it mounts `copy.js` on it and, when live, `main.js`. A renderer that fails to load leaves the still frame with the reason `import-failed`, and copy buttons that fail to load are hidden.
- `main.js` imports `vgpu@0.6.0` from jsdelivr, so nothing is bundled. It renders one fullscreen effect (`shaders/lens.wgsl`, prepared into `shaders.js`) with the glyph atlas (`atlas.png`, laid out by `atlas-layout.js`).
- `scene.js` lays the mark out from `docs/brand/mark.js`, so the glass is the committed logo. `test/cover.js` checks that the shader's copies of the mark geometry, the atlas layout and the line encoding are the same numbers.
- `content.js` holds the inbox lines on the wall.
- Rendering pauses when the cover is off screen, the tab is hidden or the pause button in the corner is pressed, and the DPR is capped at 2. The scroll cue bounces twice, then rests.
- Without WebGPU, when the adapter fails, or with `prefers-reduced-motion` (also when it is turned on while the page is open), the page keeps the static frame from `fallback-*.webp`, and `data-reason` on the cover says why. A cover that is not live after 5 seconds of the tab being visible, for example because the CDN stalls, falls back too, with the reason `timeout`. When docsify replaces the cover, the previous scene releases its GPU device. `?fallback=1` forces it. `?timing` collects GPU frame times in `window.__lensGpuMs` where `timestamp-query` exists.
- The theme follows `prefers-color-scheme` and switches live. The layout switches to mobile with the same `max-width: 759px` query as `cover.css`.
- `copy.js` wires the copy buttons, so they work on the still frame too: the npm command has a copy button, and "Copy prompt" copies the prompt for a coding agent. Both announce the result through a status region.

## Rebuild

The build needs Node.js 20.9 or newer because of sharp. The library itself stays on Node.js 18. `shaders.js`, `atlas.png`, and `fallback-*.webp` are generated and committed, since GitHub Pages runs no build. After changing the shader or the scene:

```bash
$ cd docs/cover
$ npm install
$ npm run build
```

`build/atlas.mjs` draws the JetBrains Mono glyph atlas, `build/prepare.mjs` prepares the shader, and `build/render.mjs` renders the fallback frames headlessly with `vgpu/node`, using the copy's measured boxes in `build/text-boxes.json`. `node build/render.mjs <frame>` renders one frame by name (`fallback-dark`, `fallback-light`, `fallback-dark-mobile`, `fallback-light-mobile`), and every still also gets a PNG copy in the ignored `scratch/` folder. `prepare.mjs` strips the local path before writing `shaders.js`, so that file does not depend on the directory the build runs from.
