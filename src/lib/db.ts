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
    return {
      ...defaultState,
      ...parsed,
      defaults: { ...defaultState.defaults, ...(parsed.defaults || {}) },
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
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  if (!file.type.startsWith('image/') || file.size <= 700_000) return raw
  try {
    const bitmap = await createImageBitmap(file)
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return raw
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/webp', 0.9)
  } catch {
    return raw
  }
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
