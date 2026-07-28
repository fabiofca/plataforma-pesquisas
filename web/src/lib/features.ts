import type { AuthUser } from '@/types/domain'

export const featureKeys = [
  'reports_export_csv',
  'reports_export_pdf',
  'survey_share_qr',
  'survey_share_tracking',
  'reward_extra_chance',
  'reward_engagement_unlock',
  'birthday_whatsapp_automation',
] as const

export type FeatureKey = (typeof featureKeys)[number]
export type FeatureAccess = Record<FeatureKey, boolean>

export const featureCatalog: Array<{
  key: FeatureKey
  label: string
  description: string
}> = [
  {
    key: 'reports_export_csv',
    label: 'Exportar CSV',
    description: 'Permite exportar relatórios em CSV.',
  },
  {
    key: 'reports_export_pdf',
    label: 'Exportar PDF',
    description: 'Permite exportar relatórios em PDF.',
  },
  {
    key: 'survey_share_qr',
    label: 'QR code',
    description: 'Permite gerar e baixar QR code da pesquisa.',
  },
  {
    key: 'survey_share_tracking',
    label: 'Rastreio de compartilhamento',
    description: 'Permite visualizar cliques do link e leituras do QR.',
  },
  {
    key: 'reward_extra_chance',
    label: 'Roleta com mais uma chance',
    description: 'Permite usar itens que liberam um giro extra e futuras ações de engajamento para desbloquear nova chance.',
  },
  {
    key: 'reward_engagement_unlock',
    label: 'Desbloqueio por engajamento',
    description: 'Permite pedir ação no Google ou Instagram antes de liberar a nova chance na roleta.',
  },
  {
    key: 'birthday_whatsapp_automation',
    label: 'Feliz aniversário por WhatsApp',
    description: 'Prepara o plano para automações futuras de mensagem de aniversário usando nome, WhatsApp e data de aniversário coletados.',
  },
]

export function getDefaultFeatureAccess(): FeatureAccess {
  return {
    reports_export_csv: true,
    reports_export_pdf: true,
    survey_share_qr: true,
    survey_share_tracking: true,
    reward_extra_chance: true,
    reward_engagement_unlock: false,
    birthday_whatsapp_automation: false,
  }
}

export function hasFeatureAccess(user: AuthUser | null | undefined, feature: FeatureKey) {
  if (!user) {
    return false
  }

  return user.featureAccess?.[feature] ?? getDefaultFeatureAccess()[feature]
}
