import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import multer, { type FileFilterCallback } from 'multer'
import QRCode from 'qrcode'
import { Router, type Request } from 'express'
import { z } from 'zod'

import { env } from '../config/env.js'
import { query, pool } from '../db/pool.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { ensureFeatureAccess, hasFeatureAccess } from '../services/feature-access.js'
import { ensureSurveyAccess } from '../services/survey-access.js'
import { surveySchema } from '../validators/schemas.js'
import { makeId, signSurveyPreviewToken } from '../utils/security.js'

export const surveysRouter = Router()
const SURVEY_PREVIEW_REWARD_LIMIT = 3
const FLOW_ON_ANSWER = '__answer__'

const surveyUploadKeys = new Set(['logo', 'banner'])
const surveyUploadDir = path.resolve(process.cwd(), 'uploads', 'surveys')

mkdirSync(surveyUploadDir, { recursive: true })

const surveyUpload = multer({
  storage: multer.diskStorage({
    destination: (_request: Request, _file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
      callback(null, surveyUploadDir)
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
      callback(new Error('Envie um arquivo PNG, JPG, SVG ou WEBP.'))
      return
    }

    callback(null, true)
  },
})

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function buildPublicSurveyUrl(slug: string) {
  return new URL(`/${slug}?src=qr`, env.frontendUrl).toString()
}

function removeManagedSurveyFile(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/uploads/surveys/')) {
    return
  }

  const fileName = path.basename(value)
  const filePath = path.join(surveyUploadDir, fileName)
  rmSync(filePath, { force: true })
}

type RewardRetryTask = {
  id: string
  type: 'google_review' | 'instagram_follow' | 'custom_link'
  title: string
  url: string
}

function normalizeRewardRetryTasks(value: unknown): RewardRetryTask[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is RewardRetryTask =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.type === 'string' &&
            typeof item.title === 'string' &&
            typeof item.url === 'string',
        ),
    )
    .slice(0, 5)
}

async function loadSurveyQuestions(surveyId: string) {
  const questionsResult = await query<{
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
      businessMetric?: string | null
      linkedQuestionId?: string | null
    }
  }>(
    `select id, title, description, type, is_required, position, settings_json
     from survey_questions
     where survey_id = $1
     order by position asc`,
    [surveyId],
  )

  const optionsResult = await query<{
    question_id: string
    label: string
    position: number
  }>(
    `select question_id, label, position
     from question_options
     where question_id in (
       select id from survey_questions where survey_id = $1
     )
     order by position asc`,
    [surveyId],
  )

  return questionsResult.rows.map((question) => ({
    ...question,
    options: optionsResult.rows.filter((option) => option.question_id === question.id).map((option) => option.label),
    businessMetric: question.settings_json?.businessMetric ?? null,
    linkedQuestionId: question.settings_json?.linkedQuestionId ?? null,
  }))
}

