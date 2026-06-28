const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ipc', {
  invoke: (channel, ...args) => {
    const allowedChannels = [
      'parse-file',
      'generate-cards',
      'push-to-anki',
      'test-anki-connection',
      'save-api-key',
      'get-api-key-set',
      'clear-api-key',
      'get-claude-code-status',
      'save-project',
      'list-projects',
      'get-latest-project',
      'delete-project'
    ]
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args)
    }
    return Promise.reject(new Error(`Channel "${channel}" is not allowed`))
  }
})
