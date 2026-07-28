import { describe, expect, it } from 'vitest'

import { FLOW_END, FLOW_ON_ANSWER, getVisibleSurveyQuestions, isQuestionAnswered } from '@/lib/survey-flow'
import type { SurveyQuestion } from '@/types/domain'

const questions: SurveyQuestion[] = [
  {
    id: 'q1',
    title: 'Gostou?',
    type: 'yes_no',
    required: true,
    flowRules: [
      { value: 'Sim', nextQuestionId: 'q2' },
      { value: 'Não', nextQuestionId: 'q3' },
    ],
  },
  {
    id: 'q2',
    title: 'O que você mais gostou?',
    type: 'short_text',
    required: true,
    flowRules: [{ value: FLOW_ON_ANSWER, nextQuestionId: 'q4' }],
  },
  {
    id: 'q3',
    title: 'Quer encerrar por aqui?',
    type: 'single_choice',
    required: true,
    options: ['Encerrar', 'Continuar'],
    flowRules: [
      { value: 'Encerrar', nextQuestionId: FLOW_END },
      { value: 'Continuar', nextQuestionId: 'q4' },
    ],
  },
  {
    id: 'q4',
    title: 'Como podemos melhorar?',
    type: 'long_text',
    required: false,
  },
]

describe('survey flow', () => {
  it('mostra só a primeira pergunta quando ainda não existe resposta', () => {
    expect(getVisibleSurveyQuestions(questions, {}).map((question) => question.id)).toEqual(['q1'])
  })

  it('segue o fluxo configurado para resposta positiva', () => {
    expect(getVisibleSurveyQuestions(questions, { q1: 'Sim' }).map((question) => question.id)).toEqual(['q1', 'q2'])
  })

  it('permite usar fluxo generico apos responder qualquer tipo de pergunta', () => {
    expect(getVisibleSurveyQuestions(questions, { q1: 'Sim', q2: 'Atendimento gentil' }).map((question) => question.id)).toEqual([
      'q1',
      'q2',
      'q4',
    ])
  })

  it('encerra o caminho quando a regra aponta para fim da pesquisa', () => {
    expect(getVisibleSurveyQuestions(questions, { q1: 'Não', q3: 'Encerrar' }).map((question) => question.id)).toEqual([
      'q1',
      'q3',
    ])
  })

  it('continua o caminho quando a resposta alternativa aponta para outra pergunta', () => {
    expect(getVisibleSurveyQuestions(questions, { q1: 'Não', q3: 'Continuar' }).map((question) => question.id)).toEqual([
      'q1',
      'q3',
      'q4',
    ])
  })

  it('prioriza fluxo especifico antes do fluxo generico quando ambos existem', () => {
    const mixedQuestions: SurveyQuestion[] = [
      {
        id: 'q1',
        title: 'Você recomenda?',
        type: 'single_choice',
        required: true,
        options: ['Sim', 'Talvez'],
        flowRules: [
          { value: FLOW_ON_ANSWER, nextQuestionId: 'q3' },
          { value: 'Sim', nextQuestionId: 'q2' },
        ],
      },
      { id: 'q2', title: 'Ótimo', type: 'short_text', required: false },
      { id: 'q3', title: 'Fallback', type: 'short_text', required: false },
    ]

    expect(getVisibleSurveyQuestions(mixedQuestions, { q1: 'Sim' }).map((question) => question.id)).toEqual(['q1', 'q2'])
    expect(getVisibleSurveyQuestions(mixedQuestions, { q1: 'Talvez' }).map((question) => question.id)).toEqual(['q1', 'q3'])
  })

  it('detecta se a resposta obrigatória foi preenchida de verdade', () => {
    expect(isQuestionAnswered({ type: 'short_text' }, '   ')).toBe(false)
    expect(isQuestionAnswered({ type: 'multiple_choice' }, ['A'])).toBe(true)
    expect(isQuestionAnswered({ type: 'nps' }, 8)).toBe(true)
  })
})
