import { FolderOpen, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react'
import { post } from '../lib/api'
import type { Job } from '../lib/types'
import { IconButton } from './ui'

export const jobAction = (id: string, action: string) => post(`/downloads/${id}/${action}`)
export const openJob = (id: string, target: 'file' | 'folder') => post('/open', { job_id: id, target })

export function JobControls({ job, compact }: { job: Job; compact?: boolean }) {
  const s = job.status
  const active = s === 'running' || s === 'queued' || s === 'paused'
  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {(s === 'running' || s === 'queued') && (
        <IconButton title="Pause" onClick={() => jobAction(job.id, 'pause')}><Pause className="size-4" /></IconButton>
      )}
      {s === 'paused' && (
        <IconButton title="Resume" onClick={() => jobAction(job.id, 'resume')}><Play className="size-4" /></IconButton>
      )}
      {(s === 'error' || s === 'cancelled') && (
        <IconButton title="Retry" onClick={() => jobAction(job.id, 'retry')}><RotateCcw className="size-4" /></IconButton>
      )}
      {(s === 'done' || s === 'skipped') && job.dir && (
        <IconButton title="Show in folder" onClick={() => openJob(job.id, 'folder')}><FolderOpen className="size-4" /></IconButton>
      )}
      {active ? (
        <IconButton title="Remove download (deletes the partial file)" onClick={() => jobAction(job.id, 'remove')}>
          <X className="size-4" />
        </IconButton>
      ) : !compact && (
        <IconButton title="Remove from list (the file stays on disk)" onClick={() => jobAction(job.id, 'remove')}>
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </div>
  )
}
