const PAGE_TITLE = document.title
const SIGNATURE = /^[a-zA-Z]+\(.*\)$/
const BACKTICKS = /`/g

const sidebarLabel = signature =>
  `${signature.slice(0, signature.indexOf('('))}()`

const markSignatures = () => {
  document
    .querySelectorAll('.markdown-section :is(h2, h3, h4)')
    .forEach(heading => {
      if (SIGNATURE.test(heading.textContent.trim())) {
        heading.classList.add('signature')
      }
    })

  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    const text = link.textContent.trim()
    if (!SIGNATURE.test(text)) return
    link.textContent = sidebarLabel(text)
    link.classList.add('signature')
  })
}

const replaceInTextNodes = (element, transform) => {
  const walker = document.createTreeWalker(element, window.NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    walker.currentNode.nodeValue = transform(walker.currentNode.nodeValue)
  }
}

const withoutBackticks = text => text.replace(BACKTICKS, '')

const cleanSearchResults = panel => {
  panel
    .querySelectorAll('.matching-post .title')
    .forEach(title => replaceInTextNodes(title, withoutBackticks))
  panel
    .querySelectorAll('.matching-post .content')
    .forEach(snippet => replaceInTextNodes(snippet, withoutBackticks))
}

const watchSearchResults = () => {
  const panel = document.querySelector('.search .results-panel')
  if (!panel) return
  new window.MutationObserver(() => cleanSearchResults(panel)).observe(panel, {
    childList: true
  })
}

const COVER_MODULE = 'docs/cover/main.js'
const COPY_MODULE = 'docs/cover/copy.js'
const RENDERER_MODULE = 'https://cdn.jsdelivr.net/npm/vgpu@0.6.0/+esm'

const fallbackReason = () => {
  if (new URLSearchParams(window.location.search).has('fallback')) {
    return 'forced'
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 'reduced-motion'
  }
  if (!('gpu' in navigator)) return 'no-webgpu'
  return null
}

const preloadRenderer = () => {
  const link = document.createElement('link')
  link.rel = 'modulepreload'
  link.href = RENDERER_MODULE
  link.crossOrigin = ''
  document.head.append(link)
}

const coverFallback = fallbackReason()
if (!coverFallback) preloadRenderer()

const loadModule = path => import(new URL(path, document.baseURI).href)

const showStill = (hero, reason) => {
  hero.dataset.mode = 'fallback'
  hero.dataset.reason = reason
}

const mountedHeroes = new WeakSet()
let unmountScene = () => {}

const mountCover = () => {
  const hero = document.querySelector('[data-cover]')
  if (!hero || mountedHeroes.has(hero)) return
  mountedHeroes.add(hero)
  loadModule(COPY_MODULE).then(
    ({ mountCopy }) => mountCopy(hero),
    () => {
      hero.dataset.copyUnavailable = ''
    }
  )
  if (coverFallback) return showStill(hero, coverFallback)
  hero.dataset.expectLive = ''
  loadModule(COVER_MODULE).then(
    ({ mountScene }) => {
      unmountScene()
      unmountScene = mountScene(hero)
    },
    () => showStill(hero, 'import-failed')
  )
}

const watchCover = () => {
  mountCover()
  new window.MutationObserver(mountCover).observe(document.body, {
    childList: true,
    subtree: true
  })
}

const hoistPageTitle = () => {
  const list = document.querySelector('.sidebar-nav > ul')
  if (list?.children.length !== 1) return
  const nested = list.firstElementChild.querySelector(':scope > ul')
  if (nested) list.firstElementChild.replaceWith(...nested.children)
}

const enhancePage = () => {
  document.querySelector('#seo-content')?.remove()
  hoistPageTitle()
  markSignatures()
  window.codecopy('pre')
}

window.$docsify = {
  name: 'abusive',
  repo: 'kikobeats/abusive',
  coverpage: true,
  onlyCover: false,
  maxLevel: 3,
  auto2top: true,
  noEmoji: true,
  externalLinkRel: 'noopener noreferrer',
  pageTitleFormatter: () => PAGE_TITLE,
  search: {
    maxAge: 0,
    placeholder: 'Search',
    noData: 'No results',
    depth: 3
  },
  plugins: [
    hook => {
      hook.doneEach(enhancePage)
      hook.ready(watchCover)
      hook.ready(watchSearchResults)
    }
  ]
}
