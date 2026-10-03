import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, post } from './api'
import { useStore } from './store'
import type { Entry, Job, Listing, MediaOnly, Preset } from './types'

const cache = new Map<string, { at: number; data: unknown }>()

/** GET with a small in-memory cache; `path` null means idle. */
export function useFetch<T>(path: string | null, ttl = 5 * 60_000) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>(() => {
    const hit = path ? cache.get(path) : undefined
    return { data: (hit?.data as T) ?? null, error: null, loading: !!path && !hit }
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!path) return
    const hit = cache.get(path)
    if (hit && Date.now() - hit.at < ttl && nonce === 0) {
      setState({ data: hit.data as T, error: null, loading: false })
      return
    }
    let alive = true
    setState((s) => ({ data: nonce ? s.data : null, error: null, loading: true }))
    api<T>(path)
      .then((data) => {
        cache.set(path, { at: Date.now(), data })
        if (alive) setState({ data, error: null, loading: false })
      })
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }))
    return () => { alive = false }
  }, [path, nonce, ttl])

  const reload = useCallback(() => { if (path) cache.delete(path); setNonce((n) => n + 1) }, [path])
  return { ...state, reload }
}

/** Starts (or reuses) a server-side listing and follows its live updates from the store. */
export function useListing(url: string | null, tab?: string) {
  const [key, setKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const putListing = useStore((s) => s.putListing)
  const listing = useStore((s) => (key ? s.listings[key] : undefined))

  const start = useCallback((refresh = false) => {
    if (!url) return
    setError(null)
    post<Listing>('/listing', { url, tab, refresh })
      .then((l) => { putListing(l); setKey(l.key) })
      .catch((e: Error) => setError(e.message))
  }, [url, tab, putListing])

  useEffect(() => { setKey(null); start() }, [start])

  return { listing, error: error ?? listing?.error ?? null, refresh: () => start(true) }
}

/** Selection model for a list that may still be loading: "all" follows new entries until customised. */
export function usePick(entries: Entry[], initialAll = true) {
  const [all, setAll] = useState(initialAll)
  const [custom, setCustom] = useState<Set<string>>(new Set())
  const available = useMemo(() => entries.filter((e) => !e.unavailable), [entries])
  const selected = useMemo(() => (all ? new Set(available.map((e) => e.id)) : custom), [all, available, custom])

  const set = useCallback((next: Set<string>) => {
    if (next.size === available.length && available.length > 0) { setAll(true); return }
    setAll(false)
    setCustom(next)
  }, [available.length])

  return {
    all,
    selected,
    set,
    selectAll: () => setAll(true),
    selectNone: () => { setAll(false); setCustom(new Set()) },
    items: () => available.filter((e) => selected.has(e.id)),
  }
}

export function useJobFor(videoId: string | undefined | null): Job | undefined {
  return useStore((s) => {
    if (!videoId) return undefined
    let best: Job | undefined
    for (const j of Object.values(s.jobs)) {
      if (j.video_id === videoId && (!best || j.created > best.created)) best = j
    }
    return best
  })
}

export function useDefaultPreset(): [Preset, (p: Preset) => void] {
  const def = useStore((s) => s.settings?.default_preset ?? '1080')
  const [preset, setPreset] = useState<Preset>(def)
  const touched = useRef(false)
  useEffect(() => { if (!touched.current) setPreset(def) }, [def])
  return [preset, (p) => { touched.current = true; setPreset(p) }]
}

export function toastQueued(n: number) {
  if (n === 0) toast('Already in your downloads')
  else toast.success(n === 1 ? 'Download started' : `Queued ${n} downloads`, {
    action: { label: 'View', onClick: () => useStore.getState().setPage('downloads') },
  })
}

type QueueItem = { url: string; title?: string | null; thumb?: string | null; channel?: string | null; duration?: number | null; index?: number }

export async function queueDownloads(
  items: QueueItem[],
  preset: Preset,
  folder: Record<string, unknown> = { mode: 'auto' },
  skipExisting = false,
  silent = false,
  only: MediaOnly = 'all',
): Promise<number> {
  if (!items.length) return 0
  try {
    const res = await post<{ added: number }>('/downloads', {
      items: items.map((i) => ({
        url: i.url, title: i.title, thumb: i.thumb, channel: i.channel, duration: i.duration, index: i.index,
      })),
      preset, folder, skip_existing: skipExisting, only: only === 'all' ? null : only,
    })
    if (silent) return res.added
    toastQueued(res.added)
    return res.added
  } catch (e) {
    toast.error((e as Error).message)
    return 0
  }
}
