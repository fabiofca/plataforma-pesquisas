import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import multer, { type FileFilterCallback } from 'multer'
import { Router, type Request } from 'express'

import { query } from '../db/pool.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { MAX_REAL_REWARDS, createNextReleaseSpin, getFrequencyTarget, calculateMinimumGapSpins } from '../services/reward-draw.js'
import { ensureSurveyAccess } from '../services/survey-access.js'
import { makeId } from '../utils/security.js'
import { rewardCampaignSchema, rewardItemPatchSchema, rewardItemSchema, rewardWinRedemptionSchema } from '../validators/schemas.js'

export const rewardsRouter = Router()
const MAX_ADVANCED_WHEEL_ITEMS = 12
const rewardUploadDir = path.resolve(process.cwd(), 'uploads', 'rewards')

mkdirSync(rewardUploadDir, { recursive: true })

const rewardImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_request: Request, _file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
      callback(null, rewardUploadDir)
    },
    filename: (_request: Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.bin'
      callback(null, `${makeId()}${extension}`)
    },
  }),
  limits: {
    fileSize: 3 * 1024 * 1024,
  },
  fileFilter: (_request: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
    const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('Envie uma imagem PNG, JPG, SVG ou WEBP.'))
      return
    }

    callback(null, true)
  },
})

rewardsRouter.use(requireAuth)

rewardsRouter.post('/uploads/item-image', rewardImageUpload.single('file'), async (request: AuthenticatedRequest, response) => {
  if (!request.file) {
    response.status(400).json({ message: 'Selecione uma imagem para enviar.' })
    return
  }

  const previousValue = typeof request.body.previousValue === 'string' ? request.body.previousValue : ''
  const publicPath = `/uploads/rewards/${request.file.filename}`

  removeManagedRewardImage(previousValue)

  response.json({ ok: true, key: 'item-image', value: publicPath })
})

rewardsRouter.delete('/uploads/item-image', async (request: AuthenticatedRequest, response) => {
  const value = typeof request.body?.value === 'string' ? request.body.value : ''

  removeManagedRewardImage(value)

  response.json({ ok: true, key: 'item-image', value: '' })
})

function removeManagedRewardImage(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/uploads/rewards/')) {
    return
  }

  const fileName = path.basename(value)
  const filePath = path.join(rewardUploadDir, fileName)
  rmSync(filePath, { force: true })
}

