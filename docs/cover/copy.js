const COPIED_MS = 1400
const COPIED_LABEL = 'Copied'
const COPIED_STATUS = 'Copied to clipboard'
const COPY_FAILED_STATUS = 'Could not copy'

export function mountCopy (cover) {
  const copyStatus = cover.querySelector('[data-copy-status]')
  const copyReset = new WeakMap()
  let statusReset = null

  const announce = message => {
    copyStatus.textContent = message
    clearTimeout(statusReset)
    statusReset = setTimeout(() => {
      copyStatus.textContent = ''
    }, COPIED_MS)
  }

  const bindCopy = (button, readText, label) => {
    const idle = label?.textContent
    const showIdle = () => {
      delete button.dataset.copied
      if (label) label.textContent = idle
    }
    button.addEventListener('click', async () => {
      clearTimeout(copyReset.get(button))
      try {
        await navigator.clipboard.writeText(readText())
      } catch {
        showIdle()
        announce(COPY_FAILED_STATUS)
        return
      }
      button.dataset.copied = 'true'
      if (label) label.textContent = COPIED_LABEL
      announce(COPIED_STATUS)
      copyReset.set(button, setTimeout(showIdle, COPIED_MS))
    })
  }

  const command = cover.querySelector('[data-command]')
  const copyPrompt = cover.querySelector('[data-copy-prompt]')
  bindCopy(cover.querySelector('[data-copy]'), () => command.textContent)
  bindCopy(
    copyPrompt,
    () => copyPrompt.dataset.prompt,
    copyPrompt.querySelector('[data-copy-prompt-label]')
  )
}
