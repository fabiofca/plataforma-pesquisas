import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { AppShell } from '@/components/layout/AppShell'
import { SectionCard } from '@/components/ui/SectionCard'
import { defaultBrandingSettings, type BrandingSettings } from '@/hooks/useBrandingSettings'
import { apiRequest, uploadApiFile } from '@/lib/api-client'

const settingDefinitions = [
  {
    key: 'platform_name',
    label: 'Nome da plataforma',
    description: 'Aparece no login, no painel e em emails futuros.',
  },
  {
    key: 'default_primary_color',
    label: 'Cor primária padrão',
    description: 'Usada ao criar novas pesquisas.',
  },
  {
    key: 'sidebar_color',
    label: 'Cor da barra lateral',
    description: 'Define a cor da lateral do painel administrativo.',
  },
  {
    key: 'brand_logo_url',
    label: 'Logo da plataforma',
    description: 'Envie a logo que será exibida no login, cadastro e cabeçalho do painel.',
  },
  {
    key: 'favicon_url',
    label: 'Favicon',
    description: 'Envie o ícone que aparecerá na aba do navegador.',
  },
  {
    key: 'support_email',
    label: 'E-mail de suporte',
    description: 'Contato institucional padrão da plataforma.',
  },
  {
    key: 'reward_code_prefix',
    label: 'Prefixo de cupons',
    description: 'Ajuda a identificar cupons gerados pela plataforma.',
  },
]

function normalizeColorValue(value: string, fallback = '#0f172a') {
  return /^#([0-9a-f]{6})$/i.test(value) ? value : fallback
}

type SystemSettingItem = {
  id?: string
  setting_key: string
  setting_value: string | Record<string, unknown>
}

function updateSettingListCache(settings: SystemSettingItem[] | undefined, key: string, value: string) {
  const currentSettings = settings ?? []
  const existingIndex = currentSettings.findIndex((item) => item.setting_key === key)

  if (existingIndex >= 0) {
    return currentSettings.map((item, index) =>
      index === existingIndex
        ? {
            ...item,
            setting_value: value,
          }
        : item,
    )
  }

  return [
    ...currentSettings,
    {
      id: key,
      setting_key: key,
      setting_value: value,
    },
  ]
}

