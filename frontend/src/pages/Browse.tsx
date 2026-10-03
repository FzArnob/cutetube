import {
  ArrowLeft, ArrowRight, Bookmark, Clock, Compass, Film, Home, Library, ListVideo, MousePointerClick, MousePointer2,
  PanelRightClose, PanelRightOpen, RotateCw, Search, ShieldCheck, ShieldOff, Sparkles, Tv, Users, X, type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, post } from '../lib/api'
import { compact } from '../lib/format'
import { useStore } from '../lib/store'
import type { BrowserState, Site } from '../lib/types'
import { SITE_LABEL } from '../components/SiteIcons'
import { SocialPanel } from '../components/SocialPanel'
import { ChannelSection } from '../components/ChannelSection'
import { PlaylistSection } from '../components/PlaylistSection'
import { SelectionTray } from '../components/SelectionTray'
import { ToolsBanner } from '../components/ToolsBanner'
import { VideoCard } from '../components/VideoCard'
import { Button, IconButton, Spinner, cx } from '../components/ui'

export const nav = (action: string, url?: string) => post('/browser/nav', { action, url })

/** Keeps the native YouTube view glued to this element's rectangle. */
function useNativeSlot(ref: React.RefObject<HTMLDivElement | null>, visible: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let last = ''
    let frame = 0
    const send = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const body = {
          left: r.left, top: r.top, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom,
          dpr: window.devicePixelRatio, visible,
        }
        const key = JSON.stringify(body)
        if (key !== last) { last = key; post('/browser/layout', body).catch(() => { last = '' }) }
      })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    const retry = setInterval(send, 2000) // re-sync after reconnects
    return () => { ro.disconnect(); window.removeEventListener('resize', send); clearInterval(retry); cancelAnimationFrame(frame) }
  }, [ref, visible])
}

export function Browse({ active }: { active: boolean }) {
  const slot = useRef<HTMLDivElement>(null)
  const browser = useStore((s) => s.browser)
  const connected = useStore((s) => s.connected)
  const site = useStore((s) => s.site)
  const [panel, setPanel] = useState(true)
  useNativeSlot(slot, active && connected)

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <BrowserBar browser={browser} panel={panel} togglePanel={() => setPanel(!panel)} />
        <div ref={slot} className="relative flex-1 bg-[#0f0f0f]">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-white/50">
            <Spinner className="size-6 text-white/40" />
            Opening {SITE_LABEL[site]}…
          </div>
        </div>
      </div>
      {panel && <ContextPanel browser={browser} />}
    </div>
  )
}

