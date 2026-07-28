import { describe, expect, it, vi } from 'vitest'

import {
  calculateCampaignMinimumGap,
  calculateMinimumGapSpins,
  createNextReleaseSpin,
  getAvailableRewardItems,
  getFrequencyTarget,
  selectDueRewardItem,
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

  it('seleciona um rótulo neutro quando nenhum prêmio é liberado', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(selectNoPrizeLabel()).toBe('Não foi dessa vez')

    randomSpy.mockRestore()
  })
})
