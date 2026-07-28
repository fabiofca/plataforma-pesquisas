import { Router } from 'express'

import { env } from '../config/env.js'
import { pool, query } from '../db/pool.js'
import {
  DEFAULT_NO_PRIZE_LABELS,
  MAX_REAL_REWARDS,
  calculateCampaignMinimumGap,
  calculateMinimumGapSpins,
  createNextReleaseSpin,
  getAvailableRewardItems,
  getFrequencyTarget,
  selectDueRewardItem,
  selectNoPrizeLabel,
  type RewardDrawItem,
} from '../services/reward-draw.js'
import { publicVisitSchema, responseSchema, rewardEligibilitySchema, rewardRetryTaskClickSchema } from '../validators/schemas.js'
import { generateCouponCode, hashValue, makeId, verifySurveyPreviewToken } from '../utils/security.js'

export const publicRouter = Router()

type PublicSurveyRecord = {
  id: string
  title: string
  description: string | null
  participation_mode: string
  brand_name: string
  logo_url: string | null
  primary_color: string
  banner_url: string | null
  closing_message: string | null
  reward_enabled: boolean
  reward_campaign_id: string | null
  reward_campaign_status: 'active' | 'paused' | 'ended' | null
  reward_campaign_expires_at: string | null
  reward_pickup_address: string | null
  reward_contact_whatsapp: string | null
  reward_retry_unlock_enabled: boolean | null
  reward_retry_unlock_tasks_json:
    | Array<{
        id: string
        type: 'google_review' | 'instagram_follow' | 'custom_link'
        title: string
        url: string
      }>
    | null
}

type RewardRetryTask = {
  id: string
  type: 'google_review' | 'instagram_follow' | 'custom_link'
  title: string
  url: string
}

type RewardSessionResult = {
  won: boolean
  item?: string
  landedLabel?: string
  couponCode?: string
  pickupAddress?: string
  contactWhatsApp?: string
  retryAvailable?: boolean
  retryUnlocked?: boolean
  retryTasks?: RewardRetryTask[]
  completedTaskIds?: string[]
  spinAttempt?: number
  maxAttempts?: number
  finalAttempt?: boolean
  message?: string
}

function normalizeRewardRetryTasks(value: PublicSurveyRecord['reward_retry_unlock_tasks_json']): RewardRetryTask[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is RewardRetryTask => {
      return Boolean(
        item &&
          typeof item.id === 'string' &&
          typeof item.type === 'string' &&
          typeof item.title === 'string' &&
          typeof item.url === 'string',
      )
    })
    .slice(0, 2)
}

async function getSurveyBySlug(slug: string) {
  const surveyResult = await query<PublicSurveyRecord>(
    `select
        surveys.id,
        surveys.title,
        surveys.description,
        surveys.participation_mode,
        surveys.brand_name,
        surveys.logo_url,
        surveys.primary_color,
        surveys.banner_url,
        surveys.closing_message,
        surveys.reward_enabled,
        reward_campaigns.id as reward_campaign_id,
        reward_campaigns.status as reward_campaign_status,
        cast(reward_campaigns.expires_at as text) as reward_campaign_expires_at,
        reward_campaigns.pickup_address as reward_pickup_address,
        reward_campaigns.contact_whatsapp as reward_contact_whatsapp,
        reward_campaigns.retry_unlock_enabled as reward_retry_unlock_enabled,
        reward_campaigns.retry_unlock_tasks_json as reward_retry_unlock_tasks_json
     from surveys
     left join reward_campaigns on reward_campaigns.survey_id = surveys.id
     join survey_slugs on survey_slugs.survey_id = surveys.id
     where survey_slugs.slug = $1
       and survey_slugs.is_active = true
       and surveys.status = 'published'`,
    [slug],
  )

  const survey = surveyResult.rows[0]

  if (!survey) {
    return null
  }

  const questions = await query<{
    id: string
    title: string
    description: string | null
    type: string
    is_required: boolean
    position: number
    settings_json: {
      flowRules?: Array<{
        value: string
        nextQuestionId: string
      }>
    }
  }>(
    `select id, title, description, type, is_required, position, settings_json
     from survey_questions
     where survey_id = $1
     order by position asc`,
    [survey.id],
  )

  const options = await query<{ question_id: string; label: string; position: number }>(
    `select question_id, label, position
     from question_options
     where question_id in (select id from survey_questions where survey_id = $1)
     order by position asc`,
    [survey.id],
  )

  const rewardItems =
    survey.reward_enabled && survey.reward_campaign_id
      ? await query<{ id: string; title: string }>(
          `select reward_items.id, reward_items.title
           from reward_items
           where reward_items.campaign_id = $1
             and reward_items.is_active = true
             and reward_items.quantity_total > reward_items.quantity_awarded
           order by reward_items.created_at asc
           limit $2`,
          [survey.reward_campaign_id, MAX_REAL_REWARDS],
        )
      : { rows: [] }

  return {
    ...survey,
    questions: questions.rows.map((question) => ({
      ...question,
      options: options.rows.filter((option) => option.question_id === question.id).map((option) => option.label),
    })),
    reward_items: rewardItems.rows,
    reward_neutral_labels: DEFAULT_NO_PRIZE_LABELS.slice(0, 6),
    reward_retry_unlock_enabled: survey.reward_retry_unlock_enabled ?? false,
    reward_retry_tasks: normalizeRewardRetryTasks(survey.reward_retry_unlock_tasks_json),
  }
}

