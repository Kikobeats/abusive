'use strict'

const { execFileSync } = require('node:child_process')
const { cpSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const vm = require('node:vm')

const { Window } = require('happy-dom')
const { default: test } = require('ava')

const ROOT = join(__dirname, '..')
const read = file => readFileSync(join(ROOT, file), 'utf8')

const SITE_SOURCES = ['docs/css/style.css', 'docs/js/main.js']
const SITE_BUILDS = ['static/style.min.css', 'static/main.min.js']
const COVER_IMPORT = 'import('
const SITE = 'https://abusive.js.org/'

test('the committed site bundles are what the build makes from the sources', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'abusive-site-'))
  try {
    for (const source of SITE_SOURCES) {
      cpSync(join(ROOT, source), join(workspace, source))
    }
    execFileSync(
      process.execPath,
      [
        join(ROOT, 'node_modules/gulp/bin/gulp.js'),
        '--gulpfile',
        join(ROOT, 'gulpfile.js'),
        '--cwd',
        workspace,
        'build'
      ],
      { stdio: 'ignore' }
    )
    for (const build of SITE_BUILDS) {
      t.is(read(build), readFileSync(join(workspace, build), 'utf8'), build)
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

const metaContent = (html, attribute, name) =>
  html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`))[1]

const structuredData = html =>
  JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
  )['@graph'].find(node => node['@id'].endsWith('#software'))

const firstBulletList = markdown =>
  markdown
    .slice(markdown.search(/^- /m))
    .split('\n\n')[0]
    .split('\n')
    .map(line => line.slice(2))

const withoutPeriod = sentence => sentence.replace(/\.$/, '')

test('every copy of the description says what the package description says', t => {
  const { description } = JSON.parse(read('package.json'))
  const sentence = `${description}.`
  const html = read('index.html')
  t.is(metaContent(html, 'name', 'description'), sentence)
  t.is(metaContent(html, 'property', 'og:description'), sentence)
  t.is(metaContent(html, 'name', 'twitter:description'), sentence)
  t.is(structuredData(html).description, sentence)
  t.true(read('README.md').includes(`\n> ${sentence}\n`))
  t.true(read('llms.txt').includes(`\n> ${sentence}\n`))
})

test('every copy of the feature list is the README feature list', t => {
  const features = firstBulletList(read('README.md'))
  t.true(features.length > 0)
  t.deepEqual(firstBulletList(read('llms.txt')), features)
  t.deepEqual(
    structuredData(read('index.html')).featureList,
    features.map(withoutPeriod)
  )
})

const docsPage = ({
  url = SITE,
  body = '',
  gpu = true,
  reducedMotion = false,
  importCover
} = {}) => {
  const window = new Window({ url })
  const { document } = window
  document.title = 'abusive'
  document.body.innerHTML = body
  window.matchMedia = query => ({
    matches: reducedMotion && query === '(prefers-reduced-motion: reduce)'
  })
  window.codecopy = () => {}
  const watching = new Set()
  window.MutationObserver = class extends window.MutationObserver {
    observe (...args) {
      watching.add(this)
      return super.observe(...args)
    }

    disconnect () {
      watching.delete(this)
      return super.disconnect()
    }
  }
  const imports = []
  const mounts = []
  const mountingModule = {
    mountCopy: hero => mounts.push(['copy', hero]),
    mountScene: hero => {
      mounts.push(['scene', hero])
      return () => mounts.push(['unmount', hero])
    }
  }
  window.importCover = specifier => {
    imports.push(specifier)
    return importCover
      ? importCover(specifier, mountingModule)
      : Promise.resolve(mountingModule)
  }
  const source = read('docs/js/main.js')
  vm.runInNewContext(source.replace(COVER_IMPORT, 'window.importCover('), {
    window,
    document,
    navigator: gpu ? { gpu: {} } : {},
    URL,
    URLSearchParams
  })
  const hooks = { doneEach: [], ready: [] }
  for (const plugin of window.$docsify.plugins) {
    plugin({
      doneEach: fn => hooks.doneEach.push(fn),
      ready: fn => hooks.ready.push(fn)
    })
  }
  return {
    window,
    document,
    imports,
    mounts,
    watching,
    source,
    ready: () => hooks.ready.forEach(fn => fn()),
    doneEach: () => hooks.doneEach.forEach(fn => fn())
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const COVER = '<div data-cover data-mode="loading"></div>'

test('the docs script imports the copy buttons and the renderer once', t => {
  const page = docsPage({ body: COVER })
  t.is(page.source.split(COVER_IMPORT).length - 1, 1)
  page.ready()
  page.ready()
  t.deepEqual(page.imports, [
    `${SITE}docs/cover/copy.js`,
    `${SITE}docs/cover/main.js`
  ])
  page.window.close()
})

const RENDERER = 'https://cdn.jsdelivr.net/npm/vgpu@0.6.0/+esm'

const coverStart = options => {
  const page = docsPage({ body: COVER, ...options })
  page.ready()
  const { mode, reason, expectLive } =
    page.document.querySelector('[data-cover]').dataset
  const preloads = [
    ...page.document.querySelectorAll('link[rel="modulepreload"]')
  ].map(link => `${link.hasAttribute('crossorigin')} ${link.href}`)
  const modules = page.imports.map(url => url.replace(SITE, ''))
  page.window.close()
  return { mode, reason, expectLive, preloads, modules }
}

test('a cover that can render live hides the still frame and preloads vgpu', t => {
  t.deepEqual(coverStart({}), {
    mode: 'loading',
    reason: undefined,
    expectLive: '',
    preloads: [`true ${RENDERER}`],
    modules: ['docs/cover/copy.js', 'docs/cover/main.js']
  })
})

test('each reason to keep the still frame is recorded and loads only the copy buttons', t => {
  for (const [options, reason] of [
    [{ url: `${SITE}?fallback` }, 'forced'],
    [{ reducedMotion: true }, 'reduced-motion'],
    [{ gpu: false }, 'no-webgpu']
  ]) {
    t.deepEqual(
      coverStart(options),
      {
        mode: 'fallback',
        reason,
        expectLive: undefined,
        preloads: [],
        modules: ['docs/cover/copy.js']
      },
      reason
    )
  }
})

test('the docs preload the vgpu build the cover imports', t => {
  t.true(read('docs/cover/main.js').includes(`'${RENDERER}'`))
  t.true(read('docs/js/main.js').includes(`'${RENDERER}'`))
  t.false(read('index.html').includes(RENDERER))
})

test('a renderer that fails to load leaves the still frame and says why', async t => {
  const page = docsPage({
    body: COVER,
    importCover: (specifier, module) =>
      specifier.endsWith('main.js')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(module)
  })
  page.ready()
  await settle()
  const { mode, reason } = page.document.querySelector('[data-cover]').dataset
  t.is(mode, 'fallback')
  t.is(reason, 'import-failed')
  page.window.close()
})

test('a cover rendered after the docs are ready is mounted once it appears', async t => {
  const page = docsPage()
  page.ready()
  t.deepEqual(page.imports, [])
  page.document.body.insertAdjacentHTML('beforeend', COVER)
  await settle()
  const hero = page.document.querySelector('[data-cover]')
  t.deepEqual(page.mounts, [
    ['copy', hero],
    ['scene', hero]
  ])
  page.document.body.insertAdjacentHTML('beforeend', '<p>later</p>')
  await settle()
  t.is(page.mounts.length, 2)
  page.window.close()
})

test('a cover docsify renders again is mounted again', async t => {
  const page = docsPage({ body: `<div class="cover-main">${COVER}</div>` })
  page.ready()
  await settle()
  const first = page.document.querySelector('[data-cover]')
  page.document.querySelector('.cover-main').innerHTML = COVER
  await settle()
  const second = page.document.querySelector('[data-cover]')
  t.not(first, second)
  t.deepEqual(page.mounts, [
    ['copy', first],
    ['scene', first],
    ['copy', second],
    ['unmount', first],
    ['scene', second]
  ])
  t.is('expectLive' in second.dataset, true)
  page.window.close()
})

test('copy buttons that fail to load are hidden, and the scene still starts', async t => {
  const page = docsPage({
    body: COVER,
    importCover: (specifier, module) =>
      specifier.endsWith('copy.js')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(module)
  })
  page.ready()
  await settle()
  const hero = page.document.querySelector('[data-cover]')
  t.true('copyUnavailable' in hero.dataset)
  t.deepEqual(page.mounts, [['scene', hero]])
  t.regex(
    read('docs/cover/cover.css'),
    /\.cover-hero\[data-copy-unavailable\] :is\(\.cover__copy, \.cover__copy-prompt\) \{ display: none; \}/
  )
  page.window.close()
})

test('signature headings at every level and in the sidebar are code', t => {
  const page = docsPage({
    body: `
      <aside class="sidebar-nav"><ul>
        <li><a>isAbusive({ email, ip, verified })</a></li>
        <li><a>Install</a></li>
        <li><a>abusive(options)</a></li>
      </ul></aside>
      <article class="markdown-section">
        <h2>isAbusive({ email, ip, verified })</h2>
        <h2>Install</h2>
        <h3>abusive(options)</h3>
        <h3>Store</h3>
        <h4>stripeLookup(client, [options])</h4>
        <h4>sibling.lookup</h4>
        <p>isAbusive(email)</p>
      </article>`
  })
  page.doneEach()
  const marked = [...page.document.querySelectorAll('.signature')].map(
    element => `${element.tagName} ${element.textContent}`
  )
  t.deepEqual(marked, [
    'A isAbusive()',
    'A abusive()',
    'H2 isAbusive({ email, ip, verified })',
    'H3 abusive(options)',
    'H4 stripeLookup(client, [options])'
  ])
  t.is(
    page.document.querySelectorAll('.sidebar-nav a')[1].textContent,
    'Install'
  )
  page.window.close()
})

test('a sidebar holding only the page title shows its sections instead', t => {
  const page = docsPage({
    body: `<div class="sidebar-nav"><ul><li><a>abusive</a><ul>
      <li><a>Install</a></li><li><a>Quick start</a></li>
    </ul></li></ul></div>`
  })
  page.doneEach()
  const top = [...page.document.querySelectorAll('.sidebar-nav > ul > li')]
  t.deepEqual(
    top.map(item => item.textContent.trim()),
    ['Install', 'Quick start']
  )
  page.window.close()
})

test('a sidebar with several entries or no sections is left alone', t => {
  for (const body of [
    '<div class="sidebar-nav"><ul><li><a>One</a><ul><li>a</li></ul></li><li><a>Two</a></li></ul></div>',
    '<div class="sidebar-nav"><ul><li><a>Only</a></li></ul></div>'
  ]) {
    const page = docsPage({ body })
    const before = page.document.querySelector('.sidebar-nav').innerHTML
    page.doneEach()
    t.is(page.document.querySelector('.sidebar-nav').innerHTML, before)
    page.window.close()
  }
})

test('the crawler copy leaves once the docs render', t => {
  const page = docsPage({
    body: '<main id="seo-content"><h1>abusive</h1></main>'
  })
  page.doneEach()
  t.is(page.document.querySelector('#seo-content'), null)
  t.notThrows(() => page.doneEach())
  page.window.close()
})

test('search results drop the backticks from titles and snippets only', async t => {
  const page = docsPage({
    body: '<div class="search"><div class="results-panel"></div></div>'
  })
  page.ready()
  page.document.querySelector('.results-panel').innerHTML = `
    <div class="matching-post">
      <h2 class="title">\`sibling.min\`</h2>
      <p class="content">set \`min\` to <b>\`2\`</b></p>
      <p class="other">\`kept\`</p>
    </div>`
  await settle()
  const text = selector => page.document.querySelector(selector).textContent
  t.is(text('.title'), 'sibling.min')
  t.is(text('.content'), 'set min to 2')
  t.is(text('.other'), '`kept`')
  page.window.close()
})

