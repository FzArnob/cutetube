import { ArrowDownToLine, Settings } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import type { Page, Site } from '../lib/types'
import { SITE_LABEL, SiteIcon } from './SiteIcons'
import { cx } from './ui'

export function Rail() {
  const page = useStore((s) => s.page)
  const setPage = useStore((s) => s.setPage)
  const site = useStore((s) => s.site)
  const openSite = useStore((s) => s.openSite)
  const sites: Site[] = ['youtube', 'facebook', 'instagram', 'tiktok']
  const connected = useStore((s) => s.connected)
  const jobs = useStore((s) => s.jobs)

  const { active, progress } = useMemo(() => {
    const act = Object.values(jobs).filter((j) => j.status === 'running' || j.status === 'queued')
    const p = act.length ? act.reduce((n, j) => n + j.progress, 0) / act.length : 0
    return { active: act.length, progress: p }
  }, [jobs])

  const iconCls = (on: boolean) => cx('size-[22px]', on && 'text-accent')

  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-center border-r border-line bg-surface pt-2.5 pb-3">
      <div className="flex flex-col gap-1">
        {sites.map((s) => {
          const on = page === 'browse' && site === s
          return (
            <RailButton key={s} label={SITE_LABEL[s]} active={on} onClick={() => openSite(s)}
              icon={<span className={cx('transition-[filter,opacity]', !on && 'opacity-85 grayscale-[0.3]')}><SiteIcon site={s} className="size-[26px]" /></span>} />
          )
        })}
        <div className="mx-auto my-1.5 h-px w-8 bg-line" />
        <RailButton label="Downloads" active={page === 'downloads'} onClick={() => setPage('downloads')}
          icon={<ArrowDownToLine className={iconCls(page === 'downloads')} strokeWidth={page === 'downloads' ? 2.2 : 1.9} />}>
          {active > 0 && (
            <>
              <svg className="pointer-events-none absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
                <circle cx="18" cy="18" r="16" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={`${progress * 100.5} 100.5`} className="transition-[stroke-dasharray] duration-500" />
              </svg>
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white tabular-nums">
                {active}
              </span>
            </>
          )}
        </RailButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-2">
        {!connected && <span className="size-2 animate-pulse rounded-full bg-warn" title="Reconnecting to the engine…" />}
        <RailButton label="Settings" active={page === 'settings'} onClick={() => setPage('settings' as Page)}
          icon={<Settings className={iconCls(page === 'settings')} strokeWidth={page === 'settings' ? 2.2 : 1.9} />} />
      </div>
    </nav>
  )
}

function RailButton({ icon, label, active, onClick, children }: {
  icon: ReactNode; label: string; active: boolean; onClick: () => void; children?: ReactNode
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={cx('group relative flex size-12 items-center justify-center rounded-xl transition-colors',
        active ? 'text-fg' : 'text-faint hover:bg-surface-2 hover:text-fg')}>
      {active && (
        <motion.span layoutId="rail-active" className="absolute inset-0 rounded-xl bg-surface-3"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
      )}
      {active && <motion.span layoutId="rail-bar" className="absolute top-1/2 -left-1.5 h-6 w-[3px] -translate-y-1/2 rounded-full bg-brand" />}
      <span className="relative flex items-center">{icon}</span>
      {children}
    </button>
  )
}