function updateBrandingCaches(queryClient: QueryClient, key: string, value: string) {
  queryClient.setQueryData<SystemSettingItem[] | undefined>(['system-settings'], (current) =>
    updateSettingListCache(current, key, value),
  )

  queryClient.setQueryData<BrandingSettings | undefined>(['public-system-settings'], (current) => {
    const base = current ?? defaultBrandingSettings

    if (key === 'platform_name') {
      return { ...base, platformName: value }
    }

    if (key === 'default_primary_color') {
      return { ...base, primaryColor: value }
    }

    if (key === 'sidebar_color') {
      return { ...base, sidebarColor: value }
    }

    if (key === 'support_email') {
      return { ...base, supportEmail: value }
    }

    if (key === 'favicon_url') {
      return { ...base, faviconUrl: value }
    }

    if (key === 'brand_logo_url') {
      return { ...base, brandLogoUrl: value }
    }

    return base
  })
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState('')
  const [uploadingKey, setUploadingKey] = useState('')
  const [uploadErrors, setUploadErrors] = useState({
    favicon_url: '',
    brand_logo_url: '',
  })
  const [uploadInputVersion, setUploadInputVersion] = useState({
    favicon_url: 0,
    brand_logo_url: 0,
  })
  const [removingKey, setRemovingKey] = useState('')

  const settingsQuery = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const response = await apiRequest<{ settings: SystemSettingItem[] }>('/system-settings')

      return response.settings
    },
    retry: 0,
  })

  const settings = useMemo(
    () =>
      settingDefinitions.map((definition) => {
        const currentSetting = settingsQuery.data?.find((item) => item.setting_key === definition.key)
        const value =
          typeof currentSetting?.setting_value === 'string'
            ? currentSetting.setting_value
            : currentSetting?.setting_value
              ? JSON.stringify(currentSetting.setting_value)
              : ''

        return {
          ...definition,
          value,
        }
      }),
    [settingsQuery.data],
  )

  useEffect(() => {
    setValues(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])))
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ ok: boolean }>('/system-settings', {
        method: 'PATCH',
        body: JSON.stringify(
          Object.entries(values).map(([key, value]) => ({
            key,
            value,
          })),
        ),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      await queryClient.invalidateQueries({ queryKey: ['public-system-settings'] })
      setFeedback('Configurações salvas com sucesso.')
    },
    onError: (error) => {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar as configurações.')
    },
  })

  const uploadMutation = useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['system-settings'] })
      await queryClient.cancelQueries({ queryKey: ['public-system-settings'] })
    },
    mutationFn: async ({ key, file }: { key: string; file: File }) => {
      return uploadApiFile(`/system-settings/uploads/${key}`, file)
    },
    onSuccess: async ({ key, value }) => {
      updateBrandingCaches(queryClient, key, value)
      setValues((current) => ({
        ...current,
        [key]: value,
      }))
      setUploadErrors((current) => ({
        ...current,
        [key]: '',
      }))
      setUploadInputVersion((current) => ({
        ...current,
        [key]: current[key as 'favicon_url' | 'brand_logo_url'] + 1,
      }))
      setFeedback('Arquivo enviado com sucesso.')
      setUploadingKey('')
      void queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      void queryClient.invalidateQueries({ queryKey: ['public-system-settings'] })
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : 'Não foi possível enviar o arquivo.'

      setUploadErrors((current) => ({
        ...current,
        [variables.key]: message,
      }))
      setFeedback(message)
      setUploadingKey('')
    },
  })

  const removeUploadMutation = useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['system-settings'] })
      await queryClient.cancelQueries({ queryKey: ['public-system-settings'] })
    },
    mutationFn: async ({ key }: { key: 'brand_logo_url' | 'favicon_url' }) => {
      return apiRequest<{ ok: boolean; key: string; value: string }>(`/system-settings/uploads/${key}`, {
        method: 'DELETE',
      })
    },
    onSuccess: async ({ key, value }) => {
      updateBrandingCaches(queryClient, key, value)
      setValues((current) => ({
        ...current,
        [key]: value,
      }))
      setUploadErrors((current) => ({
        ...current,
        [key]: '',
      }))
      setUploadInputVersion((current) => ({
        ...current,
        [key]: current[key as 'favicon_url' | 'brand_logo_url'] + 1,
      }))
      setRemovingKey('')
      setFeedback('Arquivo removido com sucesso.')
      void queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      void queryClient.invalidateQueries({ queryKey: ['public-system-settings'] })
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : 'Não foi possível remover o arquivo.'

      setUploadErrors((current) => ({
        ...current,
        [variables.key]: message,
      }))
      setRemovingKey('')
      setFeedback(message)
    },
  })

  async function handleUpload(settingKey: 'brand_logo_url' | 'favicon_url', file?: File) {
    if (!file) {
      return
    }

    setFeedback('')
    setUploadingKey(settingKey)
    setUploadErrors((current) => ({
      ...current,
      [settingKey]: '',
    }))
    await uploadMutation.mutateAsync({ key: settingKey, file })
  }

  async function handleRemoveUpload(settingKey: 'brand_logo_url' | 'favicon_url') {
    setFeedback('')
    setRemovingKey(settingKey)
    setUploadErrors((current) => ({
      ...current,
      [settingKey]: '',
    }))
    await removeUploadMutation.mutateAsync({ key: settingKey })
  }

  return (
    <AppShell
      title="Configurações gerais"
      subtitle="O usuário master concentra as configurações globais da plataforma, deixando tudo mais simples de administrar."
    >
      {feedback ? (
        <div
          className={`mb-6 px-4 py-3 text-sm ${
            saveMutation.isError || uploadMutation.isError || removeUploadMutation.isError
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
          style={{ borderRadius: 8 }}
        >
          {feedback}
        </div>
      ) : null}

      <SectionCard
        eyebrow="Configurações"
        title="Parâmetros institucionais"
        description="Esses campos serão persistidos no banco em `system_settings`."
      >
        {settingsQuery.isError ? (
          <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" style={{ borderRadius: 8 }}>
            Não foi possível carregar as configurações agora. Os valores atuais não estão disponíveis sem a API.
          </div>
        ) : null}

        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => void saveMutation.mutateAsync()}
            disabled={saveMutation.isPending}
            className="admin-button-primary"
          >
            {saveMutation.isPending ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>

        <div className="grid gap-4">
          {settings.map((setting) => (
            <label key={setting.key} className="admin-panel grid gap-2 p-4">
              <span className="font-semibold text-slate-950">{setting.label}</span>
              <span className="text-sm text-slate-500">{setting.description}</span>
              {setting.key === 'default_primary_color' || setting.key === 'sidebar_color' ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label={setting.key === 'sidebar_color' ? 'Selecionar cor da barra lateral' : 'Selecionar cor primÃ¡ria padrÃ£o'}
                      className="h-12 w-16 cursor-pointer border border-slate-200 bg-white p-1"
                      style={{ borderRadius: 8 }}
                      value={normalizeColorValue(
                        values[setting.key] ?? '',
                        setting.key === 'sidebar_color' ? defaultBrandingSettings.sidebarColor : defaultBrandingSettings.primaryColor,
                      )}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [setting.key]: event.target.value,
                        }))
                      }
                    />
                    <div
                      className="h-12 w-12 border border-slate-200"
                      style={{
                        borderRadius: 8,
                        backgroundColor: normalizeColorValue(
                          values[setting.key] ?? '',
                          setting.key === 'sidebar_color'
                            ? defaultBrandingSettings.sidebarColor
                            : defaultBrandingSettings.primaryColor,
                        ),
                      }}
                    />
                  </div>

                  <input
                    className="admin-input flex-1"
                    value={values[setting.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [setting.key]: event.target.value,
                      }))
                    }
                    placeholder={
                      setting.key === 'sidebar_color'
                        ? defaultBrandingSettings.sidebarColor
                        : defaultBrandingSettings.primaryColor
                    }
                  />
                </div>
              ) : setting.key === 'favicon_url' ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden border border-slate-200 bg-white" style={{ borderRadius: 8 }}>
                    {values[setting.key] ? (
                      <img
                        src={values[setting.key]}
                        alt="Preview do favicon"
                        className="h-8 w-8 object-contain"
                      />
                    ) : (
                      <span className="text-[11px] font-medium text-slate-400">Vazio</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-3">
                    <input
                      key={`favicon-${uploadInputVersion.favicon_url}`}
                      type="file"
                      accept=".png,.jpg,.jpeg,.svg,.webp,.ico,image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon"
                      className="block w-full border border-slate-200 bg-white px-4 py-3 text-sm outline-none file:mr-3 file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                      style={{ borderRadius: 8 }}
                      onChange={(event) => void handleUpload('favicon_url', event.target.files?.[0])}
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleRemoveUpload('favicon_url')}
                        disabled={!values[setting.key] || (removeUploadMutation.isPending && removingKey === 'favicon_url')}
                        className="admin-button"
                      >
                        {removeUploadMutation.isPending && removingKey === 'favicon_url' ? 'Removendo...' : 'Remover favicon'}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {uploadingKey === 'favicon_url' && uploadMutation.isPending
                        ? 'Enviando favicon...'
                        : values[setting.key] || 'Nenhum favicon configurado.'}
                    </p>
                    {uploadErrors.favicon_url ? <p className="text-xs text-rose-600">{uploadErrors.favicon_url}</p> : null}
                  </div>
                </div>
              ) : setting.key === 'brand_logo_url' ? (
                <div className="grid gap-3">
                  <input
                    key={`logo-${uploadInputVersion.brand_logo_url}`}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp"
                    className="block w-full border border-slate-200 bg-white px-4 py-3 text-sm outline-none file:mr-3 file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                    style={{ borderRadius: 8 }}
                    onChange={(event) => void handleUpload('brand_logo_url', event.target.files?.[0])}
                  />
                  {values[setting.key] ? (
                    <div className="flex min-h-20 items-center border border-slate-200 bg-white px-4 py-3" style={{ borderRadius: 8 }}>
                      <img
                        src={values[setting.key]}
                        alt="Preview da logo"
                        className="h-12 w-auto max-w-[220px] object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-20 items-center justify-center border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400" style={{ borderRadius: 8 }}>
                      Nenhuma logo configurada.
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleRemoveUpload('brand_logo_url')}
                      disabled={!values[setting.key] || (removeUploadMutation.isPending && removingKey === 'brand_logo_url')}
                      className="admin-button"
                    >
                      {removeUploadMutation.isPending && removingKey === 'brand_logo_url' ? 'Removendo...' : 'Remover logo'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {uploadingKey === 'brand_logo_url' && uploadMutation.isPending
                      ? 'Enviando logo...'
                      : values[setting.key] || 'Nenhuma logo configurada.'}
                  </p>
                  {uploadErrors.brand_logo_url ? <p className="text-xs text-rose-600">{uploadErrors.brand_logo_url}</p> : null}
                </div>
              ) : (
                <input
                  className="admin-input"
                  value={values[setting.key] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [setting.key]: event.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  )
}
