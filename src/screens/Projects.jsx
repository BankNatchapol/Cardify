import React, { useEffect, useState } from 'react'

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

export default function Projects ({ activeProjectId, onOpenProject, onNewProject }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  return (
    <div className="projects-screen">
      <header className="screen-header">
        <div>
          <h1>Projects</h1>
          <p className="subtitle">Saved generations you can reopen, edit, and push later</p>
        </div>
        <button type="button" className="primary-btn" onClick={onNewProject}>
          New Project
        </button>
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
            const cardCount = Array.isArray(project.cards) ? project.cards.length : 0
            const isActive = project.id === activeProjectId
            const summary = descriptionSummary(project.description, project.contextPrompt)
            const contents = Array.isArray(project.description?.contents) ? project.description.contents : []
            return (
              <article className={`project-row${isActive ? ' project-row--active' : ''}`} key={project.id}>
                <button
                  type="button"
                  className="project-open"
                  onClick={() => onOpenProject(project)}
                >
                  <span className="project-title">{project.title || project.fileName || 'Untitled Project'}</span>
                  <span className="project-meta">
                    {cardCount} {cardCount === 1 ? 'card' : 'cards'} · {project.cardFormat || 'basic'} · Updated {formatDate(project.updatedAt)}
                  </span>
                  {summary && (
                    <span className="project-context">{summary}</span>
                  )}
                  {contents.length > 0 && (
                    <span className="project-topic-list">
                      {contents.slice(0, 4).map((item, index) => (
                        <span className="overview-topic" key={`${project.id}-${item}-${index}`}>{item}</span>
                      ))}
                    </span>
                  )}
                </button>
                <div className="project-actions">
                  {isActive && <span className="active-pill">Open</span>}
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => onOpenProject(project)}
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => handleDelete(project)}
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