async function getSurveyPreviewById(surveyId: string) {
  const surveyResult = await query<PublicSurveyRecord & { status: string }>(
    `select
        surveys.id,
        surveys.title,
        surveys.description,
        surveys.status,
        surveys.participation_mode,
        surveys.brand_name,
        surveys.logo_url,
        surveys.primary_color,
        surveys.banner_url,
        surveys.closing_message,
        surveys.reward_enabled,
        reward_campaigns.id as reward_campaign_id,
        reward_campaigns.status as reward_campaign_status,
        cast(reward_campaigns.expires_at as text) as reward_campaign_expires_at,
        reward_campaigns.pickup_address as reward_pickup_address,
        reward_campaigns.contact_whatsapp as reward_contact_whatsapp,
        reward_campaigns.retry_unlock_enabled as reward_retry_unlock_enabled,
        reward_campaigns.retry_unlock_tasks_json as reward_retry_unlock_tasks_json
     from surveys
     left join reward_campaigns on reward_campaigns.survey_id = surveys.id
     where surveys.id = $1`,
    [surveyId],
  )

  const survey = surveyResult.rows[0]

  if (!survey) {
    return null
  }

  const questions = await query<{
    id: string
    title: string
    description: string | null
    type: string
    is_required: boolean
    position: number
    settings_json: {
      flowRules?: Array<{
        value: string
        nextQuestionId: string
      }>
    }
  }>(
    `select id, title, description, type, is_required, position, settings_json
     from survey_questions
     where survey_id = $1
     order by position asc`,
    [survey.id],
  )

  const options = await query<{ question_id: string; label: string; position: number }>(
    `select question_id, label, position
     from question_options
     where question_id in (select id from survey_questions where survey_id = $1)
     order by position asc`,
    [survey.id],
  )

  const rewardItems =
    survey.reward_enabled && survey.reward_campaign_id
      ? await query<{ id: string; title: string }>(
          `select reward_items.id, reward_items.title
           from reward_items
           where reward_items.campaign_id = $1
             and reward_items.is_active = true
             and reward_items.quantity_total > reward_items.quantity_awarded
           order by reward_items.created_at asc
           limit $2`,
          [survey.reward_campaign_id, MAX_REAL_REWARDS],
        )
      : { rows: [] }

  return {
    ...survey,
    questions: questions.rows.map((question) => ({
      ...question,
      options: options.rows.filter((option) => option.question_id === question.id).map((option) => option.label),
    })),
    reward_items: rewardItems.rows,
    reward_neutral_labels: DEFAULT_NO_PRIZE_LABELS.slice(0, 6),
    reward_retry_unlock_enabled: survey.reward_retry_unlock_enabled ?? false,
    reward_retry_tasks: normalizeRewardRetryTasks(survey.reward_retry_unlock_tasks_json),
  }
}

function isRewardCampaignAvailable(survey: Awaited<ReturnType<typeof getSurveyBySlug>>) {
  if (!survey?.reward_enabled || !survey.reward_campaign_id) {
    return false
  }

  if (survey.reward_campaign_status !== 'active') {
    return false
  }

  if (!survey.reward_campaign_expires_at) {
    return true
  }

  return survey.reward_campaign_expires_at >= new Date().toISOString().slice(0, 10)
}

function buildRewardSubmitMessage(
  survey: Awaited<ReturnType<typeof getSurveyBySlug>>,
  rewardEligible: boolean,
) {
  if (!survey?.reward_enabled || rewardEligible) {
    return null
  }

  return isRewardCampaignAvailable(survey)
    ? 'Este cliente já participou desta campanha com o mesmo WhatsApp ou e-mail. A resposta foi registrada normalmente, mas a roleta não gira novamente.'
    : 'A campanha de prêmios está pausada, encerrada ou indisponível no momento. Sua resposta foi registrada normalmente.'
}

async function countExistingRewardParticipants(input: {
  surveyId: string
  phone: string
  email?: string
}) {
  const conditions = ['participant_phone = $2']
  const values: Array<string | null> = [input.surveyId, input.phone]
  let index = 3

  if (input.email) {
    conditions.push(`participant_email = $${index}`)
    values.push(input.email)
    index += 1
  }

  const result = await query<{ count: string }>(
    `select cast(count(*) as text) as count
     from survey_responses
     where survey_id = $1
       and (${conditions.join(' or ')})`,
    values,
  )

  return Number(result.rows[0]?.count ?? 0)
}

function normalizeExistingItemSchedule(item: RewardDrawItem, currentSpin: number) {
  const target = getFrequencyTarget(item.frequency_mode, item.frequency_target)

  return {
    ...item,
    frequency_target: target,
    min_gap_spins: item.min_gap_spins > 0 ? item.min_gap_spins : calculateMinimumGapSpins(target),
    next_release_spin:
      item.next_release_spin > 0 ? item.next_release_spin : createNextReleaseSpin(currentSpin, target),
  }
}

