const crypto = require('crypto')
const dns = require('dns').promises
const net = require('net')

const KIE_BASE = 'https://api.kie.ai'
const UPLOAD_BASE = 'https://kieai.redpandaai.co'

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  const key = process.env.KIE_API_KEY
  if (!key) return json(500, { error: 'Missing KIE_API_KEY in Netlify environment variables.' })

  try {
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
  }, { timeoutMs: 8000, retries: 1 })
  if (!response.ok || data.success === false) throw new Error(`Kie file upload failed: ${data.msg || response.status}`)
  const url = data?.data?.downloadUrl || data?.data?.fileUrl
  if (!url) throw new Error('Kie upload did not return a file URL.')
  return url
}

async function runPromptMaster(ctx, key) {
  const product = ctx.product
  const strength = Number(ctx.cloneStrength) || 90
  const fidelityInstruction = strength >= 90
    ? 'Extremely close structural clone: preserve the original composition, number of copy blocks, hierarchy, relative sizing, placement, visual rhythm and persuasive sequence. Change only what must change for the new product and market.'
    : strength >= 75
      ? 'Close controlled clone: keep the same concept and structure, while allowing small changes in supporting visual details.'
      : strength >= 55
        ? 'Inspired adaptation: preserve the core concept and persuasion mechanism but allow a noticeably fresh execution.'
        : 'Loose concept adaptation: use the winner mainly as strategic inspiration while maintaining recognizable concept logic.'

  const prompt = `
You are PROMPT MASTER, an expert Meta static-ad copywriter, creative strategist and visual reverse-engineer for direct-response ecommerce.

NON-NEGOTIABLE WORKFLOW:
1) Analyze the attached WINNING AD first. Treat it as the structural source of truth.
2) Extract its exact advertising architecture: aspect ratio, composition, headline/subheadline/body/CTA count, copy length, visual hierarchy, typography behavior, product/subject placement, badges, icons, background, photographic style, persuasive mechanism, offer presentation and trust elements.
3) Rebuild that same high-performing concept for the PRODUCT CONTEXT below.
4) Preserve the winner's structure and persuasive flow. Do not turn it into a generic new ad.
5) Write market-native copy for ${ctx.market}. Output language: ${ctx.outputLanguage}.
6) Use the product's actual information, offer, guarantee, objections and guardrails. Do not invent unsupported factual claims.
7) The final image prompt must explicitly tell the image model that reference image #1 is the winning-ad layout/style reference and the remaining reference images are the actual product identity/packaging references.
8) The product in the generated creative must visually match the supplied product reference images. Do not redesign the packaging unless the user explicitly asks.
9) Keep text quantity faithful to the original winner. If the winner has only a headline and one short supporting line, do not add paragraphs, footers or extra tiny copy.
10) Generate a finished ad creative, not a wireframe, not an explanation, not a collage of references.

CLONE STRENGTH: ${strength}%
${fidelityInstruction}

WINNER METADATA:
Name: ${ctx.winner.name || ''}
Source market: ${ctx.winner.sourceMarket || ''}
Platform: ${ctx.winner.platform || ''}
Ad type: ${ctx.winner.adType || ''}
Original format: ${ctx.winner.format || ''}
Tags: ${ctx.winner.tags || ''}
Winner notes: ${ctx.winner.notes || ''}

PRODUCT CONTEXT:
Product: ${product.name}
Brand: ${product.brand || ''}
Category: ${product.category || ''}
One-line summary: ${product.summary || ''}
Full explanation: ${product.description || ''}
Mechanism / how it works: ${product.mechanism || ''}
Benefits: ${product.benefits || ''}
Audience / avatar: ${product.audience || ''}
Customer objections / fears / critiques: ${product.objections || ''}
Offer: ${product.offer || ''}
Guarantee: ${product.guarantee || ''}
Guardrails / forbidden claims / visual rules: ${product.guardrails || ''}
Research & notes: ${product.notes || ''}

PAGE CONTEXT EXTRACTED FROM PROVIDED LINKS:
${ctx.pageContext || 'No page text was available.'}

GENERATION SETTINGS:
Target market: ${ctx.market}
Output language: ${ctx.outputLanguage}
Requested aspect ratio: ${ctx.aspectRatio}
Extra user instructions: ${ctx.extraNotes || 'None'}

FINAL PROMPT RELIABILITY RULE:
Keep final_image_prompt complete but concise. It must stay under ${promptLimitForModel(ctx.model)} characters so the downstream image model cannot reject it for excessive prompt length. Prioritize exact ad copy, reference roles, layout, hierarchy, product fidelity and visual execution over redundant prose.

Return ONLY valid JSON with this exact top-level shape:
{
  "summary": "brief human-readable summary of what was extracted and how it will be adapted",
  "blueprint": {
    "layout": "...",
    "copy_structure": "...",
    "visual_style": "...",
    "persuasion_mechanism": "...",
    "product_placement": "...",
    "trust_elements": "...",
    "text_density": "..."
  },
  "final_image_prompt": "one extremely detailed production prompt for the selected image model, including the exact new ad copy to render and strict reference-image instructions",
  "variations": [
    {"instruction":"subtle variation instruction that keeps the same winning concept"},
    {"instruction":"different but controlled variation"},
    {"instruction":"different but controlled variation"},
    {"instruction":"different but controlled variation"},
    {"instruction":"different but controlled variation"},
    {"instruction":"different but controlled variation"}
  ]
}
`

  const content = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: ctx.winnerUrl } },
    ...ctx.productUrls.slice(0, 4).map((url) => ({ type: 'image_url', image_url: { url } })),
  ]

  const masterRequest = {
    messages: [{ role: 'user', content }],
    stream: false,
    reasoning_effort: 'high',
    response_format: {
      type: 'json_schema',
      properties: {
        summary: { type: 'string' },
        blueprint: {
          type: 'object',
          properties: {
            layout: { type: 'string' },
            copy_structure: { type: 'string' },
            visual_style: { type: 'string' },
            persuasion_mechanism: { type: 'string' },
            product_placement: { type: 'string' },
            trust_elements: { type: 'string' },
            text_density: { type: 'string' },
          },
        },
        final_image_prompt: { type: 'string' },
        variations: {
          type: 'array',
          items: {
            type: 'object',
            properties: { instruction: { type: 'string' } },
            required: ['instruction'],
          },
        },
      },
      required: ['summary', 'blueprint', 'final_image_prompt', 'variations'],
    },
  }

  let { response, data } = await postPromptMaster(masterRequest, key, 30000)
  // Kie's structured-output envelope has changed shape across documentation
  // revisions. If that optional parameter is rejected, fall back once to the
  // same Prompt Master instruction without response_format. The prompt itself
  // still requires JSON and the parser below validates the mandatory field.
  if (!response.ok && [400, 422].includes(response.status)) {
    const fallbackRequest = { ...masterRequest }
    delete fallbackRequest.response_format
    ;({ response, data } = await postPromptMaster(fallbackRequest, key, 22000))
  }
  if (!response.ok) throw new Error(`Prompt Master failed: ${data?.error?.message || data?.msg || response.status}`)

  // Kie normally returns OpenAI-style message.content as a string, but some
  // successful multimodal responses return content as an array/object. The
  // old parser stringified that wrapper and then mistook it for the Prompt
  // Master JSON itself, which produced the "incomplete prompt" error.
  let parsed = extractPromptMasterPayload(data)

  // Automatic recovery: if the provider returned a successful but oddly
  // wrapped/incomplete structured response, ask Prompt Master once more for
  // the final production payload instead of failing the user's generation.
  if (!parsed?.final_image_prompt || !String(parsed.final_image_prompt).trim()) {
    console.warn('Prompt Master first response needs recovery', summarizeResponseShape(data))
    parsed = await recoverPromptMaster(content, key)
  }

  if (!parsed?.final_image_prompt || !String(parsed.final_image_prompt).trim()) {
    console.error('Prompt Master recovery still missing final_image_prompt')
    throw new Error('Prompt Master could not produce the final image prompt after an automatic retry. Open the Netlify function log for generate and retry the job.')
  }

  return {
    summary: String(parsed.summary || 'Prompt Master completed winner analysis and product adaptation.'),
    blueprint: parsed.blueprint && typeof parsed.blueprint === 'object' ? parsed.blueprint : {},
    final_image_prompt: String(parsed.final_image_prompt).trim(),
    variations: normalizeVariations(parsed.variations),
  }
}

