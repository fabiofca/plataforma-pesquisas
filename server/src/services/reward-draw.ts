export type RewardFrequencyMode = 'frequent' | 'balanced' | 'rare' | 'custom'
export type RewardOutcomeRole = 'prize' | 'no_prize' | 'showcase'

export interface RewardDrawItem {
  id: string
  title: string
  wheel_label?: string | null
  image_url?: string | null
  quantity_total: number
  quantity_awarded: number
  is_active?: boolean
  show_on_wheel?: boolean
  outcome_role?: RewardOutcomeRole
  sort_order?: number
  frequency_mode: RewardFrequencyMode
  frequency_target: number
  next_release_spin: number
  last_awarded_spin: number
  min_gap_spins: number
}

export const MAX_WHEEL_OPTIONS = 6
export const MAX_REAL_REWARDS = 3
export const DEFAULT_NO_PRIZE_LABELS = [
  'Não foi dessa vez',
  'Quase!',
  'Obrigado por participar.',
  'Boa sorte na próxima',
  'Tente novamente',
  'Continue participando',
]

const DEFAULT_TARGETS: Record<Exclude<RewardFrequencyMode, 'custom'>, number> = {
  frequent: 30,
  balanced: 60,
  rare: 120,
}

function randomBetween(min: number, max: number) {
  const safeMin = Math.min(min, max)
  const safeMax = Math.max(min, max)
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin
}

export function getFrequencyTarget(mode: RewardFrequencyMode, customTarget?: number | null) {
  if (mode === 'custom') {
    return Math.max(2, Math.trunc(customTarget ?? 100))
  }

  return DEFAULT_TARGETS[mode]
}

export function calculateMinimumGapSpins(target: number) {
  return Math.max(2, Math.floor(target * 0.2))
}

export function calculateCampaignMinimumGap(targets: number[]) {
  if (!targets.length) {
    return 0
  }

  return Math.max(1, Math.floor(Math.min(...targets) * 0.2))
}

export function createNextReleaseSpin(currentSpin: number, target: number) {
  const safeTarget = Math.max(2, Math.trunc(target))
  const minOffset = Math.max(1, Math.floor(safeTarget * 0.7))
  const maxOffset = Math.max(minOffset + 1, Math.ceil(safeTarget * 1.3))

  return currentSpin + randomBetween(minOffset, maxOffset)
}

export function isRewardAvailable(item: RewardDrawItem) {
  return (item.is_active ?? true) && item.quantity_awarded < item.quantity_total
}

export function isAdvancedPrizeItem(item: RewardDrawItem) {
  return (item.outcome_role ?? 'prize') === 'prize'
}

export function isAdvancedNoPrizeItem(item: RewardDrawItem) {
  return item.outcome_role === 'no_prize'
}

export function isAdvancedShowcaseItem(item: RewardDrawItem) {
  return item.outcome_role === 'showcase'
}

export function isWheelVisibleItem(item: RewardDrawItem) {
  return (item.is_active ?? true) && (item.show_on_wheel ?? true)
}

export function getAvailableRewardItems(items: RewardDrawItem[]) {
  return items.filter((item) => isAdvancedPrizeItem(item) && isRewardAvailable(item))
}

export function sortRewardItemsByDuePriority(items: RewardDrawItem[]) {
  return [...items].sort((left, right) => {
    if (left.next_release_spin !== right.next_release_spin) {
      return left.next_release_spin - right.next_release_spin
    }

    if (left.frequency_target !== right.frequency_target) {
      return left.frequency_target - right.frequency_target
    }

    return left.title.localeCompare(right.title)
  })
}

export function selectDueRewardItem(items: RewardDrawItem[], currentSpin: number) {
  const availableItems = getAvailableRewardItems(items)
    .filter((item) => currentSpin >= item.next_release_spin)
    .filter((item) => item.last_awarded_spin === 0 || currentSpin - item.last_awarded_spin >= item.min_gap_spins)

  if (!availableItems.length) {
    return null
  }

  return sortRewardItemsByDuePriority(availableItems)[0]
}

/**
 * Selects a prize item in guaranteed_prize mode.
 *
 * Tries to respect frequency scheduling first (selectDueRewardItem).
 * If no item is due yet, falls back to the one closest to being due
 * (smallest next_release_spin) so the guarantee still holds.
 */
export function selectGuaranteedPrizeItem(items: RewardDrawItem[], currentSpin: number) {
  const availableItems = getAvailableRewardItems(items)

  if (!availableItems.length) {
    return null
  }

  return selectDueRewardItem(items, currentSpin) ?? sortRewardItemsByDuePriority(availableItems)[0]
}

export function selectAdvancedNoPrizeItem(items: RewardDrawItem[]) {
  const availableItems = items
    .filter((item) => isAdvancedNoPrizeItem(item) && (item.is_active ?? true))
    .sort((left, right) => {
      if ((left.sort_order ?? 0) !== (right.sort_order ?? 0)) {
        return (left.sort_order ?? 0) - (right.sort_order ?? 0)
      }

      return left.title.localeCompare(right.title)
    })

  if (!availableItems.length) {
    return null
  }

  return availableItems[randomBetween(0, availableItems.length - 1)] ?? availableItems[0]
}

export function selectNoPrizeLabel() {
  return DEFAULT_NO_PRIZE_LABELS[Math.floor(Math.random() * DEFAULT_NO_PRIZE_LABELS.length)] ?? DEFAULT_NO_PRIZE_LABELS[0]
}