function BrowserBar({ browser, panel, togglePanel }: { browser: BrowserState | null; panel: boolean; togglePanel: () => void }) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [dirty, setDirty] = useState(false)
  const url = browser?.url ?? ''
  const pretty = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  const selectMode = browser?.selectMode ?? false
  const selCount = useStore((s) => s.selection.items.length)
  const ab = browser?.adblock

  useEffect(() => { if (!dirty) setDraft(focused ? url : pretty) }, [pretty, url, focused, dirty])

  const toggleAdblock = async () => {
    const next = !ab?.enabled
    await api('/settings', { method: 'PATCH', body: { adblock: next } })
    toast(next ? 'Ad blocker on' : 'Ad blocker off', { description: 'Reloading the page…' })
  }

  const site: Site = browser?.site ?? 'youtube'
  const quick = QUICK[site]

  return (
    <div className="relative flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
      <IconButton title="Back" disabled={!browser?.canBack} onClick={() => nav('back')}><ArrowLeft className="size-[18px]" /></IconButton>
      <IconButton title="Forward" disabled={!browser?.canForward} onClick={() => nav('forward')}><ArrowRight className="size-[18px]" /></IconButton>
      <IconButton title={browser?.loading ? 'Stop' : 'Reload'} onClick={() => nav(browser?.loading ? 'stop' : 'reload')}>
        {browser?.loading ? <X className="size-[18px]" /> : <RotateCw className="size-4" />}
      </IconButton>

      <form className="mx-1.5 min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); nav('go', draft); setDirty(false); (document.activeElement as HTMLElement)?.blur() }}>
        <div className={cx('relative flex h-9 items-center rounded-full border bg-surface-2 transition-colors',
          focused ? 'border-accent' : 'border-transparent hover:border-line-strong')}>
          <Search className="ml-3 size-4 shrink-0 text-faint" />
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setDirty(true) }}
            onFocus={(e) => { setFocused(true); setDraft(url); requestAnimationFrame(() => e.target.select()) }}
            onBlur={() => { setFocused(false); setDirty(false) }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setDirty(false); (e.target as HTMLInputElement).blur() } }}
            placeholder={`Search ${SITE_LABEL[site]} or paste a link`}
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] outline-none placeholder:text-faint"
          />
          {browser?.loading && <div className="absolute right-4 bottom-0 left-4 h-0.5 overflow-hidden rounded-full"><div className="progress-live h-full bg-brand" /></div>}
        </div>
      </form>

      <div className="flex items-center">
        {quick.map((q) => (
          <IconButton key={q.label} title={q.label} onClick={() => nav('go', q.url)}><q.icon className="size-[17px]" /></IconButton>
        ))}
      </div>
      <div className="mx-1 h-6 w-px bg-line" />
      <Button
        size="sm"
        variant={selectMode ? 'primary' : 'secondary'}
        onClick={() => post('/browser/select-mode', { on: !selectMode })}
        icon={selectMode ? <MousePointerClick className="size-4" /> : <MousePointer2 className="size-4" />}
        title="Click posts and videos on any page to select them for download"
      >
        {selectMode ? `Selecting${selCount ? ` · ${selCount}` : ''}` : 'Select'}
      </Button>
      <button
        onClick={toggleAdblock}
        title={ab?.enabled
          ? `Ad blocker on · ${ab.page} blocked on this page · ${compact(ab.total)} this session · ${ab.ads} ads removed\nClick to turn off`
          : 'Ad blocker off — click to turn on'}
        className={cx('ml-1 flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold tabular-nums transition-colors',
          ab?.enabled ? 'text-ok hover:bg-ok/10' : 'text-faint hover:bg-surface-2')}
      >
        {ab?.enabled ? <ShieldCheck className="size-[18px]" /> : <ShieldOff className="size-[18px]" />}
        {ab?.enabled && <span>{compact(ab.page + ab.ads)}</span>}
      </button>
      <IconButton title={panel ? 'Hide download panel' : 'Show download panel'} onClick={togglePanel}>
        {panel ? <PanelRightClose className="size-[18px]" /> : <PanelRightOpen className="size-[18px]" />}
      </IconButton>
    </div>
  )
}

const QUICK: Record<Site, { icon: LucideIcon; label: string; url: string }[]> = {
  youtube: [
    { icon: Home, label: 'Home', url: 'https://www.youtube.com/' },
    { icon: Users, label: 'Subscriptions', url: 'https://www.youtube.com/feed/subscriptions' },
    { icon: Clock, label: 'History', url: 'https://www.youtube.com/feed/history' },
    { icon: Library, label: 'You', url: 'https://www.youtube.com/feed/you' },
  ],
  facebook: [
    { icon: Home, label: 'Home', url: 'https://www.facebook.com/' },
    { icon: Tv, label: 'Video', url: 'https://www.facebook.com/watch/' },
    { icon: Film, label: 'Reels', url: 'https://www.facebook.com/reel/' },
    { icon: Bookmark, label: 'Saved', url: 'https://www.facebook.com/saved/' },
  ],
  instagram: [
    { icon: Home, label: 'Home', url: 'https://www.instagram.com/' },
    { icon: Compass, label: 'Explore', url: 'https://www.instagram.com/explore/' },
    { icon: Film, label: 'Reels', url: 'https://www.instagram.com/reels/' },
  ],
  tiktok: [
    { icon: Home, label: 'For You', url: 'https://www.tiktok.com/foryou' },
    { icon: Users, label: 'Following', url: 'https://www.tiktok.com/following' },
    { icon: Compass, label: 'Explore', url: 'https://www.tiktok.com/explore' },
  ],
}

