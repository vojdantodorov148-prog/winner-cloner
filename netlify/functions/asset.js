const KIE_BASE = 'https://api.kie.ai'
const MAX_BYTES = 4_000_000

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed.' }
  const key = process.env.KIE_API_KEY
  if (!key) return { statusCode: 500, body: 'Missing KIE_API_KEY.' }

  const raw = event.queryStringParameters?.url
  if (!raw) return { statusCode: 400, body: 'Missing url' }

  try {
    const source = new URL(raw)
    if (!isAllowedSourceHost(source.hostname)) return { statusCode: 403, body: 'Image host is not allowed.' }

    const { response, data } = await fetchJson(`${KIE_BASE}/api/v1/common/download-url`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw }),
    }, 10000)

    if (!response.ok || (data?.code && Number(data.code) !== 200) || !data?.data) {
      return { statusCode: 502, body: `Could not create image link: ${data?.msg || response.status}` }
    }

    const temporary = new URL(String(data.data))
    if (!['http:', 'https:'].includes(temporary.protocol) || isLocalHost(temporary.hostname)) return { statusCode: 403, body: 'Temporary image URL is invalid.' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 16000)
    let imageResponse
    try {
      imageResponse = await fetch(temporary, { signal: controller.signal, redirect: 'follow' })
    } finally {
      clearTimeout(timer)
    }
    if (!imageResponse.ok) return { statusCode: 502, body: `Could not fetch image: ${imageResponse.status}` }

    const declared = Number(imageResponse.headers.get('content-length') || 0)
    if (declared > MAX_BYTES) return { statusCode: 413, body: 'Generated image is too large for browser copy/ZIP.' }
    const bytes = Buffer.from(await imageResponse.arrayBuffer())
    if (bytes.length > MAX_BYTES) return { statusCode: 413, body: 'Generated image is too large for browser copy/ZIP.' }

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': imageResponse.headers.get('content-type') || 'image/png',
        'Cache-Control': 'private, max-age=60',
      },
      body: bytes.toString('base64'),
    }
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'Image request timed out.' : err instanceof Error ? err.message : String(err)
    return { statusCode: 500, body: message }
  }
}

function isAllowedSourceHost(host) {
  const h = host.toLowerCase()
  return h === 'api.kie.ai' || h.endsWith('.kie.ai') || h.endsWith('.aiquickdraw.com') || h.endsWith('.redpandaai.co') || h === 'kieai.redpandaai.co'
}
function isLocalHost(host) {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')
}
async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    return { response, data }
  } finally {
    clearTimeout(timer)
  }
}
