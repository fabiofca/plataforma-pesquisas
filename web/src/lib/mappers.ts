import type { BusinessMetric, SurveyItem, SurveyQuestion, UserListItem } from '@/types/domain'

function mapRoleLabel(roleCode: string) {
  return roleCode === 'master' ? 'Usuário master' : 'Usuário comum'
}

function mapSurveyStatus(status: string): SurveyItem['status'] {
  if (status === 'published') return 'Publicada'
  if (status === 'paused') return 'Pausada'
  return 'Rascunho'
}

function mapParticipationMode(mode: string): SurveyItem['participationMode'] {
  return mode === 'identified' ? 'Identificada' : 'Anônima'
}

function mapSurveyKind(item: {
  survey_kind?: string
  questions?: Array<{
    type: string
  }>
}): SurveyItem['kind'] {
  if (item.survey_kind === 'nps') {
    return 'nps'
  }

  if (item.questions?.some((question) => question.type === 'nps')) {
    return 'nps'
  }

  return 'custom'
}

export function mapApiUser(item: {
  id: string
  name: string
  email: string
  phone?: string | null
  status: string
  role_code: string
  surveys_count?: string | number
  plan_name?: string | null
  plan_code?: string | null
  is_default_master?: boolean
}): UserListItem {
  return {
    id: item.id,
    name: item.name,
    email: item.email,
    phone: item.phone ?? undefined,
    roleCode: item.role_code as UserListItem['roleCode'],
    role: mapRoleLabel(item.role_code),
    status: item.status === 'blocked' ? 'Bloqueado' : 'Ativo',
    surveys: Number(item.surveys_count ?? 0),
    planName: item.plan_name ?? null,
    planCode: item.plan_code ?? null,
    isDefaultMaster: item.is_default_master ?? false,
  }
}

export function mapApiQuestion(item: {
  id: string
  title: string
  description?: string | null
  type: string
  is_required?: boolean
  required?: boolean
  options?: string[]
  settings_json?: {
    flowRules?: Array<{
      value: string
      nextQuestionId: string
    }>
    businessMetric?: string | null
    linkedQuestionId?: string | null
  }
}): SurveyQuestion {
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? undefined,
    type: item.type as SurveyQuestion['type'],
    required: item.is_required ?? item.required ?? false,
    options: item.options ?? [],
    flowRules: item.settings_json?.flowRules ?? [],
    businessMetric: (item.settings_json?.businessMetric as BusinessMetric) ?? null,
    linkedQuestionId: item.settings_json?.linkedQuestionId ?? null,
  }
}

export function mapApiSurvey(item: {
  id: string
  survey_kind?: string
  title: string
  description?: string | null
  slug?: string | null
  status: string
  responses?: string | number
  participation_mode?: string
  participationMode?: string
  reward_enabled?: boolean
  rewardEnabled?: boolean
  builder_mode?: 'classic' | 'visual'
  flow_json?: {
    version?: number
    nodes?: Array<{
      id: string
      x: number
      y: number
    }>
    viewport?: {
      x: number
      y: number
      zoom: number
    }
  } | null
  prevent_duplicate_responses?: boolean
  preventDuplicateResponses?: boolean
  duplicate_response_cooldown_days?: number
  duplicateResponseCooldownDays?: number
  allow_multiple_responses?: boolean
  allowMultipleResponses?: boolean
  primary_color?: string
  primaryColor?: string
  questions?: Array<{
    id: string
    title: string
    description?: string | null
    type: string
    is_required?: boolean
    required?: boolean
    options?: string[]
      settings_json?: {
        flowRules?: Array<{
          value: string
          nextQuestionId: string
        }>
        businessMetric?: string | null
        linkedQuestionId?: string | null
      }
  }>
  brand_name?: string
  brandName?: string
  logo_url?: string | null
  banner_url?: string | null
  closing_message?: string | null
  link_clicks?: string | number
  qr_scans?: string | number
  reward_items?: Array<{
    id: string
    title: string
    wheel_label?: string | null
    image_url?: string | null
    outcome_role?: 'prize' | 'no_prize' | 'showcase'
    show_on_wheel?: boolean
    quantity_total?: number
    quantity_awarded?: number
    sort_order?: number
  }>
  reward_wheel_mode?: 'standard' | 'advanced' | null
  reward_final_spin_mode?: 'allow_no_prize' | 'guaranteed_prize' | null
  reward_retry_unlock_enabled?: boolean
  reward_pickup_address?: string | null
  reward_contact_whatsapp?: string | null
  reward_redemption_method?: 'address_only' | 'address_and_whatsapp' | null
  reward_redemption_expiration_days?: number | null
  reward_retry_tasks?: Array<{
    id: string
    type: 'google_review' | 'instagram_follow' | 'custom_link'
    title: string
    url: string
  }>
}): SurveyItem {
  return {
    id: item.id,
    kind: mapSurveyKind(item),
    title: item.title,
    description: item.description ?? undefined,
    slug: item.slug ?? 'sem-slug',
    status: mapSurveyStatus(item.status),
    responses: Number(item.responses ?? 0),
    participationMode: mapParticipationMode(item.participation_mode ?? item.participationMode ?? 'anonymous'),
    rewardEnabled: item.reward_enabled ?? item.rewardEnabled ?? false,
    builderMode: item.builder_mode ?? 'classic',
    flowLayout: item.flow_json
      ? {
          version: item.flow_json.version ?? 1,
          nodes: item.flow_json.nodes ?? [],
          viewport: item.flow_json.viewport,
        }
      : undefined,
    primaryColor: item.primary_color ?? item.primaryColor ?? '#0b5cff',
    updatedAt: 'Atualizada agora',
    questions: (item.questions ?? []).map(mapApiQuestion),
    brandName: item.brand_name ?? item.brandName,
    logoUrl: item.logo_url ?? undefined,
    bannerUrl: item.banner_url ?? undefined,
    closingMessage: item.closing_message ?? undefined,
    linkClicks: Number(item.link_clicks ?? 0),
    qrScans: Number(item.qr_scans ?? 0),
    preventDuplicateResponses: item.prevent_duplicate_responses ?? item.preventDuplicateResponses ?? false,
    duplicateResponseCooldownDays: item.duplicate_response_cooldown_days ?? item.duplicateResponseCooldownDays ?? 15,
    allowMultipleResponses: item.allow_multiple_responses ?? item.allowMultipleResponses ?? true,
    rewardPreviewItems: (item.reward_items ?? []).map((rewardItem) => ({
      id: rewardItem.id,
      title: rewardItem.title,
      wheelLabel: rewardItem.wheel_label ?? rewardItem.title,
      imageUrl: rewardItem.image_url ?? undefined,
      outcomeRole: rewardItem.outcome_role ?? 'prize',
      showOnWheel: rewardItem.show_on_wheel ?? true,
      quantityTotal: rewardItem.quantity_total,
      quantityAwarded: rewardItem.quantity_awarded,
      sortOrder: rewardItem.sort_order,
    })),
    rewardWheelMode: item.reward_wheel_mode ?? undefined,
    rewardFinalSpinMode: item.reward_final_spin_mode ?? undefined,
    rewardRetryUnlockEnabled: item.reward_retry_unlock_enabled ?? false,
    rewardPickupAddress: item.reward_pickup_address ?? undefined,
    rewardContactWhatsApp: item.reward_contact_whatsapp ?? undefined,
    rewardRedemptionMethod: item.reward_redemption_method ?? undefined,
    rewardRedemptionExpirationDays: item.reward_redemption_expiration_days ?? undefined,
    rewardRetryTasks: item.reward_retry_tasks ?? [],
  }
}
