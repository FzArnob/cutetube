import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertCircle, CheckCircle2, Clock, Download, FolderOpen, Music, Pause, Play, RotateCcw, Search, Trash2, X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { post } from '../lib/api'
import { PRESET_LABEL, ago, bytes, duration, eta, plural, speed } from '../lib/format'
import { jobsList, useStore } from '../lib/store'
import type { Job } from '../lib/types'
import { JobControls, openJob } from '../components/JobControls'
import { SITE_LABEL, SiteIcon } from '../components/SiteIcons'
import { ToolsBanner } from '../components/ToolsBanner'
import { Button, Checkbox, Empty, Pill, Progress, Thumb, cx } from '../components/ui'

type Filter = 'all' | 'active' | 'done' | 'failed'
const IN = {
  active: ['running', 'queued', 'paused'],
  done: ['done', 'skipped'],
  failed: ['error', 'cancelled'],
} as const
const isIn = (f: keyof typeof IN, j: Job) => (IN[f] as readonly string[]).includes(j.status)

const haystack = (j: Job) =>
  [j.title, j.channel, (j.folder as { playlist?: string })?.playlist, j.dir].filter(Boolean).join(' ').toLowerCase()

export function Downloads() {
  const jobs = useStore((s) => s.jobs)
  const root = useStore((s) => s.settings?.download_dir ?? '')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmRemove, setConfirmRemove] = useState(false)
  const anchor = useRef<number | null>(null)
  const parent = useRef<HTMLDivElement>(null)

  const all = useMemo(() => jobsList(jobs), [jobs])
  const counts = useMemo(() => ({
    all: all.length,
    active: all.filter((j) => isIn('active', j)).length,
    done: all.filter((j) => isIn('done', j)).length,
    failed: all.filter((j) => isIn('failed', j)).length,
  }), [all])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((j) => filter === 'all' || isIn(filter, j))
      .filter((j) => !needle || haystack(j).includes(needle))
      .sort((a, b) => rank(a) - rank(b) || b.created - a.created)
  }, [all, filter, q])

  // Only rows you can see count as selected, so a filter never hides what an action will touch.
  const selected = useMemo(() => list.filter((j) => picked.has(j.id)), [list, picked])
  const allSelected = list.length > 0 && selected.length === list.length
  const n = {
    pause: selected.filter((j) => j.status === 'running' || j.status === 'queued').length,
    resume: selected.filter((j) => j.status === 'paused').length,
    retry: selected.filter((j) => j.status === 'error' || j.status === 'cancelled').length,
    active: selected.filter((j) => isIn('active', j)).length,
  }

  const totalSpeed = all.reduce((s, j) => s + (j.status === 'running' ? j.speed ?? 0 : 0), 0)
  const running = all.filter((j) => j.status === 'running').length

  const rows = useVirtualizer({ count: list.length, getScrollElement: () => parent.current, estimateSize: () => 92, overscan: 6 })

  useEffect(() => { setConfirmRemove(false) }, [picked, filter, q])

  const clear = useCallback(() => { setPicked(new Set()); anchor.current = null }, [])
  const selectAll = useCallback(() => setPicked(new Set(list.map((j) => j.id))), [list])

  const onRowClick = (index: number, e: React.MouseEvent) => {
    const id = list[index].id
    const next = new Set(picked)
    if (e.shiftKey && anchor.current != null) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
      for (let i = a; i <= b; i++) next.add(list[i].id)
    } else if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    anchor.current = index
    setPicked(next)
  }

  const run = async (action: 'pause' | 'resume' | 'retry' | 'remove') => {
    const ids = selected.map((j) => j.id)
    if (!ids.length) return
    if (action === 'remove' && n.active > 0 && !confirmRemove) { setConfirmRemove(true); return }
    const { changed } = await post<{ changed: number }>('/downloads/batch', { ids, action })
    const verb = { pause: 'Paused', resume: 'Resumed', retry: 'Retrying', remove: 'Removed' }[action]
    toast.success(`${verb} ${plural(changed, 'download')}`)
    if (action === 'remove') clear()
  }

  // Keyboard: Ctrl+A select all, Delete remove, Esc clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea')
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll() }
      else if (e.key === 'Escape') clear()
      else if (e.key === 'Delete' && selected.length) run('remove')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-8 pt-7 pb-4">
        <ToolsBanner className="mb-4" />
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <h1 className="font-[family-name:var(--font-display)] text-[28px] font-semibold tracking-tight">Downloads</h1>
            <div className="mt-1 text-[13px] text-muted">
              {running ? <>Downloading {running} · <span className="font-semibold text-fg tabular-nums">{speed(totalSpeed)}</span></>
                : counts.active ? `${counts.active} waiting` : 'Everything is up to date'}
              <span className="text-faint"> · saving to </span>
              <button onClick={() => post('/open', { target: 'root' })} className="text-muted underline decoration-line-strong underline-offset-2 hover:text-fg">{root}</button>
            </div>
          </div>
          <div className="flex gap-2">
            {counts.active > 0 && <Button size="sm" onClick={() => post('/downloads/bulk/pause_all')} icon={<Pause className="size-3.5" />}>Pause all</Button>}
            {all.some((j) => j.status === 'paused') && <Button size="sm" onClick={() => post('/downloads/bulk/resume_all')} icon={<Play className="size-3.5" />}>Resume all</Button>}
            {counts.done > 0 && <Button size="sm" variant="ghost" onClick={() => post('/downloads/bulk/clear_finished')} icon={<Trash2 className="size-3.5" />}>Clear finished</Button>}
            <Button size="sm" onClick={() => post('/open', { target: 'root' })} icon={<FolderOpen className="size-3.5" />}>Open folder</Button>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <div className="flex gap-1">
            {(['all', 'active', 'done', 'failed'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium capitalize transition-colors',
                  filter === f ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {f === 'done' ? 'Completed' : f}
                <span className={cx('rounded-md px-1.5 text-[11px] tabular-nums', filter === f ? 'bg-surface text-fg' : 'bg-surface-2 text-faint')}>{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, channel or playlist"
              className="h-8 w-full rounded-lg border border-line bg-surface-2 pr-2 pl-8 text-[13px] outline-none placeholder:text-faint focus:border-accent" />
          </div>
        </div>
      </div>

      {list.length > 0 && (
        <div className={cx('flex h-12 shrink-0 items-center gap-3 border-b px-8 transition-colors',
          selected.length ? 'border-accent/30 bg-accent-soft/60' : 'border-line')}>
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-medium" onClick={() => (allSelected ? clear() : selectAll())}>
            <Checkbox checked={allSelected} indeterminate={!allSelected && selected.length > 0}
              onChange={() => (allSelected ? clear() : selectAll())} />
            {selected.length ? `${plural(selected.length, 'download')} selected` : `Select all ${list.length}`}
          </label>
          <AnimatePresence>
            {selected.length > 0 && (
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5">
                <div className="mx-1 h-5 w-px bg-line-strong" />
                <Button size="sm" variant="ghost" disabled={!n.resume} onClick={() => run('resume')} icon={<Play className="size-3.5" />}>
                  Resume{n.resume ? ` ${n.resume}` : ''}
                </Button>
                <Button size="sm" variant="ghost" disabled={!n.pause} onClick={() => run('pause')} icon={<Pause className="size-3.5" />}>
                  Pause{n.pause ? ` ${n.pause}` : ''}
                </Button>
                <Button size="sm" variant="ghost" disabled={!n.retry} onClick={() => run('retry')} icon={<RotateCcw className="size-3.5" />}>
                  Retry{n.retry ? ` ${n.retry}` : ''}
                </Button>
                <Button size="sm" variant="danger" onClick={() => run('remove')} icon={<Trash2 className="size-3.5" />}>
                  {confirmRemove ? `Remove ${n.active} unfinished? Click again` : `Remove ${selected.length}`}
                </Button>
                <button onClick={clear} title="Clear selection (Esc)" className="ml-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                  <X className="size-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <span className="ml-auto text-[11.5px] text-faint">
            {selected.length ? 'Shift-click to select a range · Del to remove · Esc to clear' : 'Click rows to select · Ctrl+A selects all'}
          </span>
        </div>
      )}

      <div ref={parent} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6">
        {list.length === 0 ? (
          <Empty icon={<Download className="size-6" />} title={q ? 'No matches' : filter === 'all' ? 'No downloads yet' : 'Nothing here'}>
            {filter === 'all' && !q && 'Browse YouTube or paste a link — your downloads will show up here with live progress.'}
          </Empty>
        ) : (
          <div className="relative my-3" style={{ height: rows.getTotalSize() }}>
            {rows.getVirtualItems().map((r) => {
              const job = list[r.index]
              return (
                <div key={job.id} className="absolute left-0 w-full" style={{ top: r.start, height: r.size }}>
                  <JobRow job={job} root={root} selected={picked.has(job.id)} onClick={(e) => onRowClick(r.index, e)} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function rank(j: Job) {
  return j.status === 'running' ? 0 : j.status === 'queued' ? 1 : j.status === 'paused' ? 2 : j.status === 'error' ? 3 : 4
}

function JobRow({ job, root, selected, onClick }: { job: Job; root: string; selected: boolean; onClick: (e: React.MouseEvent) => void }) {
  const s = job.status
  const active = s === 'running' || s === 'queued' || s === 'paused'
  const folder = job.dir && root && job.dir.startsWith(root) ? job.dir.slice(root.length).replace(/^[\\/]/, '') || '/' : job.dir
  return (
    <div
      onClick={onClick}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onDoubleClick={() => s === 'done' && openJob(job.id, 'file')}
      className={cx('group flex h-[84px] cursor-pointer items-center gap-4 rounded-2xl border px-3 transition-colors',
        selected ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-surface')}
    >
      <Checkbox checked={selected} onChange={() => onClick({ shiftKey: false } as React.MouseEvent)} />
      <Thumb src={job.thumb} className="w-[128px]" duration={duration(job.duration)}>
        {job.kind === 'audio' && (
          <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-md bg-black/70 text-white"><Music className="size-3" /></span>
        )}
      </Thumb>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{job.title ?? untitled(job)}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted">
          {job.channel && <span className="truncate">{job.channel}</span>}
          {job.site && job.site !== 'youtube' && (
            <span className="flex items-center gap-1"><SiteIcon site={job.site} className="size-3.5" />{SITE_LABEL[job.site]}</span>
          )}
          {job.tool === 'gallery' ? <Pill>{job.media_type === 'collection' ? 'Profile' : 'Original'}</Pill>
            : <Pill>{PRESET_LABEL[job.preset] ?? job.preset}</Pill>}
          {job.format_note && <span className="text-faint">{job.format_note}</span>}
          {folder && <span className="truncate text-faint">· {folder}</span>}
        </div>
        <div className="mt-2 flex items-center gap-3">
          {active ? (
            <>
              <Progress value={job.tool === 'gallery' && s === 'running' ? 1 : job.progress} live={s === 'running'}
                tone={s === 'paused' ? 'muted' : 'brand'} className={cx('max-w-md', job.tool === 'gallery' && s === 'running' && 'opacity-60')} />
              <span className="shrink-0 text-[11.5px] text-muted tabular-nums">
                {s === 'queued' ? 'Waiting…' : s === 'paused' ? (job.stage ?? 'Paused')
                  : job.tool === 'gallery' ? <>{job.stage ?? 'Downloading'}{job.downloaded ? ` · ${bytes(job.downloaded)}` : ''}</>
                  : <>{job.stage ?? 'Downloading'} · {Math.round(job.progress * 100)}%{job.speed ? ` · ${speed(job.speed)}` : ''}{job.eta ? ` · ${eta(job.eta)}` : ''}</>}
              </span>
            </>
          ) : s === 'done' ? (
            <span className="flex items-center gap-1.5 text-[12px] text-ok"><CheckCircle2 className="size-3.5" />
              {job.tool === 'gallery' ? (job.files ? `${plural(job.files, 'file')} · ${bytes(job.total)}` : job.stage ?? 'Done') : bytes(job.total)} · {ago(job.finished)}</span>
          ) : s === 'skipped' ? (
            <span className="flex items-center gap-1.5 text-[12px] text-muted"><CheckCircle2 className="size-3.5" />Already downloaded — skipped</span>
          ) : s === 'error' ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-bad"><AlertCircle className="size-3.5 shrink-0" /><span className="truncate">{job.error}</span></span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] text-faint"><Clock className="size-3.5" />Interrupted — retry to continue</span>
          )}
        </div>
      </div>
      <div className={cx('flex items-center gap-1 transition-opacity', !active && !selected && 'opacity-60 group-hover:opacity-100')}>
        {s === 'done' && (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openJob(job.id, 'file') }} icon={<Play className="size-3.5" />}>Play</Button>
        )}
        <JobControls job={job} />
      </div>
    </div>
  )
}

const MEDIA_LABEL: Record<string, string> = {
  post: 'post', reel: 'reel', photo: 'photo', video: 'video', story: 'story', album: 'album', collection: 'collection',
}

/** A readable name for a download without a title (a social post without a caption). */
function untitled(job: Job): string {
  if (job.site === 'youtube') return job.url
  const what = `${SITE_LABEL[job.site]} ${MEDIA_LABEL[job.media_type ?? ''] ?? 'post'}`
  return job.channel ? `${what} by ${job.channel}` : what
}
