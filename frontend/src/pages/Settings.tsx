import { CheckCircle2, ExternalLink, FileText, FolderOpen, Loader2, LogOut, RefreshCw, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, post } from '../lib/api'
import { compact } from '../lib/format'
import { useStore } from '../lib/store'
import type { Settings as S } from '../lib/types'
import { BrandIcon, TAGLINE, Wordmark } from '../components/Brand'
import { LEGAL_TITLES, LegalDialog, type LegalDoc } from '../components/Legal'
import { PresetPicker } from '../components/PresetPicker'
import { Button, Card, Segmented, Select, Switch } from '../components/ui'

const save = (patch: Partial<S>) => api<S>('/settings', { method: 'PATCH', body: patch }).catch((e: Error) => toast.error(e.message))

export function Settings() {
  const s = useStore((st) => st.settings)
  const tools = useStore((st) => st.tools)
  const version = useStore((st) => st.version)
  const ab = useStore((st) => st.browser?.adblock)
  const [legal, setLegal] = useState<LegalDoc | null>(null)
  if (!s) return null

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-8 pt-7 pb-16">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] font-semibold tracking-tight">Settings</h1>

        <Section title="Where downloads go">
          <Row title="Download folder" desc={<span className="font-mono text-[12px] break-all">{s.download_dir}</span>}>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => post('/open', { target: 'root' })} icon={<FolderOpen className="size-3.5" />}>Open</Button>
              <Button size="sm" variant="soft" onClick={() => post('/settings/pick-folder')}>Change…</Button>
            </div>
          </Row>
          <Row title="Organize by channel" desc="Single videos go into Channel / Videos, Shorts or Live. Channel and playlist downloads are always organized.">
            <Switch checked={s.organize_by_channel} onChange={(v) => save({ organize_by_channel: v })} />
          </Row>
          <Row title="Skip videos already downloaded" desc="Default for channel and playlist downloads.">
            <Switch checked={s.skip_existing} onChange={(v) => save({ skip_existing: v })} />
          </Row>
          <Row title="Parallel downloads" desc="How many videos download at the same time.">
            <Select className="w-24" value={String(s.concurrency)} onChange={(v) => save({ concurrency: Number(v) })}
              options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} />
          </Row>
        </Section>

        <Section title="Quality">
          <Row title="Default quality" desc="Pre-selected everywhere. Falls back to the closest lower quality when unavailable.">
            <PresetPicker className="w-[300px]" value={s.default_preset} onChange={(p) => save({ default_preset: p })} />
          </Row>
          <Row title="Video container">
            <Segmented size="sm" value={s.container} onChange={(v) => save({ container: v })}
              options={[{ value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }]} />
          </Row>
          <Row title="Prefer compatible formats" desc="Pick H.264 + AAC when available so files play everywhere. Above 1080p YouTube only offers VP9/AV1.">
            <Switch checked={s.prefer_compatible} onChange={(v) => save({ prefer_compatible: v })} />
          </Row>
          <Row title="MP3 bitrate">
            <Select className="w-28" value={s.audio_quality} onChange={(v) => save({ audio_quality: v })}
              options={['128', '192', '256', '320'].map((b) => ({ value: b, label: `${b} kbps` }))} />
          </Row>
        </Section>

        <Section title="Extras in the file">
          <Row title="Embed thumbnail" desc="Cover art in your player and file explorer.">
            <Switch checked={s.embed_thumbnail} onChange={(v) => save({ embed_thumbnail: v })} />
          </Row>
          <Row title="Embed metadata" desc="Title, channel, date and description.">
            <Switch checked={s.embed_metadata} onChange={(v) => save({ embed_metadata: v })} />
          </Row>
          <Row title="Embed chapters">
            <Switch checked={s.embed_chapters} onChange={(v) => save({ embed_chapters: v })} />
          </Row>
          <Row title="Embed subtitles" desc={s.embed_subs ? (
            <input defaultValue={s.sub_langs} onBlur={(e) => save({ sub_langs: e.target.value || 'en.*,en' })}
              className="mt-1 h-7 w-56 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] outline-none focus:border-accent"
              placeholder="en.*,en" />
          ) : 'Adds available subtitles as selectable tracks.'}>
            <Switch checked={s.embed_subs} onChange={(v) => save({ embed_subs: v })} />
          </Row>
        </Section>

        <Section title="Browsing">
          <Row title="Block ads & trackers" desc={ab ? `${compact(ab.total)} requests blocked and ${ab.ads} ads removed this session · ${ab.full ? 'EasyList, EasyPrivacy & uBlock filters' : 'loading filter lists…'}` : undefined}>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => { post('/adblock/refresh'); toast('Updating filter lists…') }} icon={<RefreshCw className="size-3.5" />}>Update lists</Button>
              <Switch checked={s.adblock} onChange={(v) => save({ adblock: v })} />
            </div>
          </Row>
          <Row title="Use my YouTube login for downloads"
            desc="Needed for age-restricted, members-only or private videos. Sign in on the Browse tab first. Heavy bulk downloading while signed in may put your account at risk.">
            <Switch checked={s.use_login_cookies} onChange={(v) => save({ use_login_cookies: v })} />
          </Row>
          <Row title="Sign out & clear cookies" desc="Signs you out of YouTube, Facebook, Instagram and TikTok in the app.">
            <Button size="sm" variant="danger" icon={<LogOut className="size-3.5" />}
              onClick={() => { post('/browser/clear-data'); toast.success('Signed out of all sites') }}>Clear</Button>
          </Row>
        </Section>

        <Section title="Appearance">
          <Row title="Theme">
            <Segmented size="sm" value={s.theme} onChange={(v) => save({ theme: v })}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
          </Row>
        </Section>

        <Section title="Components">
          {(['yt-dlp', 'ffmpeg', 'deno'] as const).map((k) => {
            const t = tools[k]
            const desc = k === 'yt-dlp'
              ? `yt-dlp ${t?.version ?? '?'}${t?.restart ? ` → ${t.latest} after restart` : ''} · gallery-dl ${t?.gallery ?? '?'}`
              : t?.busy ? `Installing… ${Math.round((t.progress ?? 0) * 100)}%` : t?.ok ? t.path : t?.error ?? 'Not installed'
            return (
              <Row key={k} title={<span className="flex items-center gap-2">
                {t?.busy ? <Loader2 className="size-4 animate-spin text-muted" /> : t?.ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-bad" />}
                {k === 'yt-dlp' ? 'Downloaders' : k}
              </span>} desc={<span className="font-mono text-[11.5px] break-all">{desc}</span>}>
                {k === 'yt-dlp' ? (
                  <Button size="sm" loading={t?.busy} onClick={() => post('/tools/update-ytdlp')} icon={<RefreshCw className="size-3.5" />}>Check for update</Button>
                ) : !t?.ok && !t?.busy ? (
                  <Button size="sm" onClick={() => post('/tools/retry')}>Install</Button>
                ) : null}
              </Row>
            )
          })}
          <Row title="Update downloaders automatically" desc="Checks once a day for new versions of yt-dlp and gallery-dl, which keep downloads working when sites change.">
            <Switch checked={s.auto_update} onChange={(v) => save({ auto_update: v })} />
          </Row>
        </Section>

        <Section title="About">
          <Row title="Legal" desc="CuteTube is free software under GPL-2.0. It collects no data and isn't affiliated with any site.">
            <div className="flex flex-wrap justify-end gap-1.5">
              {(['terms', 'privacy', 'notices', 'license'] as const).map((d) => (
                <Button key={d} size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => setLegal(d)}>
                  {LEGAL_TITLES[d].replace(' (GPL-2.0)', '')}
                </Button>
              ))}
            </div>
          </Row>
          <Row title="Source code & support" desc="Report problems, suggest features or read the code on GitHub.">
            <Button size="sm" onClick={() => post('/open', { target: 'repo' })} icon={<ExternalLink className="size-3.5" />}>GitHub</Button>
          </Row>
        </Section>
        <LegalDialog doc={legal} onClose={() => setLegal(null)} />

        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <div className="flex items-center gap-2.5"><BrandIcon size={32} /><Wordmark className="text-[26px] leading-none" /></div>
          <div className="text-[11px] font-bold tracking-[0.25em] text-muted uppercase">{TAGLINE}</div>
          <div className="text-[12px] text-faint">Version {version} · Powered by yt-dlp and gallery-dl · Only download content you have the right to.</div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[12px] font-semibold tracking-wider text-faint uppercase">{title}</h2>
      <Card className="divide-y divide-line">{children}</Card>
    </section>
  )
}

function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-6 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</div>}
      </div>
      {children}
    </div>
  )
}
