const KIE_BASE = 'https://api.kie.ai'

exports.handler = async (event) => {
  const key = process.env.KIE_API_KEY
  if (!key) return json(500, { error: 'Missing KIE_API_KEY.' })
  const taskId = event.queryStringParameters?.taskId
  if (!taskId) return json(400, { error: 'taskId is required.' })
  try {
    const response = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return json(response.status, { error: data.msg || 'Status request failed.' })
    const rawState = String(data?.data?.state || data?.data?.status || data?.state || data?.status || '').toLowerCase()
    const status = normalizeState(rawState)
    const imageUrl = firstImageUrl(data)
    const error = data?.data?.failMsg || data?.data?.error || (status === 'fail' ? data?.msg : undefined)
    return json(200, { status, imageUrl, error })
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) })
  }
}

function normalizeState(state) {
  if (['success', 'completed', 'succeeded'].includes(state)) return 'success'
  if (['fail', 'failed', 'error'].includes(state)) return 'fail'
  if (['generating', 'processing', 'running'].includes(state)) return 'generating'
  return 'waiting'
}

function firstImageUrl(value) {
  const urls = []
  walk(value, urls)
  return urls.find((u) => /\.(png|jpe?g|webp)(\?|$)/i.test(u)) || urls.find((u) => /tempfile|aiquickdraw|redpanda/i.test(u))
}
function walk(v, out) {
  if (typeof v === 'string') {
    if (/^https?:\/\//i.test(v)) out.push(v)
    else if ((v.startsWith('[') || v.startsWith('{'))) { try { walk(JSON.parse(v), out) } catch {} }
    return
  }
  if (Array.isArray(v)) return v.forEach((x) => walk(x, out))
  if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, out))
}
function json(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) } }
