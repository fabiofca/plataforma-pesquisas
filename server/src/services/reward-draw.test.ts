import { describe, expect, it, vi } from 'vitest'

import {
  calculateCampaignMinimumGap,
  calculateMinimumGapSpins,
  createNextReleaseSpin,
  getAvailableRewardItems,
  getFrequencyTarget,
  isAdvancedPrizeItem,
  isAdvancedShowcaseItem,
  selectDueRewardItem,
  selectGuaranteedPrizeItem,
  selectNoPrizeLabel,
} from './reward-draw.js'

describe('reward draw', () => {
  it('filtra itens sem estoque', () => {
    const result = getAvailableRewardItems([
      {
        id: '1',
        title: 'A',
        quantity_total: 1,
        quantity_awarded: 1,
        frequency_mode: 'balanced',
        frequency_target: 60,
        next_release_spin: 50,
        last_awarded_spin: 0,
        min_gap_spins: 10,
      },
      {
        id: '2',
        title: 'B',
        quantity_total: 3,
        quantity_awarded: 1,
        frequency_mode: 'balanced',
        frequency_target: 60,
        next_release_spin: 50,
        last_awarded_spin: 0,
        min_gap_spins: 10,
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('retorna null quando não há prêmio liberado para o giro atual', () => {
    const result = selectDueRewardItem(
      [
        {
          id: '1',
          title: 'A',
          quantity_total: 2,
          quantity_awarded: 0,
          frequency_mode: 'balanced',
          frequency_target: 60,
          next_release_spin: 80,
          last_awarded_spin: 0,
          min_gap_spins: 10,
        },
      ],
      50,
    )

    expect(result).toBeNull()
  })

  it('prioriza o prêmio que está há mais tempo liberado', () => {
    const result = selectDueRewardItem(
      [
        {
          id: '1',
          title: 'Vale-compras',
          quantity_total: 5,
          quantity_awarded: 0,
          frequency_mode: 'rare',
          frequency_target: 120,
          next_release_spin: 90,
          last_awarded_spin: 0,
          min_gap_spins: 20,
        },
        {
          id: '2',
          title: 'Desconto',
          quantity_total: 20,
          quantity_awarded: 0,
          frequency_mode: 'frequent',
          frequency_target: 30,
          next_release_spin: 40,
          last_awarded_spin: 0,
          min_gap_spins: 6,
        },
      ],
      100,
    )

    expect(result?.id).toBe('2')
  })

  it('respeita o min_gap_spins apos uma premiacao recente', () => {
    const result = selectDueRewardItem(
      [
        {
          id: '1',
          title: 'Vale-compras',
          quantity_total: 5,
          quantity_awarded: 1,
          frequency_mode: 'balanced',
          frequency_target: 60,
          next_release_spin: 50,
          last_awarded_spin: 48,
          min_gap_spins: 12,
        },
      ],
      55,
    )

    expect(result).toBeNull()
  })

  it('libera o prêmio quando o min_gap_spins e cumprido', () => {
    const result = selectDueRewardItem(
      [
        {
          id: '1',
          title: 'Vale-compras',
          quantity_total: 5,
          quantity_awarded: 1,
          frequency_mode: 'balanced',
          frequency_target: 60,
          next_release_spin: 50,
          last_awarded_spin: 40,
          min_gap_spins: 12,
        },
      ],
      55,
    )

    expect(result?.id).toBe('1')
  })

  it('selectGuaranteedPrizeItem respeita a frequencia quando um item esta vencido', () => {
    const result = selectGuaranteedPrizeItem(
      [
        {
          id: '1',
          title: 'Premio A',
          quantity_total: 5,
          quantity_awarded: 0,
          frequency_mode: 'rare',
          frequency_target: 120,
          next_release_spin: 100,
          last_awarded_spin: 0,
          min_gap_spins: 20,
        },
        {
          id: '2',
          title: 'Premio B',
          quantity_total: 5,
          quantity_awarded: 0,
          frequency_mode: 'frequent',
          frequency_target: 30,
          next_release_spin: 40,
          last_awarded_spin: 0,
          min_gap_spins: 6,
        },
      ],
      50,
    )

    expect(result?.id).toBe('2')
  })

  it('selectGuaranteedPrizeItem garante premio mesmo sem item vencido', () => {
    const result = selectGuaranteedPrizeItem(
      [
        {
          id: '1',
          title: 'Premio A',
          quantity_total: 5,
          quantity_awarded: 0,
          frequency_mode: 'rare',
          frequency_target: 120,
          next_release_spin: 200,
          last_awarded_spin: 0,
          min_gap_spins: 24,
        },
        {
          id: '2',
          title: 'Premio B',
          quantity_total: 5,
          quantity_awarded: 0,
          frequency_mode: 'balanced',
          frequency_target: 60,
          next_release_spin: 150,
          last_awarded_spin: 0,
          min_gap_spins: 12,
        },
      ],
      50,
    )

    // Nenhum item vencido, mas guarantee deve pegar o mais proximo (menor next_release_spin)
    expect(result?.id).toBe('2')
  })

  it('selectGuaranteedPrizeItem retorna null quando nao ha estoque', () => {
    const result = selectGuaranteedPrizeItem(
      [
        {
          id: '1',
          title: 'Premio A',
          quantity_total: 5,
          quantity_awarded: 5,
          frequency_mode: 'balanced',
          frequency_target: 60,
          next_release_spin: 40,
          last_awarded_spin: 0,
          min_gap_spins: 12,
        },
      ],
      50,
    )

    expect(result).toBeNull()
  })

  it('gera uma nova janela aleatória dentro da faixa esperada', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const nextReleaseSpin = createNextReleaseSpin(10, 100)

    expect(nextReleaseSpin).toBe(80)

    randomSpy.mockRestore()
  })

  it('resolve os alvos padrão de frequência', () => {
    expect(getFrequencyTarget('frequent')).toBe(30)
    expect(getFrequencyTarget('balanced')).toBe(60)
    expect(getFrequencyTarget('rare')).toBe(120)
    expect(getFrequencyTarget('custom', 200)).toBe(200)
  })

  it('calcula intervalos mínimos sem exigir configuração manual', () => {
    expect(calculateMinimumGapSpins(30)).toBe(6)
    expect(calculateCampaignMinimumGap([30, 60, 120])).toBe(6)
  })

  it('exclui itens vitrine do sorteio de prêmios reais', () => {
    const items = [
      {
        id: '1',
        title: 'Vitrine A',
        quantity_total: 5,
        quantity_awarded: 0,
        frequency_mode: 'balanced' as const,
        frequency_target: 60,
        next_release_spin: 1,
        last_awarded_spin: 0,
        min_gap_spins: 10,
        outcome_role: 'showcase' as const,
      },
      {
        id: '2',
        title: 'Prêmio real',
        quantity_total: 5,
        quantity_awarded: 0,
        frequency_mode: 'balanced' as const,
        frequency_target: 60,
        next_release_spin: 1,
        last_awarded_spin: 0,
        min_gap_spins: 10,
        outcome_role: 'prize' as const,
      },
    ]

    expect(isAdvancedShowcaseItem(items[0])).toBe(true)
    expect(isAdvancedPrizeItem(items[0])).toBe(false)
    expect(getAvailableRewardItems(items)).toHaveLength(1)
    expect(getAvailableRewardItems(items)[0]?.id).toBe('2')
    expect(selectDueRewardItem(items, 1)?.id).toBe('2')
  })

  it('seleciona um rótulo neutro quando nenhum prêmio é liberado', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(selectNoPrizeLabel()).toBe('Não foi dessa vez')

    randomSpy.mockRestore()
  })
})
