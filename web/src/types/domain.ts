export type RoleCode = 'master' | 'user'
export type SurveyKind = 'custom' | 'nps'
export type FeatureKey =
  | 'reports_export_csv'
  | 'reports_export_pdf'
  | 'survey_share_qr'
  | 'survey_share_tracking'
  | 'reward_extra_chance'
  | 'reward_engagement_unlock'
  | 'birthday_whatsapp_automation'
export type FeatureAccess = Record<FeatureKey, boolean>

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_choice'
  | 'multiple_choice'
  | 'yes_no'
  | 'rating_1_5'
  | 'nps'

export type SurveyFlowTarget = string | '__end__'
export type SurveyBuilderMode = 'classic' | 'visual'

export interface SurveyQuestionFlowRule {
  value: string
  nextQuestionId: SurveyFlowTarget
}

export interface SurveyFlowNodeLayout {
  id: string
  x: number
  y: number
}

export interface SurveyFlowLayout {
  version: number
  nodes: SurveyFlowNodeLayout[]
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}

export interface AuthUser {
  id: string
  name: string
  email: string
  roleCode: RoleCode
  featureAccess: FeatureAccess
}

export interface UserListItem {
  id: string
  name: string
  email: string
  phone?: string
  roleCode: RoleCode
  role: string
  status: string
  surveys: number
  planName?: string | null
  planCode?: string | null
  isDefaultMaster?: boolean
}

export interface DashboardMetric {
  label: string
  value: string
  change: string
}

export type BusinessMetric = 'missing_product' | 'attendant_name' | 'attendant_rating'

export interface SurveyQuestion {
  id: string
  title: string
  type: QuestionType
  required: boolean
  description?: string
  options?: string[]
  flowRules?: SurveyQuestionFlowRule[]
  businessMetric?: BusinessMetric | null
  linkedQuestionId?: string | null
}

export interface SurveyItem {
  id: string
  kind: SurveyKind
  title: string
  description?: string
  slug: string
  status: 'Rascunho' | 'Publicada' | 'Pausada'
  responses: number
  participationMode: 'Anônima' | 'Identificada'
  rewardEnabled: boolean
  builderMode?: SurveyBuilderMode
  flowLayout?: SurveyFlowLayout
  primaryColor: string
  updatedAt: string
  questions: SurveyQuestion[]
  brandName?: string
  logoUrl?: string
  bannerUrl?: string
  closingMessage?: string
  linkClicks?: number
  qrScans?: number
  preventDuplicateResponses?: boolean
  duplicateResponseCooldownDays?: number
  allowMultipleResponses?: boolean
  rewardPreviewItems?: Array<{
    id: string
    title: string
    wheelLabel?: string
    description?: string
    imageUrl?: string
    outcomeRole?: 'prize' | 'no_prize' | 'showcase'
    showOnWheel?: boolean
    quantityTotal?: number
    quantityAwarded?: number
    sortOrder?: number
  }>
  rewardWheelMode?: 'standard' | 'advanced'
  rewardFinalSpinMode?: 'allow_no_prize' | 'guaranteed_prize'
  rewardRetryUnlockEnabled?: boolean
  rewardPickupAddress?: string
  rewardContactWhatsApp?: string
  rewardRedemptionMethod?: 'address_only' | 'address_and_whatsapp'
  rewardRedemptionExpirationDays?: number
  rewardRetryTasks?: Array<{
    id: string
    type: 'google_review' | 'instagram_follow' | 'custom_link'
    title: string
    url: string
  }>
  attendants?: Array<{
    id: string
    name: string
  }>
}

export interface RewardItem {
  id: string
  title: string
  stock: number
  delivered: number
}

export interface SystemSettingItem {
  key: string
  label: string
  description: string
  value: string
}

export interface PlanItem {
  id: string
  code: string
  name: string
  description: string
  isActive: boolean
  features: FeatureAccess
}

export interface PlanUserAssignmentItem {
  id: string
  name: string
  email: string
  roleCode: RoleCode
  status: string
  planId?: string | null
  planName?: string | null
  planCode?: string | null
}

export interface PlanHistoryItem {
  id: string
  createdAt: string
  actorName: string
  userId: string
  userName: string
  userEmail: string
  previousPlanName?: string | null
  nextPlanName?: string | null
  previousPlanCode?: string | null
  nextPlanCode?: string | null
}