async function loadSurveyPreview(surveyId: string) {
  const surveyResult = await query<{
    id: string
    title: string
    description: string | null
    status: string
    participation_mode: string
    brand_name: string
    logo_url: string | null
    primary_color: string
    banner_url: string | null
    closing_message: string | null
    reward_enabled: boolean
    reward_campaign_id: string | null
    reward_wheel_mode: 'standard' | 'advanced' | null
    reward_final_spin_mode: 'allow_no_prize' | 'guaranteed_prize' | null
    reward_pickup_address: string | null
    reward_contact_whatsapp: string | null
    reward_redemption_method: 'address_only' | 'address_and_whatsapp' | null
    reward_redemption_expiration_days: number | null
    reward_retry_unlock_enabled: boolean | null
    reward_retry_unlock_tasks_json:
      | Array<{
          id: string
          type: 'google_review' | 'instagram_follow' | 'custom_link'
          title: string
          url: string
        }>
      | null
  }>(
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
        reward_campaigns.wheel_mode as reward_wheel_mode,
        reward_campaigns.final_spin_mode as reward_final_spin_mode,
        reward_campaigns.pickup_address as reward_pickup_address,
        reward_campaigns.contact_whatsapp as reward_contact_whatsapp,
        reward_campaigns.redemption_method as reward_redemption_method,
        reward_campaigns.redemption_expiration_days as reward_redemption_expiration_days,
        reward_campaigns.retry_unlock_enabled as reward_retry_unlock_enabled,
        reward_campaigns.retry_unlock_tasks_json as reward_retry_unlock_tasks_json
     from surveys
     left join reward_campaigns on reward_campaigns.survey_id = surveys.id
     where surveys.id = $1
     limit 1`,
    [surveyId],
  )

  const survey = surveyResult.rows[0]

  if (!survey) {
    return null
  }

  const rewardItems =
    survey.reward_enabled && survey.reward_campaign_id
      ? await query<{
          id: string
          title: string
          wheel_label: string | null
          image_url: string | null
          outcome_role: 'prize' | 'no_prize' | 'showcase'
          show_on_wheel: boolean
          sort_order: number
          quantity_total: number
          quantity_awarded: number
        }>(
          `select
              reward_items.id,
              reward_items.title,
              reward_items.wheel_label,
              reward_items.image_url,
              reward_items.outcome_role,
              reward_items.show_on_wheel,
              reward_items.sort_order,
              reward_items.quantity_total,
              reward_items.quantity_awarded
           from reward_items
           where reward_items.campaign_id = $1
             and reward_items.is_active = true
             and ${survey.reward_wheel_mode === 'advanced' ? 'reward_items.show_on_wheel = true' : 'reward_items.quantity_total > reward_items.quantity_awarded'}
           order by reward_items.sort_order asc, reward_items.created_at asc
           limit $2`,
          [survey.reward_campaign_id, survey.reward_wheel_mode === 'advanced' ? 12 : SURVEY_PREVIEW_REWARD_LIMIT],
        )
      : { rows: [] }

  return {
    ...survey,
    questions: await loadSurveyQuestions(survey.id),
    reward_items: rewardItems.rows,
    reward_retry_unlock_enabled: survey.reward_retry_unlock_enabled ?? false,
    reward_retry_tasks: normalizeRewardRetryTasks(survey.reward_retry_unlock_tasks_json),
  }
}

type SurveyQuestionPayload = z.infer<typeof surveySchema>['questions'][number]

function buildQuestionSettings(question: SurveyQuestionPayload) {
  return {
    flowRules: question.flowRules ?? [],
    businessMetric: question.businessMetric ?? null,
    linkedQuestionId: question.linkedQuestionId ?? null,
  }
}

function validateSurveyQuestionFlows(questions: SurveyQuestionPayload[]) {
  const positions = new Map(questions.map((question, index) => [question.id ?? `question-${index}`, index]))
  const questionIds = new Set(questions.map((question, index) => question.id ?? `question-${index}`))

  for (const [index, question] of questions.entries()) {
    const flowRules = question.flowRules ?? []

    if (!flowRules.length) {
      continue
    }

    const allowedValues =
      question.type === 'yes_no'
        ? ['Sim', 'Não']
        : Array.from(new Set((question.options ?? []).map((option) => option.trim()).filter(Boolean)))
    const seenValues = new Set<string>()

    for (const rule of flowRules) {
      const isGenericRule = rule.value === FLOW_ON_ANSWER

      if (!isGenericRule && !['yes_no', 'single_choice', 'multiple_choice'].includes(question.type)) {
        return `A pergunta "${question.title}" só aceita o fluxo geral após responder.`
      }

      if (!isGenericRule && !allowedValues.includes(rule.value)) {
        return `A opção "${rule.value}" não é válida para a pergunta "${question.title}".`
      }

      if (seenValues.has(rule.value)) {
        return isGenericRule
          ? `A pergunta "${question.title}" possui fluxo geral duplicado após resposta.`
          : `A pergunta "${question.title}" possui fluxo duplicado para a opção "${rule.value}".`
      }

      seenValues.add(rule.value)

      if (rule.nextQuestionId === '__end__') {
        continue
      }

      if (!questionIds.has(rule.nextQuestionId)) {
        return `A pergunta "${question.title}" aponta para um destino de fluxo que não existe mais.`
      }
    }
  }

  return null
}

surveysRouter.use(requireAuth)

surveysRouter.post('/uploads/:key', surveyUpload.single('file'), async (request: AuthenticatedRequest, response) => {
  const key = typeof request.params.key === 'string' ? request.params.key : ''

  if (!surveyUploadKeys.has(key)) {
    response.status(400).json({ message: 'Tipo de upload não permitido.' })
    return
  }

  if (!request.file) {
    response.status(400).json({ message: 'Selecione um arquivo para enviar.' })
    return
  }

  const previousValue = typeof request.body.previousValue === 'string' ? request.body.previousValue : ''
  const publicPath = `/uploads/surveys/${request.file.filename}`

  removeManagedSurveyFile(previousValue)

  response.json({ ok: true, key, value: publicPath })
})

surveysRouter.delete('/uploads/:key', async (request: AuthenticatedRequest, response) => {
  const key = typeof request.params.key === 'string' ? request.params.key : ''

  if (!surveyUploadKeys.has(key)) {
    response.status(400).json({ message: 'Tipo de arquivo não permitido.' })
    return
  }

  const value = typeof request.body?.value === 'string' ? request.body.value : ''

  removeManagedSurveyFile(value)

  response.json({ ok: true, key, value: '' })
})

surveysRouter.get('/', async (request: AuthenticatedRequest, response) => {
  const canViewTracking = await hasFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'survey_share_tracking',
  )
  const result = await query<{
    id: string
    survey_kind: string
    title: string
    description: string | null
    status: string
    participation_mode: string
    brand_name: string
    primary_color: string
    reward_enabled: boolean
    prevent_duplicate_responses: boolean
    published_at: string | null
    slug: string | null
    responses: string
    link_clicks: string
    qr_scans: string
  }>(
    `select surveys.id,
            case
              when exists (
                select 1
                from survey_questions
                where survey_questions.survey_id = surveys.id
                  and survey_questions.type = 'nps'
              ) then 'nps'
              else 'custom'
            end as survey_kind,
            surveys.title, surveys.description, surveys.status, surveys.participation_mode,
            surveys.brand_name, surveys.primary_color, surveys.reward_enabled, surveys.prevent_duplicate_responses, surveys.published_at,
            survey_slugs.slug,
            cast(count(distinct survey_responses.id) as text) as responses,
            (
              select cast(count(*) as text)
              from survey_share_visits
              where survey_share_visits.survey_id = surveys.id and survey_share_visits.source = 'link'
            ) as link_clicks,
            (
              select cast(count(*) as text)
              from survey_share_visits
              where survey_share_visits.survey_id = surveys.id and survey_share_visits.source = 'qr'
            ) as qr_scans
     from surveys
     left join survey_slugs on survey_slugs.survey_id = surveys.id and survey_slugs.is_active = true
     left join survey_responses on survey_responses.survey_id = surveys.id
     where surveys.owner_user_id = $1 or $2 = 'master'
     group by surveys.id, survey_slugs.slug
     order by surveys.updated_at desc`,
    [request.auth!.userId, request.auth!.roleCode],
  )

  response.json({
    surveys: result.rows.map((survey) => ({
      ...survey,
      link_clicks: canViewTracking ? survey.link_clicks : '0',
      qr_scans: canViewTracking ? survey.qr_scans : '0',
    })),
  })
})

surveysRouter.get('/:id', async (request: AuthenticatedRequest, response) => {
  const canViewTracking = await hasFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'survey_share_tracking',
  )
  const result = await query<{
    id: string
    owner_user_id: string
    survey_kind: string
    title: string
    description: string | null
    participation_mode: string
    brand_name: string
    logo_url: string | null
    primary_color: string
    banner_url: string | null
    closing_message: string | null
    reward_enabled: boolean
    builder_mode: 'classic' | 'visual'
    flow_json: {
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
    prevent_duplicate_responses: boolean
    allow_multiple_responses: boolean
    slug: string | null
    link_clicks: string
    qr_scans: string
  }>(
    `select surveys.*,
            case
              when exists (
                select 1
                from survey_questions
                where survey_questions.survey_id = surveys.id
                  and survey_questions.type = 'nps'
              ) then 'nps'
              else 'custom'
            end as survey_kind,
            survey_slugs.slug,
            (
              select cast(count(*) as text)
              from survey_share_visits
              where survey_share_visits.survey_id = surveys.id and survey_share_visits.source = 'link'
            ) as link_clicks,
            (
              select cast(count(*) as text)
              from survey_share_visits
              where survey_share_visits.survey_id = surveys.id and survey_share_visits.source = 'qr'
            ) as qr_scans
     from surveys
     left join survey_slugs on survey_slugs.survey_id = surveys.id and survey_slugs.is_active = true
     where surveys.id = $1`,
    [request.params.id],
  )

  const survey = result.rows[0]

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa não encontrada.' })
    return
  }

  if (request.auth!.roleCode !== 'master' && survey.owner_user_id !== request.auth!.userId) {
    response.status(403).json({ message: 'Acesso negado.' })
    return
  }

  response.json({
    survey: {
      ...survey,
      link_clicks: canViewTracking ? survey.link_clicks : '0',
      qr_scans: canViewTracking ? survey.qr_scans : '0',
      questions: await loadSurveyQuestions(survey.id),
    },
  })
})

surveysRouter.get('/:id/preview', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const survey = await loadSurveyPreview(surveyId)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa não encontrada.' })
    return
  }

  response.json({ survey })
})

surveysRouter.get('/:id/preview-link', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const survey = await loadSurveyPreview(surveyId)

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa não encontrada.' })
    return
  }

  if (survey.status !== 'draft') {
    response.status(409).json({ message: 'O link de teste só pode ser gerado enquanto a pesquisa estiver em rascunho.' })
    return
  }

  const token = signSurveyPreviewToken(surveyId)
  const path = `/teste/${token}`
  const url = new URL(path, env.frontendUrl).toString()

  response.json({
    token,
    path,
    url,
    message: 'Link de teste gerado. Ele deixa de funcionar automaticamente quando a pesquisa for publicada.',
  })
})

surveysRouter.post('/', async (request: AuthenticatedRequest, response) => {
  const payload = surveySchema.parse(request.body)
  const flowValidationMessage = validateSurveyQuestionFlows(payload.questions)

  if (flowValidationMessage) {
    response.status(400).json({ message: flowValidationMessage })
    return
  }

  const surveyId = makeId()
  const slugId = makeId()

  await query(
    `insert into surveys (
      id, owner_user_id, title, description, participation_mode, brand_name, logo_url, primary_color, banner_url, closing_message, reward_enabled, prevent_duplicate_responses, duplicate_response_cooldown_days, allow_multiple_responses
      , builder_mode, flow_json
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      surveyId,
      request.auth!.userId,
      payload.title,
      payload.description ?? null,
      payload.participationMode,
      payload.brandName,
      payload.logoUrl || null,
      payload.primaryColor,
      payload.bannerUrl || null,
      payload.closingMessage ?? null,
      payload.rewardEnabled,
      payload.preventDuplicateResponses,
      payload.duplicateResponseCooldownDays,
      payload.allowMultipleResponses,
      payload.builderMode,
      JSON.stringify(payload.flowLayout ?? { version: 1, nodes: [] }),
    ],
  )

  await query('insert into survey_slugs (id, survey_id, slug) values ($1, $2, $3)', [slugId, surveyId, payload.slug])

  for (const item of payload.questions) {
    const questionId = item.id ?? makeId()

    await query(
      `insert into survey_questions (id, survey_id, title, description, type, is_required, position, settings_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        questionId,
        surveyId,
        item.title,
        item.description ?? null,
        item.type,
        item.isRequired,
        item.position,
        JSON.stringify(buildQuestionSettings(item)),
      ],
    )

    for (const [index, option] of (item.options ?? []).entries()) {
      await query(
        `insert into question_options (id, question_id, label, value, position)
         values ($1, $2, $3, $4, $5)`,
        [makeId(), questionId, option, option, index],
      )
    }
  }

  if (payload.rewardEnabled) {
    await query(
      `insert into reward_campaigns (id, survey_id, status, is_active, require_identification, distribution_mode)
       values ($1, $2, 'active', true, true, 'simple')`,
      [makeId(), surveyId],
    )
  }

  response.status(201).json({ id: surveyId })
})

surveysRouter.patch('/:id', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const payload = surveySchema.parse(request.body)
  const flowValidationMessage = validateSurveyQuestionFlows(payload.questions)

  if (flowValidationMessage) {
    response.status(400).json({ message: flowValidationMessage })
    return
  }

  await query(
    `update surveys
     set title = $2,
         description = $3,
         participation_mode = $4,
         brand_name = $5,
         logo_url = $6,
         primary_color = $7,
         banner_url = $8,
         closing_message = $9,
         reward_enabled = $10,
         prevent_duplicate_responses = $11,
         duplicate_response_cooldown_days = $12,
         allow_multiple_responses = $13,
         builder_mode = $14,
         flow_json = $15,
         updated_at = now()
     where id = $1`,
    [
      surveyId,
      payload.title,
      payload.description ?? null,
      payload.participationMode,
      payload.brandName,
      payload.logoUrl || null,
      payload.primaryColor,
      payload.bannerUrl || null,
      payload.closingMessage ?? null,
      payload.rewardEnabled,
      payload.preventDuplicateResponses,
      payload.duplicateResponseCooldownDays,
      payload.allowMultipleResponses,
      payload.builderMode,
      JSON.stringify(payload.flowLayout ?? { version: 1, nodes: [] }),
    ],
  )

  await query('update survey_slugs set slug = $2 where survey_id = $1', [surveyId, payload.slug])
  await query('delete from question_options where question_id in (select id from survey_questions where survey_id = $1)', [surveyId])
  await query('delete from survey_questions where survey_id = $1', [surveyId])

  for (const item of payload.questions) {
    const questionId = item.id ?? makeId()

    await query(
      `insert into survey_questions (id, survey_id, title, description, type, is_required, position, settings_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        questionId,
        surveyId,
        item.title,
        item.description ?? null,
        item.type,
        item.isRequired,
        item.position,
        JSON.stringify(buildQuestionSettings(item)),
      ],
    )

    for (const [index, option] of (item.options ?? []).entries()) {
      await query(
        `insert into question_options (id, question_id, label, value, position)
         values ($1, $2, $3, $4, $5)`,
        [makeId(), questionId, option, option, index],
      )
    }
  }

  response.json({ ok: true })
})

