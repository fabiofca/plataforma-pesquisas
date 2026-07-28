import { query } from '../db/pool.js'

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

export function getDefaultFeatureAccess(enabledByDefault = true): FeatureAccess {
  return {
    reports_export_csv: enabledByDefault,
    reports_export_pdf: enabledByDefault,
    survey_share_qr: enabledByDefault,
    survey_share_tracking: enabledByDefault,
    reward_extra_chance: enabledByDefault,
    reward_engagement_unlock: false,
    birthday_whatsapp_automation: false,
  }
}

export async function ensureDefaultPlanSubscription(userId: string) {
  const planResult = await query<{ id: string }>(
    'select id from plans where code = $1 and is_active = true limit 1',
    ['base'],
  )
  const defaultPlan = planResult.rows[0]

  if (!defaultPlan) {
    return
  }

  await query(
    `insert into user_plan_subscriptions (id, user_id, plan_id, status, starts_at)
     select $1, $2, $3, 'active', now()
     where not exists (
       select 1
       from user_plan_subscriptions
       where user_id = $2
         and status = 'active'
         and ends_at is null
     )`,
    [`subscription_${userId}`, userId, defaultPlan.id],
  )
}

export async function assignPlanToUser(userId: string, planId: string) {
  await query(
    `update user_plan_subscriptions
     set status = 'canceled',
         ends_at = now(),
         updated_at = now()
     where user_id = $1
       and status = 'active'
       and ends_at is null`,
    [userId],
  )

  await query(
    `insert into user_plan_subscriptions (id, user_id, plan_id, status, starts_at)
     values ($1, $2, $3, 'active', now())`,
    [`subscription_${userId}_${Date.now()}`, userId, planId],
  )
}

export async function resolveFeatureAccess(userId: string, roleCode: string): Promise<FeatureAccess> {
  if (roleCode === 'master') {
    return {
      ...getDefaultFeatureAccess(true),
      reward_engagement_unlock: true,
      birthday_whatsapp_automation: true,
    }
  }

  const baseAccess = getDefaultFeatureAccess(false)
  const activeSubscription = await query<{ plan_id: string }>(
    `select plan_id
     from user_plan_subscriptions
     where user_id = $1
       and status = 'active'
       and ends_at is null
     limit 1`,
    [userId],
  )

  if (!activeSubscription.rows[0]) {
    return getDefaultFeatureAccess(true)
  }

  const featureResult = await query<{ feature_key: string; is_enabled: boolean }>(
    `select plan_features.feature_key, plan_features.is_enabled
     from user_plan_subscriptions
     join plans on plans.id = user_plan_subscriptions.plan_id
     left join plan_features on plan_features.plan_id = plans.id
     where user_plan_subscriptions.user_id = $1
       and user_plan_subscriptions.status = 'active'
       and user_plan_subscriptions.ends_at is null
       and plans.is_active = true`,
    [userId],
  )

  if (!featureResult.rows.length) {
    return baseAccess
  }

  for (const row of featureResult.rows) {
    if (featureKeys.includes(row.feature_key as FeatureKey)) {
      baseAccess[row.feature_key as FeatureKey] = row.is_enabled
    }
  }

  return baseAccess
}

export async function hasFeatureAccess(userId: string, roleCode: string, featureKey: FeatureKey) {
  const access = await resolveFeatureAccess(userId, roleCode)
  return access[featureKey]
}

export async function ensureFeatureAccess(userId: string, roleCode: string, featureKey: FeatureKey) {
  const allowed = await hasFeatureAccess(userId, roleCode, featureKey)

  if (!allowed) {
    return {
      ok: false as const,
      status: 403,
      message: 'Este recurso não está disponível no plano atual.',
    }
  }

  return { ok: true as const }
}
