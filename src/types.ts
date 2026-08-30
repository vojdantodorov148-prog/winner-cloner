export type NavKey = 'generate' | 'winners' | 'products' | 'results' | 'settings'

export type ProductLinks = {
  landing: string
  advertorial: string
  offerPage: string
  checkout: string
}

export type Product = {
  id: string
  name: string
  brand: string
  category: string
  summary: string
  description: string
  mechanism: string
  benefits: string
  objections: string
  audience: string
  offer: string
  guarantee: string
  guardrails: string
  notes: string
  links: ProductLinks
  assetIds: string[]
  createdAt: string
  updatedAt: string
}

export type Winner = {
  id: string
  name: string
  sourceMarket: string
  platform: string
  adType: string
  format: string
  tags: string
  notes: string
  assetId: string
  createdAt: string
  updatedAt: string
}

export type ResultImage = {
  taskId: string
  variation: number
  status: 'waiting' | 'generating' | 'success' | 'fail'
  imageUrl?: string
  error?: string
  retryCount?: number
  modelUsed?: string
}

export type Job = {
  id: string
  winnerId: string
  productId: string
  market: string
  outputLanguage: string
  aspectRatio: string
  model: string
  variations: number
  cloneStrength: number
  extraNotes: string
  status: 'queued' | 'analyzing' | 'prompting' | 'generating' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  blueprint?: Record<string, unknown>
  promptSummary?: string
  results: ResultImage[]
}

export type AppState = {
  products: Product[]
  winners: Winner[]
  jobs: Job[]
  defaults: {
    market: string
    outputLanguage: string
    aspectRatio: string
    model: string
    variations: number
    cloneStrength: number
  }
}

export type StoredAsset = {
  id: string
  name: string
  type: string
  dataUrl: string
  createdAt: string
}
