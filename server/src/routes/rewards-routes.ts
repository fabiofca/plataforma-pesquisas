import { Router } from 'express'

import { query } from '../db/pool.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { MAX_REAL_REWARDS, createNextReleaseSpin, getFrequencyTarget, calculateMinimumGapSpins } from '../services/reward-draw.js'
import { ensureSurveyAccess } from '../services/survey-access.js'
import { makeId } from '../utils/security.js'
import { rewardCampaignSchema, rewardItemPatchSchema, rewardItemSchema, rewardWinRedemptionSchema } from '../validators/schemas.js'

export const rewardsRouter = Router()

rewardsRouter.use(requireAuth)

async function ensureRewardItemLimit(input: { campaignId: string; currentItemId?: string }) {
  const items = await query<{ total: string }>(
    `select cast(count(*) as text) as total
     from reward_items
     where campaign_id = $1
       and ($2::uuid is null or id <> $2::uuid)`,
    [input.campaignId, input.currentItemId ?? null],
  )

  if (Number(items.rows[0]?.total ?? 0) >= MAX_REAL_REWARDS) {
    return {
      ok: false as const,
      message: 'A roleta aceita no máximo 3 tipos de prêmio por campanha.',
    }
  }

  return { ok: true as const }
}

rewardsRouter.get('/surveys/:id/rewards', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const campaignResult = await query<{
    id: string
    status: 'active' | 'paused' | 'ended'
    expires_at: string | null
    redemption_expiration_days: number
    pickup_address: string | null
    contact_whatsapp: string | null
    redemption_method: 'address_only' | 'address_and_whatsapp'
    retry_unlock_enabled: boolean
    retry_unlock_tasks_json:
      | Array<{
          id: string
          type: 'google_review' | 'instagram_follow' | 'custom_link'
          title: string
          url: string
        }>
      | null
    spin_count: number
  }>(
    `select
        id,
        status,
        cast(expires_at as text) as expires_at,
        redemption_expiration_days,
        pickup_address,
        contact_whatsapp,
        redemption_method,
        retry_unlock_enabled,
        retry_unlock_tasks_json,
        spin_count
     from reward_campaigns
     where survey_id = $1`,
    [surveyId],
  )

  const campaign = campaignResult.rows[0]

  if (!campaign) {
    response.json({
      campaign: null,
      items: [],
      redemptionSummary: {
        pendingCount: 0,
        deliveredCount: 0,
        cancelledCount: 0,
      },
      wins: [],
    })
    return
  }

  const items = await query<{
    id: string
    title: string
    description: string | null
    quantity_total: number
    quantity_awarded: number
    is_active: boolean
    frequency_mode: 'frequent' | 'balanced' | 'rare' | 'custom'
    frequency_target: number
  }>(
    `select
        id,
        title,
        description,
        quantity_total,
        quantity_awarded,
        is_active,
        frequency_mode,
        frequency_target
     from reward_items
     where campaign_id = $1
     order by created_at asc`,
    [campaign.id],
  )

  const [redemptionSummary, wins] = await Promise.all([
    query<{
      pending_count: string
      delivered_count: string
      cancelled_count: string
    }>(
      `select
          cast(count(*) filter (where redemption_status = 'pending') as text) as pending_count,
          cast(count(*) filter (where redemption_status = 'delivered') as text) as delivered_count,
          cast(count(*) filter (where redemption_status = 'cancelled') as text) as cancelled_count
       from reward_wins
       where campaign_id = $1`,
      [campaign.id],
    ),
    query<{
      id: string
      awarded_at: string
      delivered_at: string | null
      coupon_code: string
      redemption_status: 'pending' | 'delivered' | 'cancelled'
      redemption_notes: string | null
      participant_name: string | null
      participant_phone: string | null
      participant_email: string | null
      item_title: string
    }>(
      `select
          reward_wins.id,
          cast(reward_wins.awarded_at as text) as awarded_at,
          cast(reward_wins.delivered_at as text) as delivered_at,
          reward_wins.coupon_code,
          reward_wins.redemption_status,
          reward_wins.redemption_notes,
          survey_responses.participant_name,
          survey_responses.participant_phone,
          survey_responses.participant_email,
          reward_items.title as item_title
       from reward_wins
       join survey_responses on survey_responses.id = reward_wins.response_id
       join reward_items on reward_items.id = reward_wins.reward_item_id
       where reward_wins.campaign_id = $1
       order by reward_wins.awarded_at desc
       limit 50`,
      [campaign.id],
    ),
  ])

  response.json({
    campaign: {
      ...campaign,
      retry_unlock_tasks_json: campaign.retry_unlock_tasks_json ?? [],
    },
    items: items.rows,
    redemptionSummary: {
      pendingCount: Number(redemptionSummary.rows[0]?.pending_count ?? 0),
      deliveredCount: Number(redemptionSummary.rows[0]?.delivered_count ?? 0),
      cancelledCount: Number(redemptionSummary.rows[0]?.cancelled_count ?? 0),
    },
    wins: wins.rows.map((win) => ({
      id: win.id,
      awardedAt: win.awarded_at,
      deliveredAt: win.delivered_at,
      couponCode: win.coupon_code,
      redemptionStatus: win.redemption_status,
      redemptionNotes: win.redemption_notes,
      name: win.participant_name,
      phone: win.participant_phone,
      email: win.participant_email,
      itemTitle: win.item_title,
    })),
  })
})

