import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCheck, Search, Sparkles, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { compact, duration, number } from '../lib/format'
import { useStore } from '../lib/store'
import type { Entry } from '../lib/types'
import { Checkbox, Pill, Spinner, Thumb, cx } from './ui'

interface Props {
  entries: Entry[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  loading?: boolean
  height?: number
  showIndex?: boolean
}

export function ListPicker({ entries, selected, onChange, loading, height = 360, showIndex }: Props) {
  const downloaded = useStore((s) => s.downloaded)
  const [q, setQ] = useState('')
  const parent = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? entries.filter((e) => e.title.toLowerCase().includes(needle)) : entries
  }, [entries, q])
  const available = useMemo(() => entries.filter((e) => !e.unavailable), [entries])

  const rows = useVirtualizer({
    count: shown.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 64,
    overscan: 8,
  })

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }
  const selectShown = (on: boolean) => {
    const next = new Set(selected)
    for (const e of shown) if (!e.unavailable) { if (on) next.add(e.id); else next.delete(e.id) }
    onChange(next)
  }
  const onlyNew = () => onChange(new Set(available.filter((e) => !downloaded.has(e.id)).map((e) => e.id)))
  const allShownSelected = shown.length > 0 && shown.every((e) => e.unavailable || selected.has(e.id))
  const someSelected = shown.some((e) => selected.has(e.id))

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <Checkbox
          checked={allShownSelected}
          indeterminate={!allShownSelected && someSelected}
          onChange={() => selectShown(!allShownSelected)}
        />
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by title"
            className="h-7 w-full rounded-md bg-surface-2 pr-6 pl-7 text-xs outline-none placeholder:text-faint focus:ring-1 focus:ring-accent"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <button onClick={onlyNew} title="Select only videos you haven't downloaded yet"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
          <Sparkles className="size-3.5" />New only
        </button>
        <button onClick={() => selectShown(true)} title="Select all"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
          <CheckCheck className="size-3.5" />All
        </button>
      </div>

      <div ref={parent} className="scroll-thin overflow-y-auto" style={{ height }}>
        <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map((row) => {
            const e = shown[row.index]
            const on = selected.has(e.id)
            const saved = downloaded.has(e.id)
            return (
              <div
                key={e.id}
                onClick={() => !e.unavailable && toggle(e.id)}
                className={cx(
                  'absolute left-0 flex w-full items-center gap-2.5 px-2.5 transition-colors',
                  e.unavailable ? 'opacity-40' : 'cursor-pointer hover:bg-surface-2',
                  on && 'bg-accent-soft/60',
                )}
                style={{ top: row.start, height: row.size }}
              >
                <Checkbox checked={on} onChange={() => !e.unavailable && toggle(e.id)} />
                {showIndex && <span className="w-6 text-right text-[11px] text-faint tabular-nums">{e.index}</span>}
                <div className="flex w-[84px] shrink-0 justify-center">
                  <Thumb src={e.thumb} short={e.short} className={e.short ? 'h-[52px]' : 'w-[84px]'} duration={duration(e.duration)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12.5px] leading-snug font-medium">{e.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                    {e.views != null && <span>{compact(e.views)} views</span>}
                    {e.unavailable && <Pill tone="warn">{e.unavailable}</Pill>}
                    {saved && <Pill tone="ok">Saved</Pill>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted">
            <Spinner className="size-3.5" /> Loading more… {number(entries.length)} found
          </div>
        )}
        {!loading && shown.length === 0 && (
          <div className="py-10 text-center text-xs text-muted">{q ? 'No matches' : 'Nothing here'}</div>
        )}
      </div>
    </div>
  )
}
