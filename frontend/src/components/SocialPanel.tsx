import {
  AlertTriangle, CheckCircle2, Download, FolderOpen, Images, LogIn, MousePointerClick, Music, Play, RefreshCw,
  ScrollText, Square, UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { post } from '../lib/api'
import { bytes, compact, duration, eta, number, plural, speed } from '../lib/format'
import { queueDownloads, toastQueued, useFetch, useJobFor } from '../lib/hooks'
import { useStore } from '../lib/store'
import type { BrowserState, MediaInfo, MediaOnly, Preset, ProfileInfo, Site, UrlContext } from '../lib/types'
import { JobControls, openJob } from './JobControls'
import { SITE_LABEL, SiteIcon } from './SiteIcons'
import { Button, Checkbox, Pill, Progress, Segmented, Skeleton, Spinner, cx } from './ui'

const HEIGHT_LABEL: Record<number, string> = { 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p', 360: '360p', 240: '240p' }
const TYPE_LABEL: Record<string, string> = { video: 'Video', reel: 'Reel', photo: 'Photo', post: 'Post', story: 'Story' }

export function SocialPanel({ browser }: { browser: BrowserState }) {
  const ctx = browser.ctx
  const site = browser.site
  const label = ctx.kind === 'media' ? `This ${(TYPE_LABEL[ctx.media_type] ?? 'post').toLowerCase()}`
    : ctx.kind === 'profile' ? 'Profile' : SITE_LABEL[site]

  return (
    <div className="space-y-4">
      <div className="text-[11px] font-semibold tracking-wider text-faint uppercase">{label}</div>
      {ctx.kind === 'media' ? <MediaSection key={ctx.id} ctx={ctx} />
        : ctx.kind === 'profile' ? <ProfileSection key={ctx.url} ctx={ctx} browser={browser} />
        : <SocialHelp site={site} signedIn={browser.signedIn ?? null} />}
    </div>
  )
}

/* ---------------------------------------------------------------- single post */

export function MediaSection({ ctx }: { ctx: Extract<UrlContext, { kind: 'media' }> }) {
  const { data, error, loading, reload } = useFetch<MediaInfo>(`/media?url=${encodeURIComponent(ctx.url)}`)
  const job = useJobFor(ctx.id)
  const [mode, setMode] = useState<'video' | 'audio'>('video')
  const [height, setHeight] = useState<number | null>(null)
  const [only, setOnly] = useState<MediaOnly>('all')
  const [imgOk, setImgOk] = useState(true)

  useEffect(() => { if (data?.qualities.length && height == null) setHeight(data.qualities[0].height) }, [data, height])

  const isVideo = data?.type === 'video'
  const mixed = data?.type === 'mixed'
  const preset: Preset = mode === 'audio' ? 'mp3' : height ? (String(height) as Preset) : 'best'
  const active = job && ['running', 'queued', 'paused'].includes(job.status)
  const done = job && (job.status === 'done' || job.status === 'skipped')
  const n = !data ? 0 : only === 'photos' ? data.photos ?? 0 : only === 'videos' ? data.videos ?? 0 : data.count

  const start = () => queueDownloads([{ url: ctx.url, title: data?.title, channel: data?.author ?? ctx.author, thumb: data?.thumb }],
    isVideo ? preset : 'best', { mode: 'auto' }, false, false, mixed ? only : 'all')
  // A photo opened from a multi-photo Facebook post: offer the whole post too.
  const wholePost = () => queueDownloads([{ url: `https://www.facebook.com/media/set/?set=${ctx.post_set}`, channel: data?.author ?? ctx.author }],
    'best')

  return (
    <div className="space-y-3.5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-3">
        {data?.thumb && imgOk ? (
          <img src={data.thumb} referrerPolicy="no-referrer" onError={() => setImgOk(false)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            {loading ? <Spinner className="size-6" /> : <SiteIcon site={ctx.site} className="size-12" dim />}
          </div>
        )}
        {data && (
          <div className="absolute bottom-2 left-2 flex gap-1.5">
            <Pill className="bg-black/70 text-white">
              {data.type === 'video' ? <><Play className="size-3" />{TYPE_LABEL[ctx.media_type] ?? 'Video'}{data.duration ? ` · ${duration(data.duration)}` : ''}</>
                : data.type === 'photos' ? <><Images className="size-3" />{plural(data.count, 'photo')}</>
                : <><Images className="size-3" />{plural(data.photos ?? 0, 'photo')} + {plural(data.videos ?? 0, 'video')}</>}
            </Pill>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {data?.title ? <div className="line-clamp-3 text-[14px] leading-snug font-semibold">{data.title}</div>
          : loading ? <Skeleton className="h-4 w-4/5" /> : null}
        <div className="mt-1 flex items-center gap-2 text-[12.5px] text-muted">
          {(data?.author ?? ctx.author) && <span className="font-medium text-fg/80">{handle(data?.author ?? ctx.author)}</span>}
          {data?.views != null && <span>{compact(data.views)} views</span>}
        </div>
      </div>

      {data?.parts && data.parts.length > 1 && <PartsStrip parts={data.parts} only={mixed ? only : 'all'} />}

      {error ? (
        <SignInError message={error} site={ctx.site} onRetry={reload} />
      ) : active && job ? (
        <JobProgress job={job} />
      ) : done && job ? (
        <div className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok/10 p-2.5 pl-3">
          <CheckCircle2 className="size-4 shrink-0 text-ok" />
          <span className="flex-1 text-[13px] font-medium">Downloaded{job.files > 1 ? ` · ${job.files} files` : ''}</span>
          {job.filepath && <Button size="sm" variant="ghost" onClick={() => openJob(job.id, 'file')} icon={<Play className="size-3.5" />}>Open</Button>}
          <Button size="sm" variant="ghost" onClick={() => openJob(job.id, 'folder')} icon={<FolderOpen className="size-3.5" />}>Folder</Button>
        </div>
      ) : null}
      {done && job?.only && mixed && (
        // Only part of the post was saved: offer the other part.
        <Button variant="secondary" size="sm" className="w-full" icon={<Download className="size-3.5" />}
          onClick={() => queueDownloads([{ url: ctx.url, title: data?.title, channel: data?.author ?? ctx.author, thumb: data?.thumb }],
            'best', { mode: 'auto' }, false, false, job.only === 'videos' ? 'photos' : 'videos')}>
          {job.only === 'videos' ? `Download the ${plural(data.photos ?? 0, 'photo')} too` : `Download the ${plural(data.videos ?? 0, 'video')} too`}
        </Button>
      )}
      {error || active || done ? null : (
        <>
          {isVideo && (
            <div className="space-y-2">
              <Segmented className="w-full" value={mode} onChange={setMode}
                options={[{ value: 'video', label: 'Video' }, { value: 'audio', label: <><Music className="size-3.5" />Audio (MP3)</> }]} />
              {mode === 'video' && data.qualities.length > 1 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
                  {data.qualities.map((q) => (
                    <button key={q.height} onClick={() => setHeight(q.height)}
                      className={cx('flex h-[48px] flex-col items-center justify-center rounded-xl border transition-all',
                        height === q.height ? 'border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]' : 'border-line bg-surface-2 hover:border-line-strong')}>
                      <span className="text-[13px] font-semibold">{HEIGHT_LABEL[q.height] ?? `${q.height}p`}</span>
                      <span className="text-[10.5px] text-muted">{bytes(q.size, true)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {mixed && (
            <Segmented className="w-full" size="sm" value={only} onChange={setOnly}
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'photos', label: <><Images className="size-3.5" />{plural(data.photos ?? 0, 'photo')}</> },
                { value: 'videos', label: <><Play className="size-3.5" />{plural(data.videos ?? 0, 'video')}</> },
              ]} />
          )}
          <Button variant="primary" size="lg" className="w-full" disabled={!data} onClick={start} icon={<Download className="size-[18px]" />}>
            {!data ? 'Reading post…' : isVideo ? (mode === 'audio' ? 'Download MP3' : data.count > 1 ? `Download all ${data.count} videos` : 'Download video')
              : only === 'videos' ? `Download ${n > 1 ? `${n} videos` : 'video'}`
              : only === 'photos' ? `Download ${n > 1 ? `${n} photos` : 'photo'}`
              : data.type === 'photos' ? `Download ${data.count > 1 ? `all ${data.count} photos` : 'photo'}`
              : `Download all ${data.count}`}
          </Button>
          {ctx.post_set && data && (
            <Button variant="ghost" size="sm" className="w-full" onClick={wholePost} icon={<Images className="size-3.5" />}>
              Download the whole post instead
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function PartsStrip({ parts, only }: { parts: NonNullable<MediaInfo['parts']>; only: MediaOnly }) {
  const shown = parts.slice(0, 12)
  return (
    <div className="grid grid-cols-6 gap-1">
      {shown.map((p, i) => {
        const off = only !== 'all' && (only === 'videos') !== (p.type === 'video')
        return (
          <div key={p.id} className={cx('relative aspect-square overflow-hidden rounded-md bg-surface-3 transition-opacity', off && 'opacity-25')}>
            {p.thumb && <img src={p.thumb} referrerPolicy="no-referrer" className="size-full object-cover" />}
            {p.type === 'video' && <Play className="absolute right-0.5 bottom-0.5 size-3 fill-white text-white drop-shadow" />}
            {i === shown.length - 1 && parts.length > shown.length && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[12px] font-semibold text-white">
                +{parts.length - shown.length}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function JobProgress({ job }: { job: NonNullable<ReturnType<typeof useJobFor>> }) {
  const gallery = job.tool === 'gallery'
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12.5px]">
        <span className="font-medium">{job.status === 'paused' ? 'Paused' : job.status === 'queued' ? 'Waiting in queue' : job.stage ?? 'Downloading'}</span>
        <JobControls job={job} compact />
      </div>
      <Progress value={gallery ? 1 : job.progress} live={job.status === 'running'} tone={job.status === 'paused' ? 'muted' : 'brand'}
        className={gallery && job.status === 'running' ? 'opacity-70' : undefined} />
      {!gallery && (
        <div className="mt-1.5 flex justify-between text-[11.5px] text-muted tabular-nums">
          <span>{Math.round(job.progress * 100)}% · {bytes(job.downloaded)} / {bytes(job.total)}</span>
          <span>{speed(job.speed)} {eta(job.eta)}</span>
        </div>
      )}
    </div>
  )
}

function SignInError({ message, site, onRetry }: { message: string; site: Site; onRetry: () => void }) {
  const needsLogin = /sign(ed)? in|log ?in/i.test(message)
  return (
    <div className={cx('rounded-xl p-3 text-[13px]', needsLogin ? 'border border-accent/30 bg-accent-soft/60' : 'bg-bad/10 text-bad')}>
      <div className="flex items-start gap-2">
        {needsLogin ? <LogIn className="mt-0.5 size-4 shrink-0 text-accent" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
        <span>{needsLogin ? `Sign in to ${SITE_LABEL[site]} on this tab (top of the page), then try again.` : message}</span>
      </div>
      <Button size="sm" variant="ghost" className="mt-2" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>Try again</Button>
    </div>
  )
}

/* ---------------------------------------------------------------- profile */

export function ProfileSection({ ctx, browser }: { ctx: Extract<UrlContext, { kind: 'profile' }>; browser?: BrowserState }) {
  const { data } = useFetch<ProfileInfo>(`/social/profile?url=${encodeURIComponent(ctx.url)}`, 60 * 60_000)
  const [picked, setPicked] = useState<Set<string>>(new Set(['posts', 'reels', 'photos', 'videos']))
  const [busy, setBusy] = useState(false)
  const [only, setOnly] = useState<MediaOnly>('all')
  const avatar = browser?.profile?.avatar
  const name = browser?.profile?.name
  const cats = data?.categories ?? []
  const chosen = cats.filter((c) => picked.has(c.key))

  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const download = async () => {
    setBusy(true)
    try {
      const res = await post<{ added: number }>('/downloads/collections', {
        site: ctx.site, user: ctx.user, thumb: avatar?.startsWith('https://') ? avatar : null,
        items: chosen.map((c) => ({ url: c.url, label: c.label, folder: c.folder })),
        only: only === 'all' ? null : only,
      })
      if (res.added) toastQueued(res.added)
      else toast('Already downloading these sections')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {avatar ? <img src={avatar} referrerPolicy="no-referrer" className="size-12 rounded-full object-cover ring-2 ring-line" />
          : <div className="flex size-12 items-center justify-center rounded-full bg-surface-3"><UserRound className="size-6 text-muted" /></div>}
        <div className="min-w-0">
          {name && !/^(Instagram|TikTok|Facebook)$/i.test(name) && name !== ctx.user ? (
            <>
              <div className="truncate text-[15px] font-semibold">{name}</div>
              <div className="truncate text-[12px] text-muted">@{ctx.user} · {SITE_LABEL[ctx.site]}</div>
            </>
          ) : (
            <>
              <div className="truncate text-[15px] font-semibold">@{ctx.user}</div>
              <div className="truncate text-[12px] text-muted">{SITE_LABEL[ctx.site]} profile</div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wider text-faint uppercase">Download everything from</div>
        {!data ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] rounded-xl" />) : cats.map((c) => (
          <div key={c.key} onClick={() => toggle(c.key)}
            className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
              picked.has(c.key) ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-surface-2/40 hover:border-line-strong')}>
            <Checkbox checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{c.label}</div>
              <div className="truncate text-[11.5px] text-faint">→ {SITE_LABEL[ctx.site]}/{ctx.user}/{c.folder}</div>
            </div>
          </div>
        ))}
        <Segmented className="w-full" size="sm" value={only} onChange={setOnly}
          options={[
            { value: 'all', label: 'Photos & videos' },
            { value: 'photos', label: <><Images className="size-3.5" />Photos only</> },
            { value: 'videos', label: <><Play className="size-3.5" />Videos only</> },
          ]} />
        <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!chosen.length} onClick={download}
          icon={<Download className="size-[18px]" />}>
          {chosen.length ? `Download ${plural(chosen.length, 'section')}` : 'Choose what to download'}
        </Button>
        <div className="text-[11.5px] leading-relaxed text-muted">
          Grabs every photo and video in each section. Items you already saved are skipped, so you can run it again later to get only new posts.
        </div>
      </div>

      {browser && <CollectBox />}
    </div>
  )
}

/* ---------------------------------------------------------------- pick from page */

function CollectBox() {
  const collect = useStore((s) => s.collect)
  const site = useStore((s) => s.site)
  // What is selected right now (the last "load & select" may since have been downloaded or cleared).
  const picked = useStore((s) => s.selection.items.filter((i) => i.site === site).length)
  const running = collect && collect.site === site && !collect.done
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold"><ScrollText className="size-4 text-accent" />Or pick posts from the page</div>
      <div className="mt-1 text-[12px] leading-relaxed text-muted">
        Scrolls the page to load posts and selects everything it finds. Untick anything you don't want in the tray below.
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => post('/browser/collect', { on: false })} icon={<Square className="size-3.5" />}>
            Stop · {number(collect.count)} found
          </Button>
        ) : (
          <Button size="sm" variant="soft" onClick={() => post('/browser/collect', { on: true, limit: 1000 })} icon={<ScrollText className="size-3.5" />}>
            Load &amp; select everything
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => post('/browser/select-mode', { on: true })} icon={<MousePointerClick className="size-3.5" />}>
          Pick by hand
        </Button>
      </div>
      {collect && collect.site === site && collect.done && picked > 0 && (
        <div className="mt-2 text-[12px] text-ok">Selected {plural(picked, 'post')} — download them from the tray below.</div>
      )}
    </div>
  )
}

function SocialHelp({ site, signedIn }: { site: Site; signedIn: boolean | null }) {
  const selectMode = useStore((s) => s.selection.selectMode)
  const label = SITE_LABEL[site]
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl bg-brand p-4 text-white">
        <div className="absolute -top-10 -right-10 size-36 rounded-full bg-white/10" />
        <div className="relative">
          <div className="text-[15px] font-semibold">Select posts from this page</div>
          <div className="mt-1 text-[12.5px] leading-relaxed text-white/85">Checkboxes appear on posts, reels and videos. Your picks stay selected while you browse.</div>
          <button onClick={() => post('/browser/select-mode', { on: !selectMode })}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-[#2E2250] shadow hover:bg-white/90">
            <MousePointerClick className="size-4" /> {selectMode ? 'Stop selecting' : 'Start selecting'}
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {[
          signedIn
            ? { icon: CheckCircle2, title: `Signed in to ${label}`, text: 'Downloads use your login, so posts you can see here can be saved.' }
            : { icon: LogIn, title: `Sign in to ${label}`, text: `Most ${label} downloads need your login. Sign in once in this tab — Cutetube uses that session for downloads.` },
          { icon: Play, title: 'Open any post', text: 'Open a post, reel or video to see its photos or video qualities and download it.' },
          { icon: UserRound, title: 'Whole profiles', text: 'Open a profile to download all posts, reels, stories and more into tidy folders.' },
        ].map((t) => (
          <div key={t.title} className="flex gap-3 rounded-xl p-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><t.icon className="size-4" /></div>
            <div>
              <div className="text-[13px] font-semibold">{t.title}</div>
              <div className="text-[12px] leading-relaxed text-muted">{t.text}</div>
            </div>
          </div>
        ))}
      </div>
      <CollectBox />
    </div>
  )
}

/** "@user" for handles; display names ("Jane Doe") as they are. */
function handle(name: string | null | undefined): string {
  return !name ? '' : /\s/.test(name) ? name : `@${name}`
}
