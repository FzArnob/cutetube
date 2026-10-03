import { useState } from 'react'
import { AlertTriangle, Download, ListVideo, RefreshCw } from 'lucide-react'
import { number, plural } from '../lib/format'
import { queueDownloads, useDefaultPreset, useListing, usePick } from '../lib/hooks'
import { useStore } from '../lib/store'
import { ListPicker } from './ListPicker'
import { PresetPicker } from './PresetPicker'
import { Button, Checkbox, Skeleton, Spinner } from './ui'

export function PlaylistSection({ url, height = 340 }: { url: string; height?: number }) {
  const { listing, error, refresh } = useListing(url)
  const entries = listing?.entries ?? []
  const pick = usePick(entries, true)
  const [preset, setPreset] = useDefaultPreset()
  const [skip, setSkip] = useState(useStore.getState().settings?.skip_existing ?? true)
  const loading = !listing || !listing.done
  const meta = listing?.meta ?? {}

  const download = () => queueDownloads(
    pick.items(), preset,
    { mode: 'playlist', playlist: meta.title ?? 'Playlist', channel: meta.channel ?? null },
    skip,
  )

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <ListVideo className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          {meta.title ? <div className="line-clamp-2 text-[14px] leading-snug font-semibold">{meta.title}</div>
            : <Skeleton className="mt-1 h-4 w-3/4" />}
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            {meta.channel && <span>{meta.channel} ·</span>}
            {loading ? <><Spinner className="size-3" /> {number(entries.length)} found…</> : plural(entries.length, 'video')}
          </div>
        </div>
        <button onClick={refresh} title="Reload list" className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-fg">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl bg-bad/10 p-3 text-[13px] text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}
        </div>
      ) : (
        <ListPicker entries={entries} selected={pick.selected} onChange={pick.set} loading={loading} height={height} showIndex />
      )}

      {!error && <>
      <PresetPicker value={preset} onChange={setPreset} />
      <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted" onClick={() => setSkip(!skip)}>
        <Checkbox checked={skip} onChange={setSkip} />
        Skip videos I've already downloaded
      </label>
      <Button variant="primary" size="lg" className="w-full" disabled={pick.selected.size === 0 || (pick.all && loading)}
        onClick={download} icon={<Download className="size-[18px]" />}>
        {pick.all && loading ? 'Loading playlist…' : pick.all ? `Download all ${number(pick.selected.size)}` : `Download ${plural(pick.selected.size, 'video')}`}
      </Button>
      </>}
    </div>
  )
}
