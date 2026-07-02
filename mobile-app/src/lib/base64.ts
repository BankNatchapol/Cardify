// Manual base64 <-> Uint8Array conversion — React Native/Hermes has no global
// Buffer or btoa/atob, so expo-file-system's base64 strings need this to talk
// to fflate (which operates on Uint8Array).
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64ToUint8Array (base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = B64_CHARS.indexOf(clean[i])
    const e2 = B64_CHARS.indexOf(clean[i + 1])
    const e3 = clean[i + 2] === undefined || clean[i + 2] === '=' ? -1 : B64_CHARS.indexOf(clean[i + 2])
    const e4 = clean[i + 3] === undefined || clean[i + 3] === '=' ? -1 : B64_CHARS.indexOf(clean[i + 3])
    bytes.push((e1 << 2) | (e2 >> 4))
    if (e3 !== -1) bytes.push(((e2 & 15) << 4) | (e3 >> 2))
    if (e4 !== -1) bytes.push(((e3 & 3) << 6) | e4)
  }
  return new Uint8Array(bytes)
}

export function uint8ArrayToBase64 (bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i]
    const b2 = bytes[i + 1]
    const b3 = bytes[i + 2]
    const e1 = b1 >> 2
    const e2 = ((b1 & 3) << 4) | (b2 === undefined ? 0 : b2 >> 4)
    const e3 = b2 === undefined ? 64 : ((b2 & 15) << 2) | (b3 === undefined ? 0 : b3 >> 6)
    const e4 = b3 === undefined ? 64 : b3 & 63
    result += B64_CHARS[e1] + B64_CHARS[e2] + (e3 === 64 ? '=' : B64_CHARS[e3]) + (e4 === 64 ? '=' : B64_CHARS[e4])
  }
  return result
}
