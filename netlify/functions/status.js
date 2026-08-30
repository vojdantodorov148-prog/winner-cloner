const KIE_BASE = 'https://api.kie.ai'

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' })
  const key = process.env.KIE_API_KEY
  if (!key) return json(500, { error: 'Missing KIE_API_KEY.' })
  const taskId = event.queryStringParameters?.taskId
  if (!taskId) return json(400, { error: 'taskId is required.' })

  try {
    const { response, data } = await fetchJsonWithRetry(
      `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
      { timeoutMs: 8000, retries: 1 },
    )

    if (!response.ok) return json(response.status, { error: data?.msg || `Status request failed (${response.status}).` })

    const rawState = String(data?.data?.state || data?.data?.status || data?.state || data?.status || '').toLowerCase()
    let status = normalizeState(rawState)
    const imageUrl = extractGeneratedResultUrl(data?.data)
    const error = data?.data?.failMsg || data?.data?.error || (status === 'fail' ? data?.msg : undefined)
    const progress = numberOrUndefined(data?.data?.progress)
    const retryable = status === 'fail' && isRetryableProviderFailure(error, data?.data?.failCode)

    // A successful task should normally include resultJson. If Kie reports
    // success a fraction of a second before the generated URL is populated,
    // keep polling instead of incorrectly completing the result with no image.
    if (status === 'success' && !imageUrl) status = 'generating'

    return json(200, { status, imageUrl, error, progress, retryable })
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? 'Kie status request timed out. The app will retry automatically.'
      : err instanceof Error ? err.message : String(err)
    return json(503, { error: message })
  }
}

function normalizeState(state) {
  if (['success', 'completed', 'succeeded'].includes(state)) return 'success'
  if (['fail', 'failed', 'error'].includes(state)) return 'fail'
  if (['generating', 'processing', 'running'].includes(state)) return 'generating'
  return 'waiting'
}

function extractGeneratedResultUrl(taskData) {
  if (!taskData || typeof taskData !== 'object') return undefined

  // Kie documents generated output under data.resultJson. Do NOT scan the
  // entire status payload: data.param contains the original input/reference
  // image URLs and can otherwise be mistaken for the generated result.
  const result = parseMaybeJson(taskData.resultJson)
  const direct = firstUrlFromResult(result)
  if (direct) return direct

  // Defensive fallbacks for provider response-shape changes, restricted to
  // result/output fields only so input/reference URLs can never win.
  for (const key of ['result', 'output', 'outputs', 'response']) {
    const candidate = firstUrlFromResult(parseMaybeJson(taskData[key]))
    if (candidate) return candidate
  }
  return undefined
}

function firstUrlFromResult(value) {
  if (!value) return undefined

  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return value
    const parsed = parseMaybeJson(value)
    return parsed === value ? undefined : firstUrlFromResult(parsed)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrlFromResult(item)
      if (url) return url
    }
    return undefined
  }

  if (typeof value !== 'object') return undefined

  const preferred = [
    value.resultUrls,
    value.result_urls,
    value.urls,
    value.images,
    value.output,
    value.outputs,
    value.imageUrl,
    value.image_url,
    value.url,
  ]
  for (const candidate of preferred) {
    const url = firstUrlFromResult(candidate)
    if (url) return url
  }

  for (const nested of Object.values(value)) {
    const url = firstUrlFromResult(nested)
    if (url) return url
  }
  return undefined
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!(text.startsWith('{') || text.startsWith('['))) return value
  try { return JSON.parse(text) } catch { return value }
}


function isRetryableProviderFailure(error, failCode) {
  const code = String(failCode || '').toLowerCase()
  const text = String(error || '').toLowerCase()
  if (/^(408|425|429|500|502|503|504)$/.test(code)) return true
  return /task id is blank|taskid.*blank|playground failed|temporar|timeout|timed out|busy|overload|upstream|gateway|internal|try again|network|fetch failed|aborted/.test(text)
}

function numberOrUndefined(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

async function fetchJsonWithRetry(url, options, { timeoutMs = 8000, retries = 1 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await sleep(700 * (2 ** attempt))
        continue
      }
      return { response, data }
    } catch (err) {
      lastError = err
      if (attempt >= retries) throw err
      await sleep(700 * (2 ** attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('Status request failed.')
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function json(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) } }

// Exported only for local regression tests; Netlify ignores this property.
exports._test = { extractGeneratedResultUrl, normalizeState, firstUrlFromResult, isRetryableProviderFailure }
