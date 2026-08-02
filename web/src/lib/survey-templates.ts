export type SurveyCreateFormState = {
  title: string
  description: string
  slug: string
  brandName: string
  primaryColor: string
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createEmptySurveyForm(defaults?: Partial<SurveyCreateFormState>): SurveyCreateFormState {
  return {
    title: '',
    description: '',
    slug: '',
    brandName: 'Minha marca',
    primaryColor: '#0b5cff',
    ...defaults,
  }
}

export function buildCustomSurveyPayload(form: SurveyCreateFormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    participationMode: 'identified' as const,
    slug: slugify(form.slug.trim()),
    brandName: form.brandName.trim(),
    logoUrl: '',
    primaryColor: form.primaryColor.trim(),
    bannerUrl: '',
    closingMessage: 'Obrigado por participar. Sua resposta foi registrada com sucesso.',
    rewardEnabled: false,
    preventDuplicateResponses: true,
    duplicateResponseCooldownDays: 15,
    questions: [
      {
        title: 'Como você avalia sua experiência?',
        description: '',
        type: 'short_text' as const,
        isRequired: true,
        position: 0,
        options: [],
      },
    ],
  }
}

export function buildNpsSurveyPayload(form: SurveyCreateFormState) {
  return {
    title: form.title.trim(),
    description:
      form.description.trim() ||
      'Modelo NPS com pergunta principal de recomendação e campo aberto para entender o motivo da nota.',
    participationMode: 'identified' as const,
    slug: slugify(form.slug.trim()),
    brandName: form.brandName.trim(),
    logoUrl: '',
    primaryColor: form.primaryColor.trim(),
    bannerUrl: '',
    closingMessage: 'Obrigado por compartilhar sua nota. Sua opinião vai ajudar a melhorar a experiência.',
    rewardEnabled: false,
    preventDuplicateResponses: true,
    duplicateResponseCooldownDays: 15,
    questions: [
      {
        title: 'De 0 a 10, o quanto você indicaria nossa empresa para um amigo ou colega?',
        description: '0 significa nada provável e 10 significa muito provável.',
        type: 'nps' as const,
        isRequired: true,
        position: 0,
        options: [],
      },
      {
        title: 'Qual foi o principal motivo da sua nota?',
        description: 'Use este campo para entender o que mais agradou ou o que precisa melhorar.',
        type: 'long_text' as const,
        isRequired: false,
        position: 1,
        options: [],
      },
      {
        title: 'O que podemos fazer para melhorar sua experiência?',
        description: 'Pergunta opcional para captar sugestões práticas.',
        type: 'long_text' as const,
        isRequired: false,
        position: 2,
        options: [],
      },
    ],
  }
}
