const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { parseFile } = require('../src/lib/parser')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC: parse-file
ipcMain.handle('parse-file', async (_event, filePath) => {
  return parseFile(filePath)
})

// Stub handlers for future tasks
ipcMain.handle('generate-cards', async (_event, _args) => {
  throw new Error('generate-cards not yet implemented — Task 3')
})

ipcMain.handle('push-to-anki', async (_event, _args) => {
  throw new Error('push-to-anki not yet implemented — Task 5')
})

ipcMain.handle('test-anki-connection', async () => {
  throw new Error('test-anki-connection not yet implemented — Task 5')
})

ipcMain.handle('save-api-key', async (_event, _key) => {
  throw new Error('save-api-key not yet implemented — Task 2')
})

ipcMain.handle('get-api-key-set', async () => {
  return false
})

ipcMain.handle('clear-api-key', async () => {
  throw new Error('clear-api-key not yet implemented — Task 2')
})
