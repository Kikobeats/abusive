# Brand

The abusive mark is a magnifying glass in a blue gradient: a ring, a dot in its center, and a handle at 45 degrees. It looks closely at every signup. `mark.js` holds its geometry and colors, and every brand asset is drawn from it.

| File | What it is | Used by |
| --- | --- | --- |
| `static/mark.svg` | The bare mark | Cover wordmark, sidebar, mobile header |
| `static/logo.svg` | The mark on a dark rounded tile (app icon) | Favicon |
| `static/cursor.svg` | The mark at 32px with a white outline, clicking at the lens center | Cover cursor |
| `static/logo.png` | `logo.svg` at 512px | Apple touch icon, JSON-LD `image` |
| `static/favicon-32x32.png` | `logo.svg` at 32px | PNG favicon |
| `static/banner.jpg` | 2400x1260 social card: glowing mark, wordmark, tagline, install command | `og:image`, `twitter:image` |

## Rebuild

The build needs Node.js 20.9 or newer because of sharp. The library itself stays on Node.js 18. The assets are generated and committed, since GitHub Pages runs no build. After changing `mark.js` or `banner.js`:

```bash
$ cd docs/brand
$ npm install
$ npm run build
```

`build.mjs` converts the banner text to paths with opentype.js (Space Grotesk, IBM Plex Sans, and JetBrains Mono from Fontsource), so the render does not depend on installed fonts. It rasterizes with sharp. It then writes the banner's content hash into the `og:image` and `twitter:image` URLs in `index.html` (`banner.jpg?v=<hash>`), so social caches fetch the new card.

`test/brand.js` fails when the committed SVGs differ from what `mark.js` generates, when the cover's cursor hotspot is not the lens center, when the `?v=` hash does not match `banner.jpg`, when the declared `og:image` size differs from the real one, when the dot touches the ring, when the handle leaves the ring band or pokes into the lens, or when any part leaves the mark's square box.
