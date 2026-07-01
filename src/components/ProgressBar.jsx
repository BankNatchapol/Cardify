import React from 'react'

/**
 * ProgressBar — moss-fill track. If `value` (0-100) is a finite number,
 * renders a determinate fill; otherwise renders an indeterminate sliding bar.
 */
export default function ProgressBar ({ value = null, label }) {
  const determinate = typeof value === 'number' && Number.isFinite(value)
  const pct = determinate ? Math.max(0, Math.min(100, value)) : null

  return (
    <div
      className="cf-progress"
      role="progressbar"
      aria-valuenow={determinate ? Math.round(pct) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'Generation progress'}
    >
      <div className="cf-progress-track">
        <div
          className={determinate ? 'cf-progress-fill' : 'cf-progress-fill cf-progress-fill--indeterminate'}
          style={determinate ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  )
}
