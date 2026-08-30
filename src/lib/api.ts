import type { Product, Winner } from '../types'

export type GeneratePayload = {
  winner: Winner
  winnerImage: string
  product: Product
  productImages: string[]
  market: string
  outputLanguage: string
  aspectRatio: string
  model: string
  variations: number
  cloneStrength: number
  extraNotes: string
}

export async function createGeneration(payload: GeneratePayload) {
  const res = await fetchWithTimeout('/.netlify/functions/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 59_000)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || friendlyHttpError(res.status, 'Generation request failed'))
  if (!Array.isArray(body?.taskIds) || !body.taskIds.length) throw new Error('Generation started but no image task IDs were returned. Retry once.')
  return body as {
    taskIds: string[]
    promptSummary?: string
    blueprint?: Record<string, unknown>
    warning?: string
  }
}

export async function getTaskStatus(taskId: string) {
  const res = await fetchWithTimeout(`/.netlify/functions/status?taskId=${encodeURIComponent(taskId)}`, {}, 18_000)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || friendlyHttpError(res.status, 'Status request failed'))
  return body as {
    status: 'waiting' | 'generating' | 'success' | 'fail'
    imageUrl?: string
    error?: string
    progress?: number
  }
}

export async function getCredits() {
  const res = await fetchWithTimeout('/.netlify/functions/credits', {}, 18_000)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || friendlyHttpError(res.status, 'Credits request failed'))
  return body as { credits: number }
}

export function downloadProxyUrl(url: string, filename: string) {
  return `/.netlify/functions/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The request took too long. Kie or Netlify may be temporarily busy; retry the generation.')
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

function friendlyHttpError(status: number, fallback: string) {
  if (status === 413) return 'The image request is too large. Re-upload the winner/product images so the app can compress them, then retry.'
  if (status === 429) return 'Too many requests. Wait a moment and retry.'
  if (status >= 500) return `${fallback}. The AI backend or Netlify function returned ${status}.`
  return `${fallback} (${status})`
}
