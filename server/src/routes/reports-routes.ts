import PDFDocument from 'pdfkit'
import { Router } from 'express'

import { query } from '../db/pool.js'
import { requireAuth, requireMaster, type AuthenticatedRequest } from '../middleware/auth.js'
import { ensureFeatureAccess, hasFeatureAccess } from '../services/feature-access.js'
import { ensureSurveyAccess } from '../services/survey-access.js'
import { reportPeriodSchema } from '../validators/schemas.js'

export const reportsRouter = Router()
const REWARD_EXPIRATION_DAYS = 15

type ReportRange = {
  startDate: string
  endDate: string
}

type PaginationInput = {
  page: number
  pageSize: number
}

type PaginationMeta = PaginationInput & {
  totalItems: number
  totalPages: number
}

type RewardWinnerFilters = {
  name: string
  phone: string
  prize: string
  coupon: string
  status: 'all' | 'pending' | 'delivered' | 'cancelled'
  sortField: 'awardedAt' | 'name' | 'itemTitle'
  sortDirection: 'asc' | 'desc'
}

type ParsedAnswerValue = string | number | boolean | string[] | null

type ReportSummary = {
  total_responses: string
  identified_responses: string
  reward_wins: string
  emails_collected: string
  birthdays_collected: string
  link_clicks: string
  qr_scans: string
  total_visits: string
  conversion_rate: string
}

type ReportPeriodItem = {
  day: string
  responses: string
  visits: string
}

type ReportDistributionItem = {
  label: string
  count: number
  percentage: number
}

type ReportQuestionItem = {
  id: string
  title: string
  description: string | null
  type: string
  totalAnswers: number
  completionRate: number
  averageScore?: number
  distribution?: ReportDistributionItem[]
  textSamples?: string[]
  nps?: {
    score: number
    promoters: number
    neutrals: number
    detractors: number
  }
}

type ReportRespondentItem = {
  id: string
  submittedAt: string
  name: string | null
  phone: string | null
  email: string | null
  birthDay: number | null
  birthMonth: number | null
  birthdayLabel: string | null
}

type RewardSummaryItem = {
  total_spins: string
  total_wins: string
  total_no_prize: string
  pending_redemptions: string
  delivered_redemptions: string
  cancelled_redemptions: string
}

type RewardStockItem = {
  id: string
  title: string
  quantityTotal: number
  quantityAwarded: number
  remainingStock: number
  winsInRange: number
}

type RewardWinnerItem = {
  id: string
  awardedAt: string
  expiresAt: string
  isExpired: boolean
  deliveredAt: string | null
  name: string | null
  phone: string | null
  email: string | null
  itemTitle: string
  couponCode: string
  redemptionStatus: 'pending' | 'delivered' | 'cancelled'
  redemptionNotes: string | null
  receivedBy: string | null
}

type NoPrizeItem = {
  label: string
  count: number
}

type NpsOverviewSummary = {
  surveys: number
  responses: number
  averageScore: number
  npsScore: number
  promoters: number
  neutrals: number
  detractors: number
  topSurvey: {
    id: string
    title: string
    score: number
    responses: number
  } | null
  explanation: string
  classification: string
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getDefaultReportRange(): ReportRange {
  const endDate = new Date()
  const endDateUtc = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()))
  const startDateUtc = new Date(endDateUtc)
  startDateUtc.setUTCDate(startDateUtc.getUTCDate() - 29)

  return {
    startDate: formatDateOnly(startDateUtc),
    endDate: formatDateOnly(endDateUtc),
  }
}

function getReportRange(request: AuthenticatedRequest): ReportRange {
  const defaultRange = getDefaultReportRange()
  const rawRange = reportPeriodSchema.parse({
    startDate: typeof request.query.startDate === 'string' ? request.query.startDate : undefined,
    endDate: typeof request.query.endDate === 'string' ? request.query.endDate : undefined,
  })

  return {
    startDate: rawRange.startDate ?? defaultRange.startDate,
    endDate: rawRange.endDate ?? defaultRange.endDate,
  }
}

function parsePositiveInt(value: unknown, fallback: number, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback
  }

  return Math.min(parsed, max)
}

function getRewardExpirationInfo(input: { awardedAt: string; redemptionExpiresAt: string | null }) {
  const expirationDate = input.redemptionExpiresAt ? new Date(input.redemptionExpiresAt) : new Date(input.awardedAt)

  if (Number.isNaN(expirationDate.getTime())) {
    return {
      expiresAt: input.redemptionExpiresAt ?? input.awardedAt,
      isExpired: false,
    }
  }

  if (!input.redemptionExpiresAt) {
    expirationDate.setUTCDate(expirationDate.getUTCDate() + REWARD_EXPIRATION_DAYS)
  }

  return {
    expiresAt: expirationDate.toISOString(),
    isExpired: expirationDate.getTime() < Date.now(),
  }
}

function getPaginationQuery(
  request: AuthenticatedRequest,
  defaults: PaginationInput = { page: 1, pageSize: 20 },
): PaginationInput {
  return {
    page: parsePositiveInt(request.query.page, defaults.page, { min: 1 }),
    pageSize: parsePositiveInt(request.query.pageSize, defaults.pageSize, { min: 1, max: 100 }),
  }
}

function buildPaginationMeta(totalItems: number, pagination: PaginationInput): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize))
  const page = Math.min(pagination.page, totalPages)

  return {
    page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages,
  }
}

function getWinnerFilters(request: AuthenticatedRequest): RewardWinnerFilters {
  const sortFieldRaw = typeof request.query.sortField === 'string' ? request.query.sortField : ''
  const sortDirectionRaw = typeof request.query.sortDirection === 'string' ? request.query.sortDirection : ''

  return {
    name: typeof request.query.name === 'string' ? request.query.name.trim() : '',
    phone: typeof request.query.phone === 'string' ? request.query.phone.trim() : '',
    prize: typeof request.query.prize === 'string' ? request.query.prize.trim() : '',
    coupon: typeof request.query.coupon === 'string' ? request.query.coupon.trim() : '',
    status:
      request.query.status === 'pending' ||
      request.query.status === 'delivered' ||
      request.query.status === 'cancelled'
        ? request.query.status
        : 'all',
    sortField:
      sortFieldRaw === 'name' || sortFieldRaw === 'itemTitle' || sortFieldRaw === 'awardedAt'
        ? sortFieldRaw
        : 'awardedAt',
    sortDirection: sortDirectionRaw === 'asc' ? 'asc' : 'desc',
  }
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function roundNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Number(value.toFixed(digits))
}

function parseStoredAnswerValue(answerText: string | null, answerJson: unknown): ParsedAnswerValue {
  if (typeof answerText === 'string' && answerText.trim()) {
    return answerText.trim()
  }

  if (Array.isArray(answerJson)) {
    return answerJson.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }

  if (typeof answerJson === 'string' && answerJson.trim()) {
    return answerJson.trim()
  }

  if (typeof answerJson === 'number' || typeof answerJson === 'boolean') {
    return answerJson
  }

  if (answerJson && typeof answerJson === 'object' && 'value' in answerJson) {
    const value = (answerJson as { value?: unknown }).value

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }

    if (typeof value === 'string') {
      return value.trim()
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
  }

  return null
}

