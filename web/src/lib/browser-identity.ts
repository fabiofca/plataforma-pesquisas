const BROWSER_COOKIE_ID_KEY = 'survey-browser-cookie-id'

export function getBrowserCookieId(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const stored = window.localStorage.getItem(BROWSER_COOKIE_ID_KEY)
    if (stored) {
      return stored
    }

    const id = crypto.randomUUID()
    window.localStorage.setItem(BROWSER_COOKIE_ID_KEY, id)
    return id
  } catch {
    return ''
  }
}

function collectFingerprintComponents(): string[] {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return []
  }

  const screen = window.screen
  return [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen.width ? String(screen.width) : '',
    screen.height ? String(screen.height) : '',
    screen.colorDepth ? String(screen.colorDepth) : '',
    window.devicePixelRatio ? String(window.devicePixelRatio) : '',
    navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : '',
    navigator.maxTouchPoints ? String(navigator.maxTouchPoints) : '',
  ].filter(Boolean)
}

export function getBrowserFingerprint(): string {
  const components = collectFingerprintComponents()
  if (components.length === 0) {
    return ''
  }

  let hash = 0
  const text = components.join('###')
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index)
    hash = (hash << 5) - hash + char
    hash |= 0
  }

  return String(hash)
}
