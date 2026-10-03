import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { connectEvents, post } from './lib/api'
import { useStore } from './lib/store'
import { BrandIcon, TAGLINE, Wordmark } from './components/Brand'
import { Agreement } from './components/Legal'
import { Rail } from './components/Rail'
import { Spinner } from './components/ui'
import { Browse } from './pages/Browse'
import { Downloads } from './pages/Downloads'
import { Settings } from './pages/Settings'

function useTheme(): 'dark' | 'light' {
  const pref = useStore((s) => s.settings?.theme ?? 'dark')
  const [system, setSystem] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystem(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme = pref === 'system' ? (system ? 'dark' : 'light') : pref
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    post('/window/theme', { theme }).catch(() => {}) // native title bar follows the app theme
  }, [theme])
  return theme
}

export default function App() {
  const handle = useStore((s) => s.handle)
  const setConnected = useStore((s) => s.setConnected)
  const loaded = useStore((s) => s.loaded)
  const page = useStore((s) => s.page)
  const accepted = useStore((s) => (s.settings?.accepted_terms ?? 0) >= s.termsVersion)
  const theme = useTheme()

  useEffect(() => connectEvents(handle, setConnected), [handle, setConnected])

  if (!loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5">
        <BrandIcon size={88} className="animate-pulse drop-shadow-[0_12px_28px_rgb(240_80_122/0.35)]" />
        <Wordmark className="text-[40px] leading-none" />
        <div className="text-[12px] font-bold tracking-[0.25em] text-muted uppercase">{TAGLINE}</div>
        <Spinner className="mt-2 size-5" />
      </div>
    )
  }

  // Nothing else (including the site browser) shows until the Terms and Privacy Policy are accepted.
  if (!accepted) return <Agreement />

  return (
    <div className="flex h-full">
      <Rail />
      <main className="relative min-w-0 flex-1">
        {/* Browse stays mounted so the side panel keeps its state while you visit other pages. */}
        <div className={page === 'browse' ? 'h-full' : 'hidden'}>
          <Browse active={page === 'browse'} />
        </div>
        <AnimatePresence mode="wait">
          {page !== 'browse' && (
            <motion.div key={page} className="absolute inset-0"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
              {page === 'downloads' ? <Downloads /> : <Settings />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <Toaster position="bottom-right" theme={theme} closeButton offset={16}
        toastOptions={{ style: { width: 340, borderRadius: 14 } }} />
    </div>
  )
}
