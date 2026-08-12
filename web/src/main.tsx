import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from './App'
import './index.css'

const queryClient = new QueryClient()
const chunkReloadGuardKey = 'app:chunk-reload-once'

function reloadPageWithCacheBust() {
  const currentUrl = new URL(window.location.href)
  currentUrl.searchParams.set('_reload', `${Date.now()}`)
  window.location.replace(currentUrl.toString())
}

function recoverFromChunkError() {
  if (sessionStorage.getItem(chunkReloadGuardKey) === '1') {
    return
  }

  sessionStorage.setItem(chunkReloadGuardKey, '1')
  reloadPageWithCacheBust()
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  recoverFromChunkError()
})

window.addEventListener('error', (event) => {
  const message = event.message ?? ''
  if (
    message.includes('Failed to fetch dynamically imported module')
    || message.includes('Importing a module script failed')
  ) {
    recoverFromChunkError()
  }
})

window.addEventListener('unhandledrejection', (event) => {
  const reasonMessage =
    typeof event.reason === 'string'
      ? event.reason
      : event.reason instanceof Error
        ? event.reason.message
        : ''

  if (
    reasonMessage.includes('Failed to fetch dynamically imported module')
    || reasonMessage.includes('Importing a module script failed')
  ) {
    recoverFromChunkError()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
