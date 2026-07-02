import React, { useEffect, useRef, useState } from 'react'

function formatDate (value) {
  if (!value) return 'Unknown'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return 'Unknown'
  }
}

function descriptionSummary (description, fallback = '') {
  if (!description || typeof description !== 'object') return fallback
  return description.purpose || (Array.isArray(description.contents) ? description.contents.join(', ') : '') || fallback
}

function projectProgressStatus (project) {
  const status = project.generationProgress?.status
  return status && status !== 'done' ? status : ''
}

export default function Projects ({ activeProjectId, activeProject, onOpenProject, onNewProject, onImportProject }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef(null)

  const refreshProjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.ipc.invoke('list-projects')
      setProjects(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(`Could not load projects: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshProjects()
  }, [])

  const handleDelete = async (project) => {
    try {
      await window.ipc.invoke('delete-project', project.id)
      setProjects(prev => prev.filter(item => item.id !== project.id))
    } catch (err) {
      setError(`Could not delete project: ${err.message}`)
    }
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    setError(null)
    try {
      await onImportProject?.(file.path, file.name)
    } catch (err) {
      setError(`Could not import JSON project: ${err.message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="projects-screen">
      <header className="screen-header">
        <div>
          <h1>Projects</h1>
          <p className="subtitle">Saved generations you can reopen, edit, and push later</p>
        </div>
        <div className="project-header-actions">
          <button type="button" className="secondary-btn" onClick={() => importInputRef.current?.click()} disabled={importing}>
            {importing ? 'Importing...' : 'Import JSON'}
          </button>
          <button type="button" className="primary-btn" onClick={onNewProject}>
            New Project
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.cardify.json"
            onChange={handleImportFile}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>
      </header>

      {error && <p className="error-message" role="alert">{error}</p>}

      {loading ? (
        <p className="empty-state">Loading projects...</p>
      ) : projects.length === 0 ? (
        <section className="empty-state">
          <h2>No projects yet</h2>
          <p>Generate cards from Upload and Cardify will save them here before Anki push.</p>
        </section>
      ) : (
        <div className="project-list">
          {projects.map(project => {
            const isActive = project.id === activeProjectId
            const rowProject = isActive && activeProject
              ? { ...project, ...activeProject, title: activeProject.title || project.title }
              : project
            const cardCount = Array.isArray(rowProject.cards) ? rowProject.cards.length : 0
            const summary = descriptionSummary(rowProject.description, rowProject.contextPrompt)
            const contents = Array.isArray(rowProject.description?.contents) ? rowProject.description.contents : []
            const progressStatus = projectProgressStatus(rowProject)
            return (
              <article
                className={`project-row${isActive ? ' project-row--active' : ''}`}
                key={rowProject.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenProject(rowProject)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpenProject(rowProject)
                  }
                }}
              >
                <div
                  className="project-open"
                >
                  <span className="project-title">{rowProject.title || rowProject.fileName || 'Untitled Project'}</span>
                  <span className="project-meta">
                    {cardCount} {cardCount === 1 ? 'card' : 'cards'} · {rowProject.cardFormat || 'basic'} · Updated {formatDate(rowProject.updatedAt)}
                  </span>
                  {progressStatus && (
                    <span className="project-progress">
                      Generation {progressStatus}
                      {rowProject.generationProgress?.completedBatches !== undefined && (
                        <> · Batch {rowProject.generationProgress.completedBatches} / {rowProject.generationProgress.maxBatches || 20}</>
                      )}
                    </span>
                  )}
                  {summary && (
                    <span className="project-context">{summary}</span>
                  )}
                  {contents.length > 0 && (
                    <span className="project-topic-list">
                      {contents.slice(0, 4).map((item, index) => (
                        <span className="overview-topic" key={`${rowProject.id}-${item}-${index}`}>{item}</span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="project-actions">
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDelete(rowProject)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