function extractNumericValue(value: ParsedAnswerValue) {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function formatQuestionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    short_text: 'Texto curto',
    long_text: 'Texto longo',
    single_choice: 'Escolha única',
    multiple_choice: 'Múltipla escolha',
    yes_no: 'Sim ou não',
    rating_1_5: 'Nota de 1 a 5',
    nps: 'NPS',
  }

  return labels[type] ?? type
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function escapeCsvValue(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function formatBirthdayLabel(input: { birthDay: number | null; birthMonth: number | null }) {
  if (!input.birthDay || !input.birthMonth) {
    return null
  }

  return `${String(input.birthDay).padStart(2, '0')}/${String(input.birthMonth).padStart(2, '0')}`
}

function formatDateTimeBR(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return String(value)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

function ensurePdfSpace(document: PDFKit.PDFDocument, minSpace = 72) {
  if (document.y > document.page.height - document.page.margins.bottom - minSpace) {
    document.addPage()
  }
}

function classifyNpsScore(score: number) {
  if (score >= 75) {
    return {
      classification: 'Excelente',
      explanation: 'Seu NPS está muito forte. A base tem alta chance de indicar sua marca.',
    }
  }

  if (score >= 50) {
    return {
      classification: 'Muito bom',
      explanation: 'Seu NPS está saudável. Vale acompanhar comentários para aumentar ainda mais a recomendação.',
    }
  }

  if (score >= 0) {
    return {
      classification: 'Em atenção',
      explanation: 'Existe espaço claro para melhorar a experiência e transformar neutros em promotores.',
    }
  }

  return {
    classification: 'Crítico',
    explanation: 'Há mais detratores do que promotores. O ideal é agir rápido nos principais motivos das notas baixas.',
  }
}

async function getSurveyReportTitle(surveyId: string) {
  const result = await query<{ title: string }>('select title from surveys where id = $1 limit 1', [surveyId])
  return result.rows[0]?.title ?? 'Pesquisa'
}

async function getSummaryReportData(
  surveyId: string,
  range: ReportRange,
  canViewTracking: boolean,
): Promise<{
  summary: ReportSummary
  period: ReportPeriodItem[]
  range: ReportRange
}> {
  const summary = await query<ReportSummary>(
    `with metrics as (
        select
          (
            select count(*)::numeric
            from survey_responses
            where survey_id = $1
              and submitted_at >= $2::date
              and submitted_at < ($3::date + interval '1 day')
          ) as total_responses,
          (
            select count(*)::numeric
            from survey_responses
            where survey_id = $1
              and participant_name is not null
              and submitted_at >= $2::date
              and submitted_at < ($3::date + interval '1 day')
          ) as identified_responses,
          (
            select count(*)::numeric
            from reward_wins
            join survey_responses on reward_wins.response_id = survey_responses.id
            where survey_responses.survey_id = $1
              and survey_responses.submitted_at >= $2::date
              and survey_responses.submitted_at < ($3::date + interval '1 day')
          ) as reward_wins,
          (
            select count(*)::numeric
            from survey_responses
            where survey_id = $1
              and participant_email is not null
              and submitted_at >= $2::date
              and submitted_at < ($3::date + interval '1 day')
          ) as emails_collected,
          (
            select count(*)::numeric
            from survey_responses
            where survey_id = $1
              and participant_birth_day is not null
              and participant_birth_month is not null
              and submitted_at >= $2::date
              and submitted_at < ($3::date + interval '1 day')
          ) as birthdays_collected,
          (
            select count(*)::numeric
            from survey_share_visits
            where survey_id = $1
              and source = 'link'
              and visited_at >= $2::date
              and visited_at < ($3::date + interval '1 day')
          ) as link_clicks,
          (
            select count(*)::numeric
            from survey_share_visits
            where survey_id = $1
              and source = 'qr'
              and visited_at >= $2::date
              and visited_at < ($3::date + interval '1 day')
          ) as qr_scans,
          (
            select count(*)::numeric
            from survey_share_visits
            where survey_id = $1
              and visited_at >= $2::date
              and visited_at < ($3::date + interval '1 day')
          ) as total_visits
      )
      select
        cast(total_responses as text) as total_responses,
        cast(identified_responses as text) as identified_responses,
        cast(reward_wins as text) as reward_wins,
        cast(emails_collected as text) as emails_collected,
        cast(birthdays_collected as text) as birthdays_collected,
        cast(link_clicks as text) as link_clicks,
        cast(qr_scans as text) as qr_scans,
        cast(total_visits as text) as total_visits,
        cast(
          case
            when total_visits = 0 then 0
            else round((total_responses / total_visits) * 100, 2)
          end as text
        ) as conversion_rate
      from metrics`,
    [surveyId, range.startDate, range.endDate],
  )

  const period = await query<ReportPeriodItem>(
    `with days as (
        select date_trunc('day', submitted_at) as day
        from survey_responses
        where survey_id = $1
          and submitted_at >= $2::date
          and submitted_at < ($3::date + interval '1 day')
        union
        select date_trunc('day', visited_at) as day
        from survey_share_visits
        where survey_id = $1
          and visited_at >= $2::date
          and visited_at < ($3::date + interval '1 day')
      ),
      response_totals as (
        select date_trunc('day', submitted_at) as day, count(*) as total
        from survey_responses
        where survey_id = $1
          and submitted_at >= $2::date
          and submitted_at < ($3::date + interval '1 day')
        group by 1
      ),
      visit_totals as (
        select date_trunc('day', visited_at) as day, count(*) as total
        from survey_share_visits
        where survey_id = $1
          and visited_at >= $2::date
          and visited_at < ($3::date + interval '1 day')
        group by 1
      )
      select
        to_char(days.day, 'YYYY-MM-DD') as day,
        cast(coalesce(response_totals.total, 0) as text) as responses,
        cast(coalesce(visit_totals.total, 0) as text) as visits
      from days
      left join response_totals on response_totals.day = days.day
      left join visit_totals on visit_totals.day = days.day
      order by days.day asc`,
    [surveyId, range.startDate, range.endDate],
  )

  return {
    summary: {
      ...summary.rows[0],
      link_clicks: canViewTracking ? summary.rows[0].link_clicks : '0',
      qr_scans: canViewTracking ? summary.rows[0].qr_scans : '0',
      total_visits: canViewTracking ? summary.rows[0].total_visits : '0',
      conversion_rate: canViewTracking ? summary.rows[0].conversion_rate : '0',
    },
    period: period.rows.map((item) => ({
      ...item,
      visits: canViewTracking ? item.visits : '0',
    })),
    range,
  }
}

async function getRespondentsReportData(
  surveyId: string,
  range: ReportRange,
  options?: {
    pagination?: PaginationInput
    all?: boolean
  },
): Promise<{
  respondents: ReportRespondentItem[]
  pagination: PaginationMeta
  range: ReportRange
}> {
  const pagination = options?.pagination ?? { page: 1, pageSize: 20 }
  const countResult = await query<{ total: string }>(
    `select cast(count(*) as text) as total
     from survey_responses
     where survey_id = $1
       and submitted_at >= $2::date
       and submitted_at < ($3::date + interval '1 day')`,
    [surveyId, range.startDate, range.endDate],
  )
  const totalItems = Number(countResult.rows[0]?.total ?? 0)
  const meta = buildPaginationMeta(totalItems, pagination)
  const offset = (meta.page - 1) * meta.pageSize

  const values: Array<string | number> = [surveyId, range.startDate, range.endDate]
  let paginationSql = ''

  if (!options?.all) {
    values.push(meta.pageSize, offset)
    paginationSql = ` limit $${values.length - 1} offset $${values.length}`
  }

  const result = await query<{
    id: string
    submitted_at: string
    participant_name: string | null
    participant_phone: string | null
    participant_email: string | null
    participant_birth_day: number | null
    participant_birth_month: number | null
  }>(
    `select
        id,
        submitted_at,
        participant_name,
        participant_phone,
        participant_email,
        participant_birth_day,
        participant_birth_month
     from survey_responses
     where survey_id = $1
       and submitted_at >= $2::date
       and submitted_at < ($3::date + interval '1 day')
     order by submitted_at desc${paginationSql}`,
    values,
  )

  return {
    respondents: result.rows.map((row) => ({
      id: row.id,
      submittedAt: formatDateTimeBR(row.submitted_at),
      name: row.participant_name,
      phone: row.participant_phone,
      email: row.participant_email,
      birthDay: row.participant_birth_day,
      birthMonth: row.participant_birth_month,
      birthdayLabel: formatBirthdayLabel({
        birthDay: row.participant_birth_day,
        birthMonth: row.participant_birth_month,
      }),
    })),
    pagination: options?.all
      ? {
          page: 1,
          pageSize: totalItems || pagination.pageSize,
          totalItems,
          totalPages: totalItems ? 1 : 1,
        }
      : meta,
    range,
  }
}

async function getQuestionReportData(
  surveyId: string,
  range: ReportRange,
): Promise<{
  questions: ReportQuestionItem[]
  totalResponses: number
  range: ReportRange
}> {
  const totalResponsesResult = await query<{ total: string }>(
    `select cast(count(*) as text) as total
     from survey_responses
     where survey_id = $1
       and submitted_at >= $2::date
       and submitted_at < ($3::date + interval '1 day')`,
    [surveyId, range.startDate, range.endDate],
  )
  const totalResponses = Number(totalResponsesResult.rows[0]?.total ?? 0)

  const questionRows = await query<{
    id: string
    title: string
    description: string | null
    type: string
    is_required: boolean
    position: number
    option_label: string | null
    option_position: number | null
  }>(
    `select
        survey_questions.id,
        survey_questions.title,
        survey_questions.description,
        survey_questions.type,
        survey_questions.is_required,
        survey_questions.position,
        question_options.label as option_label,
        question_options.position as option_position
      from survey_questions
      left join question_options on question_options.question_id = survey_questions.id
      where survey_questions.survey_id = $1
      order by survey_questions.position asc, question_options.position asc nulls last`,
    [surveyId],
  )

  const answerRows = await query<{
    question_id: string
    answer_text: string | null
    answer_json: unknown
    submitted_at: string
  }>(
    `select
        response_answers.question_id,
        response_answers.answer_text,
        response_answers.answer_json,
        survey_responses.submitted_at
      from response_answers
      join survey_responses on survey_responses.id = response_answers.response_id
      where survey_responses.survey_id = $1
        and survey_responses.submitted_at >= $2::date
        and survey_responses.submitted_at < ($3::date + interval '1 day')
      order by survey_responses.submitted_at desc`,
    [surveyId, range.startDate, range.endDate],
  )

  const questionsMap = new Map<
    string,
    {
      id: string
      title: string
      description: string | null
      type: string
      isRequired: boolean
      position: number
      options: string[]
    }
  >()

  for (const row of questionRows.rows) {
    if (!questionsMap.has(row.id)) {
      questionsMap.set(row.id, {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        isRequired: row.is_required,
        position: row.position,
        options: [],
      })
    }

    if (row.option_label) {
      questionsMap.get(row.id)!.options.push(row.option_label)
    }
  }

  const answersByQuestion = new Map<string, Array<{ value: ParsedAnswerValue; submittedAt: string }>>()

  for (const row of answerRows.rows) {
    const parsedValue = parseStoredAnswerValue(row.answer_text, row.answer_json)

    if (parsedValue === null || (Array.isArray(parsedValue) && !parsedValue.length)) {
      continue
    }

    const currentList = answersByQuestion.get(row.question_id) ?? []
    currentList.push({
      value: parsedValue,
      submittedAt: row.submitted_at,
    })
    answersByQuestion.set(row.question_id, currentList)
  }

  const questions = Array.from(questionsMap.values())
    .sort((left, right) => left.position - right.position)
    .map((question) => {
      const entries = answersByQuestion.get(question.id) ?? []
      const totalAnswers = entries.length
      const completionRate = totalResponses ? roundNumber((totalAnswers / totalResponses) * 100, 2) : 0

      if (question.type === 'single_choice' || question.type === 'yes_no' || question.type === 'multiple_choice') {
        const optionLabels =
          question.type === 'yes_no' && !question.options.length ? ['Sim', 'Não'] : question.options
        const counts = new Map<string, number>(optionLabels.map((label) => [label, 0]))

        for (const entry of entries) {
          if (Array.isArray(entry.value)) {
            for (const item of entry.value) {
              counts.set(item, (counts.get(item) ?? 0) + 1)
            }
            continue
          }

          if (typeof entry.value === 'string') {
            counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1)
          }
        }

        const totalCount = Array.from(counts.values()).reduce((sum, value) => sum + value, 0)
        const distribution = Array.from(counts.entries()).map(([label, count]) => ({
          label,
          count,
          percentage: totalCount ? roundNumber((count / totalCount) * 100, 2) : 0,
        }))

        return {
          id: question.id,
          title: question.title,
          description: question.description,
          type: question.type,
          totalAnswers,
          completionRate,
          distribution,
        }
      }

      if (question.type === 'rating_1_5' || question.type === 'nps') {
        const scale = question.type === 'nps' ? 11 : 5
        const counts = new Map<string, number>(
          Array.from({ length: scale }, (_, index) => [String(question.type === 'nps' ? index : index + 1), 0]),
        )
        const numbers = entries
          .map((entry) => extractNumericValue(entry.value))
          .filter((value): value is number => value !== null)

        for (const value of numbers) {
          counts.set(String(value), (counts.get(String(value)) ?? 0) + 1)
        }

        const averageScore = numbers.length
          ? roundNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 2)
          : 0
        const distribution = Array.from(counts.entries()).map(([label, count]) => ({
          label,
          count,
          percentage: numbers.length ? roundNumber((count / numbers.length) * 100, 2) : 0,
        }))

        if (question.type === 'nps') {
          const promoters = numbers.filter((value) => value >= 9).length
          const neutrals = numbers.filter((value) => value >= 7 && value <= 8).length
          const detractors = numbers.filter((value) => value <= 6).length
          const npsScore = numbers.length
            ? roundNumber(((promoters / numbers.length) - (detractors / numbers.length)) * 100, 2)
            : 0

          return {
            id: question.id,
            title: question.title,
            description: question.description,
            type: question.type,
            totalAnswers,
            completionRate,
            averageScore,
            distribution,
            nps: {
              score: npsScore,
              promoters,
              neutrals,
              detractors,
            },
          }
        }

        return {
          id: question.id,
          title: question.title,
          description: question.description,
          type: question.type,
          totalAnswers,
          completionRate,
          averageScore,
          distribution,
        }
      }

      const textSamples = entries
        .map((entry) => (typeof entry.value === 'string' ? entry.value : ''))
        .filter((value) => value.trim().length > 0)
        .slice(0, 5)

      return {
        id: question.id,
        title: question.title,
        description: question.description,
        type: question.type,
        totalAnswers,
        completionRate,
        textSamples,
      }
    })

  return {
    questions,
    totalResponses,
    range,
  }
}

