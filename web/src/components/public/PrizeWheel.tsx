import { useEffect, useRef } from 'react'

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

const rewardSegmentPalette = [
  { start: '#1d4ed8', end: '#2563eb', text: '#ffffff' },
  { start: '#7c3aed', end: '#9333ea', text: '#ffffff' },
  { start: '#be185d', end: '#db2777', text: '#ffffff' },
  { start: '#c2410c', end: '#ea580c', text: '#ffffff' },
  { start: '#0f766e', end: '#14b8a6', text: '#ffffff' },
  { start: '#0f172a', end: '#334155', text: '#ffffff' },
]

const retrySegmentPalette = [
  { start: '#0284c7', end: '#0ea5e9', text: '#ffffff' },
  { start: '#0891b2', end: '#06b6d4', text: '#ffffff' },
  { start: '#7c3aed', end: '#8b5cf6', text: '#ffffff' },
  { start: '#16a34a', end: '#22c55e', text: '#ffffff' },
]

const neutralSegmentPalette = [
  { start: '#dbeafe', end: '#bfdbfe', text: '#1e3a8a' },
  { start: '#ede9fe', end: '#ddd6fe', text: '#5b21b6' },
  { start: '#fee2e2', end: '#fecaca', text: '#991b1b' },
  { start: '#fef3c7', end: '#fde68a', text: '#92400e' },
  { start: '#dcfce7', end: '#bbf7d0', text: '#166534' },
  { start: '#cffafe', end: '#a5f3fc', text: '#155e75' },
]

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

    if (nextLine.length <= 11) {
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

  return lines.slice(0, 2)
}

function getWheelDisplayLabel(label: string) {
  const normalized = label.trim().replace(/\s+/g, ' ')

  if (normalized.length <= 22) {
    return normalized
  }

  const words = normalized.split(' ')
  let shortened = ''

  for (const word of words) {
    const nextValue = shortened ? `${shortened} ${word}` : word

    if (nextValue.length > 18) {
      break
    }

    shortened = nextValue
  }

  if (!shortened) {
    return `${normalized.slice(0, 16).trimEnd()}...`
  }

  return `${shortened}...`
}

function getSegmentColors(segment: PrizeWheelSegment, index: number, primaryColor: string) {
  if (segment.kind === 'reward') {
    const selected = rewardSegmentPalette[index % rewardSegmentPalette.length]
    return index === 0 ? { ...selected, end: primaryColor, text: '#ffffff' } : selected
  }

  if (segment.kind === 'retry') {
    return retrySegmentPalette[index % retrySegmentPalette.length]
  }

  return neutralSegmentPalette[index % neutralSegmentPalette.length]
}

