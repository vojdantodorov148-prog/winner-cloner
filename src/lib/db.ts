import type { AppState, StoredAsset } from '../types'

const META_KEY = 'winner-cloner:v1'
const DB_NAME = 'winner-cloner-assets'
const DB_VERSION = 1
const STORE = 'assets'

export const defaultState: AppState = {
  products: [],
  winners: [],
  jobs: [],
  defaults: {
    market: 'Croatia',
    outputLanguage: 'Auto — market native',
    aspectRatio: '4:5',
    model: 'nano-banana-pro',
    variations: 4,
    cloneStrength: 92,
  },
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return defaultState
    const parsed = JSON.parse(raw) as AppState
    const defaults = { ...defaultState.defaults, ...(parsed.defaults || {}) }
    // Kie's current reference-image endpoint is image-to-image.
    // Migrate the broken v1.0.3 image-edit identifier retained by previous builds.
    if (defaults.model === 'grok-imagine-image-2-0/image-edit') defaults.model = 'grok-imagine-image-2-0/image-to-image'
    return {
      ...defaultState,
      ...parsed,
      defaults,
    }
  } catch {
    return defaultState
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(META_KEY, JSON.stringify(state))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files are supported.')
  if (file.size > 25 * 1024 * 1024) throw new Error('Image is too large. Use an image under 25 MB.')

  const raw = await readFileAsDataUrl(file)
  try {
    const bitmap = await createImageBitmap(file)
    const shouldResize = Math.max(bitmap.width, bitmap.height) > 1400
    const shouldCompress = file.size > 350_000 || shouldResize || file.type !== 'image/webp'
    if (!shouldCompress) {
      bitmap.close()
      return raw
    }
    return compressBitmap(bitmap)
  } catch {
    // If the browser cannot decode a valid image, retain the original rather
    // than corrupting the user's stored asset. It will be optimized again at
    // generation time where possible.
    return raw
  }
}

// Existing browser libraries may contain images saved by older builds before
// request-size hardening existed. Re-optimize them on generation so a redeploy
// does not force the user to re-upload all winners/products just to avoid a
// Netlify 413 payload error.
export async function optimizeDataUrl(dataUrl: string): Promise<string> {
  if (!String(dataUrl || '').startsWith('data:image/')) return dataUrl
  if (dataUrl.length <= 950_000) return dataUrl
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const bitmap = await createImageBitmap(blob)
    return compressBitmap(bitmap)
  } catch {
    return dataUrl
  }
}

function compressBitmap(bitmap: ImageBitmap, targetLength = 900_000): string {
  const maxSide = 1400
  const baseScale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * baseScale))
  let height = Math.max(1, Math.round(bitmap.height * baseScale))
  let best = ''

  try {
    // If lowering WebP quality is not enough for a very detailed image, also
    // reduce dimensions in controlled rounds. This makes the request-size cap
    // practical rather than merely aspirational.
    for (let round = 0; round < 5; round++) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context unavailable')
      ctx.drawImage(bitmap, 0, 0, width, height)

      for (const quality of [0.84, 0.76, 0.68, 0.60, 0.52]) {
        const compressed = canvas.toDataURL('image/webp', quality)
        if (!best || compressed.length < best.length) best = compressed
        if (compressed.length <= targetLength) return compressed
      }

      width = Math.max(480, Math.round(width * 0.82))
      height = Math.max(480, Math.round(height * 0.82))
    }
    if (!best) throw new Error('Could not compress image')
    return best
  } finally {
    bitmap.close()
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Could not read image file.'))
    reader.readAsDataURL(file)
  })
}

export async function saveAsset(file: File): Promise<StoredAsset> {
  const asset: StoredAsset = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    dataUrl: await fileToDataUrl(file),
    createdAt: new Date().toISOString(),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(asset)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return asset
}

export async function saveDataUrlAsset(dataUrl: string, name = 'pasted-image.png'): Promise<StoredAsset> {
  const asset: StoredAsset = {
    id: crypto.randomUUID(),
    name,
    type: dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png',
    dataUrl,
    createdAt: new Date().toISOString(),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(asset)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return asset
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  const db = await openDb()
  const asset = await new Promise<StoredAsset | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return asset
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
