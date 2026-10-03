import { ChevronUp, Download, ListChecks, ListVideo, MousePointerClick, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { post } from '../lib/api'
import { duration, number, plural } from '../lib/format'
import { queueDownloads, toastQueued, useDefaultPreset } from '../lib/hooks'
import { useStore } from '../lib/store'
import { PresetPicker } from './PresetPicker'
import { Button, Pill, Thumb, cx } from './ui'

export function SelectionTray() {
  const { items, selectMode } = useStore((s) => s.selection)
  const site = useStore((s) => s.site)
  const [expanded, setExpanded] = useState(false)
  const [preset, setPreset] = useDefaultPreset()
  const [busy, setBusy] = useState(false)

  if (!selectMode && items.length === 0) return null

  const posts = items.filter((i) => i.kind === 'media')
  const videos = items.filter((i) => i.kind === 'video')
  const lists = items.filter((i) => i.kind === 'playlist' || i.kind === 'mix')
  const summary = [
    videos.length ? plural(videos.length, 'video') : '',
    lists.length ? plural(lists.length, 'playlist') : '',
    posts.length ? plural(posts.length, 'post') : '',
  ].filter(Boolean).join(' + ')
  const youtube = videos.length + lists.length > 0
  const social = site !== 'youtube'

  const download = async () => {
    setBusy(true)
    try {
      const single = [...videos, ...posts]
      if (single.length) {
        // Photos / posts take everything they have; the quality only applies to YouTube videos.
        const n = await queueDownloads(single, youtube ? preset : 'best', { mode: 'auto' }, false, lists.length > 0)
        if (lists.length) toastQueued(n)
      }
      if (lists.length) {
        // The server lists every video of each playlist, then queues them into Playlists/<name>/.
        await post('/downloads/playlists', {
          items: lists.map((l) => ({ url: l.url, title: l.title })),
          preset,
          skip_existing: useStore.getState().settings?.skip_existing ?? true,
        })
        toast(lists.length === 1 ? 'Loading the playlist…' : `Loading ${lists.length} playlists…`,
          { description: 'Every video in it will be added to your downloads.' })
      }
      await post('/selection/remove', {})
      await post('/browser/select-mode', { on: false })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="border-t border-line bg-surface/95 p-3 shadow-[0_-12px_30px_-12px_rgb(0_0_0/0.35)] backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brand text-white">
          <ListChecks className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">{items.length ? `${summary} selected` : 'Select mode'}</div>
          <div className="text-[11.5px] text-muted">
            {items.length ? 'Keep browsing — selection is kept across pages'
              : social ? 'Click posts, reels or videos on the page · Esc to exit' : 'Click videos or playlists on the page · Esc to exit'}
          </div>
        </div>
        {items.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" title="Show selected">
            <ChevronUp className={cx('size-4 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && items.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="scroll-thin mt-3 max-h-[240px] space-y-1 overflow-y-auto pr-1">
              {items.map((it) => {
                const isList = it.kind === 'playlist' || it.kind === 'mix'
                return (
                  <div key={it.id} className="group flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
                    <Thumb src={it.thumb} className="w-16" duration={duration(it.duration)}>
                      {isList && (
                        <span className="absolute inset-y-0 right-0 flex w-6 items-center justify-center bg-black/70 text-white">
                          <ListVideo className="size-3.5" />
                        </span>
                      )}
                    </Thumb>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[12px] leading-snug font-medium">{it.title ?? it.id}</div>
                      <div className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                        {isList && (
                          <Pill tone="accent" className="h-4 px-1.5 text-[10px]">
                            {it.kind === 'mix' ? 'Mix' : 'Playlist'}{it.count ? ` · ${number(it.count)} videos` : ' · all videos'}
                          </Pill>
                        )}
                        {it.channel && <span className="truncate">{it.channel}</span>}
                      </div>
                    </div>
                    <button onClick={() => post('/selection/remove', { ids: [it.id] })}
                      className="rounded-md p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg">
                      <X className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => post('/browser/select-all')} icon={<MousePointerClick className="size-3.5" />}
          title={social ? 'Selects every post shown on the page' : 'Selects every single video on the page (playlists and mixes are picked individually)'}>
          {social ? 'Select all posts on page' : 'Select all videos on page'}
        </Button>
        {items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => post('/selection/remove', {})}>Clear</Button>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-2 space-y-2">
          {youtube && <PresetPicker value={preset} onChange={setPreset} />}
          <Button variant="primary" className="w-full" loading={busy} onClick={download} icon={<Download className="size-4" />}>
            {`Download ${summary}`}
          </Button>
        </div>
      )}
    </motion.div>
  )
}
