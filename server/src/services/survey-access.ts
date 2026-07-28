import { query } from '../db/pool.js'

export async function ensureSurveyAccess(surveyId: string, userId: string, roleCode: string) {
  const result = await query<{ owner_user_id: string }>('select owner_user_id from surveys where id = $1', [surveyId])
  const survey = result.rows[0]

  if (!survey) {
    return { ok: false as const, status: 404, message: 'Pesquisa não encontrada.' }
  }

  if (roleCode !== 'master' && survey.owner_user_id !== userId) {
    return { ok: false as const, status: 403, message: 'Acesso negado.' }
  }

  return { ok: true as const }
}
