import { useEffect } from 'react'

import { defaultBrandingSettings, useBrandingSettings } from '@/hooks/useBrandingSettings'

function getFaviconLink() {
  return document.querySelector("link[rel='icon']") as HTMLLinkElement | null
}

export function BrandingEffects() {
  const brandingQuery = useBrandingSettings()
  const branding = brandingQuery.data ?? defaultBrandingSettings

  useEffect(() => {
    document.title = branding.platformName
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor)

    const currentFaviconLink = getFaviconLink()

    if (!branding.faviconUrl) {
      currentFaviconLink?.remove()
      return
    }

    const faviconLink = currentFaviconLink ?? document.createElement('link')
    faviconLink.rel = 'icon'
    faviconLink.type = branding.faviconUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
    faviconLink.href = branding.faviconUrl

    if (!currentFaviconLink) {
      document.head.appendChild(faviconLink)
    }
  }, [branding.faviconUrl, branding.platformName, branding.primaryColor])

  return null
}