async function getRewardReportData(
  surveyId: string,
  range: ReportRange,
  options?: {
    winnerFilters?: RewardWinnerFilters
    winnerPagination?: PaginationInput
    includeAllWinners?: boolean
  },
): Promise<{
  summary: RewardSummaryItem
  pickupAddress: string | null
  requireReceiverIdentity: boolean
  stock: RewardStockItem[]
  winners: RewardWinnerItem[]
  winnersPagination: PaginationMeta
  noPrizeBreakdown: NoPrizeItem[]
  range: ReportRange
}> {
  const campaignResult = await query<{ id: string; pickup_address: string | null; require_receiver_identity: boolean }>(
    'select id, pickup_address, require_receiver_identity from reward_campaigns where survey_id = $1 limit 1',
    [surveyId],
  )
  const campaignId = campaignResult.rows[0]?.id
  const pickupAddress = campaignResult.rows[0]?.pickup_address ?? null
  const requireReceiverIdentity = campaignResult.rows[0]?.require_receiver_identity ?? false

  if (!campaignId) {
    return {
      summary: {
        total_spins: '0',
        total_wins: '0',
        total_no_prize: '0',
        pending_redemptions: '0',
        delivered_redemptions: '0',
        cancelled_redemptions: '0',
      },
      pickupAddress,
      requireReceiverIdentity,
      stock: [],
      winners: [],
      winnersPagination: {
        page: 1,
        pageSize: options?.winnerPagination?.pageSize ?? 20,
        totalItems: 0,
        totalPages: 1,
      },
      noPrizeBreakdown: [],
      range,
    }
  }

  const winnerFilters = options?.winnerFilters ?? {
    name: '',
    phone: '',
    prize: '',
    coupon: '',
    status: 'all',
    sortField: 'awardedAt',
    sortDirection: 'desc',
  }
  const winnerPagination = options?.winnerPagination ?? { page: 1, pageSize: 20 }
  const winnerWhereClauses = [
    'reward_wins.campaign_id = $1',
    'reward_wins.awarded_at >= $2::date',
    "reward_wins.awarded_at < ($3::date + interval '1 day')",
  ]
  const winnerValues: Array<string | number> = [campaignId, range.startDate, range.endDate]

  if (winnerFilters.name) {
    winnerValues.push(`%${winnerFilters.name}%`)
    winnerWhereClauses.push(`coalesce(survey_responses.participant_name, '') ilike $${winnerValues.length}`)
  }

  if (winnerFilters.phone) {
    winnerValues.push(`%${winnerFilters.phone}%`)
    winnerWhereClauses.push(`coalesce(survey_responses.participant_phone, '') ilike $${winnerValues.length}`)
  }

  if (winnerFilters.prize) {
    winnerValues.push(`%${winnerFilters.prize}%`)
    winnerWhereClauses.push(`coalesce(reward_items.title, '') ilike $${winnerValues.length}`)
  }

  if (winnerFilters.coupon) {
    winnerValues.push(`%${winnerFilters.coupon}%`)
    winnerWhereClauses.push(`coalesce(reward_wins.coupon_code, '') ilike $${winnerValues.length}`)
  }

  if (winnerFilters.status !== 'all') {
    winnerValues.push(winnerFilters.status)
    winnerWhereClauses.push(`reward_wins.redemption_status = $${winnerValues.length}`)
  }

  const winnerWhereSql = winnerWhereClauses.join(' and ')
  const winnerOrderByMap: Record<RewardWinnerFilters['sortField'], string> = {
    awardedAt: 'reward_wins.awarded_at',
    name: "coalesce(survey_responses.participant_name, '')",
    itemTitle: 'reward_items.title',
  }
  const winnerOrderBy = winnerOrderByMap[winnerFilters.sortField]
  const totalWinnersResult = await query<{ total: string }>(
    `select cast(count(*) as text) as total
     from reward_wins
     join reward_items on reward_items.id = reward_wins.reward_item_id
     join survey_responses on survey_responses.id = reward_wins.response_id
     where ${winnerWhereSql}`,
    winnerValues,
  )
  const totalWinnerItems = Number(totalWinnersResult.rows[0]?.total ?? 0)
  const winnersMeta = buildPaginationMeta(totalWinnerItems, winnerPagination)
  const winnersOffset = (winnersMeta.page - 1) * winnersMeta.pageSize
  const winnerQueryValues = [...winnerValues]
  let winnerPaginationSql = ''

  if (!options?.includeAllWinners) {
    winnerQueryValues.push(winnersMeta.pageSize, winnersOffset)
    winnerPaginationSql = ` limit $${winnerQueryValues.length - 1} offset $${winnerQueryValues.length}`
  }

  const [summaryResult, stockResult, winnersResult, noPrizeResult] = await Promise.all([
    query<RewardSummaryItem>(
      `select
          cast(count(*) as text) as total_spins,
          cast(count(*) filter (where outcome_type = 'win') as text) as total_wins,
          cast(count(*) filter (where outcome_type = 'no_prize') as text) as total_no_prize,
          (
            select cast(count(*) as text)
            from reward_wins
            where campaign_id = $1
              and redemption_status = 'pending'
          ) as pending_redemptions,
          (
            select cast(count(*) as text)
            from reward_wins
            where campaign_id = $1
              and redemption_status = 'delivered'
          ) as delivered_redemptions,
          (
            select cast(count(*) as text)
            from reward_wins
            where campaign_id = $1
              and redemption_status = 'cancelled'
          ) as cancelled_redemptions
       from reward_spin_logs
       where campaign_id = $1
         and created_at >= $2::date
         and created_at < ($3::date + interval '1 day')`,
      [campaignId, range.startDate, range.endDate],
    ),
    query<{
      id: string
      title: string
      quantity_total: number
      quantity_awarded: number
      wins_in_range: string
    }>(
      `select
          reward_items.id,
          reward_items.title,
          reward_items.quantity_total,
          reward_items.quantity_awarded,
          cast(count(reward_wins.id) filter (
            where reward_wins.awarded_at >= $2::date
              and reward_wins.awarded_at < ($3::date + interval '1 day')
          ) as text) as wins_in_range
       from reward_items
       left join reward_wins on reward_wins.reward_item_id = reward_items.id
       where reward_items.campaign_id = $1
       group by reward_items.id, reward_items.title, reward_items.quantity_total, reward_items.quantity_awarded
       order by reward_items.created_at asc`,
      [campaignId, range.startDate, range.endDate],
    ),
    query<{
      id: string
      awarded_at: string
      redemption_expires_at: string | null
      delivered_at: string | null
      participant_name: string | null
      participant_phone: string | null
      participant_email: string | null
      item_title: string
      coupon_code: string
      redemption_status: 'pending' | 'delivered' | 'cancelled'
      redemption_notes: string | null
      received_by: string | null
    }>(
      `select
          reward_wins.id,
          cast(reward_wins.awarded_at as text) as awarded_at,
          cast(reward_wins.redemption_expires_at as text) as redemption_expires_at,
          cast(reward_wins.delivered_at as text) as delivered_at,
          survey_responses.participant_name,
          survey_responses.participant_phone,
          survey_responses.participant_email,
          reward_items.title as item_title,
          reward_wins.coupon_code,
          reward_wins.redemption_status,
          reward_wins.redemption_notes,
          reward_wins.received_by
       from reward_wins
       join reward_items on reward_items.id = reward_wins.reward_item_id
       join survey_responses on survey_responses.id = reward_wins.response_id
       where ${winnerWhereSql}
       order by ${winnerOrderBy} ${winnerFilters.sortDirection}, reward_wins.awarded_at desc${winnerPaginationSql}`,
      winnerQueryValues,
    ),
    query<{ label: string; count: string }>(
      `select wheel_label as label, cast(count(*) as text) as count
       from reward_spin_logs
       where campaign_id = $1
         and outcome_type = 'no_prize'
         and created_at >= $2::date
         and created_at < ($3::date + interval '1 day')
       group by wheel_label
       order by count(*) desc, wheel_label asc`,
      [campaignId, range.startDate, range.endDate],
    ),
  ])

  return {
    summary: summaryResult.rows[0] ?? {
      total_spins: '0',
      total_wins: '0',
      total_no_prize: '0',
      pending_redemptions: '0',
      delivered_redemptions: '0',
      cancelled_redemptions: '0',
    },
    pickupAddress,
    requireReceiverIdentity,
    stock: stockResult.rows.map((item) => ({
      id: item.id,
      title: item.title,
      quantityTotal: item.quantity_total,
      quantityAwarded: item.quantity_awarded,
      remainingStock: Math.max(item.quantity_total - item.quantity_awarded, 0),
      winsInRange: Number(item.wins_in_range ?? 0),
    })),
    winners: winnersResult.rows.map((row) => {
      const expiration = getRewardExpirationInfo({
        awardedAt: row.awarded_at,
        redemptionExpiresAt: row.redemption_expires_at,
      })

      return {
        id: row.id,
        awardedAt: row.awarded_at,
        expiresAt: expiration.expiresAt,
        isExpired: expiration.isExpired,
        deliveredAt: row.delivered_at,
        name: row.participant_name,
        phone: row.participant_phone,
        email: row.participant_email,
        itemTitle: row.item_title,
        couponCode: row.coupon_code,
        redemptionStatus: row.redemption_status,
        redemptionNotes: row.redemption_notes,
        receivedBy: row.received_by,
      }
    }),
    winnersPagination: options?.includeAllWinners
      ? {
          page: 1,
          pageSize: totalWinnerItems || winnerPagination.pageSize,
          totalItems: totalWinnerItems,
          totalPages: totalWinnerItems ? 1 : 1,
        }
      : winnersMeta,
    noPrizeBreakdown: noPrizeResult.rows.map((row) => ({
      label: row.label,
      count: Number(row.count ?? 0),
    })),
    range,
  }
}

