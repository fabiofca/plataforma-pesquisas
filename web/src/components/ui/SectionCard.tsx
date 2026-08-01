import type { ReactNode } from 'react'

export function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-4 shadow-card">
      <div className="mb-4 border-b border-slate-100 pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <div className="mt-2 h-[3px] w-12 bg-[linear-gradient(90deg,#0b5cff_0%,#93c5fd_100%)]" />
      </div>
      <div className="mb-4 mt-1.5">
        <h2 className="font-display text-[22px] leading-tight text-slate-950">{title}</h2>
        <p className="mt-1 text-[13px] text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  )
}
