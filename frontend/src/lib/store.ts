import { create } from 'zustand'
import { toast } from 'sonner'
import type { BrowserState, Job, Listing, Page, SelectionItem, Settings, Site, ToolState } from './types'

// Listing events can arrive over the socket before the HTTP response that registers the listing.
const pendingListing: Record<string, any[]> = {}

function mergeListing(cur: Listing, data: any): Listing {
  const fresh = (data.added as Listing['entries']).filter((e) => (e.index ?? 0) > cur.entries.length)
  return {
    ...cur,
    meta: { ...cur.meta, ...data.meta },
    entries: fresh.length ? [...cur.entries, ...fresh] : cur.entries,
    count: Math.max(data.count, cur.entries.length + fresh.length),
    done: data.done,
    error: data.error,
  }
}

interface State {
  connected: boolean
  loaded: boolean
  version: string
  /** Version of the Terms / Privacy Policy the user must have accepted. */
  termsVersion: number
  repo: string
  page: Page
  settings: Settings | null
  tools: Record<string, ToolState>
  jobs: Record<string, Job>
  browser: BrowserState | null
  selection: { items: SelectionItem[]; selectMode: boolean }
  listings: Record<string, Listing>
  downloaded: Set<string>
  /** Active site tab (mirrors the backend's active browser pane). */
  site: Site
  collect: { site: Site; count: number; done: boolean } | null
  openSite: (site: Site) => void
  setPage: (p: Page) => void
  setConnected: (up: boolean) => void
  putListing: (l: Listing) => void
  handle: (msg: { type: string; data: any }) => void
}

export const useStore = create<State>((set, get) => ({
  connected: false,
  loaded: false,
  version: '',
  termsVersion: 0,
  repo: '',
  page: 'browse',
  settings: null,
  tools: {},
  jobs: {},
  browser: null,
  selection: { items: [], selectMode: false },
  listings: {},
  downloaded: new Set(),
  site: 'youtube',
  collect: null,
  openSite: (site) => {
    set({ site, page: 'browse' })
    fetch('/api/browser/site', {
      method: 'POST',
      headers: { 'x-ct-token': sessionStorage.getItem('ct-token') ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ site }),
    }).catch(() => {})
  },

  setPage: (page) => set({ page }),
  setConnected: (connected) => set({ connected }),
  putListing: (l) => {
    let merged = l
    for (const ev of pendingListing[l.key] ?? []) merged = mergeListing(merged, ev)
    delete pendingListing[l.key]
    set((s) => ({ listings: { ...s.listings, [l.key]: merged } }))
  },

  handle: ({ type, data }) => {
    switch (type) {
      case 'snapshot': {
        const jobs: Record<string, Job> = {}
        for (const j of data.jobs as Job[]) jobs[j.id] = j
        set({
          loaded: true,
          version: data.version,
          termsVersion: data.terms_version ?? 0,
          repo: data.repo ?? '',
          settings: data.settings,
          tools: data.tools,
          jobs,
          browser: data.browser,
          site: data.browser?.site ?? 'youtube',
          selection: data.selection,
          downloaded: new Set(data.downloaded),
        })
        break
      }
      case 'job': {
        const job = data as Job
        const prev = get().jobs[job.id]
        set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }))
        if (prev && prev.status !== job.status && job.status === 'error') {
          toast.error(job.title ?? 'Download failed', { description: job.error ?? undefined })
        }
        break
      }
      case 'job.removed':
        set((s) => {
          const jobs = { ...s.jobs }
          delete jobs[data.id]
          return { jobs }
        })
        break
      case 'downloaded':
        set((s) => ({ downloaded: new Set(s.downloaded).add(data.id) }))
        break
      case 'queue.idle':
        toast.success('All downloads finished')
        break
      case 'settings':
        set({ settings: data })
        break
      case 'tools':
        set({ tools: data })
        break
      case 'browser':
        set((s) => ({ browser: data, site: data.site ?? s.site }))
        break
      case 'collect':
        set({ collect: data })
        break
      case 'adblock':
        set((s) => (s.browser ? { browser: { ...s.browser, adblock: data } } : {}))
        break
      case 'selection':
        set({ selection: data })
        break
      case 'listing': {
        const cur = get().listings[data.key]
        if (!cur) {
          ;(pendingListing[data.key] ??= []).push(data)
          break
        }
        set((s) => ({ listings: { ...s.listings, [data.key]: mergeListing(cur, data) } }))
        break
      }
      case 'toast': {
        const fn = data.level === 'error' ? toast.error : data.level === 'success' ? toast.success : toast
        fn(data.message)
        break
      }
    }
  },
}))

export const jobsList = (jobs: Record<string, Job>) => Object.values(jobs).sort((a, b) => b.created - a.created)
