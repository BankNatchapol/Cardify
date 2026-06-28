'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function makeProjectStore (dir) {
  const file = path.join(dir, 'cardify-projects.json')

  function readProjects () {
    if (!fs.existsSync(file)) return []
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(data.projects) ? data.projects : []
    } catch {
      return []
    }
  }

  function writeProjects (projects) {
    fs.writeFileSync(file, JSON.stringify({ projects }, null, 2), { mode: 0o600 })
  }

  function saveProject (project) {
    const now = '2026-06-28T00:00:00.000Z'
    const projects = readProjects()
    const id = project.id || 'project-test'
    const existing = projects.findIndex(p => p.id === id)
    const nextProject = {
      ...project,
      id,
      updatedAt: now,
      createdAt: project.createdAt || (existing >= 0 ? projects[existing].createdAt : now)
    }
    if (existing >= 0) projects[existing] = nextProject
    else projects.unshift(nextProject)
    writeProjects(projects)
    return nextProject
  }

  return { file, readProjects, saveProject }
}

describe('project storage', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-projects-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns an empty list when no projects file exists', () => {
    const store = makeProjectStore(tmpDir)
    expect(store.readProjects()).toEqual([])
  })

  it('saves generated cards before Anki push', () => {
    const store = makeProjectStore(tmpDir)
    const saved = store.saveProject({
      fileName: 'notes.pdf',
      description: {
        title: 'Notes Review',
        purpose: 'Review the important ideas from notes.pdf',
        contents: ['Definitions']
      },
      contextPrompt: 'study context',
      cardFormat: 'basic',
      cards: [{ type: 'basic', front: 'Q', back: 'A' }]
    })

    expect(saved.id).toBe('project-test')
    expect(store.readProjects()).toHaveLength(1)
    expect(store.readProjects()[0].cards[0].front).toBe('Q')
    expect(store.readProjects()[0].description.purpose).toBe('Review the important ideas from notes.pdf')
  })

  it('loads saved description and cards together', () => {
    const store = makeProjectStore(tmpDir)
    store.saveProject({
      id: 'p1',
      description: {
        title: 'HSK 1',
        purpose: 'Practice beginner vocabulary',
        contents: ['Greetings', 'Numbers']
      },
      cards: [{ type: 'basic', front: '你好', back: 'hello' }]
    })

    const [project] = store.readProjects()
    expect(project.description).toEqual({
      title: 'HSK 1',
      purpose: 'Practice beginner vocabulary',
      contents: ['Greetings', 'Numbers']
    })
    expect(project.cards).toEqual([{ type: 'basic', front: '你好', back: 'hello' }])
  })

  it('updates an existing project instead of duplicating it', () => {
    const store = makeProjectStore(tmpDir)
    store.saveProject({ id: 'p1', cards: [{ front: 'Q1', back: 'A1', type: 'basic' }] })
    store.saveProject({ id: 'p1', cards: [{ front: 'Q2', back: 'A2', type: 'basic' }] })

    const projects = store.readProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].cards[0].front).toBe('Q2')
  })
})
