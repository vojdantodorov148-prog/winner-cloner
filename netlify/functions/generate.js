const crypto = require('crypto')
const dns = require('dns').promises
const net = require('net')

const KIE_BASE = 'https://api.kie.ai'
const UPLOAD_BASE = 'https://kieai.redpandaai.co'
const PROMPT_MASTER_TIMEOUT_MS = Number(process.env.PROMPT_MASTER_TIMEOUT_MS || 18000)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  const key = process.env.KIE_API_KEY
  if (!key) return json(500, { error: 'Missing KIE_API_KEY in Netlify environment variables.' })

  try {
    const startedAt = Date.now()
    const body = JSON.parse(event.body || '{}')
    validate(body)

    // Run independent preparation work in parallel. This keeps the synchronous
    // Netlify function comfortably below its execution window in normal cases.
    const uploadsPromise = Promise.all([
      uploadDataUrl(body.winnerImage, `winner-${crypto.randomUUID()}.webp`, key),
      ...body.productImages.slice(0, 5).map((data, i) => uploadDataUrl(data, `product-${i + 1}-${crypto.randomUUID()}.webp`, key)),
    ])
    const pageContextPromise = collectPageContext(body.product.links || {})
    const [[winnerUrl, ...productUrls], pageContext] = await Promise.all([uploadsPromise, pageContextPromise])
    console.log('Winner Cloner v1.0.4 preparation ms', Date.now() - startedAt)

    const master = await runPromptMaster({ ...body, winnerUrl, productUrls, pageContext }, key)

    const refs = [winnerUrl, ...productUrls]
    const requested = Math.max(1, Math.min(Number(body.variations) || 1, 6))
    const taskFactories = Array.from({ length: requested }, (_, i) => async () => {
      const variation = master.variations?.[i] || master.variations?.[i % Math.max(master.variations?.length || 1, 1)] || {}
      const rawPrompt = [
        master.final_image_prompt,
        variation?.instruction ? `\nVARIATION ${i + 1}: ${variation.instruction}` : `\nVARIATION ${i + 1}: Preserve the exact concept while making only subtle, meaningful visual variation.`,
        `\nOUTPUT REQUIREMENT: aspect ratio ${body.aspectRatio}. Render a finished static ad, not a mockup.`,
      ].join('')
      const prompt = fitPromptForModel(rawPrompt, body.model)
      return createImageTask(body.model, prompt, refs, body.aspectRatio, key)
    })
    const taskAttempts = await runSettledInBatches(taskFactories, 6)
    console.log('Winner Cloner v1.0.4 total create ms', Date.now() - startedAt, 'promptMode', master.mode || 'unknown')

    const taskIds = taskAttempts.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    const failed = taskAttempts.filter((r) => r.status === 'rejected')
    if (!taskIds.length) {
      const message = failed.map((r) => cleanError(r.reason)).filter(Boolean).join(' | ')
      throw new Error(message || 'Kie could not create any image generation tasks.')
    }

    return json(200, {
      taskIds,
      warning: failed.length ? `${failed.length} of ${requested} image tasks could not be created. The successful tasks will continue.` : undefined,
      promptSummary: master.summary || 'Prompt Master completed winner analysis and product adaptation.',
      blueprint: master.blueprint || {},
      promptMode: master.mode || 'ai',
    })
  } catch (err) {
    console.error(err)
    return json(500, { error: cleanError(err) })
  }
}