async function getNpsOverviewData(userId: string, roleCode: string): Promise<NpsOverviewSummary> {
  const surveysResult = await query<{
    id: string
    title: string
  }>(
    `select surveys.id, surveys.title
     from surveys
     where ($2 = 'master' or surveys.owner_user_id = $1)
       and exists (
         select 1
         from survey_questions
         where survey_questions.survey_id = surveys.id
           and survey_questions.type = 'nps'
       )
     order by surveys.updated_at desc`,
    [userId, roleCode],
  )

  if (!surveysResult.rows.length) {
    const emptyState = classifyNpsScore(0)

    return {
      surveys: 0,
      responses: 0,
      averageScore: 0,
      npsScore: 0,
      promoters: 0,
      neutrals: 0,
      detractors: 0,
      topSurvey: null,
      explanation: 'Crie a primeira pesquisa NPS para começar a medir recomendação e satisfação.',
      classification: emptyState.classification,
    }
  }

  const answerRows = await query<{
    survey_id: string
    survey_title: string
    answer_text: string | null
    answer_json: unknown
  }>(
    `select
        surveys.id as survey_id,
        surveys.title as survey_title,
        response_answers.answer_text,
        response_answers.answer_json
     from surveys
     join survey_questions on survey_questions.survey_id = surveys.id and survey_questions.type = 'nps'
     join response_answers on response_answers.question_id = survey_questions.id
     join survey_responses on survey_responses.id = response_answers.response_id
     where ($2 = 'master' or surveys.owner_user_id = $1)`,
    [userId, roleCode],
  )

  const surveyScoreMap = new Map<string, { id: string; title: string; values: number[] }>()
  const allScores: number[] = []

  for (const row of answerRows.rows) {
    const parsedValue = parseStoredAnswerValue(row.answer_text, row.answer_json)
    const score = extractNumericValue(parsedValue)

    if (score === null) {
      continue
    }

    allScores.push(score)

    const currentSurvey = surveyScoreMap.get(row.survey_id) ?? {
      id: row.survey_id,
      title: row.survey_title,
      values: [],
    }
    currentSurvey.values.push(score)
    surveyScoreMap.set(row.survey_id, currentSurvey)
  }

  const promoters = allScores.filter((value) => value >= 9).length
  const neutrals = allScores.filter((value) => value >= 7 && value <= 8).length
  const detractors = allScores.filter((value) => value <= 6).length
  const averageScore = allScores.length ? roundNumber(allScores.reduce((sum, value) => sum + value, 0) / allScores.length, 2) : 0
  const npsScore = allScores.length
    ? roundNumber(((promoters / allScores.length) - (detractors / allScores.length)) * 100, 2)
    : 0

  const topSurvey =
    Array.from(surveyScoreMap.values())
      .map((survey) => {
        const surveyPromoters = survey.values.filter((value) => value >= 9).length
        const surveyDetractors = survey.values.filter((value) => value <= 6).length
        const score = survey.values.length
          ? roundNumber(((surveyPromoters / survey.values.length) - (surveyDetractors / survey.values.length)) * 100, 2)
          : 0

        return {
          id: survey.id,
          title: survey.title,
          score,
          responses: survey.values.length,
        }
      })
      .sort((left, right) => right.score - left.score || right.responses - left.responses)[0] ?? null

  const explanationState = classifyNpsScore(npsScore)

  return {
    surveys: surveysResult.rows.length,
    responses: allScores.length,
    averageScore,
    npsScore,
    promoters,
    neutrals,
    detractors,
    topSurvey,
    explanation: allScores.length
      ? explanationState.explanation
      : 'As pesquisas NPS já existem, mas ainda não há notas suficientes para montar a leitura.',
    classification: allScores.length ? explanationState.classification : 'Aguardando respostas',
  }
}

