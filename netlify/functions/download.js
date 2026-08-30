const KIE_BASE = 'https://api.kie.ai'

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed.' }
  const key = process.env.KIE_API_KEY
  if (!key) return { statusCode: 500, body: 'Missing KIE_API_KEY.' }

  const raw = event.queryStringParameters?.url
  if (!raw) return { statusCode: 400, body: 'Missing url' }

  try {
    const source = new URL(raw)
    if (!isAllowedSourceHost(source.hostname)) return { statusCode: 403, body: 'Download host is not allowed.' }

    // Kie exposes a dedicated authenticated endpoint that converts a generated
    // result URL into a short-lived downloadable URL. Redirect to that URL
    // instead of buffering the image through Netlify: buffered Functions have
    // a much smaller response payload ceiling than image-generation services.
    const { response, data } = await fetchJsonWithRetry(`${KIE_BASE}/api/v1/common/download-url`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw }),
    }, 1, 10000)

    if (!response.ok || (data?.code && Number(data.code) !== 200) || !data?.data) {
      return { statusCode: 502, body: `Could not create download link: ${data?.msg || response.status}` }
    }

    const temporary = new URL(String(data.data))
    if (!['http:', 'https:'].includes(temporary.protocol) || isLocalHost(temporary.hostname)) return { statusCode: 403, body: 'Temporary download URL is invalid.' }

    return {
      statusCode: 302,
      headers: {
        Location: temporary.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
      body: '',
    }
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'Download-link request timed out.' : err instanceof Error ? err.message : String(err)
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

async function fetchJsonWithRetry(url, options, retries = 1, timeoutMs = 10000) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (2 ** attempt)))
        continue
      }
      return { response, data }
    } catch (err) {
      lastError = err
      if (attempt >= retries) throw err
      await new Promise((r) => setTimeout(r, 600 * (2 ** attempt)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('Request failed.')
}
