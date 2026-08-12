export type SurveyShareSource = 'link' | 'qr'

export function getPublicSurveyPath(slug: string, source?: SurveyShareSource) {
  const path = `/${slug.trim()}`

  if (!source) {
    return path
  }

  return `${path}?src=${source}`
}

export function getPublicSurveyUrl(slug: string, source?: SurveyShareSource) {
  const path = getPublicSurveyPath(slug, source)

  if (typeof window === 'undefined') {
    return path
  }

  return new URL(path, window.location.origin).toString()
}

export function getSurveyTestPath(id: string) {
  return `/app/pesquisas/${id}/teste?fresh=1`
}

export function getSharedSurveyTestPath(token: string) {
  return `/teste/${token.trim()}`
}

export function getSharedSurveyTestUrl(token: string) {
  const path = getSharedSurveyTestPath(token)

  if (typeof window === 'undefined') {
    return path
  }

  return new URL(path, window.location.origin).toString()
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'

  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}
