import { Film, Music } from 'lucide-react'
import { useRef } from 'react'
import { isAudioPreset } from '../lib/format'
import type { Preset } from '../lib/types'
import { Segmented, Select, cx } from './ui'

const VIDEO_OPTIONS = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]
const AUDIO_OPTIONS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'M4A (original)' },
]

export function PresetPicker({ value, onChange, className }: { value: Preset; onChange: (p: Preset) => void; className?: string }) {
  const audio = isAudioPreset(value)
  const lastVideo = useRef<Preset>(audio ? '1080' : value)
  if (!audio) lastVideo.current = value

  return (
    <div className={cx('flex items-center gap-2', className)}>
      <Segmented
        size="sm"
        value={audio ? 'audio' : 'video'}
        onChange={(m) => onChange(m === 'audio' ? 'mp3' : lastVideo.current)}
        options={[
          { value: 'video', label: <><Film className="size-3.5" />Video</> },
          { value: 'audio', label: <><Music className="size-3.5" />Audio</> },
        ]}
      />
      <Select
        className="h-8 min-w-0 flex-1"
        value={value}
        onChange={(v) => onChange(v as Preset)}
        options={audio ? AUDIO_OPTIONS : VIDEO_OPTIONS}
      />
    </div>
  )
}
