import type { LucideIcon } from 'lucide-react'

type MetricCardTone = 'blue' | 'emerald' | 'violet' | 'amber'

const toneClasses: Record<
  MetricCardTone,
  { badge: string; icon: string; glow: string; card: string; border: string }
> = {
  blue: {
    badge: 'bg-blue-50 text-blue-700',
    icon: 'bg-blue-600 text-white',
    glow: 'from-blue-500/70 via-blue-300/35 to-transparent',
    card: 'bg-[linear-gradient(180deg,#eff6ff_0%,#ffffff_100%)]',
    border: 'border-blue-100',
  },
  emerald: {
    badge: 'bg-emerald-50 text-emerald-700',
    icon: 'bg-emerald-600 text-white',
    glow: 'from-emerald-500/70 via-emerald-300/35 to-transparent',
    card: 'bg-[linear-gradient(180deg,#ecfdf5_0%,#ffffff_100%)]',
    border: 'border-emerald-100',
  },
  violet: {
    badge: 'bg-violet-50 text-violet-700',
    icon: 'bg-violet-600 text-white',
    glow: 'from-violet-500/70 via-violet-300/35 to-transparent',
    card: 'bg-[linear-gradient(180deg,#f5f3ff_0%,#ffffff_100%)]',
    border: 'border-violet-100',
  },
  amber: {
    badge: 'bg-amber-50 text-amber-700',
    icon: 'bg-amber-500 text-white',
    glow: 'from-amber-500/70 via-amber-300/35 to-transparent',
    card: 'bg-[linear-gradient(180deg,#fffbeb_0%,#ffffff_100%)]',
    border: 'border-amber-100',
  },
}

export function MetricCard({
  label,
  value,
  change,
  detail,
  tone = 'blue',
  icon: Icon,
}: {
  label: string
  value: string
  change: string
  detail?: string
  tone?: MetricCardTone
  icon?: LucideIcon
}) {
  const palette = toneClasses[tone]

  return (
    <article className={`overflow-hidden rounded-[6px] border p-3 shadow-card ${palette.card} ${palette.border}`}>
      <div className={`mb-3 h-[3px] w-14 bg-gradient-to-r ${palette.glow}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 font-display text-[34px] leading-none text-slate-950">{value}</p>
        </div>

        {Icon ? (
          <div className={`flex h-9 w-9 items-center justify-center rounded-[6px] ${palette.icon}`}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-1.5">
        <span className={`inline-flex rounded-[6px] px-2.5 py-1 text-[10px] font-semibold ${palette.badge}`}>{change}</span>
        {detail ? <p className="text-[13px] text-slate-500">{detail}</p> : null}
      </div>
    </article>
  )
}
