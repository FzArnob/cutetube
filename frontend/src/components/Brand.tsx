/** Cutetube brand marks (from the brand board): pink rounded square with a white "C" and navy "T". */
export const BRAND = { accent: '#F0507A', navy: '#2E2250', cream: '#FFF6F2', blush: '#FDE3EA', muted: '#6B6180' }

export function BrandIcon({ size = 40, className }: { size?: number; className?: string }) {
  // The brand board uses slightly bigger, tighter letters at small sizes.
  const small = size <= 32
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} role="img" aria-label="Cutetube">
      <rect width="120" height="120" rx="34" fill={BRAND.accent} />
      <text x="60" y={small ? 86 : 84} textAnchor="middle" fontFamily="'Fredoka Variable', Fredoka, sans-serif" fontWeight={700}
        fontSize={small ? 72 : 66} letterSpacing={small ? -4 : -3}>
        <tspan fill="#FFFFFF">C</tspan><tspan fill={BRAND.navy}>T</tspan>
      </text>
    </svg>
  )
}

/** "cute" in accent + "tube" in navy (cream on dark backgrounds). */
export function Wordmark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className} style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.02em', ...style }}>
      <span style={{ color: BRAND.accent }}>cute</span>
      <span className="text-[#2E2250] dark:text-[#FFF6F2]">tube</span>
    </span>
  )
}

export const TAGLINE = 'Save it · Keep it · Skip the ads'

/** Nav icon for the embedded YouTube view: a red play-button tile. */
export function YouTubeIcon({ className, muted }: { className?: string; muted?: boolean }) {
  return (
    <svg viewBox="0 0 28 20" className={className} aria-hidden>
      <rect width="28" height="20" rx="6" fill={muted ? 'currentColor' : '#FF0033'} opacity={muted ? 0.85 : 1} />
      <path d="M11.2 5.6v8.8L18.8 10z" fill={muted ? 'var(--surface)' : '#FFFFFF'} />
    </svg>
  )
}
