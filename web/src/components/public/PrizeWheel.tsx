import { useEffect, useRef } from 'react'

type PrizeWheelSegment = {
  id: string
  label: string
  kind: 'reward' | 'neutral' | 'retry' | 'showcase'
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
  disableTransition?: boolean
  onSpin: () => void
}

const rewardSegmentPalette = [
  { start: '#dc2626', end: '#ef4444', text: '#ffffff' },
  { start: '#7c3aed', end: '#8b5cf6', text: '#ffffff' },
  { start: '#db2777', end: '#ec4899', text: '#ffffff' },
  { start: '#ea580c', end: '#f97316', text: '#ffffff' },
  { start: '#059669', end: '#10b981', text: '#ffffff' },
  { start: '#2563eb', end: '#3b82f6', text: '#ffffff' },
]

const retrySegmentPalette = [
  { start: '#0284c7', end: '#0ea5e9', text: '#ffffff' },
  { start: '#0891b2', end: '#06b6d4', text: '#ffffff' },
  { start: '#7c3aed', end: '#8b5cf6', text: '#ffffff' },
  { start: '#16a34a', end: '#22c55e', text: '#ffffff' },
]

const showcaseSegmentPalette = [
  { start: '#d97706', end: '#f59e0b', text: '#ffffff' },
  { start: '#dc2626', end: '#ef4444', text: '#ffffff' },
  { start: '#4f46e5', end: '#6366f1', text: '#ffffff' },
  { start: '#0d9488', end: '#14b8a6', text: '#ffffff' },
]

const neutralSegmentPalette = [
  { start: '#3b82f6', end: '#60a5fa', text: '#ffffff' },
  { start: '#8b5cf6', end: '#a78bfa', text: '#ffffff' },
  { start: '#f43f5e', end: '#fb7185', text: '#ffffff' },
  { start: '#f59e0b', end: '#fbbf24', text: '#451a03' },
  { start: '#22c55e', end: '#4ade80', text: '#ffffff' },
  { start: '#06b6d4', end: '#22d3ee', text: '#ffffff' },
]

const confettiPalette = ['#facc15', '#ff006e', '#6366f1', '#22c55e', '#38bdf8', '#ffffff', '#fb7185', '#f97316']
const confettiPieces = Array.from({ length: 34 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 34
  const distance = 108 + (index % 4) * 28

  return {
    x: `${Math.cos(angle) * distance}px`,
    y: `${Math.sin(angle) * distance - 42}px`,
    rotate: `${index % 2 === 0 ? 220 : -220}deg`,
    delay: `${index * 18}ms`,
    duration: `${1180 + (index % 4) * 160}ms`,
    color: confettiPalette[index % confettiPalette.length],
    width: `${8 + (index % 3) * 3}px`,
    height: `${12 + (index % 4) * 4}px`,
    shape: index % 5 === 0 ? '999px' : '3px',
  }
})

