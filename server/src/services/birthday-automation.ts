import { query } from '../db/pool.js'
import { hasFeatureAccess } from './feature-access.js'
import { makeId } from '../utils/security.js'

export const defaultBirthdayMessageTemplate =
  'Feliz aniversário, {{name}}! A equipe da {{brand_name}} deseja um dia maravilhoso para você.'

export type BirthdayAutomationSettings = {
  id: string
  ownerUserId: string
  isEnabled: boolean
  messageTemplate: string
}

export type BirthdayRecipient = {
  responseId: string
  surveyId: string
  surveyTitle: string
  brandName: string
  name: string
  phone: string
  email: string | null
  birthDay: number
  birthMonth: number
  birthdayLabel: string
  submittedAt: string
}

export type BirthdayDispatchItem = {
  id: string
  dispatchDate: string
  participantName: string | null
  participantPhone: string
  participantEmail: string | null
  renderedMessage: string
  status: string
  surveyId: string
  queuedAt: string
  sentAt: string | null
}

function getTodayBirthdayParts(referenceDate = new Date()) {
  return {
    day: referenceDate.getDate(),
    month: referenceDate.getMonth() + 1,
    isoDate: referenceDate.toISOString().slice(0, 10),
  }
}

function formatBirthdayLabel(day: number, month: number) {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`
}

export function renderBirthdayMessage(template: string, input: { name: string; brandName: string }) {
  return template
    .split('{{name}}')
    .join(input.name)
    .split('{{brand_name}}')
    .join(input.brandName)
    .trim()
}

export async function getBirthdayAutomationSettings(userId: string) {
  const result = await query<{
    id: string
    owner_user_id: string
    is_enabled: boolean
    message_template: string
  }>(
    `select id, owner_user_id, is_enabled, message_template
     from birthday_automation_settings
     where owner_user_id = $1
     limit 1`,
    [userId],
  )

  const row = result.rows[0]

  if (!row) {
    return null
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    isEnabled: row.is_enabled,
    messageTemplate: row.message_template,
  } satisfies BirthdayAutomationSettings
}

export async function upsertBirthdayAutomationSettings(input: {
  userId: string
  isEnabled: boolean
  messageTemplate: string
}) {
  const existing = await getBirthdayAutomationSettings(input.userId)

  if (existing) {
    await query(
      `update birthday_automation_settings
       set is_enabled = $2,
           message_template = $3,
           updated_at = now()
       where owner_user_id = $1`,
      [input.userId, input.isEnabled, input.messageTemplate],
    )

    return {
      ...existing,
      isEnabled: input.isEnabled,
      messageTemplate: input.messageTemplate,
    }
  }

  const created = {
    id: makeId(),
    ownerUserId: input.userId,
    isEnabled: input.isEnabled,
    messageTemplate: input.messageTemplate,
  }

  await query(
    `insert into birthday_automation_settings (id, owner_user_id, is_enabled, message_template)
     values ($1, $2, $3, $4)`,
    [created.id, created.ownerUserId, created.isEnabled, created.messageTemplate],
  )

  return created
}

export async function getTodayBirthdayRecipients(userId: string, referenceDate = new Date()) {
  const today = getTodayBirthdayParts(referenceDate)
  const result = await query<{
    response_id: string
    survey_id: string
    survey_title: string
    brand_name: string
    participant_name: string
    participant_phone: string
    participant_email: string | null
    participant_birth_day: number
    participant_birth_month: number
    submitted_at: string
  }>(
    `with ranked_responses as (
        select
          survey_responses.id as response_id,
          surveys.id as survey_id,
          surveys.title as survey_title,
          surveys.brand_name,
          survey_responses.participant_name,
          survey_responses.participant_phone,
          survey_responses.participant_email,
          survey_responses.participant_birth_day,
          survey_responses.participant_birth_month,
          survey_responses.submitted_at,
          row_number() over (
            partition by survey_responses.participant_phone
            order by survey_responses.submitted_at desc, survey_responses.id desc
          ) as position
        from survey_responses
        join surveys on surveys.id = survey_responses.survey_id
        where surveys.owner_user_id = $1
          and survey_responses.participant_name is not null
          and survey_responses.participant_phone is not null
          and survey_responses.participant_birth_day = $2
          and survey_responses.participant_birth_month = $3
      )
      select
        response_id,
        survey_id,
        survey_title,
        brand_name,
        participant_name,
        participant_phone,
        participant_email,
        participant_birth_day,
        participant_birth_month,
        submitted_at
      from ranked_responses
      where position = 1
      order by participant_name asc`,
    [userId, today.day, today.month],
  )

  return result.rows.map((row) => ({
    responseId: row.response_id,
    surveyId: row.survey_id,
    surveyTitle: row.survey_title,
    brandName: row.brand_name,
    name: row.participant_name,
    phone: row.participant_phone,
    email: row.participant_email,
    birthDay: row.participant_birth_day,
    birthMonth: row.participant_birth_month,
    birthdayLabel: formatBirthdayLabel(row.participant_birth_day, row.participant_birth_month),
    submittedAt: row.submitted_at,
  })) satisfies BirthdayRecipient[]
}

export async function getRecentBirthdayDispatches(userId: string, limit = 20) {
  const result = await query<{
    id: string
    dispatch_date: string
    participant_name: string | null
    participant_phone: string
    participant_email: string | null
    rendered_message: string
    status: string
    survey_id: string
    queued_at: string
    sent_at: string | null
  }>(
    `select
        id,
        dispatch_date,
        participant_name,
        participant_phone,
        participant_email,
        rendered_message,
        status,
        survey_id,
        queued_at,
        sent_at
     from birthday_message_dispatches
     where owner_user_id = $1
     order by dispatch_date desc, queued_at desc
     limit $2`,
    [userId, limit],
  )

  return result.rows.map((row) => ({
    id: row.id,
    dispatchDate: row.dispatch_date,
    participantName: row.participant_name,
    participantPhone: row.participant_phone,
    participantEmail: row.participant_email,
    renderedMessage: row.rendered_message,
    status: row.status,
    surveyId: row.survey_id,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
  })) satisfies BirthdayDispatchItem[]
}

export async function queueBirthdayDispatchesForUser(input: {
  userId: string
  roleCode: string
  requirePlanAccess?: boolean
  referenceDate?: Date
}) {
  if (input.requirePlanAccess) {
    const canSend = await hasFeatureAccess(input.userId, input.roleCode, 'birthday_whatsapp_automation')

    if (!canSend) {
      return {
        ok: false as const,
        message: 'O envio de aniversário por WhatsApp não está disponível no plano atual.',
        queuedCount: 0,
        queued: [] as BirthdayDispatchItem[],
      }
    }
  }

  const settings =
    (await getBirthdayAutomationSettings(input.userId)) ??
    ({
      id: '',
      ownerUserId: input.userId,
      isEnabled: false,
      messageTemplate: defaultBirthdayMessageTemplate,
    } satisfies BirthdayAutomationSettings)

  if (!settings.isEnabled) {
    return {
      ok: false as const,
      message: 'Ative a automação de aniversário antes de executar o envio diário.',
      queuedCount: 0,
      queued: [] as BirthdayDispatchItem[],
    }
  }

  const today = getTodayBirthdayParts(input.referenceDate)
  const recipients = await getTodayBirthdayRecipients(input.userId, input.referenceDate)
  const queued: BirthdayDispatchItem[] = []

  for (const recipient of recipients) {
    const renderedMessage = renderBirthdayMessage(settings.messageTemplate, {
      name: recipient.name,
      brandName: recipient.brandName,
    })

    const insertResult = await query<{
      id: string
      dispatch_date: string
      participant_name: string | null
      participant_phone: string
      participant_email: string | null
      rendered_message: string
      status: string
      survey_id: string
      queued_at: string
      sent_at: string | null
    }>(
      `insert into birthday_message_dispatches (
        id, owner_user_id, survey_response_id, survey_id, dispatch_date, participant_name, participant_phone,
        participant_email, rendered_message, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')
       on conflict (owner_user_id, participant_phone, dispatch_date) do nothing
       returning
         id,
         dispatch_date,
         participant_name,
         participant_phone,
         participant_email,
         rendered_message,
         status,
         survey_id,
         queued_at,
         sent_at`,
      [
        makeId(),
        input.userId,
        recipient.responseId,
        recipient.surveyId,
        today.isoDate,
        recipient.name,
        recipient.phone,
        recipient.email,
        renderedMessage,
      ],
    )

    const inserted = insertResult.rows[0]

    if (inserted) {
      queued.push({
        id: inserted.id,
        dispatchDate: inserted.dispatch_date,
        participantName: inserted.participant_name,
        participantPhone: inserted.participant_phone,
        participantEmail: inserted.participant_email,
        renderedMessage: inserted.rendered_message,
        status: inserted.status,
        surveyId: inserted.survey_id,
        queuedAt: inserted.queued_at,
        sentAt: inserted.sent_at,
      })
    }
  }

  return {
    ok: true as const,
    message: queued.length
      ? `${queued.length} mensagem(ns) de aniversário ficaram prontas na fila de envio.`
      : 'Nenhum aniversariante novo precisou entrar na fila hoje.',
    queuedCount: queued.length,
    queued,
  }
}
