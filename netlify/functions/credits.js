const KIE_BASE = 'https://api.kie.ai'

exports.handler = async (event) => {
  if (event?.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' })
  const key = process.env.KIE_API_KEY
  if (!key) return json(500, { error: 'Missing KIE_API_KEY.' })
  try {
    const { response, data } = await fetchJsonWithRetry(`${KIE_BASE}/api/v1/chat/credit`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!response.ok) return json(response.status, { error: data?.msg || 'Could not read credits.' })
    const credits = Number(data?.data)
    if (!Number.isFinite(credits)) return json(502, { error: 'Kie returned an invalid credit balance.' })
    return json(200, { credits })
  } catch (err) {
    return json(503, { error: err?.name === 'AbortError' ? 'Kie credit request timed out.' : err instanceof Error ? err.message : String(err) })
  }
}

async function fetchJsonWithRetry(url, options, retries = 1) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 7000)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 700 * (2 ** attempt)))
        continue
      }
      return { response, data }
    } catch (err) {
      lastError = err
      if (attempt >= retries) throw err
      await new Promise((r) => setTimeout(r, 700 * (2 ** attempt)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('Credit request failed.')
}
function json(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) } }