surveysRouter.get('/:id/export', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const surveyResult = await query<{
    title: string
    description: string | null
    participation_mode: string
    brand_name: string
    logo_url: string | null
    primary_color: string
    banner_url: string | null
    closing_message: string | null
    reward_enabled: boolean
    prevent_duplicate_responses: boolean
    duplicate_response_cooldown_days: number
    allow_multiple_responses: boolean
    builder_mode: 'classic' | 'visual'
    flow_json: Record<string, unknown> | null
    slug: string | null
  }>(
    `select surveys.title, surveys.description, surveys.participation_mode, surveys.brand_name,
            surveys.logo_url, surveys.primary_color, surveys.banner_url, surveys.closing_message,
            surveys.reward_enabled, surveys.prevent_duplicate_responses, surveys.duplicate_response_cooldown_days,
            surveys.allow_multiple_responses, surveys.builder_mode, surveys.flow_json,
            survey_slugs.slug
     from surveys
     left join survey_slugs on survey_slugs.survey_id = surveys.id and survey_slugs.is_active = true
     where surveys.id = $1
     limit 1`,
    [surveyId],
  )

  const survey = surveyResult.rows[0]

  if (!survey) {
    response.status(404).json({ message: 'Pesquisa não encontrada.' })
    return
  }

  const questionsResult = await query<{
    id: string
    title: string
    description: string | null
    type: string
    is_required: boolean
    position: number
    settings_json: {
      flowRules?: Array<{ value: string; nextQuestionId: string }>
      businessMetric?: string | null
      linkedQuestionId?: string | null
    }
  }>(
    `select id, title, description, type, is_required, position, settings_json
     from survey_questions
     where survey_id = $1
     order by position asc`,
    [surveyId],
  )

  const questionIds = questionsResult.rows.map((q) => q.id)
  const optionsResult = await query<{
    question_id: string
    label: string
    position: number
  }>(
    `select question_id, label, position
     from question_options
     where question_id = any($1::uuid[])
     order by position asc`,
    [questionIds],
  )

  const idMap = new Map<string, string>()
  for (const q of questionsResult.rows) {
    idMap.set(q.id, q.id)
  }

  const exportedQuestions = questionsResult.rows.map((q, index) => {
    const qOptions = optionsResult.rows
      .filter((o) => o.question_id === q.id)
      .map((o) => o.label)

    const flowRules = (q.settings_json?.flowRules ?? []).map((rule) => ({
      value: rule.value,
      nextQuestionId: rule.nextQuestionId === '__end__' ? '__end__' : (idMap.get(rule.nextQuestionId) ?? rule.nextQuestionId),
    }))

    return {
      id: q.id,
      title: q.title,
      description: q.description ?? '',
      type: q.type,
      isRequired: q.is_required,
      position: q.position,
      options: qOptions,
      flowRules,
      businessMetric: q.settings_json?.businessMetric ?? null,
      linkedQuestionId: q.settings_json?.linkedQuestionId ?? null,
    }
  })

  const flowLayout = survey.flow_json ?? { version: 1, nodes: [] }

  response.json({
    version: 1,
    kind: 'survey',
    data: {
      title: survey.title,
      description: survey.description ?? undefined,
      participationMode: survey.participation_mode,
      slug: survey.slug ?? `imported-${Date.now()}`,
      brandName: survey.brand_name,
      logoUrl: survey.logo_url ?? '',
      primaryColor: survey.primary_color,
      bannerUrl: survey.banner_url ?? '',
      closingMessage: survey.closing_message ?? undefined,
      rewardEnabled: survey.reward_enabled,
      preventDuplicateResponses: survey.prevent_duplicate_responses,
      duplicateResponseCooldownDays: survey.duplicate_response_cooldown_days,
      allowMultipleResponses: survey.allow_multiple_responses,
      builderMode: survey.builder_mode,
      flowLayout,
      questions: exportedQuestions,
    },
  })
})

