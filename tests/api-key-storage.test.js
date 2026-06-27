/**
 * Unit tests for the API key storage logic that lives in electron/main.js.
 *
 * Because the production module wires Electron IPC handlers at import time
 * (which requires a real Electron runtime), we replicate the pure storage
 * functions here against the same safeStorage contract and assert:
 *
 *   - save → encrypt → write
 *   - get → existence + decrypt
 *   - clear → unlink
 *   - the saved bytes are NOT the raw key (encryption actually happened)
 *
 * This gives us regression coverage without spinning up Electron in CI.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

// A trivial fake safeStorage with a deterministic "encryption" that lets us
// verify the bytes on disk are not the plaintext key.
function makeFakeSafeStorage() {
  // Mirrors safeStorage's contract: bytes on disk are opaque, but
  // decryptString round-trips. We XOR with a fixed key so the on-disk
  // blob really doesn't contain the plaintext substring (matches the
  // real safeStorage behaviour where the file is OS-keychain-encrypted).
  const XOR_KEY = Buffer.from([0xa5, 0x3c, 0x77, 0x1f])
  const HEADER = Buffer.from([0x00, 0x53, 0x42, 0x01]) // marker
  const xor = (buf) => {
    const out = Buffer.alloc(buf.length)
    for (let i = 0; i < buf.length; i++) {
      out[i] = buf[i] ^ XOR_KEY[i % XOR_KEY.length]
    }
    return out
  }
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.concat([HEADER, xor(Buffer.from(s, 'utf8'))]),
    decryptString: (buf) => {
      if (!Buffer.isBuffer(buf) || buf.length < HEADER.length) {
        throw new Error('not encrypted')
      }
      if (!buf.slice(0, HEADER.length).equals(HEADER)) {
        throw new Error('bad header')
      }
      return xor(buf.slice(HEADER.length)).toString('utf8')
    }
  }
}

// Mirrors the logic in electron/main.js so we can unit-test it without
// Electron's runtime. If main.js changes, this test must change with it.
function makeKeyStore(safeStorage, file) {
  return {
    save(key) {
      if (typeof key !== 'string' || key.trim().length === 0) {
        throw new Error('API key must be a non-empty string')
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available')
      }
      const encrypted = safeStorage.encryptString(key.trim())
      fs.writeFileSync(file, encrypted, { mode: 0o600 })
      return { ok: true }
    },
    isSet() {
      if (!fs.existsSync(file)) return false
      try {
        const buf = fs.readFileSync(file)
        if (!buf || buf.length === 0) return false
        const plain = safeStorage.decryptString(buf)
        return Boolean(plain && plain.length > 0)
      } catch {
        return false
      }
    },
    read() {
      if (!fs.existsSync(file)) return null
      const buf = fs.readFileSync(file)
      const plain = safeStorage.decryptString(buf)
      return plain && plain.length > 0 ? plain : null
    },
    clear() {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      return { ok: true }
    }
  }
}

describe('API key storage (Task 2)', () => {
  let tmpDir
  let keyFile
  let safe
  let store

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-keystore-'))
    keyFile = path.join(tmpDir, 'claude-api-key.enc')
    safe = makeFakeSafeStorage()
    store = makeKeyStore(safe, keyFile)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  test('isSet() returns false when no key has been saved', () => {
    expect(store.isSet()).toBe(false)
  })

  test('save() persists an encrypted blob, not the raw key', () => {
    const key = 'sk-ant-test-key-1234567890'
    store.save(key)

    expect(fs.existsSync(keyFile)).toBe(true)
    const raw = fs.readFileSync(keyFile)

    // Encrypted file must not contain the literal key string anywhere.
    expect(raw.toString('utf8')).not.toContain(key)

    // The actual key can still be retrieved via the (main-process-only)
    // decrypt path — but never sent back to the renderer.
    expect(store.read()).toBe(key)
  })

  test('isSet() returns true after save()', () => {
    store.save('sk-ant-abc')
    expect(store.isSet()).toBe(true)
  })

  test('save() trims whitespace from the key before encrypting', () => {
    store.save('   sk-ant-trimmed   ')
    expect(store.read()).toBe('sk-ant-trimmed')
  })

  test('save() rejects empty / non-string values', () => {
    expect(() => store.save('')).toThrow(/non-empty/)
    expect(() => store.save('   ')).toThrow(/non-empty/)
    expect(() => store.save(null)).toThrow(/non-empty/)
    expect(() => store.save(undefined)).toThrow(/non-empty/)
    expect(() => store.save(12345)).toThrow(/non-empty/)
  })

  test('clear() deletes the file and isSet() returns false again', () => {
    store.save('sk-ant-clear-me')
    expect(store.isSet()).toBe(true)

    store.clear()
    expect(fs.existsSync(keyFile)).toBe(false)
    expect(store.isSet()).toBe(false)
  })

  test('clear() is a no-op when no key file exists', () => {
    expect(() => store.clear()).not.toThrow()
    expect(store.isSet()).toBe(false)
  })

  test('save → close → reopen flow: isSet() survives a fresh store instance', () => {
    store.save('sk-ant-persist')

    // Simulate app relaunch: brand-new store pointing at the same file.
    const newSafe = makeFakeSafeStorage()
    const newStore = makeKeyStore(newSafe, keyFile)

    expect(newStore.isSet()).toBe(true)
    expect(newStore.read()).toBe('sk-ant-persist')
  })

  test('isSet() returns false when encryption is unavailable on this system', () => {
    const brokenSafe = {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('unavailable')
      },
      decryptString: () => {
        throw new Error('unavailable')
      }
    }
    const brokenStore = makeKeyStore(brokenSafe, keyFile)
    // Save should refuse...
    expect(() => brokenStore.save('sk-ant-x')).toThrow(/Encryption is not available/)
    // ...and with no file written, isSet stays false.
    expect(brokenStore.isSet()).toBe(false)
  })
})