function buildWheelGradient(segments: PrizeWheelSegment[], primaryColor: string) {
  const angle = 360 / segments.length

  return segments
    .map((segment, index) => {
      const start = index * angle
      const mid = start + angle * 0.48
      const end = start + angle
      const colors = getSegmentColors(segment, index, primaryColor)
      return `${colors.start} ${start}deg, ${colors.end} ${mid}deg, ${colors.start} ${end}deg`
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
  const audioContextRef = useRef<AudioContext | null>(null)
  const spinSoundTimeoutRef = useRef<number | null>(null)
  const spinSoundStartedAtRef = useRef<number | null>(null)
  const audioUnlockedRef = useRef(false)
  const isFullscreen = variant === 'fullscreen'
  const angle = 360 / segments.length
  const gradient = buildWheelGradient(segments, primaryColor)
  const dividerOverlay = buildWheelOverlay(segments)
  const compactWheel = segments.length >= 6
  const rewardLikeSegments = segments.filter((segment) => segment.kind !== 'neutral').length
  const labelWidth = isFullscreen
    ? compactWheel
      ? 'clamp(86px, 13vw, 120px)'
      : 'clamp(96px, 15vw, 132px)'
    : '124px'
  const pointerBaseClass = isFullscreen
    ? 'absolute left-1/2 top-[-18px] z-40 h-[56px] w-[44px] -translate-x-1/2 rounded-t-[24px] rounded-b-[10px] bg-[linear-gradient(180deg,#475569_0%,#0f172a_100%)] shadow-[0_10px_18px_rgba(15,23,42,0.18)] sm:top-[-24px] sm:h-[64px] sm:w-[52px]'
    : 'absolute left-1/2 top-[-16px] z-40 h-[50px] w-[40px] -translate-x-1/2 rounded-t-[24px] rounded-b-[10px] bg-[linear-gradient(180deg,#475569_0%,#0f172a_100%)] shadow-[0_10px_18px_rgba(15,23,42,0.18)]'
  const pointerTipClass = isFullscreen
    ? 'absolute left-1/2 top-[18px] z-40 h-0 w-0 -translate-x-1/2 border-l-[18px] border-r-[18px] border-t-[32px] border-l-transparent border-r-transparent border-t-slate-700 drop-shadow-[0_10px_14px_rgba(15,23,42,0.18)] sm:top-[20px] sm:border-l-[20px] sm:border-r-[20px] sm:border-t-[36px]'
    : 'absolute left-1/2 top-[16px] z-40 h-0 w-0 -translate-x-1/2 border-l-[16px] border-r-[16px] border-t-[30px] border-l-transparent border-r-transparent border-t-slate-700 drop-shadow-[0_10px_14px_rgba(15,23,42,0.18)]'
  const wheelWrapperStyle = {
    maxWidth: isFullscreen ? 'min(calc(100vw - 0.75rem), calc(100dvh - 11.5rem))' : '430px',
  }

  function getAudioContext() {
    if (typeof window === 'undefined') {
      return null
    }

    const BrowserAudioContext = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!BrowserAudioContext) {
      return null
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new BrowserAudioContext()
    }

    return audioContextRef.current
  }

  async function unlockWheelSound() {
    const audioContext = getAudioContext()

    if (!audioContext) {
      return
    }

    try {
      if (audioContext.state !== 'running') {
        await audioContext.resume()
      }

      audioUnlockedRef.current = true
    } catch {
      audioUnlockedRef.current = false
    }
  }

  function clearSpinSoundLoop() {
    if (spinSoundTimeoutRef.current) {
      window.clearTimeout(spinSoundTimeoutRef.current)
      spinSoundTimeoutRef.current = null
    }

    spinSoundStartedAtRef.current = null
  }

  function playWheelTick(audioContext: AudioContext, progress: number) {
    const now = audioContext.currentTime
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const filter = audioContext.createBiquadFilter()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(1400 - progress * 620, now)
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1800 - progress * 800, now)
    filter.Q.setValueAtTime(2.8, now)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.018, now + 0.006)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.055)

    oscillator.connect(filter)
    filter.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.start(now)
    oscillator.stop(now + 0.06)
  }

  useEffect(() => {
    if (!isSpinning || !audioUnlockedRef.current) {
      clearSpinSoundLoop()
      return
    }

    const audioContext = getAudioContext()

    if (!audioContext || audioContext.state !== 'running') {
      return
    }

    spinSoundStartedAtRef.current = Date.now()

    const runTickLoop = () => {
      if (!audioContextRef.current || audioContext.state !== 'running') {
        clearSpinSoundLoop()
        return
      }

      const startedAt = spinSoundStartedAtRef.current ?? Date.now()
      const elapsed = Date.now() - startedAt
      const progress = Math.min(elapsed / 5200, 1)
      playWheelTick(audioContext, progress)

      const nextDelay = Math.round(62 + progress * 88)
      spinSoundTimeoutRef.current = window.setTimeout(runTickLoop, nextDelay)
    }

    runTickLoop()

    return () => {
      clearSpinSoundLoop()
    }
  }, [isSpinning])

  useEffect(() => {
    return () => {
      clearSpinSoundLoop()
    }
  }, [])

  return (
    <div className="mx-auto w-full" style={wheelWrapperStyle}>
      <div className="relative aspect-square">
        <div className="absolute inset-[-5%] rounded-full bg-[radial-gradient(circle,_rgba(96,165,250,0.18)_0%,_rgba(168,85,247,0.14)_30%,_rgba(244,114,182,0.12)_52%,_rgba(255,255,255,0)_76%)] blur-xl" />
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

        <div className="absolute inset-0 rounded-full border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_22px_50px_rgba(15,23,42,0.10)]" />
        <div className="absolute inset-[1.2%] rounded-full bg-[linear-gradient(135deg,rgba(59,130,246,0.28)_0%,rgba(168,85,247,0.24)_32%,rgba(244,114,182,0.22)_62%,rgba(245,158,11,0.22)_100%)]" />
        <div className="absolute inset-[2.1%] rounded-full border border-white/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]" />
        <div className="absolute inset-[4.2%] rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(148,163,184,0.16)]" />

        <div className="absolute inset-[5.1%] overflow-hidden rounded-full border-[5px] border-white shadow-[0_18px_36px_rgba(15,23,42,0.14)] transition-transform duration-[5200ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]"
          style={{
            background: `
              radial-gradient(circle at 50% 18%, rgba(255,255,255,0.28), transparent 24%),
              radial-gradient(circle at 50% 50%, rgba(255,255,255,0.06), transparent 70%),
              conic-gradient(${dividerOverlay}),
              conic-gradient(${gradient})
            `,
            transform: `rotate(${rotation}deg)`,
          }}
        >
          <div className="absolute inset-[2.2%] rounded-full border border-white/35 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.05),_transparent_72%)]">
            {segments.map((segment, index) => {
              const centerAngle = index * angle + angle / 2
              const centerRadians = (centerAngle * Math.PI) / 180
              const isActive = activeSegmentId === segment.id
              const isRewardSegment = segment.kind === 'reward'
              const isRetrySegment = segment.kind === 'retry'
              const labelLines = splitSegmentLabel(getWheelDisplayLabel(segment.label))
              const { text } = getSegmentColors(segment, index, primaryColor)
              const radiusPercent = isFullscreen
                ? segment.kind === 'neutral'
                  ? compactWheel
                    ? 33
                    : 31
                  : compactWheel
                    ? 27
                    : 25
                : segment.kind === 'neutral'
                  ? 31
                  : 26
              const segmentLeft = `${50 + Math.sin(centerRadians) * radiusPercent}%`
              const segmentTop = `${50 - Math.cos(centerRadians) * radiusPercent}%`
              const segmentRotation = centerAngle > 180 ? centerAngle + 180 : centerAngle
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
                    left: segmentLeft,
                    top: segmentTop,
                    transform: `translate(-50%, -50%) rotate(${segmentRotation}deg)`,
                  }}
                >
                  <div
                    className={`-rotate-90 text-center uppercase transition ${
                      isActive ? 'scale-[1.06]' : ''
                    }`}
                    style={{
                      width:
                        isFullscreen && rewardLikeSegments <= 3
                          ? segment.kind === 'neutral'
                            ? 'clamp(72px, 11vw, 96px)'
                            : 'clamp(90px, 14vw, 118px)'
                          : isFullscreen
                            ? segment.kind === 'neutral'
                              ? 'clamp(68px, 10vw, 92px)'
                              : labelWidth
                            : undefined,
                      color: text,
                      textShadow,
                      fontSize:
                        isRewardSegment || isRetrySegment
                          ? isFullscreen
                            ? compactWheel
                              ? 'clamp(11px, 1.55vmin, 17px)'
                              : 'clamp(12px, 1.8vmin, 20px)'
                            : 'clamp(12px, 1.28vw, 18px)'
                          : isFullscreen
                            ? compactWheel
                              ? 'clamp(10px, 1.25vmin, 14px)'
                              : 'clamp(10px, 1.35vmin, 15px)'
                            : 'clamp(9px, 0.95vw, 14px)',
                      fontWeight: isRewardSegment || isRetrySegment ? '900' : '700',
                      lineHeight: isRewardSegment || isRetrySegment ? '1.02' : '1',
                      letterSpacing: isRewardSegment || isRetrySegment ? '0.01em' : '0.01em',
                      opacity: isRewardSegment || isRetrySegment ? '1' : '0.88',
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
          <div className="absolute inset-[2%] rounded-full border border-slate-900/8" />
        </div>

        <div className="absolute left-1/2 top-1/2 z-20 flex h-[56px] w-[56px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-amber-200 bg-[radial-gradient(circle_at_30%_30%,#ffffff_0%,#fde68a_42%,#f59e0b_100%)] text-center shadow-[0_10px_20px_rgba(245,158,11,0.18)] sm:h-[60px] sm:w-[60px]">
          <div className="h-[18px] w-[18px] rounded-full bg-[linear-gradient(180deg,#fff7ed_0%,#f59e0b_100%)] shadow-[inset_0_1px_2px_rgba(255,255,255,0.65)] sm:h-[20px] sm:w-[20px]" />
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => {
            void unlockWheelSound()
            onSpin()
          }}
          disabled={disabled || isSpinning}
          className={`rounded-full bg-slate-950 font-bold uppercase text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 ${
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