async function getCompletedRetryTaskIds(
  client: Pick<typeof pool, 'query'>,
  responseId: string,
  campaignId: string,
) {
  const clicks = await client.query<{ task_id: string }>(
    `select task_id
     from reward_retry_task_clicks
     where response_id = $1 and campaign_id = $2`,
    [responseId, campaignId],
  )

  return clicks.rows.map((row) => row.task_id)
}

async function getRewardSessionState(
  client: Pick<typeof pool, 'query'>,
  survey: NonNullable<Awaited<ReturnType<typeof getSurveyBySlug>>>,
  responseId: string,
) {
  const retryTasks = survey.reward_retry_unlock_enabled ? survey.reward_retry_tasks ?? [] : []
  const surveyResponseResult = await client.query<{
    id: string
    participant_name: string | null
    participant_phone: string | null
    reward_eligible: boolean
    reward_spin_completed: boolean
    reward_retry_count: number
    reward_retry_unlock_pending: boolean
    reward_retry_unlocked_at: string | null
  }>(
    `select
        id,
        participant_name,
        participant_phone,
        reward_eligible,
        reward_spin_completed,
        reward_retry_count,
        reward_retry_unlock_pending,
        cast(reward_retry_unlocked_at as text) as reward_retry_unlocked_at
     from survey_responses
     where id = $1 and survey_id = $2
     limit 1`,
    [responseId, survey.id],
  )

  const surveyResponse = surveyResponseResult.rows[0]

  if (!surveyResponse) {
    return null
  }

  const spinLogsResult = await client.query<{
    spin_attempt: number
    outcome_type: 'win' | 'no_prize'
    wheel_label: string
    coupon_code: string | null
    item_title: string | null
    pickup_address: string | null
    contact_whatsapp: string | null
  }>(
    `select
        reward_spin_logs.spin_attempt,
        reward_spin_logs.outcome_type,
        reward_spin_logs.wheel_label,
        reward_wins.coupon_code,
        reward_items.title as item_title,
        reward_campaigns.pickup_address,
        reward_campaigns.contact_whatsapp
     from reward_spin_logs
     left join reward_wins on reward_wins.response_id = reward_spin_logs.response_id
     left join reward_items on reward_items.id = reward_spin_logs.reward_item_id
     left join reward_campaigns on reward_campaigns.id = reward_spin_logs.campaign_id
     where reward_spin_logs.response_id = $1
     order by reward_spin_logs.spin_attempt desc`,
    [responseId],
  )

  const latestSpin = spinLogsResult.rows[0]
  const attemptsMade = spinLogsResult.rows.length
  const maxAttempts = 1 + retryTasks.length
  const completedTaskIds =
    survey.reward_campaign_id && retryTasks.length > 0
      ? await getCompletedRetryTaskIds(client, responseId, survey.reward_campaign_id)
      : []
  const nextPendingTask = retryTasks.find((task) => !completedTaskIds.includes(task.id))
  const retryUnlocked = Boolean(
    surveyResponse.reward_retry_unlock_pending &&
      surveyResponse.reward_retry_unlocked_at &&
      completedTaskIds.length > surveyResponse.reward_retry_count,
  )

  const canSpinReward = latestSpin
    ? latestSpin.outcome_type !== 'win' && retryUnlocked
    : Boolean(surveyResponse.reward_eligible && !surveyResponse.reward_spin_completed)

  let rewardResult: RewardSessionResult | null = null

  if (latestSpin?.outcome_type === 'win') {
    rewardResult = {
      won: true,
      item: latestSpin.item_title ?? undefined,
      landedLabel: latestSpin.wheel_label,
      couponCode: latestSpin.coupon_code ?? undefined,
      pickupAddress: latestSpin.pickup_address ?? undefined,
      contactWhatsApp: latestSpin.contact_whatsapp ?? undefined,
      retryAvailable: false,
      retryUnlocked: false,
      retryTasks,
      completedTaskIds,
      spinAttempt: latestSpin.spin_attempt,
      maxAttempts,
      finalAttempt: true,
      message: 'Este resultado já foi registrado anteriormente.',
    }
  } else if (latestSpin) {
    const finalAttempt = latestSpin.spin_attempt >= maxAttempts

    if (surveyResponse.reward_retry_unlock_pending && nextPendingTask) {
      rewardResult = {
        won: false,
        landedLabel: latestSpin.wheel_label,
        retryAvailable: true,
        retryUnlocked,
        retryTasks,
        completedTaskIds,
        spinAttempt: latestSpin.spin_attempt,
        maxAttempts,
        finalAttempt,
        message: retryUnlocked
          ? 'A tarefa foi registrada. Sua próxima chance já está liberada.'
          : 'Conclua a próxima tarefa para liberar um novo giro.',
      }
    } else {
      rewardResult = {
        won: false,
        landedLabel: latestSpin.wheel_label,
        pickupAddress: latestSpin.pickup_address ?? undefined,
        contactWhatsApp: latestSpin.contact_whatsapp ?? undefined,
        retryAvailable: false,
        retryUnlocked: false,
        retryTasks,
        completedTaskIds,
        spinAttempt: latestSpin.spin_attempt,
        maxAttempts,
        finalAttempt,
        message:
          finalAttempt || surveyResponse.reward_spin_completed
            ? maxAttempts > 1
              ? 'As chances desta participação já foram usadas.'
              : 'Não houve prêmio disponível nesta tentativa.'
            : 'A roleta já foi utilizada nesta participação.',
      }
    }
  }

  return {
    responseId,
    participantName: surveyResponse.participant_name ?? '',
    participantPhone: surveyResponse.participant_phone ?? '',
    submitMessage: buildRewardSubmitMessage(survey, surveyResponse.reward_eligible),
    canSpinReward,
    completedTaskIds,
    rewardResult,
  }
}

