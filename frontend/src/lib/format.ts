export function bytes(n: number | null | undefined, approx = false): string {
  if (!n || n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${approx ? '~' : ''}${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function speed(n: number | null | undefined): string {
  return n ? `${bytes(n)}/s` : ''
}

export function duration(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return ''
  s = Math.round(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function eta(s: number | null | undefined): string {
  if (s == null || s < 0) return ''
  if (s < 60) return `${s}s left`
  if (s < 3600) return `${Math.round(s / 60)}m left`
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m left`
}

export function compact(n: number | null | undefined): string {
  if (n == null) return ''
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function number(n: number): string {
  return new Intl.NumberFormat('en').format(n)
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${number(n)} ${n === 1 ? word : pluralWord}`
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = Date.now() / 1000 - ts
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return new Date(ts * 1000).toLocaleDateString()
}

export function uploadDate(s: string | null | undefined): string {
  if (!s || s.length !== 8) return ''
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export const PRESET_LABEL: Record<string, string> = {
  best: 'Best', '4320': '8K', '2160': '4K', '1440': '1440p', '1080': '1080p', '720': '720p', '480': '480p', '360': '360p', '240': '240p', '144': '144p',
  mp3: 'MP3', m4a: 'M4A',
}

export const isAudioPreset = (p: string) => p === 'mp3' || p === 'm4a'