function validate(body) {
  if (!body?.winnerImage || !String(body.winnerImage).startsWith('data:image/')) throw new Error('Winner image is missing or invalid.')
  if (!Array.isArray(body.productImages) || !body.productImages.length) throw new Error('At least one product image is required.')
  if (body.productImages.some((x) => !String(x || '').startsWith('data:image/'))) throw new Error('One or more product images are invalid.')
  if (!body.product?.name) throw new Error('Product profile is missing.')
  const supportedModels = ['nano-banana-pro', 'nano-banana-2', 'gpt-image-2-image-to-image', 'grok-imagine-image-2-0/image-edit', 'grok-imagine-image-2-0/image-to-image']
  if (!supportedModels.includes(body.model)) throw new Error(`Unsupported image model: ${body.model || 'missing'}`)
  const supportedRatios = ['4:5', '1:1', '9:16', '16:9']
  if (!supportedRatios.includes(body.aspectRatio)) throw new Error(`Unsupported aspect ratio: ${body.aspectRatio || 'missing'}`)
  const variations = Number(body.variations)
  if (!Number.isFinite(variations) || variations < 1 || variations > 6) throw new Error('Variations must be between 1 and 6.')
}

async function uploadDataUrl(dataUrl, filename, key) {
  const { response, data } = await fetchJsonWithRetry(`${UPLOAD_BASE}/api/file-base64-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data: dataUrl, uploadPath: 'winner-cloner', fileName: filename }),
  }, { timeoutMs: 7000, retries: 1 })
  if (!response.ok || data.success === false) throw new Error(`Kie file upload failed: ${data.msg || response.status}`)
  const url = data?.data?.downloadUrl || data?.data?.fileUrl
  if (!url) throw new Error('Kie upload did not return a file URL.')
  return url
}

async function runPromptMaster(ctx, key) {
  const product = ctx.product || {}
  const strength = Number(ctx.cloneStrength) || 90
  const fidelityInstruction = strength >= 90
    ? 'Extremely close structural clone: preserve composition, copy-block count, hierarchy, relative sizing, placement, visual rhythm and persuasive sequence. Change only what must change for the new product and market.'
    : strength >= 75
      ? 'Close controlled clone: keep the same concept and structure, allowing only small changes in supporting visual details.'
      : strength >= 55
        ? 'Inspired adaptation: preserve the core concept and persuasion mechanism but allow a noticeably fresh execution.'
        : 'Loose concept adaptation: use the winner mainly as strategic inspiration while maintaining recognizable concept logic.'

  // Keep the hidden Prompt Master compact enough to complete inside a single
  // Netlify synchronous request. The old v1.0.3 could chain Pro -> Pro -> Flash,
  // making a 60s Netlify 504 mathematically possible even when every timeout
  // behaved exactly as configured.
  const prompt = `
You are PROMPT MASTER, an expert Meta static-ad copywriter, creative strategist and visual reverse-engineer for direct-response ecommerce.

MANDATORY PROCESS:
1. Analyze reference image #1 (the winning ad) first and treat it as the structural source of truth.
2. Extract its composition, exact copy-block count/length, hierarchy, product/subject placement, badges/icons, background treatment, photographic/design style, persuasive mechanism, offer presentation and CTA logic.
3. Rebuild that same concept for the selected product and target market using the real product information below.
4. Reference images #2 onward are the actual product/packaging references. Reproduce them faithfully; do not redesign packaging, logo, colors or proportions.
5. Keep text quantity faithful to the winner. Never add extra paragraphs, tiny footer copy, badges or icons unless the winner structurally calls for them.
6. Write natural market-native copy for ${clip(ctx.market, 120)}. Output language: ${clip(ctx.outputLanguage, 120)}.
7. Do not invent unsupported factual claims. Follow guardrails.
8. Return a finished static ad concept, not a mockup, wireframe, collage or explanation.

CLONE STRENGTH: ${strength}%
${fidelityInstruction}

WINNER:
Name: ${clip(ctx.winner?.name, 220)}
Source market: ${clip(ctx.winner?.sourceMarket, 120)}
Ad type: ${clip(ctx.winner?.adType, 120)}
Format: ${clip(ctx.winner?.format, 60)}
Tags/notes: ${clip(`${ctx.winner?.tags || ''} ${ctx.winner?.notes || ''}`, 1200)}

PRODUCT:
Name: ${clip(product.name, 220)}
Brand/category: ${clip(`${product.brand || ''} / ${product.category || ''}`, 300)}
Summary: ${clip(product.summary, 1200)}
Explanation: ${clip(product.description, 2600)}
Mechanism: ${clip(product.mechanism, 1800)}
Benefits: ${clip(product.benefits, 1800)}
Audience: ${clip(product.audience, 1200)}
Objections: ${clip(product.objections, 1200)}
Offer/guarantee: ${clip(`${product.offer || ''} ${product.guarantee || ''}`, 1200)}
Guardrails: ${clip(product.guardrails, 1200)}
Research/notes: ${clip(product.notes, 1800)}

PAGE CONTEXT:
${clip(ctx.pageContext || 'No page text available.', 10000)}

SETTINGS:
Target market: ${clip(ctx.market, 120)}
Output language: ${clip(ctx.outputLanguage, 120)}
Aspect ratio: ${ctx.aspectRatio}
Extra instructions: ${clip(ctx.extraNotes || 'None', 1800)}

OUTPUT REQUIREMENT:
Return JSON with only summary and final_image_prompt. final_image_prompt is mandatory, production-ready, under 5200 characters, and must contain the exact adapted ad copy plus explicit reference-image roles, layout/hierarchy, product fidelity, text-density and aspect-ratio instructions.
`.trim()

  const content = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: ctx.winnerUrl } },
    ...ctx.productUrls.slice(0, 4).map((url) => ({ type: 'image_url', image_url: { url } })),
  ]

  const request = {
    messages: [{ role: 'user', content }],
    stream: false,
    reasoning_effort: 'medium',
    response_format: promptMasterResponseFormat(),
  }

  try {
    // ONE AI call maximum. 18s hard cap leaves ample room for uploads and
    // createTask before Netlify's non-configurable 60s synchronous limit.
    const { response, data } = await postPromptMaster(request, key, PROMPT_MASTER_TIMEOUT_MS, 'gemini-2.5-pro')
    if (response.ok) {
      const parsed = extractPromptMasterPayload(data)
      if (hasUsableFinalPrompt(parsed)) {
        return { ...normalizePromptMasterPayload(parsed), mode: 'ai' }
      }
      const rawText = extractAssistantText(data)
      if (isUsablePromptText(rawText)) {
        return {
          ...normalizePromptMasterPayload({
            summary: 'Prompt Master completed winner analysis and product adaptation.',
            final_image_prompt: cleanAssistantPrompt(rawText),
          }),
          mode: 'ai-text',
        }
      }
      console.warn('Prompt Master returned no usable prompt; using deterministic master fallback', summarizeResponseShape(data))
    } else {
      console.warn('Prompt Master HTTP failure; using deterministic master fallback', response.status, data?.msg || data?.error?.message || '')
    }
  } catch (err) {
    console.warn('Prompt Master timed out/failed; using deterministic master fallback', cleanError(err))
  }

  // This is not "Prompt Master off". The exact same mandatory Prompt Master
  // rules are compiled into the downstream image-model prompt, and the winner
  // + product references are still supplied to the image model. It exists only
  // to make provider latency non-fatal.
  return { ...buildDeterministicPromptMasterFallback(ctx, strength, fidelityInstruction), mode: 'deterministic-fallback' }
}

function promptMasterResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'prompt_master_payload',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          final_image_prompt: { type: 'string' },
        },
        required: ['summary', 'final_image_prompt'],
      },
    },
  }
}

function hasUsableFinalPrompt(parsed) {
  return Boolean(parsed?.final_image_prompt && isUsablePromptText(String(parsed.final_image_prompt)))
}

function normalizePromptMasterPayload(parsed) {
  return {
    summary: String(parsed?.summary || 'Prompt Master completed winner analysis and product adaptation.'),
    blueprint: parsed?.blueprint && typeof parsed.blueprint === 'object' ? parsed.blueprint : {},
    final_image_prompt: cleanAssistantPrompt(String(parsed?.final_image_prompt || '')),
    variations: normalizeVariations(parsed?.variations),
  }
}

function buildDeterministicPromptMasterFallback(ctx, strength, fidelityInstruction) {
  const p = ctx.product || {}
  const final = `
PROMPT MASTER — WINNER CLONE PRODUCTION PROMPT

REFERENCE ROLES:
- Reference image #1 is the winning ad. Treat it as the structural and visual source of truth: preserve its composition, hierarchy, number of text blocks, relative text sizes, visual rhythm, subject/product placement, CTA logic, trust elements, background treatment and persuasive sequence.
- Reference images #2 onward are the real ${p.name || 'product'} identity/packaging references. Reproduce the actual product faithfully; do not redesign packaging, logo, colors, proportions or label details.

CLONE FIDELITY: ${strength}%.
${fidelityInstruction}

ADAPTATION:
Create the same winning concept for ${p.name || 'the selected product'}${p.brand ? ` by ${p.brand}` : ''} for the ${ctx.market} market. Output language: ${ctx.outputLanguage}. Requested aspect ratio: ${ctx.aspectRatio}.
Product summary: ${p.summary || ''}
Product explanation: ${p.description || ''}
Mechanism: ${p.mechanism || ''}
Benefits: ${p.benefits || ''}
Audience: ${p.audience || ''}
Objections: ${p.objections || ''}
Offer: ${p.offer || ''}
Guarantee: ${p.guarantee || ''}
Guardrails: ${p.guardrails || ''}
Research/notes: ${p.notes || ''}
Extra instructions: ${ctx.extraNotes || 'None'}

COPY RULES:
Infer the winning ad's copy architecture from reference image #1 and write only the amount of copy that architecture requires. Keep the adapted copy market-native, direct-response oriented, concise and easy to read. Do not invent unsupported factual claims. Never add extra tiny footer copy, paragraphs, badges or icons that the winner does not structurally call for.

VISUAL RULES:
Recreate the winner's layout and styling rather than inventing a generic ad. Preserve headline position, visual hierarchy, product/subject scale, spacing, balance, background feel, badge/icon logic and overall native/premium level. Replace only the original product-specific elements with the selected product and appropriate adapted copy. Render a polished finished static ad, not a mockup, wireframe, prompt sheet or collage.

OUTPUT: one finished ${ctx.aspectRatio} static ad creative.
`.trim()

  return {
    summary: 'Prompt Master safety mode preserved the winner structure and product context.',
    blueprint: {},
    final_image_prompt: fitPromptForModel(final, ctx.model),
    variations: [],
  }
}

async function postPromptMaster(body, key, timeoutMs, model = 'gemini-2.5-pro') {
  const endpoint = model === 'gemini-2.5-flash' ? 'gemini-2.5-flash' : 'gemini-2.5-pro'
  return fetchJsonWithRetry(`${KIE_BASE}/${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs, retries: 0 })
}