async function recoverPromptMaster(originalContent, key) {
  const recoveryInstruction = {
    type: 'text',
    text: `RECOVERY INSTRUCTION: Produce the final Prompt Master payload now. Return ONLY JSON. The key final_image_prompt is mandatory and must contain a complete, detailed production prompt with the exact ad copy to render, reference-image roles, layout/hierarchy rules, product fidelity rules, market adaptation, and aspect-ratio requirement. Also return summary, blueprint and variations. Do not omit final_image_prompt.`,
  }

  const recoveryRequest = {
    messages: [{ role: 'user', content: [...originalContent, recoveryInstruction] }],
    stream: false,
    reasoning_effort: 'medium',
    response_format: {
      type: 'json_schema',
      properties: {
        summary: { type: 'string' },
        blueprint: { type: 'object' },
        final_image_prompt: { type: 'string' },
        variations: {
          type: 'array',
          items: {
            type: 'object',
            properties: { instruction: { type: 'string' } },
            required: ['instruction'],
          },
        },
      },
      required: ['summary', 'blueprint', 'final_image_prompt', 'variations'],
    },
  }
  let { response, data } = await postPromptMaster(recoveryRequest, key, 16000)
  if (!response.ok && [400, 422].includes(response.status)) {
    const fallbackRequest = { ...recoveryRequest }
    delete fallbackRequest.response_format
    ;({ response, data } = await postPromptMaster(fallbackRequest, key, 12000))
  }
  if (!response.ok) {
    console.error('Prompt Master recovery request failed', data?.error?.message || data?.msg || response.status)
    return null
  }
  return extractPromptMasterPayload(data)
}

