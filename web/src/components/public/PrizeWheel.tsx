type PrizeWheelSegment = {
  id: string
  label: string
  kind: 'reward' | 'neutral' | 'retry'
}

type PrizeWheelProps = {
  segments: PrizeWheelSegment[]
  rotation: number
  isSpinning: boolean
  primaryColor: string
  activeSegmentId?: string
  showCelebration?: boolean
  celebrationKey?: number
  disabled?: boolean
  variant?: 'default' | 'fullscreen'
  spinLabel?: string
  onSpin: () => void
}

const confettiPalette = ['#facc15', '#ff006e', '#4338ca', '#22c55e', '#38bdf8', '#ffffff']
const confettiPieces = Array.from({ length: 18 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 18
  const distance = 84 + (index % 3) * 18

  return {
    x: `${Math.cos(angle) * distance}px`,
    y: `${Math.sin(angle) * distance - 28}px`,
    rotate: `${index % 2 === 0 ? 120 : -120}deg`,
    delay: `${index * 28}ms`,
    color: confettiPalette[index % confettiPalette.length],
  }
})

function splitSegmentLabel(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean)

  if (words.length <= 1) {
    return [label]
  }

  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word

    if (nextLine.length <= 14) {
      currentLine = nextLine
      continue
    }

    if (currentLine) {
      lines.push(currentLine)
    }
    currentLine = word
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines.slice(0, 3)
}

function getWheelDisplayLabel(label: string) {
  const normalized = label.trim().replace(/\s+/g, ' ')

  if (normalized.length <= 34) {
    return normalized
  }

  const words = normalized.split(' ')
  let shortened = ''

  for (const word of words) {
    const nextValue = shortened ? `${shortened} ${word}` : word

    if (nextValue.length > 30) {
      break
    }

    shortened = nextValue
  }

  if (!shortened) {
    return `${normalized.slice(0, 27).trimEnd()}...`
  }

  return `${shortened}...`
}

function getSegmentColors(segment: PrizeWheelSegment, index: number, primaryColor: string) {
  const rewardSequence = [0, 2, 1, 3]
  const retrySequence = [0, 2, 3, 1]
  const neutralSequence = [0, 2, 1, 3, 4, 5]

  if (segment.kind === 'reward') {
    const rewardPalette = [
      { fill: primaryColor, text: '#ffffff' },
      { fill: '#4338ca', text: '#ffffff' },
      { fill: '#facc15', text: '#1f2937' },
      { fill: '#ff006e', text: '#ffffff' },
    ]

    return rewardPalette[rewardSequence[index % rewardSequence.length]]
  }

  if (segment.kind === 'retry') {
    const retryPalette = [
      { fill: '#ffffff', text: '#e11d48' },
      { fill: '#facc15', text: '#1f2937' },
      { fill: '#4338ca', text: '#ffffff' },
      { fill: '#ff006e', text: '#ffffff' },
    ]

    return retryPalette[retrySequence[index % retrySequence.length]]
  }

  const neutralPalette = [
    { fill: '#ffffff', text: '#1f2937' },
    { fill: '#4338ca', text: '#ffffff' },
    { fill: '#facc15', text: '#1f2937' },
    { fill: '#ff006e', text: '#ffffff' },
    { fill: '#111827', text: '#ffffff' },
    { fill: '#2563eb', text: '#ffffff' },
  ]

  return neutralPalette[neutralSequence[index % neutralSequence.length]]
}

function buildWheelGradient(segments: PrizeWheelSegment[], primaryColor: string) {
  const angle = 360 / segments.length

  return segments
    .map((segment, index) => {
      const start = index * angle
      const end = start + angle
      const { fill } = getSegmentColors(segment, index, primaryColor)
      return `${fill} ${start}deg ${end}deg`
    })
    .join(', ')
}

function buildWheelOverlay(segments: PrizeWheelSegment[]) {
  const dividerWidth = Math.max(0.9, Math.min(1.8, 7 / segments.length))
  const angle = 360 / segments.length

  return segments
    .map((_, index) => {
      const start = index * angle
      const end = start + dividerWidth
      return `rgba(255,255,255,0.22) ${start}deg ${end}deg`
    })
    .join(', ')
}

function getSegmentTargetRotation(currentRotation: number, segmentCount: number, targetIndex: number, extraSpins = 6) {
  const normalizedIndex = Math.max(0, Math.min(targetIndex, segmentCount - 1))
  const segmentAngle = 360 / segmentCount
  const centerAngle = normalizedIndex * segmentAngle + segmentAngle / 2
  const desiredRotation = (360 - centerAngle + 360) % 360
  const normalizedCurrentRotation = ((currentRotation % 360) + 360) % 360
  const deltaToTarget = (desiredRotation - normalizedCurrentRotation + 360) % 360

  return currentRotation + 360 * extraSpins + deltaToTarget
}