publicRouter.get('/surveys/:slug', async (request, response) => {
  const survey = await getSurveyBySlug(request.params.slug)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa pública não encontrada.' })
    return
  }

  response.json({ survey })
})

publicRouter.get('/preview/:token', async (request, response) => {
  let surveyId = ''

  try {
    surveyId = verifySurveyPreviewToken(String(request.params.token ?? '')).surveyId
  } catch {
    response.status(404).json({ message: 'Link de teste inválido ou expirado.' })
    return
  }

  const survey = await getSurveyPreviewById(surveyId)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa de teste não encontrada.' })
    return
  }

  if (survey.status !== 'draft') {
    response.status(410).json({ message: 'Este link de teste expirou porque a pesquisa já não está mais em rascunho.' })
    return
  }

  response.json({ survey })
})

publicRouter.post('/surveys/:slug/visit', async (request, response) => {
  const payload = publicVisitSchema.parse(request.body)
  const survey = await getSurveyBySlug(request.params.slug)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa pública não encontrada.' })
    return
  }

  await query(
    `insert into survey_share_visits (id, survey_id, source, source_ip_hash, user_agent, referer)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      makeId(),
      survey.id,
      payload.source,
      request.ip ? hashValue(request.ip) : null,
      request.headers['user-agent'] ?? null,
      request.headers.referer ?? null,
    ],
  )

  response.status(201).json({ ok: true })
})

publicRouter.post('/surveys/:slug/eligibility', async (request, response) => {
  const payload = rewardEligibilitySchema.parse(request.body)
  const survey = await getSurveyBySlug(request.params.slug)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa não encontrada.' })
    return
  }

  const duplicateCount = await countExistingRewardParticipants({
    surveyId: survey.id,
    phone: payload.participant.phone,
    email: payload.participant.email,
  })

  response.json({
    eligible: duplicateCount === 0,
  })
})

publicRouter.post('/surveys/:slug/respond', async (request, response) => {
  const payload = responseSchema.parse(request.body)
  const survey = await getSurveyBySlug(request.params.slug)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa pública não encontrada.' })
    return
  }

  const sourceIp = request.ip ? hashValue(request.ip) : null
  const previousResponsesCount = await countExistingRewardParticipants({
    surveyId: survey.id,
    phone: payload.participant.phone,
    email: payload.participant.email,
  })
  const rewardEligible = isRewardCampaignAvailable(survey) && previousResponsesCount === 0

  const responseId = makeId()

  await query(
    `insert into survey_responses (
      id, survey_id, participant_name, participant_email, participant_phone, participant_birth_day, participant_birth_month,
      source_ip_hash, browser_fingerprint, browser_cookie_id, reward_eligible
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      responseId,
      survey.id,
      payload.participant.name,
      payload.participant.email ?? null,
      payload.participant.phone,
      payload.participant.birthDay,
      payload.participant.birthMonth,
      sourceIp,
      payload.fingerprint ?? null,
      payload.browserCookieId ?? null,
      rewardEligible,
    ],
  )

  for (const answer of payload.answers) {
    await query(
      `insert into response_answers (id, response_id, question_id, answer_text, answer_json)
       values ($1, $2, $3, $4, $5)`,
      [
        makeId(),
        responseId,
        answer.questionId,
        typeof answer.value === 'string' ? answer.value : null,
        typeof answer.value === 'string' ? JSON.stringify({ value: answer.value }) : JSON.stringify(answer.value),
      ],
    )
  }

  response.status(201).json({
    responseId,
    rewardEnabled: survey.reward_enabled,
    rewardEligible,
    rewardMessage: buildRewardSubmitMessage(survey, rewardEligible),
  })
})

publicRouter.get('/surveys/:slug/reward-session', async (request, response) => {
  const survey = await getSurveyBySlug(request.params.slug)
  const responseId = String(request.query.responseId ?? '').trim()

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa pública não encontrada.' })
    return
  }

  if (!responseId) {
    response.status(400).json({ message: 'Informe a participação para recuperar a roleta.' })
    return
  }

  const client = await pool.connect()

  try {
    const sessionState = await getRewardSessionState(client, survey, responseId)

    if (!sessionState) {
      response.status(404).json({ message: 'Participação não encontrada para esta pesquisa.' })
      return
    }

    response.json(sessionState)
  } finally {
    client.release()
  }
})