async function postPromptMaster(body, key, timeoutMs) {
  return fetchJsonWithRetry(`${KIE_BASE}/gemini-2.5-pro/v1/chat/completions`, {
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
  } else if (effectiveModel === 'grok-imagine-image-2-0/image-edit') {
    input = { prompt, image_urls: refs.slice(0, 5), aspect_ratio: aspectRatio }
  } else {
    throw new Error(`Unsupported image model: ${model}`)
  }

  const { response, data } = await fetchJsonWithRetry(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: effectiveModel, input }),
  }, { timeoutMs: 8000, retries: 0 })
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
      return `\n--- ${label.toUpperCase()} ---\n${text.slice(0, 10000)}`
    } catch (e) {
      return `\n--- ${label.toUpperCase()} ---\n[Could not fetch this page: ${cleanError(e)}]`
    }
  }))
  return chunks.join('\n').slice(0, 28000)
}

async function fetchSafePage(rawUrl) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('Local addresses are blocked')
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private network addresses are blocked')
  if (!net.isIP(host)) {
    const resolved = await dns.lookup(host, { all: true })
    if (resolved.some((r) => isPrivateIp(r.address))) throw new Error('Private network addresses are blocked')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'WinnerCloner/1.0.2' } })
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
  return model === 'grok-imagine-image-2-0/image-to-image' ? 'grok-imagine-image-2-0/image-edit' : model
}

function promptLimitForModel(model) {
  return normalizeImageModel(model) === 'grok-imagine-image-2-0/image-edit' ? 4200 : 7500
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function cleanError(err) {
  return err instanceof Error ? err.message : String(err || 'Unknown error')
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }
}