const confettiRainPieces = Array.from({ length: 22 }, (_, index) => {
  const spread = 10 + (index % 6) * 4

  return {
    left: `${8 + ((index * 11) % 84)}%`,
    delay: `${220 + index * 55}ms`,
    duration: `${1800 + (index % 5) * 180}ms`,
    drift: `${index % 2 === 0 ? -spread : spread}px`,
    rotate: `${index % 2 === 0 ? -160 : 160}deg`,
    color: confettiPalette[(index + 3) % confettiPalette.length],
    width: `${6 + (index % 3) * 3}px`,
    height: `${12 + (index % 4) * 4}px`,
    shape: index % 4 === 0 ? '999px' : '3px',
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
    // First reward segment is branded with primaryColor; keep it solid and let the vignette overlay create depth
    return index === 0 ? { start: primaryColor, end: primaryColor, text: '#ffffff' } : selected
  }

  if (segment.kind === 'retry') {
    return retrySegmentPalette[index % retrySegmentPalette.length]
  }

  if (segment.kind === 'showcase') {
    return showcaseSegmentPalette[index % showcaseSegmentPalette.length]
  }

  return neutralSegmentPalette[index % neutralSegmentPalette.length]
}

function buildWheelGradient(segments: PrizeWheelSegment[], primaryColor: string) {
  const angle = 360 / segments.length

  return segments
    .map((segment, index) => {
      const start = index * angle
      const end = start + angle
      const colors = getSegmentColors(segment, index, primaryColor)
      return `${colors.start} ${start}deg, ${colors.end} ${end - angle * 0.45}deg, ${colors.start} ${end}deg`
    })
    .join(', ')
}

function buildWheelOverlay(segments: PrizeWheelSegment[]) {
  const dividerWidth = Math.max(1.2, Math.min(2.2, 8 / segments.length))
  const angle = 360 / segments.length

  return segments
    .map((_, index) => {
      const start = index * angle
      const end = start + dividerWidth
      return `rgba(255,255,255,0.72) ${start}deg, rgba(255,255,255,0.72) ${end}deg, transparent ${end}deg, transparent ${start + angle - dividerWidth / 2}deg`
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
  disableTransition,
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
    ? 'absolute left-1/2 top-[-18px] z-40 h-[56px] w-[44px] -translate-x-1/2 rounded-t-[24px] rounded-b-[10px] bg-[linear-gradient(180deg,#b91c1c_0%,#7f1d1d_60%,#450a0a_100%)] shadow-[0_10px_22px_rgba(185,28,28,0.35)] sm:top-[-24px] sm:h-[64px] sm:w-[52px]'
    : 'absolute left-1/2 top-[-16px] z-40 h-[50px] w-[40px] -translate-x-1/2 rounded-t-[24px] rounded-b-[10px] bg-[linear-gradient(180deg,#b91c1c_0%,#7f1d1d_60%,#450a0a_100%)] shadow-[0_10px_22px_rgba(185,28,28,0.35)]'
  const pointerTipClass = isFullscreen
    ? 'absolute left-1/2 top-[18px] z-40 h-0 w-0 -translate-x-1/2 border-l-[18px] border-r-[18px] border-t-[32px] border-l-transparent border-r-transparent border-t-red-700 drop-shadow-[0_10px_14px_rgba(185,28,28,0.35)] sm:top-[20px] sm:border-l-[20px] sm:border-r-[20px] sm:border-t-[36px]'
    : 'absolute left-1/2 top-[16px] z-40 h-0 w-0 -translate-x-1/2 border-l-[16px] border-r-[16px] border-t-[30px] border-l-transparent border-r-transparent border-t-red-700 drop-shadow-[0_10px_14px_rgba(185,28,28,0.35)]'
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

  function playWinSound(audioContext: AudioContext) {
    const now = audioContext.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.08)
      gainNode.gain.setValueAtTime(0.0001, now + index * 0.08)
      gainNode.gain.exponentialRampToValueAtTime(0.08, now + index * 0.08 + 0.04)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.35)
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.start(now + index * 0.08)
      oscillator.stop(now + index * 0.08 + 0.4)
    })
  }

  function playNeutralSound(audioContext: AudioContext) {
    const now = audioContext.currentTime
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(300, now)
    oscillator.frequency.linearRampToValueAtTime(250, now + 0.25)
    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.05, now + 0.04)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.4)
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
    if (!showCelebration || !audioUnlockedRef.current) {
      return
    }

    const audioContext = getAudioContext()
    if (!audioContext || audioContext.state !== 'running') {
      return
    }

    const timeout = window.setTimeout(() => {
      playWinSound(audioContext)
    }, 200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [showCelebration, celebrationKey])

  useEffect(() => {
    if (isSpinning || !activeSegmentId || !audioUnlockedRef.current) {
      return
    }

    const activeSegment = segments.find((segment) => segment.id === activeSegmentId)
    if (!activeSegment || activeSegment.kind === 'reward') {
      return
    }

    const audioContext = getAudioContext()
    if (!audioContext || audioContext.state !== 'running') {
      return
    }

    playNeutralSound(audioContext)
  }, [activeSegmentId, isSpinning, segments])

  useEffect(() => {
    return () => {
      clearSpinSoundLoop()
    }
  }, [])

  return (
    <div className="mx-auto w-full" style={wheelWrapperStyle}>
      <div className="relative aspect-square">
        <div className="absolute inset-[-8%] rounded-full bg-[radial-gradient(circle,_rgba(250,204,21,0.35)_0%,_rgba(249,115,22,0.28)_22%,_rgba(236,72,153,0.24)_45%,_rgba(139,92,246,0.18)_68%,_rgba(255,255,255,0)_88%)] blur-2xl" />
        {showCelebration ? (
          <div key={celebrationKey} className="pointer-events-none absolute inset-0 z-50" aria-hidden="true">
            <span className="celebration-flash" />
            <span className="celebration-glow-ring" />
            <span className="confetti-burst-core" />
            <span className="confetti-burst-ring" />
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
                    animationDuration: piece.duration,
                    width: piece.width,
                    height: piece.height,
                    borderRadius: piece.shape,
                    ['--confetti-x' as string]: piece.x,
                    ['--confetti-y' as string]: piece.y,
                    ['--confetti-rotate' as string]: piece.rotate,
                  } as Record<string, string>
                }
              />
            ))}
            {confettiRainPieces.map((piece, index) => (
              <span
                key={`rain-${celebrationKey}-${index}`}
                className="confetti-rain-piece"
                style={
                  {
                    left: piece.left,
                    top: '12%',
                    backgroundColor: piece.color,
                    animationDelay: piece.delay,
                    animationDuration: piece.duration,
                    width: piece.width,
                    height: piece.height,
                    borderRadius: piece.shape,
                    ['--confetti-rain-drift' as string]: piece.drift,
                    ['--confetti-rain-rotate' as string]: piece.rotate,
                  } as Record<string, string>
                }
              />
            ))}
          </div>
        ) : null}

        <div className={pointerBaseClass} />
        <div className={pointerTipClass} />

        <div className="absolute inset-0 rounded-full border-[6px] border-transparent bg-clip-padding shadow-[0_22px_50px_rgba(245,158,11,0.22),inset_0_0_0_1px_rgba(255,255,255,0.45)]" style={{ background: 'linear-gradient(180deg, #fefce8 0%, #fde68a 100%)' }} />
        <div className="absolute inset-[0.7%] rounded-full border-[5px] border-white/70" style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 20%, #fcd34d 40%, #f59e0b 60%, #fbbf24 80%, #f59e0b 100%)' }} />
        <div className="absolute inset-[1.6%] rounded-full border border-white/80 shadow-[inset_0_2px_6px_rgba(180,83,9,0.12)]" style={{ background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)' }} />
        <div className="absolute inset-[2.6%] rounded-full border border-amber-300/70 bg-white shadow-[inset_0_0_14px_rgba(245,158,11,0.18)]" />

        <div className={"absolute inset-[5.1%] overflow-hidden rounded-full border-[4px] border-white/90 shadow-[0_18px_36px_rgba(15,23,42,0.14),inset_0_0_18px_rgba(0,0,0,0.06)] " + (disableTransition ? "" : "transition-transform duration-[5200ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]")}
          style={{
            background: `
              conic-gradient(from 0deg, ${dividerOverlay}),
              conic-gradient(from 0deg, ${gradient}),
              radial-gradient(circle at 50% 50%, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.08) 70%)
            `,
            backgroundBlendMode: 'normal, normal, multiply',
            transform: `rotate(${rotation}deg)`,
          }}
        >
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_40px_rgba(0,0,0,0.12)]" />
          <div className="absolute inset-[2.2%] rounded-full border border-white/25 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.06),_transparent_72%)]">
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
                    ? '0 1px 0 rgba(255,255,255,0.55)'
                    : '0 1px 2px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.6)'
                  : text === '#1f2937' || text === '#e11d48'
                    ? '0 1px 0 rgba(255,255,255,0.4)'
                    : '0 1px 2px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.5)'

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
                      isActive ? 'scale-[1.12]' : ''
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
                      textShadow: isActive
                        ? `${textShadow}, 0 0 14px rgba(255,255,255,0.5)`
                        : textShadow,
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
                      letterSpacing: isRewardSegment || isRetrySegment ? '0.02em' : '0.015em',
                      opacity: isRewardSegment || isRetrySegment ? '1' : '0.9',
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

        <div className="absolute left-1/2 top-1/2 z-20 flex h-[56px] w-[56px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[4px] border-amber-100 bg-[radial-gradient(circle_at_30%_30%,#fffbeb_0%,#fde68a_35%,#f59e0b_70%,#b45309_100%)] text-center shadow-[0_12px_28px_rgba(180,83,9,0.28),inset_0_-3px_8px_rgba(0,0,0,0.12)] sm:h-[60px] sm:w-[60px]">
          <div className="h-[20px] w-[20px] rounded-full bg-[radial-gradient(circle_at_35%_35%,#fffbeb_0%,#fbbf24_45%,#d97706_100%)] shadow-[0_2px_6px_rgba(180,83,9,0.35),inset_0_1px_2px_rgba(255,255,255,0.7)] sm:h-[22px] sm:w-[22px]" />
        </div>
      </div>

      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={() => {
            void unlockWheelSound()
            onSpin()
          }}
          disabled={disabled || isSpinning}
          className={`relative overflow-hidden rounded-full font-black uppercase text-white shadow-[0_14px_28px_rgba(0,0,0,0.22),inset_0_-4px_0_rgba(0,0,0,0.18)] transition-all active:translate-y-[2px] active:shadow-[0_6px_14px_rgba(0,0,0,0.22),inset_0_-2px_0_rgba(0,0,0,0.18)] disabled:cursor-not-allowed disabled:opacity-60 ${
            isFullscreen ? 'px-10 py-4 text-xs tracking-[0.24em] sm:px-12' : 'px-8 py-3 text-[11px] tracking-[0.2em]'
          }`}
          style={{ backgroundColor: primaryColor }}
        >
          <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.28)_0%,transparent_50%,rgba(0,0,0,0.12)_100%)]" />
          <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
            {isSpinning ? 'Girando' : spinLabel || 'Girar'}
          </span>
        </button>
      </div>
    </div>
  )
}

export { getSegmentTargetRotation }
export type { PrizeWheelSegment }