test('the docs work without a search panel', t => {
  const page = docsPage()
  t.notThrows(() => page.ready())
  page.window.close()
})

const ruleBody = (css, selector) => {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule for ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

test('signature headings and sidebar links are set in the code font', t => {
  const css = read('docs/css/style.css')
  for (const selector of [
    '.markdown-section .signature',
    '.sidebar-nav a.signature'
  ]) {
    t.regex(
      ruleBody(css, selector),
      /font-family: var\(--code-font\)/,
      selector
    )
  }
})

test('the copy status and the crawler copy are hidden with the one shared rule', t => {
  t.regex(
    read('_coverpage.md'),
    /<span class="visually-hidden" role="status" data-copy-status>/
  )
  t.regex(read('index.html'), /<main id="seo-content" class="visually-hidden"/)
  t.regex(
    ruleBody(read('docs/css/style.css'), '.visually-hidden'),
    /clip-path: inset\(50%\)/
  )
})

test('docsify and the stylesheet agree on where mobile starts', t => {
  const css = read('docs/css/style.css')
  const [, breakpoint] = css.match(/--_mobile-breakpoint: (\d+px);/)
  t.true(css.includes(`@media (max-width: ${breakpoint})`))
})

const textOf = html => html.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '')

test('every copy of the tagline, the install command and the title agree', async t => {
  const { BANNER } = await import('../docs/brand/banner.js')
  const html = read('index.html')
  const cover = read('_coverpage.md')
  const tagline = BANNER.tagline.text
  t.is(textOf(cover.match(/<p class="cover__tagline">(.*?)<\/p>/)[1]), tagline)
  for (const [attribute, name] of [
    ['property', 'og:image:alt'],
    ['name', 'twitter:image:alt']
  ]) {
    t.true(metaContent(html, attribute, name).endsWith(`: ${tagline}`), name)
  }

  const install = BANNER.command.text
  t.is(cover.match(/<code data-command>(.*?)<\/code>/)[1], install)
  t.is(metaContent(html, 'name', 'twitter:data1'), install)

  const title = html.match(/<title>(.*?)<\/title>/)[1]
  t.is(metaContent(html, 'property', 'og:title'), title)
  t.is(metaContent(html, 'name', 'twitter:title'), title)
})

test('the CDN is preconnected for the CORS vgpu preload too', t => {
  t.true(
    read('index.html').includes(
      '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />'
    )
  )
})

test('cover.css sets --cover-bg on :root, which docsify reads before painting a random cover', t => {
  t.regex(
    read('docs/cover/cover.css'),
    /^:root \{\n {2}--cover-bg: #[0-9a-f]{6};/
  )
})