surveysRouter.post('/:id/publish', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  await query(`update surveys set status = 'published', published_at = now(), updated_at = now() where id = $1`, [surveyId])

  response.json({ ok: true })
})

surveysRouter.post('/:id/unpublish', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  await query(`update surveys set status = 'draft', published_at = null, updated_at = now() where id = $1`, [surveyId])

  response.json({ ok: true })
})

surveysRouter.get('/:id/share/qr', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const featureAccess = await ensureFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'survey_share_qr',
  )

  if (!featureAccess.ok) {
    response.status(featureAccess.status).json({ message: featureAccess.message })
    return
  }

  const surveyResult = await query<{ title: string; slug: string | null }>(
    `select surveys.title, survey_slugs.slug
     from surveys
     left join survey_slugs on survey_slugs.survey_id = surveys.id and survey_slugs.is_active = true
     where surveys.id = $1
     limit 1`,
    [surveyId],
  )
  const survey = surveyResult.rows[0]

  if (!survey?.slug) {
    response.status(404).json({ message: 'A pesquisa pública ainda não possui slug ativo.' })
    return
  }

  const qrCodeBuffer = await QRCode.toBuffer(buildPublicSurveyUrl(survey.slug), {
    type: 'png',
    width: 640,
    margin: 1,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  })
  const fileName = `qrcode-pesquisa-${sanitizeFileName(survey.slug)}.png`
  const shouldDownload = request.query.download === '1' || request.query.download === 'true'

  response.setHeader('Content-Type', 'image/png')
  response.setHeader(
    'Content-Disposition',
    `${shouldDownload ? 'attachment' : 'inline'}; filename="${fileName}"`,
  )
  response.send(qrCodeBuffer)
})
