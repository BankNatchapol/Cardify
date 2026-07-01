const { contextBridge, ipcRenderer } = require('electron')

const generationBatchListeners = new WeakMap()

contextBridge.exposeInMainWorld('ipc', {
  invoke: (channel, ...args) => {
    const allowedChannels = [
      'parse-file',
      'prepare-generation',
      'generate-sample-cards',
      'generate-deck-overview',
      'generate-cards',
      'cancel-generation',
      'start-iterative-generation',
      'stop-iterative-generation',
      'push-to-anki',
      'test-anki-connection',
      'save-api-key',
      'get-api-key-set',
      'get-api-key-status',
      'clear-api-key',
      'list-claude-api-models',
      'get-claude-code-status',
      'get-generation-settings',
      'save-generation-settings',
      'save-project',
      'list-projects',
      'get-latest-project',
      'delete-project',
      'export-mobile-package'
    ]
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args)
    }
    return Promise.reject(new Error(`Channel "${channel}" is not allowed`))
  },
  onGenerationBatch: (callback) => {
    if (typeof callback !== 'function') return
    const listener = (_event, payload) => callback(payload)
    generationBatchListeners.set(callback, listener)
    ipcRenderer.on('generation-batch', listener)
  },
  offGenerationBatch: (callback) => {
    const listener = generationBatchListeners.get(callback)
    if (!listener) return
    ipcRenderer.removeListener('generation-batch', listener)
    generationBatchListeners.delete(callback)
  }
})