rewardsRouter.post('/surveys/:id/rewards', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const payload = rewardCampaignSchema.parse(request.body)
  const existing = await query<{ id: string }>('select id from reward_campaigns where survey_id = $1', [surveyId])
  const isActive = payload.status === 'active'

  if (existing.rows[0]) {
    await query(
      `update reward_campaigns
       set status = $2,
           is_active = $3,
           require_identification = true,
           distribution_mode = 'simple',
           expires_at = $4,
           redemption_expiration_days = $5,
           pickup_address = $6,
           contact_whatsapp = $7,
           redemption_method = $8,
           retry_unlock_enabled = $9,
           retry_unlock_tasks_json = $10::jsonb,
           updated_at = now()
       where survey_id = $1`,
      [
        surveyId,
        payload.status,
        isActive,
        payload.expiresAt || null,
        payload.redemptionExpirationDays,
        payload.pickupAddress?.trim() || null,
        payload.contactWhatsApp?.trim() || null,
        payload.redemptionMethod,
        payload.retryUnlockEnabled,
        JSON.stringify(payload.retryUnlockEnabled ? payload.retryUnlockTasks : []),
      ],
    )
  } else {
    await query(
      `insert into reward_campaigns (
        id, survey_id, status, is_active, require_identification, distribution_mode, expires_at, pickup_address,
        redemption_expiration_days, contact_whatsapp, redemption_method, retry_unlock_enabled, retry_unlock_tasks_json
       ) values ($1, $2, $3, $4, true, 'simple', $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        makeId(),
        surveyId,
        payload.status,
        isActive,
        payload.expiresAt || null,
        payload.pickupAddress?.trim() || null,
        payload.redemptionExpirationDays,
        payload.contactWhatsApp?.trim() || null,
        payload.redemptionMethod,
        payload.retryUnlockEnabled,
        JSON.stringify(payload.retryUnlockEnabled ? payload.retryUnlockTasks : []),
      ],
    )
  }

  await query(
    `update surveys
     set reward_enabled = $2,
         updated_at = now()
     where id = $1`,
    [surveyId, payload.status !== 'ended'],
  )

  response.json({ ok: true })
})

rewardsRouter.post('/surveys/:id/rewards/items', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const payload = rewardItemSchema.parse(request.body)
  const campaignResult = await query<{ id: string; spin_count: number }>(
    'select id, spin_count from reward_campaigns where survey_id = $1 limit 1',
    [surveyId],
  )
  const campaign = campaignResult.rows[0]

  if (!campaign) {
    response.status(400).json({ message: 'Crie a campanha antes de cadastrar os prêmios.' })
    return
  }

  const itemLimit = await ensureRewardItemLimit({ campaignId: campaign.id })

  if (!itemLimit.ok) {
    response.status(400).json({ message: itemLimit.message })
    return
  }

  const frequencyTarget = getFrequencyTarget(payload.frequencyMode, payload.customFrequencyTarget)

  await query(
    `insert into reward_items (
      id,
      campaign_id,
      title,
      description,
      quantity_total,
      quantity_awarded,
      is_active,
      frequency_mode,
      frequency_target,
      next_release_spin,
      last_awarded_spin,
      min_gap_spins,
      odds_weight,
      is_visual_only,
      grants_extra_spin
     ) values ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, 0, $10, 1, false, false)`,
    [
      makeId(),
      campaign.id,
      payload.title,
      payload.description ?? null,
      payload.quantityTotal,
      payload.isActive,
      payload.frequencyMode,
      frequencyTarget,
      createNextReleaseSpin(campaign.spin_count, frequencyTarget),
      calculateMinimumGapSpins(frequencyTarget),
    ],
  )

  response.status(201).json({ ok: true })
})

rewardsRouter.patch('/rewards/items/:id', async (request: AuthenticatedRequest, response) => {
  const itemAccess = await query<{ survey_id: string; campaign_id: string }>(
    `select reward_campaigns.survey_id, reward_campaigns.id as campaign_id
     from reward_items
     join reward_campaigns on reward_campaigns.id = reward_items.campaign_id
     where reward_items.id = $1`,
    [request.params.id],
  )

  const surveyId = itemAccess.rows[0]?.survey_id

  if (!surveyId) {
    response.status(404).json({ message: 'Prêmio não encontrado.' })
    return
  }

  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const payload = rewardItemPatchSchema.parse(request.body)
  const currentItemResult = await query<{
    campaign_id: string
    title: string
    description: string | null
    quantity_total: number
    is_active: boolean
    frequency_mode: 'frequent' | 'balanced' | 'rare' | 'custom'
    frequency_target: number
  }>(
    `select campaign_id, title, description, quantity_total, is_active, frequency_mode, frequency_target
     from reward_items
     where id = $1
     limit 1`,
    [request.params.id],
  )

  const currentItem = currentItemResult.rows[0]

  if (!currentItem) {
    response.status(404).json({ message: 'Prêmio não encontrado.' })
    return
  }

  const campaignResult = await query<{ spin_count: number }>(
    'select spin_count from reward_campaigns where id = $1 limit 1',
    [currentItem.campaign_id],
  )
  const campaignSpinCount = campaignResult.rows[0]?.spin_count ?? 0
  const nextFrequencyMode = payload.frequencyMode ?? currentItem.frequency_mode
  const nextFrequencyTarget = getFrequencyTarget(nextFrequencyMode, payload.customFrequencyTarget ?? currentItem.frequency_target)

  await query(
    `update reward_items
     set title = coalesce($2, title),
         description = coalesce($3, description),
         quantity_total = coalesce($4, quantity_total),
         is_active = coalesce($5, is_active),
         frequency_mode = $6,
         frequency_target = $7,
         next_release_spin = $8,
         min_gap_spins = $9,
         odds_weight = 1,
         is_visual_only = false,
         grants_extra_spin = false
     where id = $1`,
    [
      request.params.id,
      payload.title,
      payload.description,
      payload.quantityTotal,
      payload.isActive,
      nextFrequencyMode,
      nextFrequencyTarget,
      createNextReleaseSpin(campaignSpinCount, nextFrequencyTarget),
      calculateMinimumGapSpins(nextFrequencyTarget),
    ],
  )

  response.json({ ok: true })
})

rewardsRouter.delete('/rewards/items/:id', async (request: AuthenticatedRequest, response) => {
  const itemAccess = await query<{ survey_id: string }>(
    `select reward_campaigns.survey_id
     from reward_items
     join reward_campaigns on reward_campaigns.id = reward_items.campaign_id
     where reward_items.id = $1`,
    [request.params.id],
  )

  const surveyId = itemAccess.rows[0]?.survey_id

  if (!surveyId) {
    response.status(404).json({ message: 'Prêmio não encontrado.' })
    return
  }

  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  await query('delete from reward_items where id = $1', [request.params.id])

  response.json({ ok: true })
})

rewardsRouter.patch('/rewards/wins/:id/redemption', async (request: AuthenticatedRequest, response) => {
  const winAccess = await query<{ survey_id: string }>(
    `select reward_campaigns.survey_id
     from reward_wins
     join reward_campaigns on reward_campaigns.id = reward_wins.campaign_id
     where reward_wins.id = $1
     limit 1`,
    [request.params.id],
  )

  const surveyId = winAccess.rows[0]?.survey_id

  if (!surveyId) {
    response.status(404).json({ message: 'Premiação não encontrada.' })
    return
  }

  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const payload = rewardWinRedemptionSchema.parse(request.body)

  const result = await query<{
    id: string
    redemption_status: 'pending' | 'delivered' | 'cancelled'
    delivered_at: string | null
    redemption_notes: string | null
  }>(
    `update reward_wins
     set redemption_status = $2,
         delivered_at = case
           when $2 = 'delivered' then coalesce(delivered_at, now())
           else null
         end,
         redemption_notes = $3,
         redemption_updated_at = now()
     where id = $1
     returning
       id,
       redemption_status,
       cast(delivered_at as text) as delivered_at,
       redemption_notes`,
    [request.params.id, payload.status, payload.redemptionNotes?.trim() || null],
  )

  response.json({
    ok: true,
    win: {
      id: result.rows[0]?.id,
      redemptionStatus: result.rows[0]?.redemption_status,
      deliveredAt: result.rows[0]?.delivered_at,
      redemptionNotes: result.rows[0]?.redemption_notes,
    },
  })
})