function buildCsvReportContent(input: {
  title: string
  range: ReportRange
  summary: ReportSummary
  period: ReportPeriodItem[]
  questions: ReportQuestionItem[]
  respondents: ReportRespondentItem[]
  rewards: {
    summary: RewardSummaryItem
    pickupAddress: string | null
    stock: RewardStockItem[]
    winners: RewardWinnerItem[]
    noPrizeBreakdown: NoPrizeItem[]
  }
  missingProducts?: MissingProductsResponse[]
  attendantPerformance?: AttendantPerformanceResponse[]
}) {
  const lines: string[][] = [
    ['Relatório', input.title],
    ['Período inicial', input.range.startDate],
    ['Período final', input.range.endDate],
    ['Total de respostas', input.summary.total_responses],
    ['Participação identificada', input.summary.identified_responses],
    ['Prêmios entregues', input.summary.reward_wins],
    ['E-mails coletados', input.summary.emails_collected],
    ['Aniversários coletados', input.summary.birthdays_collected],
    ['Cliques no link', input.summary.link_clicks],
    ['Leituras do QR', input.summary.qr_scans],
    ['Acessos totais', input.summary.total_visits],
    ['Taxa de conversão', `${input.summary.conversion_rate}%`],
    [],
    ['Indicador', 'Valor'],
    ['Total de respostas', `${input.summary.total_responses} respostas válidas registradas`],
    ['Taxa de conversão', `${input.summary.conversion_rate}% das visitas viraram respostas`],
    ['Acessos totais', `${input.summary.total_visits} visitas rastreadas na pesquisa`],
    ['Participação identificada', `${input.summary.identified_responses} respostas com identificação`],
    ['E-mails coletados', `${input.summary.emails_collected} participantes informaram e-mail`],
    ['Aniversários coletados', `${input.summary.birthdays_collected} participantes informaram aniversário`],
    ['Cliques no link', `${input.summary.link_clicks} acessos vieram pelo link divulgado`],
    ['Leituras do QR code', `${input.summary.qr_scans} acessos vieram pelo QR code`],
    ['Prêmios entregues', `${input.summary.reward_wins} prêmios realmente sorteados`],
    ['Giros da roleta', `${input.rewards.summary.total_spins} giros aconteceram no período`],
    ['Sem prêmio', `${input.rewards.summary.total_no_prize} giros caíram em opção sem prêmio`],
    ['Resgates pendentes', `${input.rewards.summary.pending_redemptions} prêmios aguardam retirada`],
    ['Resgates entregues', `${input.rewards.summary.delivered_redemptions} prêmios já foram entregues`],
    ['Local de retirada', input.rewards.pickupAddress ?? 'Não informado'],
    [],
    ['Dia', 'Acessos', 'Respostas'],
    ...input.period.map((item) => [item.day, item.visits, item.responses]),
  ]

  if (input.questions.length) {
    lines.push([])
    lines.push(['Pergunta', 'Tipo', 'Respostas', 'Conclusao (%)', 'Media/NPS', 'Detalhe'])

    for (const question of input.questions) {
      const detail = question.distribution?.length
        ? question.distribution.map((item) => `${item.label}: ${item.count} (${item.percentage}%)`).join(' | ')
        : question.textSamples?.join(' | ') ?? ''

      lines.push([
        question.title,
        formatQuestionTypeLabel(question.type),
        String(question.totalAnswers),
        String(question.completionRate),
        question.nps?.score !== undefined
          ? String(question.nps.score)
          : question.averageScore !== undefined
            ? String(question.averageScore)
            : '',
        detail,
      ])
    }
  }

  if (input.rewards.stock.length) {
    lines.push([])
    lines.push(['Roleta'])
    lines.push(['Prêmio', 'Entregues no período', 'Entregues no total', 'Estoque total', 'Estoque restante'])

    for (const item of input.rewards.stock) {
      lines.push([
        item.title,
        String(item.winsInRange),
        String(item.quantityAwarded),
        String(item.quantityTotal),
        String(item.remainingStock),
      ])
    }
  }

  if (input.rewards.noPrizeBreakdown.length) {
    lines.push([])
    lines.push(['Opções sem prêmio'])
    lines.push(['Opção', 'Quantidade'])

    for (const item of input.rewards.noPrizeBreakdown) {
      lines.push([item.label, String(item.count)])
    }
  }

  if (input.rewards.winners.length) {
    lines.push([])
    lines.push(['Ganhadores'])
    lines.push(['Data', 'Validade', 'Expirado', 'Nome', 'WhatsApp', 'E-mail', 'Prêmio', 'Protocolo', 'Status', 'Retirado em', 'Observações'])

    for (const winner of input.rewards.winners) {
      lines.push([
        winner.awardedAt,
        winner.expiresAt,
        winner.isExpired ? 'Sim' : 'Não',
        winner.name ?? '',
        winner.phone ?? '',
        winner.email ?? '',
        winner.itemTitle,
        winner.couponCode,
        winner.redemptionStatus,
        winner.deliveredAt ?? '',
        winner.redemptionNotes ?? '',
      ])
    }
  }

  if (input.respondents.length) {
    lines.push([])
    lines.push(['Participantes'])
    lines.push(['Data', 'Nome', 'WhatsApp', 'Aniversário', 'E-mail'])

    for (const respondent of input.respondents) {
      lines.push([
        respondent.submittedAt,
        respondent.name ?? '',
        respondent.phone ?? '',
        respondent.birthdayLabel ?? '',
        respondent.email ?? '',
      ])
    }
  }

  if (input.missingProducts?.length) {
    for (const report of input.missingProducts) {
      lines.push([])
      lines.push([`Produtos em falta — ${report.questionTitle}`])
      lines.push(['Produto', 'Menções', 'Porcentagem'])
      for (const item of report.items) {
        lines.push([item.product, String(item.count), `${item.percentage}%`])
      }
    }
  }

  if (input.attendantPerformance?.length) {
    for (const report of input.attendantPerformance) {
      lines.push([])
      lines.push([`Desempenho dos atendentes — ${report.nameQuestionTitle}`])
      lines.push(['Posição', 'Atendente', 'Nota média', 'Avaliações', 'Faixa'])
      for (let i = 0; i < report.attendants.length; i++) {
        const att = report.attendants[i]
        lines.push([`${i + 1}º`, att.name, String(att.averageRating), String(att.ratingCount), `${att.minRating}-${att.maxRating}`])
      }
    }
  }

  return lines.map((line) => line.map(escapeCsvValue).join(',')).join('\n')
}

