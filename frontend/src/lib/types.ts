export type Preset = 'best' | '4320' | '2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'mp3' | 'm4a'
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'skipped' | 'error' | 'cancelled'

export interface Job {
  id: string
  url: string
  video_id: string
  title: string | null
  thumb: string | null
  channel: string | null
  duration: number | null
  preset: Preset
  kind: 'video' | 'audio'
  folder: Record<string, unknown>
  status: JobStatus
  stage: string | null
  progress: number
  downloaded: number
  total: number | null
  speed: number | null
  eta: number | null
  filepath: string | null
  dir: string | null
  error: string | null
  created: number
  finished: number | null
  format_note: string | null
  site: Site
  tool: 'ytdlp' | 'gallery'
  files: number
  media_type: string | null
  only: 'photos' | 'videos' | null
}

export interface Settings {
  download_dir: string
  organize_by_channel: boolean
  default_preset: Preset
  container: 'mp4' | 'mkv'
  prefer_compatible: boolean
  audio_quality: string
  embed_thumbnail: boolean
  embed_metadata: boolean
  embed_chapters: boolean
  embed_subs: boolean
  sub_langs: string
  concurrency: number
  skip_existing: boolean
  adblock: boolean
  use_login_cookies: boolean
  theme: 'dark' | 'light' | 'system'
  home_url: string
  auto_update: boolean
  accepted_terms: number
}

export interface ToolState {
  ok: boolean
  path?: string | null
  busy: boolean
  progress?: number
  error: string | null
  version?: string
  latest?: string
  gallery?: string
  restart?: boolean
}

export type Site = 'youtube' | 'facebook' | 'instagram' | 'tiktok'

export type UrlContext =
  | { kind: 'video'; site?: Site; url: string; video_id: string; short: boolean; playlist_id: string | null; playlist_url: string | null }
  | { kind: 'playlist'; site?: Site; url: string; playlist_id: string }
  | { kind: 'channel'; site?: Site; url: string; channel_url: string; tab: string | null }
  | { kind: 'media'; site: Site; url: string; id: string; media_type: string; author: string | null; post_set?: string | null }
  | { kind: 'profile'; site: Site; url: string; user: string; tab: string | null }
  | { kind: 'page'; site?: Site; url: string; page: 'home' | 'search' | 'feed' | 'other' }
  | { kind: 'invalid'; site?: Site | null; url: string }

export interface MediaInfo {
  id: string
  url: string
  site: Site
  media_type: string
  type: 'video' | 'photos' | 'mixed'
  title: string | null
  author: string | null
  thumb: string | null
  duration: number | null
  views: number | null
  count: number
  videos?: number
  photos?: number
  qualities: { height: number; size: number | null }[]
  /** Facebook posts: each photo / video, as the browser saw it. */
  parts?: { type: 'photo' | 'video'; id: string; thumb: string | null }[]
  post_set?: string | null
}

/** Which files of a post to keep. */
export type MediaOnly = 'all' | 'photos' | 'videos'

export interface ProfileInfo {
  site: Site
  user: string
  label: string
  categories: { key: string; label: string; folder: string; url: string }[]
}

export interface AdblockStats {
  enabled: boolean
  page: number
  total: number
  ads: number
  full: boolean
}

export interface BrowserState {
  site: Site
  sites: Record<Site, { label: string; open: boolean }>
  profile: { name: string | null; avatar: string | null } | null
  ready: boolean
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  ctx: UrlContext
  video: { id: string; title: string; channel: string; duration: number | null; live: boolean } | null
  selectMode: boolean
  adblock: AdblockStats
  /** Social tabs: whether the page shows you signed in (null when it can't tell). */
  signedIn?: boolean | null
}

export interface Entry {
  id: string
  url: string
  title: string
  duration: number | null
  views?: number | null
  thumb: string
  short: boolean
  channel?: string | null
  unavailable?: string | null
  index?: number
}

export interface Listing {
  key: string
  kind: 'channel_tab' | 'playlist'
  meta: {
    title?: string
    channel?: string
    channel_url?: string
    expected?: number | null
    tab?: string
    label?: string
    folder?: string
    missing?: boolean
  }
  entries: Entry[]
  count: number
  done: boolean
  error: string | null
}

export interface VideoInfo {
  id: string
  url: string
  title: string
  channel: string | null
  channel_url: string | null
  duration: number | null
  views: number | null
  upload_date: string | null
  thumb: string
  live_status: string | null
  short: boolean
  qualities: { height: number; fps: number | null; size: number | null; hdr: boolean }[]
  audio_size: number | null
  mp3_size: number | null
}

export interface ChannelInfo {
  title: string
  channel_id: string
  handle: string | null
  url: string
  avatar: string | null
  followers: number | null
  description: string
  tabs: { key: string; label: string }[]
}

export interface SelectionItem {
  id: string
  kind: 'video' | 'playlist' | 'mix' | 'media'
  site?: Site
  media_type?: string
  list_id?: string
  count?: number | null
  url: string
  title: string | null
  channel: string | null
  duration: number | null
  short: boolean
  thumb: string | null
}

export type Page = 'browse' | 'downloads' | 'settings'
