import { AlertTriangle, Wrench } from 'lucide-react'
import { post } from '../lib/api'
import { useStore } from '../lib/store'
import { Button, Progress, cx } from './ui'

const NAMES: Record<string, string> = { ffmpeg: 'ffmpeg (video merging)', deno: 'Deno (YouTube player support)' }

/** First-run helper: shows while required components are downloading or failed to install. */
export function ToolsBanner({ className }: { className?: string }) {
  const tools = useStore((s) => s.tools)
  const busy = Object.entries(tools).filter(([k, t]) => NAMES[k] && t.busy)
  const failed = Object.entries(tools).filter(([k, t]) => NAMES[k] && !t.busy && !t.ok && t.error)
  if (!busy.length && !failed.length) return null

  return (
    <div className={cx('rounded-2xl border p-3', failed.length ? 'border-bad/30 bg-bad/10' : 'border-line bg-surface-2', className)}>
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        {failed.length ? <AlertTriangle className="size-4 text-bad" /> : <Wrench className="size-4 text-accent" />}
        {failed.length ? 'Some components failed to install' : 'Setting things up (first run only)'}
      </div>
      <div className="mt-2 space-y-2">
        {busy.map(([k, t]) => (
          <div key={k}>
            <div className="mb-1 flex justify-between text-[11.5px] text-muted">
              <span>Downloading {NAMES[k]}</span><span className="tabular-nums">{Math.round((t.progress ?? 0) * 100)}%</span>
            </div>
            <Progress value={t.progress ?? 0} live />
          </div>
        ))}
        {failed.map(([k, t]) => (
          <div key={k} className="text-[12px] text-bad">{NAMES[k]}: {t.error}</div>
        ))}
      </div>
      {failed.length > 0 && <Button size="sm" className="mt-2" onClick={() => post('/tools/retry')}>Retry</Button>}
    </div>
  )
}