function buildPdfReport(document: PDFKit.PDFDocument, input: {
  title: string
  range: ReportRange
  summary: ReportSummary
  period: ReportPeriodItem[]
  questions: ReportQuestionItem[]
  respondents: ReportRespondentItem[]
  rewards: {
    summary: RewardSummaryItem
    pickupAddress: string | null
    stock: RewardStockItem[]
    winners: RewardWinnerItem[]
    noPrizeBreakdown: NoPrizeItem[]
  }
  missingProducts?: MissingProductsResponse[]
  attendantPerformance?: AttendantPerformanceResponse[]
}) {
  const summaryLines = [
    `Total de respostas: ${input.summary.total_responses}`,
    `Participação identificada: ${input.summary.identified_responses}`,
    `Prêmios entregues: ${input.summary.reward_wins}`,
    `E-mails coletados: ${input.summary.emails_collected}`,
    `Aniversários coletados: ${input.summary.birthdays_collected}`,
    `Cliques no link: ${input.summary.link_clicks}`,
    `Leituras do QR: ${input.summary.qr_scans}`,
    `Acessos totais: ${input.summary.total_visits}`,
    `Taxa de conversão: ${input.summary.conversion_rate}%`,
    `Giros da roleta: ${input.rewards.summary.total_spins}`,
    `Giros sem prêmio: ${input.rewards.summary.total_no_prize}`,
    `Resgates pendentes: ${input.rewards.summary.pending_redemptions}`,
    `Resgates entregues: ${input.rewards.summary.delivered_redemptions}`,
    `Local de retirada: ${input.rewards.pickupAddress ?? 'Não informado'}`,
  ]

  document.fontSize(20).fillColor('#0f172a').text(input.title)
  document.moveDown(0.4)
  document.fontSize(11).fillColor('#475569').text(`Período: ${input.range.startDate} até ${input.range.endDate}`)
  document.moveDown()

  document.fontSize(14).fillColor('#0f172a').text('Resumo')
  document.moveDown(0.4)
  for (const line of summaryLines) {
    document.fontSize(11).fillColor('#111827').text(line)
  }

  document.moveDown()
  ensurePdfSpace(document, 140)
  document.fontSize(14).fillColor('#0f172a').text('Serie temporal')
  document.moveDown(0.4)
  if (input.period.length) {
    for (const item of input.period) {
      ensurePdfSpace(document, 36)
      document
        .fontSize(10)
        .fillColor('#111827')
        .text(`${item.day}: ${item.visits} acessos | ${item.responses} respostas`)
    }
  } else {
    document.fontSize(10).fillColor('#64748b').text('Nenhum dado disponível para o período selecionado.')
  }

  document.moveDown()
  ensurePdfSpace(document, 160)
  document.fontSize(14).fillColor('#0f172a').text('Perguntas')
  document.moveDown(0.4)

  if (!input.questions.length) {
    document.fontSize(10).fillColor('#64748b').text('Nenhum dado por pergunta disponível para o período selecionado.')
  } else {
    input.questions.forEach((question, index) => {
      ensurePdfSpace(document, 120)
      document.fontSize(12).fillColor('#0f172a').text(`Pergunta ${index + 1}: ${question.title}`)
      document.fontSize(10).fillColor('#475569').text(`Tipo: ${formatQuestionTypeLabel(question.type)}`)
      document
        .fontSize(10)
        .fillColor('#111827')
        .text(`Respostas: ${question.totalAnswers} | Conclusão: ${question.completionRate}%`)

      if (question.averageScore !== undefined) {
        document.fontSize(10).text(`Média: ${question.averageScore}`)
      }

      if (question.nps) {
        document
          .fontSize(10)
          .text(
            `NPS: ${question.nps.score} | Promotores: ${question.nps.promoters} | Neutros: ${question.nps.neutrals} | Detratores: ${question.nps.detractors}`,
          )
      }

      if (question.distribution?.length) {
        question.distribution.forEach((item) => {
          ensurePdfSpace(document, 24)
          document.fontSize(10).text(`- ${item.label}: ${item.count} respostas (${item.percentage}%)`)
        })
      }

      if (question.textSamples?.length) {
        question.textSamples.forEach((sample) => {
          ensurePdfSpace(document, 32)
          document.fontSize(10).text(`- ${sample}`)
        })
      }

      document.moveDown()
    })
  }

  document.moveDown()
  ensurePdfSpace(document, 200)
  document.fontSize(14).fillColor('#0f172a').text('Roleta')
  document.moveDown(0.4)

  if (!input.rewards.stock.length) {
    document.fontSize(10).fillColor('#64748b').text('Nenhum dado da roleta disponível para o período selecionado.')
  } else {
    document
      .fontSize(10)
      .fillColor('#111827')
      .text(`Giros no período: ${input.rewards.summary.total_spins}`)
      .text(`Prêmios sorteados: ${input.rewards.summary.total_wins}`)
      .text(`Opções sem prêmio: ${input.rewards.summary.total_no_prize}`)
    document.moveDown(0.4)

    input.rewards.stock.forEach((item) => {
      ensurePdfSpace(document, 42)
      document
        .fontSize(10)
        .text(
          `${item.title}: ${item.winsInRange} prêmios no período | ${item.quantityAwarded}/${item.quantityTotal} entregues | estoque restante ${item.remainingStock}`,
        )
    })

    if (input.rewards.noPrizeBreakdown.length) {
      document.moveDown(0.6)
      ensurePdfSpace(document, 80)
      document.fontSize(11).fillColor('#0f172a').text('Opções sem prêmio')
      input.rewards.noPrizeBreakdown.forEach((item) => {
        ensurePdfSpace(document, 24)
        document.fontSize(10).fillColor('#111827').text(`- ${item.label}: ${item.count} vezes`)
      })
    }
  }

  document.moveDown()
  ensurePdfSpace(document, 180)
  document.fontSize(14).fillColor('#0f172a').text('Participantes')
  document.moveDown(0.4)

  if (!input.respondents.length) {
    document.fontSize(10).fillColor('#64748b').text('Nenhum participante disponível para o período selecionado.')
  } else {
    input.respondents.forEach((respondent) => {
      ensurePdfSpace(document, 72)
      document
        .fontSize(10)
        .fillColor('#111827')
        .text(`Data: ${respondent.submittedAt}`)
        .text(`Nome: ${respondent.name ?? '-'}`)
        .text(`WhatsApp: ${respondent.phone ?? '-'}`)
        .text(`Aniversário: ${respondent.birthdayLabel ?? '-'}`)
        .text(`E-mail: ${respondent.email ?? '-'}`)
      document.moveDown(0.6)
    })
  }

  document.moveDown()
  ensurePdfSpace(document, 180)
  document.fontSize(14).fillColor('#0f172a').text('Ganhadores')
  document.moveDown(0.4)

  if (!input.rewards.winners.length) {
    document.fontSize(10).fillColor('#64748b').text('Nenhum ganhador disponível para o período selecionado.')
  } else {
    input.rewards.winners.forEach((winner) => {
      ensurePdfSpace(document, 84)
      document
        .fontSize(10)
        .fillColor('#111827')
        .text(`Data: ${winner.awardedAt}`)
        .text(`Validade: ${winner.expiresAt}`)
        .text(`Expirado: ${winner.isExpired ? 'Sim' : 'Não'}`)
        .text(`Nome: ${winner.name ?? '-'}`)
        .text(`WhatsApp: ${winner.phone ?? '-'}`)
        .text(`E-mail: ${winner.email ?? '-'}`)
        .text(`Prêmio: ${winner.itemTitle}`)
        .text(`Protocolo: ${winner.couponCode}`)
        .text(`Status: ${winner.redemptionStatus}`)
        .text(`Retirado em: ${winner.deliveredAt ?? '-'}`)
        .text(`Observações: ${winner.redemptionNotes ?? '-'}`)
      document.moveDown(0.6)
    })
  }

  if (input.missingProducts?.length) {
    document.moveDown()
    ensurePdfSpace(document, 180)
    document.fontSize(14).fillColor('#0f172a').text('Produtos em falta')
    document.moveDown(0.4)
    for (const report of input.missingProducts) {
      ensurePdfSpace(document, 60)
      document.fontSize(11).fillColor('#0f172a').text(report.questionTitle)
      document.moveDown(0.2)
      for (const item of report.items) {
        ensurePdfSpace(document, 24)
        document.fontSize(10).fillColor('#111827').text(`${item.product}: ${item.count} menções (${item.percentage}%)`)
      }
      document.moveDown(0.4)
    }
  }

  if (input.attendantPerformance?.length) {
    document.moveDown()
    ensurePdfSpace(document, 180)
    document.fontSize(14).fillColor('#0f172a').text('Desempenho dos atendentes')
    document.moveDown(0.4)
    for (const report of input.attendantPerformance) {
      ensurePdfSpace(document, 60)
      document.fontSize(11).fillColor('#0f172a').text(report.nameQuestionTitle)
      document.moveDown(0.2)
      for (let i = 0; i < report.attendants.length; i++) {
        const att = report.attendants[i]
        ensurePdfSpace(document, 24)
        document.fontSize(10).fillColor('#111827').text(`${i + 1}º ${att.name}: nota média ${att.averageRating} (${att.ratingCount} avaliações)`)
      }
      document.moveDown(0.4)
    }
  }
}

reportsRouter.use(requireAuth)

reportsRouter.get('/surveys/:id/reports/summary', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const canViewTracking = await hasFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'survey_share_tracking',
  )

  response.json(await getSummaryReportData(surveyId, getReportRange(request), canViewTracking))
})

reportsRouter.get('/surveys/:id/reports/questions', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  response.json(await getQuestionReportData(surveyId, getReportRange(request)))
})

reportsRouter.get('/surveys/:id/reports/respondents', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  response.json(
    await getRespondentsReportData(surveyId, getReportRange(request), {
      pagination: getPaginationQuery(request),
    }),
  )
})

reportsRouter.get('/surveys/:id/reports/rewards', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  response.json(
    await getRewardReportData(surveyId, getReportRange(request), {
      winnerFilters: getWinnerFilters(request),
      winnerPagination: getPaginationQuery(request),
    }),
  )
})