const PAGE_LABEL: Record<string, string> = { home: 'Home feed', search: 'Search results', feed: 'Your feed', other: 'YouTube' }

function ContextPanel({ browser }: { browser: BrowserState | null }) {
  const ctx = browser?.ctx
  const label = !ctx ? '' : ctx.kind === 'video' ? (ctx.short ? 'This Short' : 'This video')
    : ctx.kind === 'channel' ? 'Channel' : ctx.kind === 'playlist' ? 'Playlist' : ctx.kind === 'page' ? PAGE_LABEL[ctx.page] ?? '' : ''

  return (
    <aside className="flex w-[384px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        <ToolsBanner className="mb-4" />
        {browser && browser.site !== 'youtube' ? <SocialPanel browser={browser} /> : <>
        <div className="mb-3 text-[11px] font-semibold tracking-wider text-faint uppercase">{label}</div>
        {!ctx ? <PageHelp /> : ctx.kind === 'video' ? (
          <div className="space-y-5">
            <VideoCard key={ctx.video_id} url={ctx.url} videoId={ctx.video_id} hint={browser?.video} />
            {ctx.playlist_url && (
              <div className="border-t border-line pt-4">
                <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
                  <ListVideo className="size-3.5" /> From this playlist
                </div>
                <PlaylistSection key={ctx.playlist_id} url={ctx.playlist_url} height={280} />
              </div>
            )}
          </div>
        ) : ctx.kind === 'channel' ? (
          <ChannelSection key={ctx.channel_url} url={ctx.channel_url} />
        ) : ctx.kind === 'playlist' ? (
          <PlaylistSection key={ctx.playlist_id} url={ctx.url} height={420} />
        ) : <PageHelp />}
        </>}
      </div>
      <SelectionTray />
    </aside>
  )
}

function PageHelp() {
  const selectMode = useStore((s) => s.selection.selectMode)
  const tips = [
    { icon: MousePointerClick, title: 'Pick from any page', text: 'Turn on Select, then click videos on Home, Subscriptions, search results — anywhere.' },
    { icon: Tv, title: 'Whole channels', text: 'Open a channel to download its Videos, Shorts and Live streams into tidy folders.' },
    { icon: ListVideo, title: 'Playlists', text: 'Open a playlist to grab all of it or tick just the ones you want.' },
    { icon: Sparkles, title: 'Right-click', text: 'Right-click any video thumbnail and choose "Download video".' },
  ]
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl bg-brand p-4 text-white">
        <div className="absolute -top-10 -right-10 size-36 rounded-full bg-white/10" />
        <div className="absolute -right-4 -bottom-14 size-28 rounded-full bg-white/10" />
        <div className="relative">
          <div className="text-[15px] font-semibold">Select videos from this page</div>
          <div className="mt-1 text-[12.5px] leading-relaxed text-white/85">Checkboxes appear on every thumbnail. Your picks stay selected while you browse.</div>
          <button
            onClick={() => post('/browser/select-mode', { on: !selectMode })}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-[#1a1a24] shadow hover:bg-white/90"
          >
            <MousePointerClick className="size-4" /> {selectMode ? 'Stop selecting' : 'Start selecting'}
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {tips.map((t) => (
          <div key={t.title} className="flex gap-3 rounded-xl p-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><t.icon className="size-4" /></div>
            <div>
              <div className="text-[13px] font-semibold">{t.title}</div>
              <div className="text-[12px] leading-relaxed text-muted">{t.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
