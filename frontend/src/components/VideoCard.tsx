import { AlertTriangle, CheckCircle2, Download, Eye, FolderOpen, Music, Play, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { bytes, compact, duration, eta, isAudioPreset, speed, uploadDate } from '../lib/format'
import { queueDownloads, useFetch, useJobFor } from '../lib/hooks'
import { useStore } from '../lib/store'
import type { Preset, VideoInfo } from '../lib/types'
import { JobControls, openJob } from './JobControls'
import { Button, Progress, Segmented, Skeleton, Thumb, cx } from './ui'

const HEIGHT_LABEL: Record<number, string> = { 4320: '8K', 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p', 360: '360p', 240: '240p', 144: '144p' }

interface Hint { title?: string | null; channel?: string | null; duration?: number | null }

export function VideoCard({ url, videoId, hint, wide, onOpenInBrowser }: {
  url: string
  videoId: string
  hint?: Hint | null
  wide?: boolean
  onOpenInBrowser?: () => void
}) {
  const { data, error, loading, reload } = useFetch<VideoInfo>(`/video?url=${encodeURIComponent(url)}`)
  const job = useJobFor(videoId)
  const defaultPreset = useStore((s) => s.settings?.default_preset ?? '1080')
  const [mode, setMode] = useState<'video' | 'audio'>(isAudioPreset(defaultPreset) ? 'audio' : 'video')
  const [preset, setPreset] = useState<Preset>(defaultPreset)

  // Snap the chosen quality to what this video actually offers.
  useEffect(() => {
    if (!data || isAudioPreset(preset)) return
    const hs = data.qualities.map((q) => q.height)
    if (!hs.length) return
    const want = preset === 'best' ? hs[0] : Number(preset)
    const pick = hs.find((h) => h <= want) ?? hs[hs.length - 1]
    if (String(pick) !== preset) setPreset(String(pick) as Preset)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const size = useMemo(() => {
    if (!data) return null
    if (preset === 'mp3') return data.mp3_size
    if (preset === 'm4a') return data.audio_size
    return data.qualities.find((q) => String(q.height) === preset)?.size ?? null
  }, [data, preset])

  const title = data?.title ?? hint?.title
  const channel = data?.channel ?? hint?.channel
  const dur = data?.duration ?? hint?.duration
  const isLive = data?.live_status === 'is_live' || data?.live_status === 'is_upcoming'
  const active = job && (job.status === 'running' || job.status === 'queued' || job.status === 'paused')
  const done = job && (job.status === 'done' || job.status === 'skipped') && job.preset === preset

  const start = () => queueDownloads([{ url, title: title ?? undefined, channel, duration: dur, thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` }], preset)

  const thumb = (
    <Thumb
      src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
      duration={duration(dur)}
      className={cx('w-full rounded-xl', data?.short && 'aspect-video')}
    >
      {onOpenInBrowser && (
        <button onClick={onOpenInBrowser}
          className="group absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/35">
          <span className="flex size-12 scale-90 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </button>
      )}
    </Thumb>
  )

  const details = (
    <div className="min-w-0">
      {title ? <h3 className={cx('leading-snug font-semibold', wide ? 'text-lg' : 'text-[14.5px] line-clamp-3')}>{title}</h3>
        : <Skeleton className="h-5 w-4/5" />}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
        {channel && <span className="font-medium text-fg/80">{channel}</span>}
        {data?.views != null && <span className="flex items-center gap-1"><Eye className="size-3.5" />{compact(data.views)}</span>}
        {data?.upload_date && <span>{uploadDate(data.upload_date)}</span>}
      </div>
    </div>
  )

  const formats = (
    <div className="space-y-3">
      <Segmented
        className="w-full"
        value={mode}
        onChange={(m) => { setMode(m); setPreset(m === 'audio' ? 'mp3' : (String(data?.qualities[0]?.height ?? 1080) as Preset)) }}
        options={[{ value: 'video', label: 'Video' }, { value: 'audio', label: <><Music className="size-3.5" />Audio only</> }]}
      />
      {loading && !data ? (
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[52px]" />)}</div>
      ) : error ? (
        <div className="rounded-xl border border-bad/30 bg-bad/10 p-3 text-[13px] text-bad">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>
          <Button size="sm" variant="ghost" className="mt-2" icon={<RefreshCw className="size-3.5" />} onClick={reload}>Try again</Button>
        </div>
      ) : mode === 'video' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {data?.qualities.map((q) => (
            <QualityTile key={q.height} active={preset === String(q.height)} onClick={() => setPreset(String(q.height) as Preset)}
              label={HEIGHT_LABEL[q.height] ?? `${q.height}p`} sub={bytes(q.size, true)}
              badge={q.hdr ? 'HDR' : q.fps && q.fps > 30 ? `${Math.round(q.fps)}` : undefined} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <QualityTile active={preset === 'mp3'} onClick={() => setPreset('mp3')} label="MP3" sub={bytes(data?.mp3_size, true)} />
          <QualityTile active={preset === 'm4a'} onClick={() => setPreset('m4a')} label="M4A" sub={bytes(data?.audio_size, true)} badge="Original" />
        </div>
      )}
    </div>
  )

  const action = isLive ? (
    <div className="flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
      <AlertTriangle className="size-4 shrink-0" />
      {data?.live_status === 'is_live' ? 'Live right now — you can download it after the stream ends.' : "This premiere/stream hasn't started yet."}
    </div>
  ) : active && job ? (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12.5px]">
        <span className="font-medium">{job.status === 'paused' ? 'Paused' : job.status === 'queued' ? 'Waiting in queue' : job.stage ?? 'Downloading'}</span>
        <JobControls job={job} compact />
      </div>
      <Progress value={job.progress} live={job.status === 'running'} tone={job.status === 'paused' ? 'muted' : 'brand'} />
      <div className="mt-1.5 flex justify-between text-[11.5px] text-muted tabular-nums">
        <span>{Math.round(job.progress * 100)}% · {bytes(job.downloaded)} / {bytes(job.total)}</span>
        <span>{speed(job.speed)} {eta(job.eta)}</span>
      </div>
    </div>
  ) : done && job ? (
    <div className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok/10 p-2.5 pl-3">
      <CheckCircle2 className="size-4 shrink-0 text-ok" />
      <span className="flex-1 text-[13px] font-medium">{job.status === 'skipped' ? 'Already downloaded' : 'Downloaded'}</span>
      <Button size="sm" variant="ghost" onClick={() => openJob(job.id, 'file')} icon={<Play className="size-3.5" />}>Play</Button>
      <Button size="sm" variant="ghost" onClick={() => openJob(job.id, 'folder')} icon={<FolderOpen className="size-3.5" />}>Folder</Button>
    </div>
  ) : (
    <Button variant="primary" size="lg" className="w-full" disabled={!data} onClick={start} icon={<Download className="size-[18px]" />}>
      Download {data ? (isAudioPreset(preset) ? preset.toUpperCase() : HEIGHT_LABEL[Number(preset)] ?? `${preset}p`) : ''}
      {size ? <span className="font-normal opacity-80">· {bytes(size, true)}</span> : null}
    </Button>
  )

  if (wide) {
    return (
      <div className="grid grid-cols-[minmax(0,420px)_1fr] gap-6">
        {thumb}
        <div className="flex min-w-0 flex-col gap-4">
          {details}
          {formats}
          <div className="mt-auto">{action}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3.5">
      {thumb}
      {details}
      {formats}
      {action}
    </div>
  )
}

function QualityTile({ label, sub, badge, active, onClick }: { label: string; sub: string; badge?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'relative flex h-[52px] flex-col items-center justify-center rounded-xl border text-center transition-all',
        active ? 'border-accent bg-accent-soft text-fg shadow-[0_0_0_1px_var(--accent)]' : 'border-line bg-surface-2 text-fg hover:border-line-strong',
      )}
    >
      <span className="text-[13.5px] font-semibold">{label}</span>
      <span className="text-[10.5px] whitespace-nowrap text-muted tabular-nums">{sub}</span>
      {badge && (
        <span className="absolute -top-1.5 -right-1 rounded-md bg-brand px-1 text-[9px] leading-[14px] font-bold text-white">{badge}</span>
      )}
    </button>
  )
}
