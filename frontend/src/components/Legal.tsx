import { FileText, LogOut, ShieldCheck, X } from 'lucide-react'
import { motion } from 'motion/react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, post } from '../lib/api'
import { useStore } from '../lib/store'
import type { Settings } from '../lib/types'
import { BrandIcon, Wordmark } from './Brand'
import { Button, Checkbox, Segmented, Spinner, cx } from './ui'

export type LegalDoc = 'terms' | 'privacy' | 'notices' | 'license'

export const LEGAL_TITLES: Record<LegalDoc, string> = {
  terms: 'Terms of Use',
  privacy: 'Privacy Policy',
  notices: 'Third-party notices',
  license: 'License (GPL-2.0)',
}

const cache: Partial<Record<LegalDoc, string>> = {}

function useLegal(doc: LegalDoc) {
  const [text, setText] = useState<string | null>(cache[doc] ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (cache[doc]) { setText(cache[doc]!); return }
    setText(null)
    setError(null)
    api<{ text: string }>(`/legal/${doc}`)
      .then((r) => { cache[doc] = r.text; setText(r.text) })
      .catch((e: Error) => setError(e.message))
  }, [doc])
  return { text, error }
}

/** Inline markdown: **bold**, `code`, and bare links. */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)|]+)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i} className="font-semibold text-fg">{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.92em]">{part.slice(1, -1)}</code>
    if (/^https?:\/\//.test(part)) return <span key={i} className="break-all text-accent">{part}</span>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Just enough markdown for the legal texts: headings, paragraphs, bullet lists and tables. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const h = line.match(/^(#{1,3})\s+(.*)/)
    if (h) {
      const cls = h[1].length === 1 ? 'text-[20px] font-semibold mt-1' : 'text-[15px] font-semibold mt-5'
      out.push(<div key={i} className={cx('text-fg', cls)}>{inline(h[2])}</div>)
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[][] = []
      for (; i < lines.length && lines[i].startsWith('|'); i++) {
        if (/^\|\s*-/.test(lines[i])) continue
        rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()))
      }
      i--
      const [head, ...body] = rows
      out.push(
        <div key={i} className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-2 text-fg"><tr>{head.map((c, k) => <th key={k} className="px-3 py-2 font-semibold">{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, j) => <tr key={j} className="border-t border-line align-top">{r.map((c, k) => <td key={k} className="px-3 py-2">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*-\s/.test(line)) {
      const items: string[] = []
      for (; i < lines.length && /^\s*-\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*-\s/, ''))
      i--
      out.push(<ul key={i} className="mt-2 list-disc space-y-1.5 pl-5">{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>)
      continue
    }
    // Plain text (also the GPL, which is preformatted): keep its own line breaks.
    const para: string[] = []
    for (; i < lines.length && lines[i].trim() && !/^(#|\||\s*-\s)/.test(lines[i]); i++) para.push(lines[i])
    i--
    out.push(<p key={i} className="mt-2.5 whitespace-pre-line">{inline(para.join('\n'))}</p>)
  }
  return <div className="text-[13px] leading-relaxed text-muted">{out}</div>
}

export function LegalText({ doc, className }: { doc: LegalDoc; className?: string }) {
  const { text, error } = useLegal(doc)
  return (
    <div className={cx('scroll-thin overflow-y-auto', className)}>
      {error ? <div className="py-8 text-center text-[13px] text-bad">Couldn't load the {LEGAL_TITLES[doc]}: {error}</div>
        : text === null ? <div className="flex justify-center py-10"><Spinner className="size-5" /></div>
          : <Markdown text={text} />}
    </div>
  )
}

/** Full-window viewer for one legal text (Settings → About). */
export function LegalDialog({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [onClose])
  if (!doc) return null
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
      <motion.div role="dialog" aria-label={LEGAL_TITLES[doc]} onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        initial={{ y: 12, scale: 0.98 }} animate={{ y: 0, scale: 1 }}>
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <FileText className="size-4.5 text-accent" />
          <div className="flex-1 text-[15px] font-semibold">{LEGAL_TITLES[doc]}</div>
          <button className="ring-focus rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={onClose} aria-label="Close">
            <X className="size-4.5" />
          </button>
        </div>
        <LegalText doc={doc} className="px-6 pt-2 pb-6" />
      </motion.div>
    </motion.div>
  )
}

/** First start (and whenever the Terms or Privacy Policy change): read and accept before using the app. */
export function Agreement() {
  const termsVersion = useStore((s) => s.termsVersion)
  const updated = (useStore((s) => s.settings?.accepted_terms) ?? 0) > 0
  const [doc, setDoc] = useState<'terms' | 'privacy'>('terms')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)

  const accept = () => {
    setBusy(true)
    api<Settings>('/settings', { method: 'PATCH', body: { accepted_terms: termsVersion } })
      .then((s) => useStore.setState({ settings: s }))
      .catch((e: Error) => { toast.error(e.message); setBusy(false) })
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <motion.div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-4 border-b border-line px-7 py-5">
          <BrandIcon size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-[20px] font-semibold">
              {updated ? 'Our terms have changed' : <>Welcome to <Wordmark className="text-[22px]" /></>}
            </div>
            <div className="mt-0.5 text-[13px] text-muted">
              {updated ? 'Please read and accept the updated terms to keep using the app.' : 'Before you start, please read and accept how the app may be used.'}
            </div>
          </div>
        </div>

        <div className="grid gap-2.5 border-b border-line bg-surface-2/40 px-7 py-4 text-[13px] sm:grid-cols-3">
          <Point icon={<ShieldCheck className="size-4 text-ok" />} title="Nothing collected">No accounts, analytics or tracking. Your data stays on this PC.</Point>
          <Point icon={<FileText className="size-4 text-accent" />} title="Your responsibility">Only download content you have the right to, and follow each site's rules.</Point>
          <Point icon={<FileText className="size-4 text-accent" />} title="Free software">GPL-2.0, provided as is, not affiliated with any site.</Point>
        </div>

        <div className="flex items-center justify-between px-7 pt-4">
          <Segmented size="sm" value={doc} onChange={setDoc}
            options={[{ value: 'terms', label: 'Terms of Use' }, { value: 'privacy', label: 'Privacy Policy' }]} />
        </div>
        <LegalText doc={doc} className="mx-7 mt-3 min-h-40 flex-1 min-h-0 rounded-xl border border-line px-5 pb-5" />

        <div className="flex items-center gap-4 border-t border-line px-7 py-4">
          <div className="flex flex-1 cursor-pointer items-center gap-2.5 text-[13px] select-none" onClick={() => setAgreed(!agreed)}>
            <Checkbox checked={agreed} onChange={setAgreed} />
            I have read and agree to the Terms of Use and the Privacy Policy.
          </div>
          <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => post('/quit')}>Quit</Button>
          <Button variant="primary" disabled={!agreed} loading={busy} onClick={accept}>Agree and continue</Button>
        </div>
      </motion.div>
    </div>
  )
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5">{icon}</div>
      <div><div className="font-semibold">{title}</div><div className="mt-0.5 text-[12px] leading-snug text-muted">{children}</div></div>
    </div>
  )
}
