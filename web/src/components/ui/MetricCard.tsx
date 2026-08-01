import type { LucideIcon } from 'lucide-react'

type MetricCardTone = 'blue' | 'emerald' | 'violet' | 'amber'

const toneClasses: Record<
  MetricCardTone,
  { badge: string; icon: string; glow: string; card: string; border: string }
> = {
  blue: {
    badge: 'bg-slate-100 text-slate-700',
    icon: 'border border-blue-100 bg-blue-50 text-blue-700',
    glow: 'from-blue-500/35 via-blue-300/15 to-transparent',
    card: 'bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)]',
    border: 'border-slate-200',
  },
  emerald: {
    badge: 'bg-slate-100 text-slate-700',
    icon: 'border border-emerald-100 bg-emerald-50 text-emerald-700',
    glow: 'from-emerald-500/35 via-emerald-300/15 to-transparent',
    card: 'bg-[linear-gradient(180deg,#ffffff_0%,#f8fcfb_100%)]',
    border: 'border-slate-200',
  },
  violet: {
    badge: 'bg-slate-100 text-slate-700',
    icon: 'border border-violet-100 bg-violet-50 text-violet-700',
    glow: 'from-violet-500/35 via-violet-300/15 to-transparent',
    card: 'bg-[linear-gradient(180deg,#ffffff_0%,#faf8ff_100%)]',
    border: 'border-slate-200',
  },
  amber: {
    badge: 'bg-slate-100 text-slate-700',
    icon: 'border border-amber-100 bg-amber-50 text-amber-700',
    glow: 'from-amber-500/35 via-amber-300/15 to-transparent',
    card: 'bg-[linear-gradient(180deg,#ffffff_0%,#fffcf5_100%)]',
    border: 'border-slate-200',
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
    <article className={`overflow-hidden rounded-[8px] border p-3 shadow-card ${palette.card} ${palette.border}`}>
      <div className={`mb-3 h-[3px] w-14 bg-gradient-to-r ${palette.glow}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 font-display text-[34px] leading-none text-slate-950">{value}</p>
        </div>

        {Icon ? (
          <div className={`flex h-9 w-9 items-center justify-center rounded-[8px] ${palette.icon}`}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-1.5">
        <span className={`inline-flex rounded-[8px] px-2.5 py-1 text-[10px] font-semibold ${palette.badge}`}>{change}</span>
        {detail ? <p className="text-[13px] text-slate-500">{detail}</p> : null}
      </div>
    </article>
  )
}
