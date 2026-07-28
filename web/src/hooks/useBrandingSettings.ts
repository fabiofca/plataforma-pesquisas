import { useQuery } from '@tanstack/react-query'

import { apiRequest } from '@/lib/api-client'

export interface BrandingSettings {
  platformName: string
  primaryColor: string
  sidebarColor: string
  supportEmail: string
  faviconUrl: string
  brandLogoUrl: string
}

export const defaultBrandingSettings: BrandingSettings = {
  platformName: 'Plataforma Pesquisas',
  primaryColor: '#0f172a',
  sidebarColor: '#11284a',
  supportEmail: '',
  faviconUrl: '/favicon.svg',
  brandLogoUrl: '',
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function useBrandingSettings() {
  return useQuery({
    queryKey: ['public-system-settings'],
    queryFn: async (): Promise<BrandingSettings> => {
      try {
        const response = await apiRequest<{
          settings: Array<{
            setting_key: string
            setting_value: string | Record<string, unknown>
          }>
        }>('/system-settings/public')

        const map = new Map(response.settings.map((item) => [item.setting_key, asString(item.setting_value)]))

        return {
          platformName: map.has('platform_name') ? (map.get('platform_name') ?? '') : defaultBrandingSettings.platformName,
          primaryColor: map.has('default_primary_color')
            ? (map.get('default_primary_color') ?? '')
            : defaultBrandingSettings.primaryColor,
          sidebarColor: map.has('sidebar_color') ? (map.get('sidebar_color') ?? '') : defaultBrandingSettings.sidebarColor,
          supportEmail: map.has('support_email') ? (map.get('support_email') ?? '') : defaultBrandingSettings.supportEmail,
          faviconUrl: map.has('favicon_url') ? (map.get('favicon_url') ?? '') : defaultBrandingSettings.faviconUrl,
          brandLogoUrl: map.has('brand_logo_url') ? (map.get('brand_logo_url') ?? '') : defaultBrandingSettings.brandLogoUrl,
        }
      } catch {
        return defaultBrandingSettings
      }
    },
    retry: 0,
    staleTime: 1000 * 60 * 5,
  })
}
