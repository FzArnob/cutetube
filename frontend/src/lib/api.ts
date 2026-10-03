const TOKEN_KEY = 'ct-token'

function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    try { sessionStorage.setItem(TOKEN_KEY, fromUrl) } catch { /* storage unavailable */ }
    history.replaceState(null, '', location.pathname)
    return fromUrl
  }
  try { return sessionStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' }
}

const token = readToken()

export class ApiError extends Error {}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'x-ct-token': token, 'content-type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      detail = typeof j.detail === 'string' ? j.detail : detail
    } catch { /* not json */ }
    throw new ApiError(detail)
  }
  return res.json() as Promise<T>
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { body })

export function connectEvents(onMessage: (msg: { type: string; data: any }) => void, onStatus: (up: boolean) => void) {
  let socket: WebSocket | null = null
  let retry = 0
  let closed = false

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
    socket.onopen = () => { retry = 0; onStatus(true) }
    socket.onmessage = (e) => onMessage(JSON.parse(e.data))
    socket.onclose = () => {
      onStatus(false)
      if (!closed) setTimeout(open, Math.min(4000, 300 * 2 ** retry++))
    }
  }
  open()
  return () => { closed = true; socket?.close() }
}