reportsRouter.get('/surveys/:id/reports/export.csv', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const featureAccess = await ensureFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'reports_export_csv',
  )

  if (!featureAccess.ok) {
    response.status(featureAccess.status).json({ message: featureAccess.message })
    return
  }

  const range = getReportRange(request)
  const canViewTracking = await hasFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'survey_share_tracking',
  )
  const [title, summaryData, questionsData, respondentsData, rewardsData, missingProductsData, attendantPerformanceData] = await Promise.all([
    getSurveyReportTitle(surveyId),
    getSummaryReportData(surveyId, range, canViewTracking),
    getQuestionReportData(surveyId, range),
    getRespondentsReportData(surveyId, range, { all: true }),
    getRewardReportData(surveyId, range, { includeAllWinners: true }),
    getMissingProductsReportData(surveyId, range),
    getAttendantPerformanceReportData(surveyId, range),
  ])

  const fileName = `relatorio-${sanitizeFileName(title)}-${range.startDate}-${range.endDate}.csv`
  const csv = buildCsvReportContent({
    title,
    range,
    summary: summaryData.summary,
    period: summaryData.period,
    questions: questionsData.questions,
    respondents: respondentsData.respondents,
    rewards: rewardsData,
    missingProducts: missingProductsData,
    attendantPerformance: attendantPerformanceData,
  })

  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  response.send(`\ufeff${csv}`)
})

reportsRouter.get('/surveys/:id/reports/export.pdf', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const featureAccess = await ensureFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'reports_export_pdf',
  )

  if (!featureAccess.ok) {
    response.status(featureAccess.status).json({ message: featureAccess.message })
    return
  }

  const range = getReportRange(request)
  const canViewTracking = await hasFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'survey_share_tracking',
  )
  const [title, summaryData, questionsData, respondentsData, rewardsData, missingProductsData, attendantPerformanceData] = await Promise.all([
    getSurveyReportTitle(surveyId),
    getSummaryReportData(surveyId, range, canViewTracking),
    getQuestionReportData(surveyId, range),
    getRespondentsReportData(surveyId, range, { all: true }),
    getRewardReportData(surveyId, range, { includeAllWinners: true }),
    getMissingProductsReportData(surveyId, range),
    getAttendantPerformanceReportData(surveyId, range),
  ])

  const fileName = `relatorio-${sanitizeFileName(title)}-${range.startDate}-${range.endDate}.pdf`
  response.setHeader('Content-Type', 'application/pdf')
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

  const document = new PDFDocument({
    margin: 40,
    size: 'A4',
  })

  document.pipe(response)
  buildPdfReport(document, {
    title,
    range,
    summary: summaryData.summary,
    period: summaryData.period,
    questions: questionsData.questions,
    respondents: respondentsData.respondents,
    rewards: rewardsData,
    missingProducts: missingProductsData,
    attendantPerformance: attendantPerformanceData,
  })
  document.end()
})

function buildParticipantsCsvContent(input: {
  title: string
  range: ReportRange
  respondents: ReportRespondentItem[]
}) {
  const lines: string[][] = [
    ['Participantes da pesquisa', input.title],
    ['Período', `${input.range.startDate} até ${input.range.endDate}`],
    ['Total de participantes', String(input.respondents.length)],
    [],
    ['Nome', 'WhatsApp', 'Aniversário', 'E-mail', 'Data de participação'],
  ]

  for (const respondent of input.respondents) {
    lines.push([
      respondent.name ?? '',
      respondent.phone ?? '',
      respondent.birthdayLabel ?? '',
      respondent.email ?? '',
      respondent.submittedAt,
    ])
  }

  return lines.map((line) => line.map(escapeCsvValue).join(',')).join('\n')
}

reportsRouter.get('/surveys/:id/reports/export-participants.csv', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const featureAccess = await ensureFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'reports_export_csv',
  )

  if (!featureAccess.ok) {
    response.status(featureAccess.status).json({ message: featureAccess.message })
    return
  }

  const range = getReportRange(request)
  const [title, respondentsData] = await Promise.all([
    getSurveyReportTitle(surveyId),
    getRespondentsReportData(surveyId, range, { all: true }),
  ])

  const fileName = `participantes-${sanitizeFileName(title)}-${range.startDate}-${range.endDate}.csv`
  const csv = buildParticipantsCsvContent({ title, range, respondents: respondentsData.respondents })

  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  response.send(`\ufeff${csv}`)
})

function buildParticipantsTxtContent(input: {
  title: string
  range: ReportRange
  respondents: ReportRespondentItem[]
}) {
  const separator = '─'.repeat(70)
  const lines: string[] = [
    separator,
    `  PARTICIPANTES DA PESQUISA: ${input.title}`,
    `  Período: ${input.range.startDate} até ${input.range.endDate}`,
    `  Total de participantes: ${input.respondents.length}`,
    separator,
    '',
  ]

  for (let i = 0; i < input.respondents.length; i++) {
    const r = input.respondents[i]
    lines.push(`  ${i + 1}. Nome: ${r.name ?? 'Não informado'}`)
    lines.push(`     WhatsApp: ${r.phone ?? 'Não informado'}`)
    lines.push(`     Aniversário: ${r.birthdayLabel ?? 'Não informado'}`)
    lines.push(`     E-mail: ${r.email ?? 'Não informado'}`)
    lines.push(`     Data de participação: ${r.submittedAt}`)
    lines.push('')
  }

  lines.push(separator)
  return lines.join('\n')
}

function buildParticipantsPdfDocument(document: PDFKit.PDFDocument, input: {
  title: string
  range: ReportRange
  respondents: ReportRespondentItem[]
}) {
  document.fontSize(18).fillColor('#0f172a').text(`Participantes — ${input.title}`)
  document.moveDown(0.3)
  document.fontSize(11).fillColor('#475569').text(`Período: ${input.range.startDate} até ${input.range.endDate}`)
  document.fontSize(11).fillColor('#475569').text(`Total: ${input.respondents.length} participante(s)`)
  document.moveDown()

  // Table header
  const colX = { name: 40, phone: 180, birthday: 290, email: 350, date: 490 }
  ensurePdfSpace(document, 40)
  document.fontSize(9).fillColor('#64748b').font('Helvetica-Bold')
  document.text('Nome', colX.name, undefined, { width: 130 })
  document.text('WhatsApp', colX.phone, undefined, { width: 100 })
  document.text('Aniv.', colX.birthday, undefined, { width: 50 })
  document.text('E-mail', colX.email, undefined, { width: 130 })
  document.text('Data', colX.date, undefined, { width: 100 })
  document.moveDown(0.3)

  // Divider line
  const pageWidth = document.page.width - 80
  document.moveTo(40, document.y).lineTo(40 + pageWidth, document.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke()
  document.moveDown(0.3)

  document.font('Helvetica')

  for (const r of input.respondents) {
    ensurePdfSpace(document, 36)
    const startY = document.y
    document.fontSize(8).fillColor('#111827')
    document.text(r.name ?? 'Não informado', colX.name, startY, { width: 130, lineBreak: false })
    document.text(r.phone ?? '-', colX.phone, startY, { width: 100, lineBreak: false })
    document.text(r.birthdayLabel ?? '-', colX.birthday, startY, { width: 50, lineBreak: false })
    document.text(r.email ?? '-', colX.email, startY, { width: 130, lineBreak: false })
    document.text(r.submittedAt, colX.date, startY, { width: 100 })
    document.moveDown(0.2)
  }
}

reportsRouter.get('/surveys/:id/reports/export-participants.txt', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const featureAccess = await ensureFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'reports_export_csv',
  )

  if (!featureAccess.ok) {
    response.status(featureAccess.status).json({ message: featureAccess.message })
    return
  }

  const range = getReportRange(request)
  const [title, respondentsData] = await Promise.all([
    getSurveyReportTitle(surveyId),
    getRespondentsReportData(surveyId, range, { all: true }),
  ])

  const fileName = `participantes-${sanitizeFileName(title)}-${range.startDate}-${range.endDate}.txt`
  const txt = buildParticipantsTxtContent({ title, range, respondents: respondentsData.respondents })

  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  response.send(txt)
})

reportsRouter.get('/surveys/:id/reports/export-participants.pdf', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  const featureAccess = await ensureFeatureAccess(
    request.auth!.userId,
    request.auth!.roleCode,
    'reports_export_pdf',
  )

  if (!featureAccess.ok) {
    response.status(featureAccess.status).json({ message: featureAccess.message })
    return
  }

  const range = getReportRange(request)
  const [title, respondentsData] = await Promise.all([
    getSurveyReportTitle(surveyId),
    getRespondentsReportData(surveyId, range, { all: true }),
  ])

  const fileName = `participantes-${sanitizeFileName(title)}-${range.startDate}-${range.endDate}.pdf`
  response.setHeader('Content-Type', 'application/pdf')
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)

  const document = new PDFDocument({ margin: 40, size: 'A4' })
  document.pipe(response)
  buildParticipantsPdfDocument(document, { title, range, respondents: respondentsData.respondents })
  document.end()
})

