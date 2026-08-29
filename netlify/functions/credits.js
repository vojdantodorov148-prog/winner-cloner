const KIE_BASE = 'https://api.kie.ai'
exports.handler = async () => {
  const key = process.env.KIE_API_KEY
  if (!key) return json(500, { error: 'Missing KIE_API_KEY.' })
  try {
    const response = await fetch(`${KIE_BASE}/api/v1/chat/credit`, { headers: { Authorization: `Bearer ${key}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return json(response.status, { error: data.msg || 'Could not read credits.' })
    return json(200, { credits: Number(data?.data ?? 0) })
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) })
  }
}
function json(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) } }