async function createImageTask(model, prompt, refs, aspectRatio, key) {
  const effectiveModel = normalizeImageModel(model)
  let input
  if (effectiveModel === 'nano-banana-pro' || effectiveModel === 'nano-banana-2') {
    input = { prompt, image_input: refs.slice(0, 6), aspect_ratio: aspectRatio, resolution: '1K', output_format: 'png' }
  } else if (effectiveModel === 'gpt-image-2-image-to-image') {
    input = { prompt, input_urls: refs.slice(0, 5), aspect_ratio: aspectRatio }
  } else if (effectiveModel === 'grok-imagine-image-2-0/image-to-image') {
    input = { prompt, image_urls: refs.slice(0, 5), aspect_ratio: aspectRatio }
  } else {
    throw new Error(`Unsupported image model: ${model}`)
  }

  const { response, data } = await fetchJsonWithRetry(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: effectiveModel, input }),
  }, { timeoutMs: 7000, retries: 0 })
  if (!response.ok || (data.code && Number(data.code) !== 200)) throw new Error(`Image task failed: ${data.msg || response.status}`)
  const id = data?.data?.taskId
  if (!id) throw new Error('Image task did not return a taskId.')
  return id
}

async function collectPageContext(links) {
  const entries = Object.entries(links).filter(([, url]) => /^https?:\/\//i.test(String(url || '')))
  if (!entries.length) return ''
  const chunks = await Promise.all(entries.slice(0, 4).map(async ([label, url]) => {
    try {
      const text = await fetchSafePage(String(url))
      return `\n--- ${label.toUpperCase()} ---\n${text.slice(0, 4500)}`
    } catch (e) {
      return `\n--- ${label.toUpperCase()} ---\n[Could not fetch this page: ${cleanError(e)}]`
    }
  }))
  return chunks.join('\n').slice(0, 10000)
}

async function fetchSafePage(rawUrl) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('Local addresses are blocked')
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private network addresses are blocked')
  if (!net.isIP(host)) {
    const resolved = await withTimeout(dns.lookup(host, { all: true }), 1800, 'DNS lookup timed out')
    if (resolved.some((r) => isPrivateIp(r.address))) throw new Error('Private network addresses are blocked')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'WinnerCloner/1.0.4' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) throw new Error('Page is not text/HTML')
    const html = await response.text()
    return htmlToText(html)
  } finally {
    clearTimeout(timer)
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function isPrivateIp(ip) {
  if (ip.includes(':')) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')
  const p = ip.split('.').map(Number)
  return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0
}

function extractPromptMasterPayload(data) {
  const message = data?.choices?.[0]?.message
  const candidates = [
    message?.parsed,
    message?.content,
    message?.text,
    data?.output,
    data?.result,
    data?.data,
  ]

  for (const candidate of candidates) {
    const found = findPromptMasterObject(candidate)
    if (found) return found
  }

  // Last-resort scan of the full response. This intentionally only accepts an
  // object that contains a recognized prompt field, so metadata cannot be
  // mistaken for the Prompt Master payload.
  return findPromptMasterObject(data)
}

function findPromptMasterObject(value, depth = 0) {
  if (depth > 8 || value == null) return null

  if (typeof value === 'string') {
    const parsed = tryParseJson(value)
    return parsed == null ? null : findPromptMasterObject(parsed, depth + 1)
  }

  if (Array.isArray(value)) {
    // Common multimodal shape: [{ type: 'text', text: '{...json...}' }]
    for (const part of value) {
      if (typeof part === 'string') {
        const found = findPromptMasterObject(part, depth + 1)
        if (found) return found
      } else if (part && typeof part === 'object') {
        for (const field of ['text', 'content', 'value', 'output_text']) {
          if (part[field] != null) {
            const found = findPromptMasterObject(part[field], depth + 1)
            if (found) return found
          }
        }
        const found = findPromptMasterObject(part, depth + 1)
        if (found) return found
      }
    }
    return null
  }

  if (typeof value !== 'object') return null

  const finalPrompt =
    value.final_image_prompt ??
    value.finalImagePrompt ??
    value.image_prompt ??
    value.imagePrompt ??
    value.final_prompt ??
    value.finalPrompt

  if (typeof finalPrompt === 'string' && finalPrompt.trim()) {
    return {
      ...value,
      final_image_prompt: finalPrompt,
      summary: value.summary ?? value.prompt_summary ?? value.promptSummary,
      blueprint: value.blueprint ?? value.creative_blueprint ?? value.creativeBlueprint,
      variations: value.variations ?? value.variation_instructions ?? value.variationInstructions,
    }
  }

  // Some providers put the structured response one level deeper under a
  // generic key such as response/result/output/json/content.
  for (const key of ['response', 'result', 'output', 'json', 'content', 'data', 'message']) {
    if (value[key] != null) {
      const found = findPromptMasterObject(value[key], depth + 1)
      if (found) return found
    }
  }

  return null
}

function tryParseJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/, '')
    .trim()

  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch {}

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) } catch {}
  }
  return null
}

