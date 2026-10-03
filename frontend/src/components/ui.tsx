import { clsx } from 'clsx'
import { Check, Loader2, Minus } from 'lucide-react'
import { motion } from 'motion/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const cx = clsx

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-[0_6px_20px_-6px_var(--accent)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-bad/10 text-bad hover:bg-bad/20',
  soft: 'bg-accent-soft text-accent hover:brightness-110',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-[10px]',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
}

export function Button({
  variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      className={cx(
        'ring-focus inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 select-none',
        variants[variant], sizes[size], className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  className, active, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cx(
        'ring-focus inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-35 disabled:pointer-events-none',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'ring-focus relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-brand' : 'bg-surface-3',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
        className={cx('block size-[18px] rounded-full bg-white shadow', checked ? 'ml-[19px]' : 'ml-[3px]')}
      />
    </button>
  )
}

export function Checkbox({
  checked, indeterminate, onChange, className,
}: { checked: boolean; indeterminate?: boolean; onChange?: (v: boolean) => void; className?: string }) {
  const on = checked || indeterminate
  return (
    <span
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked) }}
      className={cx(
        'inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border transition-all',
        on ? 'border-transparent bg-brand text-white' : 'border-line-strong bg-surface hover:border-accent',
        className,
      )}
    >
      {indeterminate ? <Minus className="size-3" strokeWidth={3.5} /> : checked ? <Check className="size-3" strokeWidth={3.5} /> : null}
    </span>
  )
}

export function Segmented<T extends string>({
  value, onChange, options, size = 'md', className,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={cx('relative inline-flex rounded-[10px] bg-surface-2 p-0.5 border border-line', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative z-10 flex flex-1 items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs rounded-lg' : 'h-8 px-3 text-[13px] rounded-lg',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join('-')}`}
              className="absolute inset-0 -z-10 rounded-lg bg-surface shadow-card border border-line"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({
  value, onChange, options, className,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'native ring-focus h-9 cursor-pointer rounded-[10px] border border-line bg-surface-2 pl-3 text-[13px] font-medium text-fg hover:border-line-strong',
        className,
      )}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-muted', className ?? 'size-4')} />
}

export function Progress({ value, live, tone = 'brand', className }: { value: number; live?: boolean; tone?: 'brand' | 'ok' | 'bad' | 'muted'; className?: string }) {
  const bg = { brand: 'bg-brand', ok: 'bg-ok', bad: 'bg-bad', muted: 'bg-faint' }[tone]
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', bg, live && 'progress-live')}
        style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'bad' | 'warn' | 'accent'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-3 text-muted',
    ok: 'bg-ok/15 text-ok',
    bad: 'bg-bad/15 text-bad',
    warn: 'bg-warn/15 text-warn',
    accent: 'bg-accent-soft text-accent',
  }
  return (
    <span className={cx('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Thumb({ src, short, duration, className, children }: { src?: string | null; short?: boolean; duration?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cx('relative shrink-0 overflow-hidden rounded-lg bg-surface-3', short ? 'aspect-[9/16]' : 'aspect-video', className)}>
      {src && <img src={src} loading="lazy" draggable={false} className="size-full object-cover" referrerPolicy="no-referrer"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
      {duration && (
        <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 py-px text-[10px] font-semibold text-white tabular-nums">
          {duration}
        </span>
      )}
      {children}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)}>{children}</div>
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <div className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} />
}