reportsRouter.get('/reports/global', requireMaster, async (_request, response) => {
  const result = await query<{
    surveys: string
    users: string
    responses: string
    wins: string
  }>(
    `select
        (select cast(count(*) as text) from surveys) as surveys,
        (select cast(count(*) as text) from users where deleted_at is null) as users,
        (select cast(count(*) as text) from survey_responses) as responses,
        (select cast(count(*) as text) from reward_wins) as wins`,
  )

  response.json({ metrics: result.rows[0] })
})

reportsRouter.get('/reports/nps-overview', async (request: AuthenticatedRequest, response) => {
  response.json({
    summary: await getNpsOverviewData(request.auth!.userId, request.auth!.roleCode),
  })
})

// --- Business Metrics Reports ---

type MissingProductItem = {
  product: string
  count: number
  percentage: number
}

type MissingProductsResponse = {
  questionId: string
  questionTitle: string
  totalResponses: number
  items: MissingProductItem[]
}

async function getMissingProductsReportData(
  surveyId: string,
  range: ReportRange,
): Promise<MissingProductsResponse[]> {
  // Find questions marked as missing_product
  const metricQuestions = await query<{
    id: string
    title: string
    settings_json: { businessMetric?: string }
  }>(
    `select id, title, settings_json
     from survey_questions
     where survey_id = $1
       and settings_json->>'businessMetric' = 'missing_product'
     order by position asc`,
    [surveyId],
  )

  if (!metricQuestions.rows.length) {
    return []
  }

  const totalResponsesResult = await query<{ total: string }>(
    `select cast(count(*) as text) as total
     from survey_responses
     where survey_id = $1
       and submitted_at >= $2::date
       and submitted_at < ($3::date + interval '1 day')`,
    [surveyId, range.startDate, range.endDate],
  )
  const totalResponses = Number(totalResponsesResult.rows[0]?.total ?? 0)

  const results: MissingProductsResponse[] = []

  for (const q of metricQuestions.rows) {
    const answers = await query<{ answer_text: string | null; answer_json: unknown }>(
      `select ra.answer_text, ra.answer_json
       from response_answers ra
       join survey_responses sr on sr.id = ra.response_id
       where ra.question_id = $1
         and sr.survey_id = $2
         and sr.submitted_at >= $3::date
         and sr.submitted_at < ($4::date + interval '1 day')`,
      [q.id, surveyId, range.startDate, range.endDate],
    )

    const counts = new Map<string, number>()
    let totalAnswers = 0

    for (const row of answers.rows) {
      const text = parseStoredAnswerValue(row.answer_text, row.answer_json)
      if (typeof text === 'string' && text.trim()) {
        const normalized = text.trim().toLowerCase()
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
        totalAnswers++
      }
    }

    const items = Array.from(counts.entries())
      .map(([product, count]) => ({
        product,
        count,
        percentage: totalAnswers ? roundNumber((count / totalAnswers) * 100, 2) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    results.push({
      questionId: q.id,
      questionTitle: q.title,
      totalResponses,
      items,
    })
  }

  return results
}

type AttendantPerformanceItem = {
  name: string
  averageRating: number
  ratingCount: number
  minRating: number
  maxRating: number
}

type AttendantPerformanceResponse = {
  nameQuestionId: string
  nameQuestionTitle: string
  ratingQuestionId: string
  ratingQuestionTitle: string
  totalEvaluations: number
  attendants: AttendantPerformanceItem[]
}

async function getAttendantPerformanceReportData(
  surveyId: string,
  range: ReportRange,
): Promise<AttendantPerformanceResponse[]> {
  // Find questions marked as attendant_rating (they link to the attendant_name question)
  const ratingQuestions = await query<{
    id: string
    title: string
    settings_json: { businessMetric?: string; linkedQuestionId?: string }
  }>(
    `select id, title, settings_json
     from survey_questions
     where survey_id = $1
       and settings_json->>'businessMetric' = 'attendant_rating'
     order by position asc`,
    [surveyId],
  )

  if (!ratingQuestions.rows.length) {
    return []
  }

  const results: AttendantPerformanceResponse[] = []

  for (const rq of ratingQuestions.rows) {
    const linkedQuestionId = rq.settings_json?.linkedQuestionId
    if (!linkedQuestionId) continue

    // Verify linked question exists and is a text type (attendant_name)
    const nameQuestion = await query<{
      id: string
      title: string
      type: string
    }>(
      `select id, title, type
       from survey_questions
       where id = $1 and survey_id = $2`,
      [linkedQuestionId, surveyId],
    )

    if (!nameQuestion.rows.length) continue
    const nq = nameQuestion.rows[0]

    // Fetch registered attendants for matching
    const registeredAttendants = await query<{ id: string; name: string; is_active: boolean }>(
      `select id, name, is_active from survey_attendants where survey_id = $1 order by name asc`,
      [surveyId],
    )

    // Build normalized name -> registered name map (only active attendants)
    const registeredNameMap = new Map<string, string>()
    for (const att of registeredAttendants.rows) {
      if (att.is_active) {
        registeredNameMap.set(att.name.toLowerCase(), att.name)
      }
    }

    // Get paired answers: name + rating from same response
    const pairedAnswers = await query<{
      response_id: string
      name_text: string | null
      name_json: unknown
      rating_text: string | null
      rating_json: unknown
    }>(
      `select
         ra_name.response_id,
         ra_name.answer_text as name_text,
         ra_name.answer_json as name_json,
         ra_rating.answer_text as rating_text,
         ra_rating.answer_json as rating_json
       from response_answers ra_name
       join response_answers ra_rating
         on ra_rating.response_id = ra_name.response_id
         and ra_rating.question_id = $2
       join survey_responses sr on sr.id = ra_name.response_id
       where ra_name.question_id = $1
         and sr.survey_id = $3
         and sr.submitted_at >= $4::date
         and sr.submitted_at < ($5::date + interval '1 day')`,
      [nq.id, rq.id, surveyId, range.startDate, range.endDate],
    )

    const attendantMap = new Map<
      string,
      { ratings: number[]; count: number; displayName: string }
    >()

    for (const row of pairedAnswers.rows) {
      const name = parseStoredAnswerValue(row.name_text, row.name_json)
      const rating = parseStoredAnswerValue(row.rating_text, row.rating_json)

      if (typeof name !== 'string' || !name.trim()) continue
      const numericRating = extractNumericValue(rating)
      if (numericRating === null) continue

      const trimmedName = name.trim()
      const normalizedKey = trimmedName.toLowerCase()

      // Try to match against registered attendants (exact match)
      const matchedName = registeredNameMap.get(normalizedKey)
      const displayName = matchedName ?? toTitleCase(trimmedName)
      const mapKey = matchedName ? matchedName.toLowerCase() : normalizedKey

      const existing = attendantMap.get(mapKey) ?? { ratings: [], count: 0, displayName }
      existing.ratings.push(numericRating)
      existing.count++
      attendantMap.set(mapKey, existing)
    }

    const attendants = Array.from(attendantMap.entries())
      .map(([, data]) => {
        const avg = data.ratings.reduce((s, v) => s + v, 0) / data.ratings.length
        return {
          name: data.displayName,
          averageRating: roundNumber(avg, 2),
          ratingCount: data.count,
          minRating: Math.min(...data.ratings),
          maxRating: Math.max(...data.ratings),
        }
      })
      .sort((a, b) => b.averageRating - a.averageRating || b.ratingCount - a.ratingCount)

    results.push({
      nameQuestionId: nq.id,
      nameQuestionTitle: nq.title,
      ratingQuestionId: rq.id,
      ratingQuestionTitle: rq.title,
      totalEvaluations: attendants.reduce((sum, a) => sum + a.ratingCount, 0),
      attendants,
    })
  }

  return results
}

reportsRouter.get('/surveys/:id/reports/missing-products', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  response.json(await getMissingProductsReportData(surveyId, getReportRange(request)))
})

reportsRouter.get('/surveys/:id/reports/attendant-performance', async (request: AuthenticatedRequest, response) => {
  const surveyId = String(request.params.id)
  const access = await ensureSurveyAccess(surveyId, request.auth!.userId, request.auth!.roleCode)

  if (!access.ok) {
    response.status(access.status).json({ message: access.message })
    return
  }

  response.json(await getAttendantPerformanceReportData(surveyId, getReportRange(request)))
})
