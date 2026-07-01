import React from 'react'

const STATUS_META = {
  in_progress: { label: 'In progress', tone: 'info', spin: true },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'danger' },
  capped: { label: 'Capped', tone: 'warning' },
  idle: { label: 'Idle', tone: 'muted' }
}

/**
 * StatusTile — colored, animated status indicator for the generation stat grid.
 * Running = pulsing water spinner; done = moss; failed/stopped = clay; capped = ochre.
 */
export default function StatusTile ({ status }) {
  const meta = STATUS_META[status] || STATUS_META.idle
  return (
    <div className="cf-stat-tile">
      <span className="iterative-label">Status</span>
      <span className={`cf-status cf-status--${meta.tone}`}>
        {meta.spin
          ? <span className="cf-status-ring" aria-hidden="true" />
          : <span className="cf-status-dot" aria-hidden="true" />}
        <strong className={meta.spin ? 'cf-pulse-text' : ''}>{meta.label}</strong>
      </span>
    </div>
  )
}