async function ensureRewardItemLimit(input: { campaignId: string; currentItemId?: string; wheelMode: 'standard' | 'advanced' }) {
  const items = await query<{ total: string; real_total: string }>(
    `select cast(count(*) as text) as total
          ,cast(count(*) filter (where outcome_role = 'prize') as text) as real_total
     from reward_items
     where campaign_id = $1
       and ($2::uuid is null or id <> $2::uuid)`,
    [input.campaignId, input.currentItemId ?? null],
  )

  if (input.wheelMode === 'standard' && Number(items.rows[0]?.real_total ?? 0) >= MAX_REAL_REWARDS) {
    return {
      ok: false as const,
      message: 'A roleta aceita no máximo 3 tipos de prêmio por campanha.',
    }
  }

  if (input.wheelMode === 'advanced' && Number(items.rows[0]?.total ?? 0) >= MAX_ADVANCED_WHEEL_ITEMS) {
    return {
      ok: false as const,
      message: `A roleta avançada aceita no máximo ${MAX_ADVANCED_WHEEL_ITEMS} itens visuais por campanha.`,
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
    wheel_mode: 'standard' | 'advanced'
    final_spin_mode: 'allow_no_prize' | 'guaranteed_prize'
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
        wheel_mode,
        final_spin_mode,
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
    wheel_label: string | null
    description: string | null
    image_url: string | null
    outcome_role: 'prize' | 'no_prize' | 'showcase'
    show_on_wheel: boolean
    sort_order: number
    quantity_total: number
    quantity_awarded: number
    is_active: boolean
    frequency_mode: 'frequent' | 'balanced' | 'rare' | 'custom'
    frequency_target: number
  }>(
    `select
        id,
        title,
        wheel_label,
        description,
        image_url,
        outcome_role,
        show_on_wheel,
        sort_order,
        quantity_total,
        quantity_awarded,
        is_active,
        frequency_mode,
        frequency_target
     from reward_items
     where campaign_id = $1
     order by sort_order asc, created_at asc`,
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
    items: items.rows.map((item) => ({
      ...item,
      wheel_label: item.wheel_label ?? item.title,
    })),
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
           wheel_mode = $4,
           final_spin_mode = $5,
           expires_at = $6,
           redemption_expiration_days = $7,
           pickup_address = $8,
           contact_whatsapp = $9,
           redemption_method = $10,
           retry_unlock_enabled = $11,
           retry_unlock_tasks_json = $12::jsonb,
           updated_at = now()
       where survey_id = $1`,
      [
        surveyId,
        payload.status,
        isActive,
        payload.wheelMode,
        payload.finalSpinMode,
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
        wheel_mode, final_spin_mode, redemption_expiration_days, contact_whatsapp, redemption_method, retry_unlock_enabled, retry_unlock_tasks_json
       ) values ($1, $2, $3, $4, true, 'simple', $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        makeId(),
        surveyId,
        payload.status,
        isActive,
        payload.expiresAt || null,
        payload.pickupAddress?.trim() || null,
        payload.wheelMode,
        payload.finalSpinMode,
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
  const campaignResult = await query<{ id: string; spin_count: number; wheel_mode: 'standard' | 'advanced' }>(
    'select id, spin_count, wheel_mode from reward_campaigns where survey_id = $1 limit 1',
    [surveyId],
  )
  const campaign = campaignResult.rows[0]

  if (!campaign) {
    response.status(400).json({ message: 'Crie a campanha antes de cadastrar os prêmios.' })
    return
  }

  const itemLimit = await ensureRewardItemLimit({ campaignId: campaign.id, wheelMode: campaign.wheel_mode })

  if (!itemLimit.ok) {
    response.status(400).json({ message: itemLimit.message })
    return
  }

  const isPrizeItem = payload.outcomeRole === 'prize'
  const frequencyMode = isPrizeItem ? payload.frequencyMode : 'balanced'
  const frequencyTarget = isPrizeItem ? getFrequencyTarget(payload.frequencyMode, payload.customFrequencyTarget) : 60
  const sortOrderResult = await query<{ next_sort_order: string }>(
    `select cast(coalesce(max(sort_order), 0) + 1 as text) as next_sort_order
     from reward_items
     where campaign_id = $1`,
    [campaign.id],
  )
  const nextSortOrder = Number(sortOrderResult.rows[0]?.next_sort_order ?? 1)

  await query(
    `insert into reward_items (
      id,
      campaign_id,
      title,
      wheel_label,
      description,
      image_url,
      outcome_role,
      show_on_wheel,
      sort_order,
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
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, 0, $15, 1, $16, false)`,
    [
      makeId(),
      campaign.id,
      payload.title.trim(),
      payload.wheelLabel?.trim() || payload.title.trim(),
      payload.description?.trim() || null,
      payload.imageUrl?.trim() || null,
      payload.outcomeRole,
      payload.showOnWheel,
      payload.sortOrder ?? nextSortOrder,
      payload.quantityTotal ?? 1,
      payload.isActive,
      frequencyMode,
      frequencyTarget,
      isPrizeItem ? createNextReleaseSpin(campaign.spin_count, frequencyTarget) : 0,
      isPrizeItem ? calculateMinimumGapSpins(frequencyTarget) : 0,
      payload.outcomeRole === 'showcase',
    ],
  )

  response.status(201).json({ ok: true })
})

rewardsRouter.patch('/rewards/items/:id', async (request: AuthenticatedRequest, response) => {
  const itemId = String(request.params.id)
  const itemAccess = await query<{ survey_id: string; campaign_id: string }>(
    `select reward_campaigns.survey_id, reward_campaigns.id as campaign_id
     from reward_items
     join reward_campaigns on reward_campaigns.id = reward_items.campaign_id
     where reward_items.id = $1`,
    [itemId],
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
    wheel_mode: 'standard' | 'advanced'
    title: string
    wheel_label: string | null
    description: string | null
    image_url: string | null
    outcome_role: 'prize' | 'no_prize' | 'showcase'
    show_on_wheel: boolean
    sort_order: number
    quantity_total: number
    is_active: boolean
    frequency_mode: 'frequent' | 'balanced' | 'rare' | 'custom'
    frequency_target: number
  }>(
    `select
        reward_items.campaign_id,
        reward_campaigns.wheel_mode,
        reward_items.title,
        reward_items.wheel_label,
        reward_items.description,
        reward_items.image_url,
        reward_items.outcome_role,
        reward_items.show_on_wheel,
        reward_items.sort_order,
        reward_items.quantity_total,
        reward_items.is_active,
        reward_items.frequency_mode,
        reward_items.frequency_target
     from reward_items
     join reward_campaigns on reward_campaigns.id = reward_items.campaign_id
     where reward_items.id = $1
     limit 1`,
    [itemId],
  )

  const currentItem = currentItemResult.rows[0]

  if (!currentItem) {
    response.status(404).json({ message: 'Prêmio não encontrado.' })
    return
  }

  const itemLimit = await ensureRewardItemLimit({
    campaignId: currentItem.campaign_id,
    currentItemId: itemId,
    wheelMode: currentItem.wheel_mode,
  })

  if (!itemLimit.ok) {
    response.status(400).json({ message: itemLimit.message })
    return
  }

  const campaignResult = await query<{ spin_count: number }>(
    'select spin_count from reward_campaigns where id = $1 limit 1',
    [currentItem.campaign_id],
  )
  const campaignSpinCount = campaignResult.rows[0]?.spin_count ?? 0
  const nextOutcomeRole = payload.outcomeRole ?? currentItem.outcome_role
  const nextFrequencyMode = nextOutcomeRole === 'prize' ? (payload.frequencyMode ?? currentItem.frequency_mode) : 'balanced'
  const nextFrequencyTarget =
    nextOutcomeRole === 'prize'
      ? getFrequencyTarget(nextFrequencyMode, payload.customFrequencyTarget ?? currentItem.frequency_target)
      : 60

  await query(
    `update reward_items
     set title = coalesce($2, title),
         wheel_label = $3,
         description = $4,
         image_url = $5,
         outcome_role = $6,
         show_on_wheel = $7,
         sort_order = $8,
         quantity_total = $9,
         is_active = $10,
         frequency_mode = $11,
         frequency_target = $12,
         next_release_spin = $13,
         min_gap_spins = $14,
         odds_weight = 1,
         is_visual_only = $15,
         grants_extra_spin = false
     where id = $1`,
    [
      itemId,
      payload.title?.trim() || currentItem.title,
      payload.wheelLabel?.trim() || currentItem.wheel_label || payload.title?.trim() || currentItem.title,
      payload.description?.trim() ?? currentItem.description,
      payload.imageUrl?.trim() ?? currentItem.image_url,
      nextOutcomeRole,
      payload.showOnWheel ?? currentItem.show_on_wheel,
      payload.sortOrder ?? currentItem.sort_order,
      payload.quantityTotal ?? currentItem.quantity_total,
      payload.isActive ?? currentItem.is_active,
      nextFrequencyMode,
      nextFrequencyTarget,
      nextOutcomeRole === 'prize' ? createNextReleaseSpin(campaignSpinCount, nextFrequencyTarget) : 0,
      nextOutcomeRole === 'prize' ? calculateMinimumGapSpins(nextFrequencyTarget) : 0,
      nextOutcomeRole === 'showcase',
    ],
  )

  response.json({ ok: true })
})

rewardsRouter.delete('/rewards/items/:id', async (request: AuthenticatedRequest, response) => {
  const itemId = String(request.params.id)
  const itemAccess = await query<{ survey_id: string }>(
    `select reward_campaigns.survey_id
     from reward_items
     join reward_campaigns on reward_campaigns.id = reward_items.campaign_id
     where reward_items.id = $1`,
    [itemId],
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

  const itemResult = await query<{ image_url: string | null }>('select image_url from reward_items where id = $1', [itemId])

  removeManagedRewardImage(itemResult.rows[0]?.image_url)
  await query('delete from reward_items where id = $1', [itemId])

  response.json({ ok: true })
})

rewardsRouter.patch('/rewards/wins/:id/redemption', async (request: AuthenticatedRequest, response) => {
  const winId = String(request.params.id)
  const winAccess = await query<{ survey_id: string }>(
    `select reward_campaigns.survey_id
     from reward_wins
     join reward_campaigns on reward_campaigns.id = reward_wins.campaign_id
     where reward_wins.id = $1
     limit 1`,
    [winId],
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
    [winId, payload.status, payload.redemptionNotes?.trim() || null],
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
