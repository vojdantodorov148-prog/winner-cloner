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
  const res = await fetch('/.netlify/functions/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Generation request failed (${res.status})`)
  return body as {
    taskIds: string[]
    promptSummary?: string
    blueprint?: Record<string, unknown>
  }
}

export async function getTaskStatus(taskId: string) {
  const res = await fetch(`/.netlify/functions/status?taskId=${encodeURIComponent(taskId)}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Status request failed (${res.status})`)
  return body as { status: 'waiting' | 'generating' | 'success' | 'fail'; imageUrl?: string; error?: string }
}

export async function getCredits() {
  const res = await fetch('/.netlify/functions/credits')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Credits request failed (${res.status})`)
  return body as { credits: number }
}

export function downloadProxyUrl(url: string, filename: string) {
  return `/.netlify/functions/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
}