function normalizeVariations(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return { instruction: item }
      if (!item || typeof item !== 'object') return null
      const instruction = item.instruction ?? item.prompt ?? item.description ?? item.text
      return instruction ? { instruction: String(instruction) } : null
    })
    .filter(Boolean)
    .slice(0, 6)
}

function extractAssistantText(data) {
  const message = data?.choices?.[0]?.message
  const candidates = [message?.content, message?.text, data?.output_text, data?.output]
  for (const candidate of candidates) {
    const text = flattenText(candidate).trim()
    if (text) return text
  }
  return ''
}

function flattenText(value, depth = 0) {
  if (depth > 8 || value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((x) => flattenText(x, depth + 1)).filter(Boolean).join('\n')
  if (typeof value !== 'object') return ''

  const preferred = ['text', 'content', 'output_text', 'value']
  const parts = []
  for (const key of preferred) {
    if (value[key] != null) {
      const text = flattenText(value[key], depth + 1)
      if (text) parts.push(text)
    }
  }
  if (parts.length) return parts.join('\n')
  return ''
}

function cleanAssistantPrompt(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json|text|markdown)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

function isUsablePromptText(text) {
  const value = cleanAssistantPrompt(text)
  if (value.length < 80) return false
  if (/^(?:sorry|i\s+can(?:not|'t)|unable to)/i.test(value)) return false
  return true
}

function summarizeResponseShape(data) {
  try {
    const message = data?.choices?.[0]?.message
    return {
      topLevelKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      messageKeys: message && typeof message === 'object' ? Object.keys(message) : [],
      contentType: Array.isArray(message?.content) ? 'array' : typeof message?.content,
      contentParts: Array.isArray(message?.content)
        ? message.content.map((part) => part && typeof part === 'object' ? Object.keys(part) : typeof part)
        : undefined,
      finishReason: data?.choices?.[0]?.finish_reason,
    }
  } catch {
    return { shape: 'unavailable' }
  }
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
  throw new Error('Prompt Master returned invalid JSON.')
}

function normalizeImageModel(model) {
  return model === 'grok-imagine-image-2-0/image-edit' ? 'grok-imagine-image-2-0/image-to-image' : model
}

function promptLimitForModel(model) {
  return normalizeImageModel(model) === 'grok-imagine-image-2-0/image-to-image' ? 4200 : 7500
}

function fitPromptForModel(prompt, model) {
  const max = promptLimitForModel(model)
  const text = String(prompt || '').trim()
  if (text.length <= max) return text
  const suffix = '\n[Prompt compacted automatically for model reliability. Preserve all reference-image, copy and layout rules above.]'
  const available = Math.max(500, max - suffix.length)
  const cut = text.slice(0, available)
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  const safe = boundary > available * 0.72 ? cut.slice(0, boundary + 1) : cut
  return `${safe}${suffix}`.slice(0, max)
}

async function fetchJsonWithRetry(url, options, { timeoutMs = 15000, retries = 1 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      const transient = response.status === 429 || response.status >= 500
      if (transient && attempt < retries) {
        await sleep(800 * (2 ** attempt))
        continue
      }
      return { response, data }
    } catch (err) {
      lastError = err
      if (attempt >= retries) throw err
      await sleep(800 * (2 ** attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('Kie request failed.')
}

async function runSettledInBatches(factories, batchSize) {
  const out = []
  for (let i = 0; i < factories.length; i += batchSize) {
    out.push(...await Promise.allSettled(factories.slice(i, i + batchSize).map((fn) => fn())))
  }
  return out
}

function clip(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 24))} …[context clipped]`
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function cleanError(err) {
  return err instanceof Error ? err.message : String(err || 'Unknown error')
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }
}
