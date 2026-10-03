import { AlertTriangle, ChevronDown, Download, FolderTree, Radio, RefreshCw, Smartphone, Video } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { compact, number, plural } from '../lib/format'
import { queueDownloads, toastQueued, useDefaultPreset, useFetch, useListing, usePick } from '../lib/hooks'
import { useStore } from '../lib/store'
import type { ChannelInfo, Entry } from '../lib/types'
import { ListPicker } from './ListPicker'
import { PresetPicker } from './PresetPicker'
import { Button, Checkbox, Skeleton, Spinner, cx } from './ui'

const TAB_META: Record<string, { icon: typeof Video; folder: string; noun: string }> = {
  videos: { icon: Video, folder: 'Videos', noun: 'video' },
  shorts: { icon: Smartphone, folder: 'Shorts', noun: 'short' },
  streams: { icon: Radio, folder: 'Live', noun: 'stream' },
}

interface TabState { selected: number; total: number; loading: boolean; all: boolean; missing: boolean; error: string | null }

export function ChannelSection({ url, pickerHeight = 300 }: { url: string; pickerHeight?: number }) {
  const { data: info, error, loading, reload } = useFetch<ChannelInfo>(`/channel?url=${encodeURIComponent(url)}`, 15 * 60_000)
  const [include, setInclude] = useState<Record<string, boolean>>({ videos: true })
  const [states, setStates] = useState<Record<string, TabState>>({})
  const getters = useRef<Record<string, () => Entry[]>>({})
  const [preset, setPreset] = useDefaultPreset()
  const [skip, setSkip] = useState(useStore.getState().settings?.skip_existing ?? true)
  const [busy, setBusy] = useState(false)

  const onState = useCallback((tab: string, s: TabState) => setStates((prev) => ({ ...prev, [tab]: s })), [])

  const tabs = info?.tabs ?? []
  const chosen = tabs.filter((t) => include[t.key] && !states[t.key]?.missing)
  const total = chosen.reduce((n, t) => n + (states[t.key]?.selected ?? 0), 0)
  const waiting = chosen.some((t) => states[t.key]?.all && states[t.key]?.loading)

  const download = async () => {
    if (!info) return
    setBusy(true)
    let added = 0
    for (const t of chosen) {
      const items = getters.current[t.key]?.() ?? []
      added += await queueDownloads(items, preset,
        { mode: 'channel_tab', channel: info.title, tab_folder: TAB_META[t.key]?.folder ?? t.label }, skip, true)
    }
    setBusy(false)
    toastQueued(added)
  }

  if (error) {
    return (
      <div className="rounded-xl bg-bad/10 p-3 text-[13px] text-bad">
        <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>
        <Button size="sm" variant="ghost" className="mt-2" onClick={reload} icon={<RefreshCw className="size-3.5" />}>Try again</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {info?.avatar ? (
          <img src={info.avatar} referrerPolicy="no-referrer" className="size-12 rounded-full object-cover ring-2 ring-line" />
        ) : (
          <Skeleton className="size-12 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          {info ? <div className="truncate text-[15px] font-semibold">{info.title}</div> : <Skeleton className="h-4 w-2/3" />}
          <div className="mt-0.5 truncate text-[12px] text-muted">
            {info ? [info.handle, info.followers != null && `${compact(info.followers)} subscribers`].filter(Boolean).join(' · ')
              : loading && 'Loading channel…'}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-faint uppercase">
          <span>What to download</span>
          <span className="flex items-center gap-1 normal-case tracking-normal font-medium">
            <FolderTree className="size-3.5" /> Sorted into folders
          </span>
        </div>
        {info ? tabs.map((t) => (
          <CategoryCard
            key={t.key}
            channelUrl={info.url}
            channelTitle={info.title}
            tab={t.key}
            label={t.label}
            include={!!include[t.key]}
            setInclude={(v) => setInclude((p) => ({ ...p, [t.key]: v }))}
            onState={onState}
            register={(fn) => { getters.current[t.key] = fn }}
            pickerHeight={pickerHeight}
          />
        )) : [0, 1, 2].map((i) => <Skeleton key={i} className="h-[62px] rounded-xl" />)}
      </div>

      <div className="space-y-3 rounded-2xl border border-line bg-surface-2/60 p-3">
        <PresetPicker value={preset} onChange={setPreset} />
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted" onClick={() => setSkip(!skip)}>
          <Checkbox checked={skip} onChange={setSkip} />
          Skip videos I've already downloaded
        </label>
        <Button variant="primary" size="lg" className="w-full" loading={busy}
          disabled={!info || total === 0 || waiting} onClick={download} icon={<Download className="size-[18px]" />}>
          {waiting ? 'Loading lists…' : total === 0 ? 'Choose what to download' : `Download ${plural(total, 'video')}`}
        </Button>
      </div>
    </div>
  )
}

function CategoryCard({ channelUrl, channelTitle, tab, label, include, setInclude, onState, register, pickerHeight }: {
  channelUrl: string
  channelTitle: string
  tab: string
  label: string
  include: boolean
  setInclude: (v: boolean) => void
  onState: (tab: string, s: TabState) => void
  register: (fn: () => Entry[]) => void
  pickerHeight: number
}) {
  const { listing, error, refresh } = useListing(channelUrl, tab)
  const entries = listing?.entries ?? []
  const pick = usePick(entries, true)
  const [open, setOpen] = useState(false)
  const loading = !listing || !listing.done
  const missing = !!listing?.meta.missing || (!!listing?.done && entries.length === 0 && !error)
  const meta = TAB_META[tab] ?? TAB_META.videos
  const Icon = meta.icon

  register(pick.items)
  useEffect(() => {
    onState(tab, { selected: pick.selected.size, total: entries.length, loading, all: pick.all, missing, error })
  }, [tab, pick.selected.size, entries.length, loading, pick.all, missing, error, onState])

  const status = error ? 'Failed to load'
    : missing ? `No ${label.toLowerCase()}`
    : loading ? `${number(entries.length)} found…`
    : pick.all ? `All ${plural(entries.length, meta.noun)}`
    : `${number(pick.selected.size)} of ${number(entries.length)}`

  return (
    <div className={cx('overflow-hidden rounded-xl border transition-colors',
      include && !missing ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-surface-2/40', missing && 'opacity-55')}>
      <div className={cx('flex items-center gap-3 p-3', !missing && 'cursor-pointer')} onClick={() => !missing && setInclude(!include)}>
        <Checkbox checked={include && !missing && pick.selected.size > 0} onChange={() => !missing && setInclude(!include)} />
        <div className={cx('flex size-9 items-center justify-center rounded-lg', include ? 'bg-brand text-white' : 'bg-surface-3 text-muted')}>
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">{label}</div>
          <div className="flex items-center gap-1.5 truncate text-[11.5px] text-muted">
            {loading && !error && <Spinner className="size-3" />}
            <span className={cx(error && 'text-bad')}>{status}</span>
            {!missing && <span className="truncate text-faint">→ {channelTitle}/{meta.folder}</span>}
          </div>
        </div>
        {error ? (
          <button onClick={(e) => { e.stopPropagation(); refresh() }} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg" title="Retry">
            <RefreshCw className="size-4" />
          </button>
        ) : !missing && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-surface-3 hover:text-fg"
          >
            Pick <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && !missing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="px-2 pb-2"
          >
            <ListPicker
              entries={entries}
              selected={pick.selected}
              onChange={(s) => { pick.set(s); if (s.size && !include) setInclude(true) }}
              loading={loading}
              height={pickerHeight}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
