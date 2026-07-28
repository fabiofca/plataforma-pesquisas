const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4310/api'
const MASTER_EMAIL = process.env.MASTER_EMAIL ?? 'master@plataforma.local'
const MASTER_PASSWORD = process.env.MASTER_PASSWORD ?? 'master1234'

let cookieJar = ''

function setCookies(response) {
  const raw = response.headers.get('set-cookie')

  if (!raw) {
    return
  }

  cookieJar = raw
    .split(/,(?=[^;]+?=)/)
    .map((item) => item.split(';')[0].trim())
    .join('; ')
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(cookieJar ? { cookie: cookieJar } : {}),
      ...(options.headers ?? {}),
    },
  })

  setCookies(response)

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${JSON.stringify(data)}`)
  }

  return data
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function run() {
  const slug = `pesquisa-smoke-${Date.now()}`
  const userEmail = `operador.${Date.now()}@plataforma.local`
  let rollbackSettings = null

  try {
    console.log('1) Login master')
    const login = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: MASTER_EMAIL,
        password: MASTER_PASSWORD,
      }),
    })

    assert(login.user?.roleCode === 'master', 'Login master não retornou role master.')

    console.log('2) Sessão atual')
    const me = await api('/auth/me')
    assert(me.user?.email === MASTER_EMAIL, 'Sessão atual não corresponde ao usuário master.')

    console.log('3) Configurações globais')
    const settingsBefore = await api('/system-settings')
    const previousSettings = new Map(
      (settingsBefore.settings ?? []).map((setting) => [setting.setting_key, setting.setting_value]),
    )
    const temporaryPlatformName = `Plataforma Pesquisas Smoke ${Date.now()}`
    const temporarySupportEmail = `suporte.smoke.${Date.now()}@plataforma.local`

    rollbackSettings = [
      {
        key: 'platform_name',
        value:
          typeof previousSettings.get('platform_name') === 'string'
            ? previousSettings.get('platform_name')
            : 'Plataforma Pesquisas',
      },
      {
        key: 'support_email',
        value:
          typeof previousSettings.get('support_email') === 'string'
            ? previousSettings.get('support_email')
            : '',
      },
    ]

    await api('/system-settings', {
      method: 'PATCH',
      body: JSON.stringify([
        { key: 'platform_name', value: temporaryPlatformName },
        { key: 'support_email', value: temporarySupportEmail },
      ]),
    })

    const settings = await api('/system-settings')
    assert(Array.isArray(settings.settings) && settings.settings.length >= 2, 'Configurações globais não foram persistidas.')
    assert(
      settings.settings.some((setting) => setting.setting_key === 'platform_name' && setting.setting_value === temporaryPlatformName),
      'Configuração temporária de nome da plataforma não foi persistida.',
    )
    assert(
      settings.settings.some((setting) => setting.setting_key === 'support_email' && setting.setting_value === temporarySupportEmail),
      'Configuração temporária de email de suporte não foi persistida.',
    )

    console.log('4) Criar usuário comum')
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Operador Smoke',
        email: userEmail,
        password: '12345678',
        roleCode: 'user',
        status: 'active',
        phone: '11999999999',
      }),
    })

    const users = await api('/users')
    assert(users.users.some((user) => user.email === userEmail), 'Usuário comum não apareceu na listagem.')

    console.log('5) Criar pesquisa com roleta')
    const surveyCreate = await api('/surveys', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Pesquisa Smoke Test',
        description: 'Fluxo automatizado de validação',
        participationMode: 'identified',
        slug,
        brandName: 'Radar Pesquisas',
        logoUrl: '',
        primaryColor: '#4f46e5',
        bannerUrl: '',
        closingMessage: 'Obrigado por responder.',
        rewardEnabled: true,
        questions: [
          {
            title: 'Como você avalia a experiência?',
            type: 'rating_1_5',
            isRequired: true,
            position: 0,
          },
          {
            title: 'Qual recurso mais gostou?',
            type: 'single_choice',
            isRequired: true,
            position: 1,
            options: ['Dashboard', 'Relatórios', 'Roleta'],
          },
        ],
      }),
    })

    const surveyId = surveyCreate.id
    assert(surveyId, 'Criação da pesquisa não retornou id.')

    console.log('6) Publicar pesquisa')
    await api(`/surveys/${surveyId}/publish`, {
      method: 'POST',
    })

    console.log('7) Configurar campanha e prêmio')
    await api(`/surveys/${surveyId}/rewards`, {
      method: 'POST',
      body: JSON.stringify({
        isActive: true,
        requireIdentification: true,
        distributionMode: 'simple',
      }),
    })

    await api(`/surveys/${surveyId}/rewards/items`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Vale-compras 50',
        description: 'Prêmio de validação automatizada',
        quantityTotal: 5,
        oddsWeight: 3,
        isActive: true,
      }),
    })

    console.log('8) Carregar pesquisa pública')
    const publicSurvey = await api(`/public/surveys/${slug}`)
    assert(publicSurvey.survey?.slug === undefined || publicSurvey.survey?.title, 'Pesquisa pública não retornou dados válidos.')
    const [questionA, questionB] = publicSurvey.survey.questions

    console.log('9) Verificar elegibilidade inicial')
    const eligibilityBefore = await api(`/public/surveys/${slug}/eligibility`, {
      method: 'POST',
      body: JSON.stringify({
        participant: {
          name: 'Participante Smoke',
          email: 'participante.smoke@plataforma.local',
        },
        browserCookieId: 'cookie-smoke-e2e',
        fingerprint: 'fingerprint-smoke-e2e',
      }),
    })
    assert(eligibilityBefore.eligible === true, 'Participante deveria estar elegível antes da resposta.')

    console.log('10) Enviar resposta pública')
    const responsePayload = await api(`/public/surveys/${slug}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        participant: {
          name: 'Participante Smoke',
          email: 'participante.smoke@plataforma.local',
        },
        answers: [
          { questionId: questionA.id, value: 5 },
          { questionId: questionB.id, value: 'Relatórios' },
        ],
        browserCookieId: 'cookie-smoke-e2e',
        fingerprint: 'fingerprint-smoke-e2e',
      }),
    })

    assert(responsePayload.responseId, 'Resposta pública não retornou responseId.')

    console.log('11) Girar roleta')
    const spin = await api(`/public/surveys/${slug}/spin`, {
      method: 'POST',
      body: JSON.stringify({
        responseId: responsePayload.responseId,
      }),
    })

    assert(typeof spin.won === 'boolean', 'Roleta não retornou estado de ganho.')

    console.log('12) Verificar elegibilidade após resposta')
    const eligibilityAfter = await api(`/public/surveys/${slug}/eligibility`, {
      method: 'POST',
      body: JSON.stringify({
        participant: {
          name: 'Participante Smoke',
          email: 'participante.smoke@plataforma.local',
        },
        browserCookieId: 'cookie-smoke-e2e',
        fingerprint: 'fingerprint-smoke-e2e',
      }),
    })
    assert(eligibilityAfter.eligible === false, 'Participante não deveria ficar elegível após responder.')

    console.log('13) Validar relatórios')
    const summary = await api(`/surveys/${surveyId}/reports/summary`)
    assert(summary.summary.total_responses === '1', 'Resumo não refletiu a resposta enviada.')
    assert(summary.range?.startDate && summary.range?.endDate, 'Resumo não retornou o período padrão esperado.')

    const questions = await api(`/surveys/${surveyId}/reports/questions`)
    assert(Array.isArray(questions.questions) && questions.questions.length >= 2, 'Relatório por perguntas não retornou perguntas.')
    assert(questions.totalResponses === 1, 'Relatório por perguntas não consolidou a resposta enviada.')

    const global = await api('/reports/global')
    assert(global.metrics.responses >= '1', 'Relatório global não retornou contagem de respostas.')

    console.log('Smoke test concluído com sucesso.')
    console.log(JSON.stringify({ surveyId, slug, spin, summary: summary.summary, global: global.metrics }, null, 2))
  } finally {
    if (rollbackSettings?.length) {
      try {
        await api('/system-settings', {
          method: 'PATCH',
          body: JSON.stringify(rollbackSettings),
        })
      } catch (error) {
        console.error('Falha ao restaurar system_settings após o smoke test:', error.message)
      }
    }
  }
}

run().catch((error) => {
  console.error('Falha no smoke test:', error.message)
  process.exit(1)
})