publicRouter.post('/surveys/:slug/retry-task-click', async (request, response) => {
  const payload = rewardRetryTaskClickSchema.parse(request.body)
  const survey = await getSurveyBySlug(request.params.slug)

  if (!survey || !survey.reward_enabled || !survey.reward_campaign_id) {
    response.status(404).json({ message: 'Campanha de prêmios não encontrada.' })
    return
  }

  const retryTasks = survey.reward_retry_unlock_enabled ? survey.reward_retry_tasks ?? [] : []
  const targetTask = retryTasks.find((task) => task.id === payload.taskId)

  if (!targetTask) {
    response.status(404).json({ message: 'Tarefa de desbloqueio não encontrada.' })
    return
  }

  const client = await pool.connect()

  try {
    await client.query('begin')

    const surveyResponseResult = await client.query<{
      id: string
      reward_retry_unlock_pending: boolean
      reward_retry_count: number
      reward_retry_unlocked_at: string | null
    }>(
      `select
          id,
          reward_retry_unlock_pending,
          reward_retry_count,
          cast(reward_retry_unlocked_at as text) as reward_retry_unlocked_at
       from survey_responses
       where id = $1 and survey_id = $2
       limit 1
       for update`,
      [payload.responseId, survey.id],
    )

    const surveyResponse = surveyResponseResult.rows[0]

    if (!surveyResponse) {
      await client.query('rollback')
      response.status(404).json({ message: 'Participação não encontrada.' })
      return
    }

    if (!surveyResponse.reward_retry_unlock_pending) {
      await client.query('rollback')
      response.status(409).json({ message: 'Esta participação não está aguardando desbloqueio para mais um giro.' })
      return
    }

    const completedTaskIdsBeforeInsert = await getCompletedRetryTaskIds(client, payload.responseId, survey.reward_campaign_id)
    const nextTask = retryTasks.find((task) => !completedTaskIdsBeforeInsert.includes(task.id))

    if (!nextTask || nextTask.id !== payload.taskId) {
      await client.query('rollback')
      response.status(409).json({ message: 'Conclua a próxima tarefa disponível para liberar um novo giro.' })
      return
    }

    await client.query(
      `insert into reward_retry_task_clicks (id, response_id, campaign_id, task_id)
       values ($1, $2, $3, $4)
       on conflict (response_id, task_id) do nothing`,
      [makeId(), payload.responseId, survey.reward_campaign_id, payload.taskId],
    )

    const completedTaskIds = await getCompletedRetryTaskIds(client, payload.responseId, survey.reward_campaign_id)
    const unlocked = completedTaskIds.length > surveyResponse.reward_retry_count

    if (unlocked && !surveyResponse.reward_retry_unlocked_at) {
      await client.query(
        `update survey_responses
         set reward_retry_unlocked_at = now()
         where id = $1`,
        [payload.responseId],
      )
    }

    await client.query('commit')

    response.json({
      ok: true,
      unlocked,
      completedTaskIds,
      remainingTasks: Math.max(0, retryTasks.length - completedTaskIds.length),
    })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
})

publicRouter.post('/surveys/:slug/spin', async (request, response) => {
  const survey = await getSurveyBySlug(request.params.slug)

  if (!survey || !survey.reward_enabled || !survey.reward_campaign_id) {
    response.status(404).json({ message: 'Campanha de prêmios não encontrada.' })
    return
  }

  if (!isRewardCampaignAvailable(survey)) {
    response.status(400).json({ message: 'A campanha de prêmios está pausada, encerrada ou indisponível.' })
    return
  }

  const responseId = String(request.body.responseId ?? '')
  const retryTasks = survey.reward_retry_unlock_enabled ? survey.reward_retry_tasks ?? [] : []
  const client = await pool.connect()

  try {
    await client.query('begin')

    const surveyResponseResult = await client.query<{
      id: string
      reward_eligible: boolean
      reward_spin_completed: boolean
      reward_retry_count: number
      reward_retry_unlock_pending: boolean
      reward_retry_unlocked_at: string | null
    }>(
      `select
          id,
          reward_eligible,
          reward_spin_completed,
          reward_retry_count,
          reward_retry_unlock_pending,
          cast(reward_retry_unlocked_at as text) as reward_retry_unlocked_at
       from survey_responses
       where id = $1 and survey_id = $2
       limit 1
       for update`,
      [responseId, survey.id],
    )

    const surveyResponse = surveyResponseResult.rows[0]

    if (!surveyResponse) {
      await client.query('rollback')
      response.status(404).json({ message: 'Resposta não encontrada para esta pesquisa.' })
      return
    }

    const existingSpinLogs = await client.query<{
      spin_attempt: number
      outcome_type: 'win' | 'no_prize'
      wheel_label: string
      coupon_code: string | null
      item_title: string | null
      pickup_address: string | null
      contact_whatsapp: string | null
    }>(
      `select
          reward_spin_logs.spin_attempt,
          reward_spin_logs.outcome_type,
          reward_spin_logs.wheel_label,
          reward_wins.coupon_code,
          reward_items.title as item_title,
          reward_campaigns.pickup_address,
          reward_campaigns.contact_whatsapp
       from reward_spin_logs
       left join reward_wins on reward_wins.response_id = reward_spin_logs.response_id
       left join reward_items on reward_items.id = reward_spin_logs.reward_item_id
       left join reward_campaigns on reward_campaigns.id = reward_spin_logs.campaign_id
       where reward_spin_logs.response_id = $1
       order by reward_spin_logs.spin_attempt desc`,
      [responseId],
    )

    const latestSpin = existingSpinLogs.rows[0]
    const attemptsMade = existingSpinLogs.rows.length
    const currentAttempt = attemptsMade + 1
    const completedTaskIds =
      survey.reward_campaign_id && retryTasks.length > 0
        ? await getCompletedRetryTaskIds(client, responseId, survey.reward_campaign_id)
        : []
    const nextPendingTask = retryTasks.find((task) => !completedTaskIds.includes(task.id))
    const maxAttempts = 1 + retryTasks.length
    const isFinalAttempt = currentAttempt >= maxAttempts

    if (attemptsMade >= maxAttempts) {
      await client.query('commit')
      response.json({
        won: latestSpin?.outcome_type === 'win',
        item: latestSpin?.item_title ?? undefined,
        landedLabel: latestSpin?.wheel_label,
        couponCode: latestSpin?.coupon_code ?? undefined,
        pickupAddress: latestSpin?.pickup_address ?? undefined,
        contactWhatsApp: latestSpin?.contact_whatsapp ?? undefined,
        spinAttempt: latestSpin?.spin_attempt ?? maxAttempts,
        maxAttempts,
        finalAttempt: true,
        message:
          latestSpin?.outcome_type === 'win'
            ? 'Este resultado já foi registrado anteriormente.'
            : `A participação já utilizou as chances disponíveis e a última roleta parou em "${latestSpin?.wheel_label}".`,
      })
      return
    }

    if (latestSpin?.outcome_type === 'win') {
      await client.query('commit')
      response.json({
        won: true,
        item: latestSpin.item_title ?? undefined,
        landedLabel: latestSpin.wheel_label,
        couponCode: latestSpin.coupon_code ?? undefined,
        pickupAddress: latestSpin.pickup_address ?? undefined,
        contactWhatsApp: latestSpin.contact_whatsapp ?? undefined,
        spinAttempt: latestSpin.spin_attempt,
        maxAttempts,
        finalAttempt: true,
        message: 'Este resultado já foi registrado anteriormente.',
      })
      return
    }

    if (attemptsMade >= 1 && latestSpin) {
      if (surveyResponse.reward_retry_unlock_pending) {
        if (!surveyResponse.reward_retry_unlocked_at && nextPendingTask) {
          await client.query('commit')
          response.json({
            won: false,
            landedLabel: latestSpin.wheel_label,
            message: 'Conclua a próxima tarefa para liberar um novo giro.',
            retryAvailable: true,
            retryUnlocked: false,
            retryTasks,
            completedTaskIds,
            spinAttempt: latestSpin.spin_attempt,
            maxAttempts,
            finalAttempt: false,
          })
          return
        }
      } else {
        await client.query('commit')
        response.json({
          won: false,
          landedLabel: latestSpin.wheel_label,
          pickupAddress: latestSpin.pickup_address ?? undefined,
          contactWhatsApp: latestSpin.contact_whatsapp ?? undefined,
          spinAttempt: latestSpin.spin_attempt,
          maxAttempts,
          finalAttempt: latestSpin.spin_attempt >= maxAttempts,
          message: `A roleta já foi utilizada nesta participação e parou em "${latestSpin.wheel_label}".`,
        })
        return
      }
    }

    if (currentAttempt === 1 && surveyResponse.reward_spin_completed) {
      await client.query('commit')
      response.status(409).json({ message: 'Esta participação já utilizou a roleta.' })
      return
    }

    if (currentAttempt === 1 && !surveyResponse.reward_eligible) {
      await client.query('commit')
      response.status(409).json({
        message: 'Este cliente já participou desta campanha com o mesmo WhatsApp ou e-mail. A resposta foi salva, mas a roleta não pode ser usada novamente.',
      })
      return
    }

    if (
      currentAttempt > 1 &&
      (!surveyResponse.reward_retry_unlock_pending ||
        !surveyResponse.reward_retry_unlocked_at ||
        surveyResponse.reward_retry_count >= completedTaskIds.length)
    ) {
      await client.query('commit')
      response.status(409).json({ message: 'A chance extra ainda não está liberada para esta participação.' })
      return
    }

    if (!isFinalAttempt) {
      const noPrizeLabel = selectNoPrizeLabel()

      await client.query(
        `insert into reward_spin_logs (id, campaign_id, response_id, reward_item_id, outcome_type, wheel_label, spin_attempt)
         values ($1, $2, $3, null, 'no_prize', $4, $5)`,
        [makeId(), survey.reward_campaign_id, responseId, noPrizeLabel, currentAttempt],
      )

      await client.query(
        `update survey_responses
         set reward_eligible = false,
             reward_spin_completed = false,
             reward_spin_item_id = null,
             reward_retry_unlock_pending = $2,
             reward_retry_unlocked_at = null,
             reward_retry_count = $3
         where id = $1`,
        [responseId, Boolean(nextPendingTask), currentAttempt - 1],
      )

      await client.query('commit')
      response.json({
        won: false,
        landedLabel: noPrizeLabel,
        retryAvailable: Boolean(nextPendingTask),
        retryUnlocked: false,
        retryTasks,
        completedTaskIds,
        spinAttempt: currentAttempt,
        maxAttempts,
        finalAttempt: false,
        message: nextPendingTask
          ? `${noPrizeLabel} Conclua a próxima tarefa para liberar outro giro.`
          : `${noPrizeLabel} Continue participando para liberar outra chance.`,
      })
      return
    }

    const campaignResult = await client.query<{
      id: string
      status: 'active' | 'paused' | 'ended'
      expires_at: string | null
      retry_unlock_enabled: boolean
      retry_unlock_tasks_json: RewardRetryTask[] | null
      spin_count: number
      last_winning_spin: number
    }>(
      `select
          id,
          status,
          cast(expires_at as text) as expires_at,
          retry_unlock_enabled,
          retry_unlock_tasks_json,
          spin_count,
          last_winning_spin
       from reward_campaigns
       where id = $1
       limit 1
       for update`,
      [survey.reward_campaign_id],
    )

    const campaign = campaignResult.rows[0]

    if (!campaign || campaign.status !== 'active' || (campaign.expires_at && campaign.expires_at < new Date().toISOString().slice(0, 10))) {
      await client.query('rollback')
      response.status(400).json({ message: 'A campanha de prêmios está pausada, encerrada ou indisponível.' })
      return
    }

    const itemsResult = await client.query<RewardDrawItem>(
      `select
          id,
          title,
          quantity_total,
          quantity_awarded,
          is_active,
          frequency_mode,
          frequency_target,
          next_release_spin,
          last_awarded_spin,
          min_gap_spins
       from reward_items
       where campaign_id = $1
       order by created_at asc
       for update`,
      [campaign.id],
    )

    const normalizedItems = itemsResult.rows.map((item) => normalizeExistingItemSchedule(item, campaign.spin_count))

    for (const item of normalizedItems) {
      const original = itemsResult.rows.find((entry) => entry.id === item.id)

      if (!original || (original.next_release_spin === item.next_release_spin && original.min_gap_spins === item.min_gap_spins && original.frequency_target === item.frequency_target)) {
        continue
      }

      await client.query(
        `update reward_items
         set frequency_target = $2,
             next_release_spin = $3,
             min_gap_spins = $4
         where id = $1`,
        [item.id, item.frequency_target, item.next_release_spin, item.min_gap_spins],
      )
    }

    const activeTargets = getAvailableRewardItems(normalizedItems).map((item) => item.frequency_target)
    const currentSpin = campaign.spin_count + 1
    const canReleasePrize = currentSpin - campaign.last_winning_spin >= calculateCampaignMinimumGap(activeTargets)
    const selectedItem = canReleasePrize ? selectDueRewardItem(normalizedItems, currentSpin) : null

    await client.query(
      `update reward_campaigns
       set spin_count = $2,
           updated_at = now()
       where id = $1`,
      [campaign.id, currentSpin],
    )

    if (!selectedItem) {
      const noPrizeLabel = selectNoPrizeLabel()
      const retryEnabledForLoss = Boolean(nextPendingTask)
      const nextRetryCount = currentAttempt > 1 ? surveyResponse.reward_retry_count + 1 : surveyResponse.reward_retry_count

      await client.query(
        `insert into reward_spin_logs (id, campaign_id, response_id, reward_item_id, outcome_type, wheel_label, spin_attempt)
         values ($1, $2, $3, null, 'no_prize', $4, $5)`,
        [makeId(), campaign.id, responseId, noPrizeLabel, currentAttempt],
      )

      if (retryEnabledForLoss) {
        await client.query(
          `update survey_responses
           set reward_eligible = false,
               reward_spin_completed = false,
               reward_spin_item_id = null,
               reward_retry_unlock_pending = true,
               reward_retry_unlocked_at = null,
               reward_retry_count = $2
           where id = $1`,
          [responseId, nextRetryCount],
        )

        await client.query('commit')
        response.json({
          won: false,
          landedLabel: noPrizeLabel,
          spinAttempt: currentAttempt,
          maxAttempts,
          finalAttempt: true,
          message: `${noPrizeLabel} Conclua a próxima tarefa para liberar um novo giro.`,
          retryAvailable: true,
          retryUnlocked: false,
          retryTasks,
          completedTaskIds,
        })
        return
      }

      await client.query(
        `update survey_responses
         set reward_eligible = false,
             reward_spin_completed = true,
             reward_spin_item_id = null,
             reward_retry_unlock_pending = false,
             reward_retry_count = $2
         where id = $1`,
        [responseId, nextRetryCount],
      )

      await client.query('commit')
      response.json({
        won: false,
        landedLabel: noPrizeLabel,
        spinAttempt: currentAttempt,
        maxAttempts,
        finalAttempt: true,
        message:
          maxAttempts > 1
            ? `${noPrizeLabel} As chances desta participação já foram usadas.`
            : `${noPrizeLabel} Não houve prêmio disponível nesta tentativa.`,
      })
      return
    }

    const frequencyTarget = getFrequencyTarget(selectedItem.frequency_mode, selectedItem.frequency_target)
    const itemUpdateResult = await client.query<{ id: string }>(
      `update reward_items
       set quantity_awarded = quantity_awarded + 1,
           last_awarded_spin = $2,
           next_release_spin = $3,
           min_gap_spins = $4
       where id = $1
         and quantity_awarded < quantity_total
       returning id`,
      [
        selectedItem.id,
        currentSpin,
        createNextReleaseSpin(currentSpin, frequencyTarget),
        calculateMinimumGapSpins(frequencyTarget),
      ],
    )

    if (!itemUpdateResult.rows[0]) {
      const noPrizeLabel = selectNoPrizeLabel()
      const retryEnabledForLoss = Boolean(nextPendingTask)
      const nextRetryCount = currentAttempt > 1 ? surveyResponse.reward_retry_count + 1 : surveyResponse.reward_retry_count

      await client.query(
        `insert into reward_spin_logs (id, campaign_id, response_id, reward_item_id, outcome_type, wheel_label, spin_attempt)
         values ($1, $2, $3, null, 'no_prize', $4, $5)`,
        [makeId(), campaign.id, responseId, noPrizeLabel, currentAttempt],
      )

      if (retryEnabledForLoss) {
        await client.query(
          `update survey_responses
           set reward_eligible = false,
               reward_spin_completed = false,
               reward_spin_item_id = null,
               reward_retry_unlock_pending = true,
               reward_retry_unlocked_at = null,
               reward_retry_count = $2
           where id = $1`,
          [responseId, nextRetryCount],
        )

        await client.query('commit')
        response.json({
          won: false,
          landedLabel: noPrizeLabel,
          spinAttempt: currentAttempt,
          maxAttempts,
          finalAttempt: true,
          message: `${noPrizeLabel} Conclua a próxima tarefa para liberar um novo giro.`,
          retryAvailable: true,
          retryUnlocked: false,
          retryTasks,
          completedTaskIds,
        })
        return
      }

      await client.query(
        `update survey_responses
         set reward_eligible = false,
             reward_spin_completed = true,
             reward_spin_item_id = null,
             reward_retry_unlock_pending = false,
             reward_retry_count = $2
         where id = $1`,
        [responseId, nextRetryCount],
      )

      await client.query('commit')
      response.json({
        won: false,
        landedLabel: noPrizeLabel,
        spinAttempt: currentAttempt,
        maxAttempts,
        finalAttempt: true,
        message:
          maxAttempts > 1
            ? `${noPrizeLabel} As chances desta participação já foram usadas.`
            : `${noPrizeLabel} Nenhum prêmio ficou disponível neste giro.`,
      })
      return
    }

    const couponCode = generateCouponCode(env.rewardCodePrefix)

    await client.query(
      `update reward_campaigns
       set last_winning_spin = $2,
           updated_at = now()
       where id = $1`,
      [campaign.id, currentSpin],
    )
    await client.query(
      `insert into reward_wins (id, campaign_id, reward_item_id, response_id, coupon_code)
       values ($1, $2, $3, $4, $5)`,
      [makeId(), campaign.id, selectedItem.id, responseId, couponCode],
    )
    await client.query(
      `insert into reward_spin_logs (id, campaign_id, response_id, reward_item_id, outcome_type, wheel_label, spin_attempt)
       values ($1, $2, $3, $4, 'win', $5, $6)`,
      [makeId(), campaign.id, responseId, selectedItem.id, selectedItem.title, currentAttempt],
    )
    await client.query(
      `update survey_responses
       set reward_eligible = false,
           reward_spin_completed = true,
           reward_spin_item_id = $2,
           reward_retry_unlock_pending = false,
           reward_retry_count = $3
       where id = $1`,
      [responseId, selectedItem.id, currentAttempt > 1 ? surveyResponse.reward_retry_count + 1 : surveyResponse.reward_retry_count],
    )

    await client.query('commit')

    response.json({
      won: true,
      item: selectedItem.title,
      landedLabel: selectedItem.title,
      couponCode,
      pickupAddress: survey.reward_pickup_address ?? undefined,
      contactWhatsApp: survey.reward_contact_whatsapp ?? undefined,
      spinAttempt: currentAttempt,
      maxAttempts,
      finalAttempt: true,
      message: survey.reward_pickup_address
        ? 'Parabéns! O resultado foi definido com segurança no servidor e o local de retirada já está indicado abaixo.'
        : 'Parabéns! O resultado foi definido com segurança no servidor e registrado nesta campanha.',
    })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
})
