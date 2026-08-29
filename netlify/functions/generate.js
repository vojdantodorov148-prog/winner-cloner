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

    const [winnerUrl, ...productUrls] = await Promise.all([
      uploadDataUrl(body.winnerImage, `winner-${crypto.randomUUID()}.webp`, key),
      ...body.productImages.slice(0, 5).map((data, i) => uploadDataUrl(data, `product-${i + 1}-${crypto.randomUUID()}.webp`, key)),
    ])

    const pageContext = await collectPageContext(body.product.links || {})
    const master = await runPromptMaster({ ...body, winnerUrl, productUrls, pageContext }, key)

    const taskIds = []
    const refs = [winnerUrl, ...productUrls]
    const requested = Math.max(1, Math.min(Number(body.variations) || 1, 6))
    for (let i = 0; i < requested; i++) {
      const variation = master.variations?.[i] || master.variations?.[i % Math.max(master.variations?.length || 1, 1)] || {}
      const prompt = [
        master.final_image_prompt,
        variation?.instruction ? `\nVARIATION ${i + 1}: ${variation.instruction}` : `\nVARIATION ${i + 1}: Preserve the exact concept while making only subtle, meaningful visual variation.`,
        `\nOUTPUT REQUIREMENT: aspect ratio ${body.aspectRatio}. Render a finished static ad, not a mockup.`,
      ].join('')
      taskIds.push(await createImageTask(body.model, prompt, refs, body.aspectRatio, key))
    }

    return json(200, {
      taskIds,
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
  if (!body.product?.name) throw new Error('Product profile is missing.')
  if (!body.model) throw new Error('Image model is missing.')
}

async function uploadDataUrl(dataUrl, filename, key) {
  const response = await fetch(`${UPLOAD_BASE}/api/file-base64-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data: dataUrl, uploadPath: 'winner-cloner', fileName: filename }),
  })
  const data = await response.json().catch(() => ({}))
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

  const response = await fetch(`${KIE_BASE}/gemini-2.5-pro/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      stream: false,
      reasoning_effort: 'high',
      response_format: {
        type: 'json_schema',
        properties: {
          summary: { type: 'string' },
          blueprint: { type: 'object' },
          final_image_prompt: { type: 'string' },
          variations: { type: 'array', items: { type: 'object' } },
        },
        required: ['summary', 'blueprint', 'final_image_prompt', 'variations'],
      },
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Prompt Master failed: ${data?.error?.message || data?.msg || response.status}`)
  let text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') text = JSON.stringify(text || '')
  const parsed = parseJson(text)
  if (!parsed.final_image_prompt) throw new Error('Prompt Master returned an incomplete prompt.')
  return parsed
}

async function createImageTask(model, prompt, refs, aspectRatio, key) {
  let input
  if (model === 'nano-banana-pro' || model === 'nano-banana-2') {
    input = { prompt, image_input: refs.slice(0, 6), aspect_ratio: aspectRatio, resolution: '1K', output_format: 'png' }
  } else if (model === 'gpt-image-2-image-to-image') {
    input = { prompt, input_urls: refs.slice(0, 5), aspect_ratio: aspectRatio }
  } else if (model === 'grok-imagine-image-2-0/image-to-image') {
    input = { prompt, image_urls: refs.slice(0, 5), aspect_ratio: aspectRatio }
  } else {
    throw new Error(`Unsupported image model: ${model}`)
  }

  const response = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.code && data.code !== 200) throw new Error(`Image task failed: ${data.msg || response.status}`)
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
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'WinnerCloner/1.0' } })
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

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
  throw new Error('Prompt Master returned invalid JSON.')
}

function cleanError(err) {
  return err instanceof Error ? err.message : String(err || 'Unknown error')
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }
}
