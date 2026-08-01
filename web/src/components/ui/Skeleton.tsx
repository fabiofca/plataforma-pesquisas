export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton skeleton-card ${className}`} aria-hidden="true" />
  )
}

export function SkeletonText({ width = '100%', className = '' }: { width?: string; className?: string }) {
  return (
    <div
      className={`skeleton skeleton-text ${className}`}
      style={{ width }}
      aria-hidden="true"
    />
  )
}

export function SkeletonHeading({ width = '60%', className = '' }: { width?: string; className?: string }) {
  return (
    <div
      className={`skeleton skeleton-heading ${className}`}
      style={{ width }}
      aria-hidden="true"
    />
  )
}

export function SkeletonMetricCard() {
  return (
    <div className="admin-stat-card animate-fade-in-up space-y-3">
      <SkeletonHeading width="50%" />
      <SkeletonText width="35%" />
      <div className="flex gap-2">
        <SkeletonText width="20%" />
        <SkeletonText width="40%" />
      </div>
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="admin-table-shell animate-fade-in space-y-3 p-4" aria-hidden="true">
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonHeading key={i} width={`${60 + i * 5}%`} />
        ))}
      </div>
      <div className="h-px bg-slate-200" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: 4 }).map((_, j) => (
            <SkeletonText key={j} width={`${40 + j * 10}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonPageHero() {
  return (
    <div className="admin-page-hero animate-fade-in space-y-3" aria-hidden="true">
      <SkeletonHeading width="30%" />
      <div className="grid gap-3 sm:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}