export function PrizeWheel({
  segments,
  rotation,
  isSpinning,
  primaryColor,
  activeSegmentId,
  showCelebration,
  celebrationKey = 0,
  disabled,
  variant = 'default',
  spinLabel,
  onSpin,
}: PrizeWheelProps) {
  const isFullscreen = variant === 'fullscreen'
  const angle = 360 / segments.length
  const gradient = buildWheelGradient(segments, primaryColor)
  const dividerOverlay = buildWheelOverlay(segments)
  const labelDistance = isFullscreen ? 'clamp(116px, 28vw, 182px)' : '94px'
  const labelWidth = isFullscreen ? 'clamp(156px, 38vw, 240px)' : '124px'
  const pointerBaseClass = isFullscreen
    ? 'absolute left-1/2 top-[-18px] z-40 h-[56px] w-[44px] -translate-x-1/2 rounded-t-[24px] rounded-b-[10px] bg-[linear-gradient(180deg,#4b5563_0%,#1f2937_100%)] shadow-[0_10px_18px_rgba(15,23,42,0.35)] sm:top-[-24px] sm:h-[64px] sm:w-[52px]'
    : 'absolute left-1/2 top-[-16px] z-40 h-[50px] w-[40px] -translate-x-1/2 rounded-t-[24px] rounded-b-[10px] bg-[linear-gradient(180deg,#4b5563_0%,#1f2937_100%)] shadow-[0_10px_18px_rgba(15,23,42,0.35)]'
  const pointerTipClass = isFullscreen
    ? 'absolute left-1/2 top-[18px] z-40 h-0 w-0 -translate-x-1/2 border-l-[18px] border-r-[18px] border-t-[32px] border-l-transparent border-r-transparent border-t-slate-700 drop-shadow-[0_10px_14px_rgba(15,23,42,0.28)] sm:top-[20px] sm:border-l-[20px] sm:border-r-[20px] sm:border-t-[36px]'
    : 'absolute left-1/2 top-[16px] z-40 h-0 w-0 -translate-x-1/2 border-l-[16px] border-r-[16px] border-t-[30px] border-l-transparent border-r-transparent border-t-slate-700 drop-shadow-[0_10px_14px_rgba(15,23,42,0.28)]'
  const wheelWrapperClass = isFullscreen
    ? 'mx-auto w-full max-w-[calc(100vw-1rem)] sm:max-w-[720px] lg:max-w-[760px]'
    : 'mx-auto w-full max-w-[430px]'

  return (
    <div className={wheelWrapperClass}>
      <div className="relative aspect-square">
        <div className="absolute inset-[-7%] rounded-full bg-[radial-gradient(circle,_rgba(251,191,36,0.24)_0%,_rgba(255,0,110,0.12)_28%,_rgba(67,56,202,0.16)_48%,_transparent_72%)] blur-2xl" />
        {showCelebration ? (
          <div key={celebrationKey} className="pointer-events-none absolute inset-0 z-50" aria-hidden="true">
            {confettiPieces.map((piece, index) => (
              <span
                key={`${celebrationKey}-${index}`}
                className="confetti-piece"
                style={
                  {
                    left: '50%',
                    top: '42%',
                    backgroundColor: piece.color,
                    animationDelay: piece.delay,
                    ['--confetti-x' as string]: piece.x,
                    ['--confetti-y' as string]: piece.y,
                    ['--confetti-rotate' as string]: piece.rotate,
                  } as Record<string, string>
                }
              />
            ))}
          </div>
        ) : null}

        <div className={pointerBaseClass} />
        <div className={pointerTipClass} />

        <div className="absolute inset-0 rounded-full bg-[linear-gradient(135deg,#fff4c3_0%,#f59e0b_18%,#a16207_48%,#fbbf24_70%,#fff4c3_100%)] shadow-[0_26px_60px_rgba(146,64,14,0.24)]" />
        <div className="absolute inset-[1.4%] rounded-full border border-white/35 bg-[linear-gradient(135deg,#fdf2bf_0%,#d97706_40%,#92400e_52%,#fbbf24_76%,#fde68a_100%)]" />
        <div className="absolute inset-[3.7%] rounded-full bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.3),_transparent_42%),linear-gradient(180deg,#5b4a17_0%,#2b1f08_100%)] shadow-[inset_0_0_18px_rgba(0,0,0,0.24)]" />

        <div className="absolute inset-[5.1%] overflow-hidden rounded-full border-[5px] border-white/85 shadow-[0_22px_40px_rgba(15,23,42,0.22)] transition-transform duration-[5200ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]"
          style={{
            background: `
              radial-gradient(circle at 50% 18%, rgba(255,255,255,0.22), transparent 26%),
              radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08), transparent 70%),
              conic-gradient(${dividerOverlay}),
              conic-gradient(${gradient})
            `,
            transform: `rotate(${rotation}deg)`,
          }}
        >
          <div className="absolute inset-[2.2%] rounded-full border border-white/18 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.05),_transparent_72%)]">
            {segments.map((segment, index) => {
              const centerAngle = index * angle + angle / 2
              const isActive = activeSegmentId === segment.id
              const isRewardSegment = segment.kind === 'reward'
              const isRetrySegment = segment.kind === 'retry'
              const labelLines = splitSegmentLabel(getWheelDisplayLabel(segment.label))
              const { text } = getSegmentColors(segment, index, primaryColor)
              const textShadow =
                isRewardSegment || isRetrySegment
                  ? text === '#1f2937' || text === '#e11d48'
                    ? '0 1px 0 rgba(255,255,255,0.62), 0 0 8px rgba(255,255,255,0.22)'
                    : '0 3px 8px rgba(0,0,0,0.52), 0 0 2px rgba(0,0,0,0.75)'
                  : text === '#1f2937' || text === '#e11d48'
                    ? '0 1px 0 rgba(255,255,255,0.5), 0 0 5px rgba(255,255,255,0.14)'
                    : '0 2px 5px rgba(0,0,0,0.4), 0 0 1px rgba(0,0,0,0.58)'

              return (
                <div
                  key={segment.id}
                  className="absolute left-1/2 top-1/2 origin-center"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${centerAngle}deg) translateY(-${labelDistance})`,
                  }}
                >
                  <div
                    className={`-rotate-90 text-center uppercase transition ${
                      isActive ? 'scale-[1.06]' : ''
                    }`}
                    style={{
                      width: isFullscreen ? labelWidth : undefined,
                      color: text,
                      textShadow,
                      fontSize:
                        isRewardSegment || isRetrySegment
                          ? isFullscreen
                            ? 'clamp(14px, 2.15vw, 26px)'
                            : 'clamp(12px, 1.28vw, 18px)'
                          : isFullscreen
                            ? 'clamp(12px, 1.7vw, 20px)'
                            : 'clamp(10px, 1.05vw, 15px)',
                      fontWeight: isRewardSegment || isRetrySegment ? '900' : '800',
                      lineHeight: isRewardSegment || isRetrySegment ? '1.03' : '1.06',
                      letterSpacing: isRewardSegment || isRetrySegment ? '0.015em' : '0.03em',
                      opacity: isRewardSegment || isRetrySegment ? '1' : '0.96',
                    }}
                  >
                    {labelLines.map((line) => (
                      <span key={`${segment.id}-${line}`} className="block">
                        {line}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="absolute inset-[2%] rounded-full border border-slate-950/10" />
        </div>

        <div className="absolute left-1/2 top-1/2 z-20 flex h-[56px] w-[56px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[#f7d794] bg-[radial-gradient(circle_at_30%_30%,#f8d892_0%,#b87333_44%,#8b5a2b_72%,#f6c667_100%)] text-center shadow-[0_12px_24px_rgba(120,53,15,0.26)] sm:h-[60px] sm:w-[60px]">
          <div className="h-[18px] w-[18px] rounded-full bg-[radial-gradient(circle,#fff2c7_0%,#f59e0b_55%,#92400e_100%)] shadow-[inset_0_2px_4px_rgba(255,255,255,0.45)] sm:h-[20px] sm:w-[20px]" />
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={onSpin}
          disabled={disabled || isSpinning}
          className={`rounded-full bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_52%,#e2e8f0_100%)] font-bold uppercase text-slate-950 shadow-[0_10px_18px_rgba(255,255,255,0.16)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 ${
            isFullscreen ? 'px-8 py-3.5 text-xs tracking-[0.22em] sm:px-10' : 'px-6 py-2.5 text-[11px] tracking-[0.18em]'
          }`}
        >
          {isSpinning ? 'Girando' : spinLabel || 'Girar'}
        </button>
      </div>
    </div>
  )
}

export { getSegmentTargetRotation }
export type { PrizeWheelSegment }
