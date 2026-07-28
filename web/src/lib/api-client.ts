const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const headers = new Headers(init?.headers ?? {})

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers,
    ...init,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : null

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Falha ao comunicar com a API.'

    throw new ApiError(message, response.status)
  }

  return payload as T
}

export async function uploadApiFile(
  path: string,
  file: File,
  fieldName = 'file',
  extraFields?: Record<string, string>,
) {
  const formData = new FormData()
  formData.append(fieldName, file)
  Object.entries(extraFields ?? {}).forEach(([key, value]) => {
    formData.append(key, value)
  })

  return apiRequest<{ ok: boolean; key: string; value: string }>(path, {
    method: 'POST',
    body: formData,
  })
}

export function buildApiUrl(path: string) {
  if (/^https?:\/\//i.test(API_BASE_URL)) {
    return new URL(path, API_BASE_URL).toString()
  }

  return `${API_BASE_URL}${path}`
}

export async function downloadApiFile(path: string, fallbackFileName?: string) {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
  })

  if (!response.ok) {
    const isJson = response.headers.get('content-type')?.includes('application/json')
    const payload = isJson ? await response.json() : null
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : 'Falha ao baixar o arquivo.'

    throw new ApiError(message, response.status)
  }

  const blob = await response.blob()
  const contentDisposition = response.headers.get('content-disposition')
  const matchedFileName = contentDisposition?.match(/filename="?([^"]+)"?/)
  const fileName = matchedFileName?.[1] ?? fallbackFileName ?? 'arquivo'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
