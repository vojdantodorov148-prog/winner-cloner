exports.handler = async (event) => {
  const raw = event.queryStringParameters?.url
  const filename = sanitize(event.queryStringParameters?.filename || 'creative.png')
  if (!raw) return { statusCode: 400, body: 'Missing url' }
  try {
    const url = new URL(raw)
    if (!isAllowedHost(url.hostname)) return { statusCode: 403, body: 'Download host is not allowed.' }
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) return { statusCode: response.status, body: 'Remote download failed.' }
    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'image/png',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
      body: buffer.toString('base64'),
    }
  } catch (err) {
    return { statusCode: 500, body: err instanceof Error ? err.message : String(err) }
  }
}
function isAllowedHost(host) {
  const h = host.toLowerCase()
  return h === 'api.kie.ai' || h.endsWith('.kie.ai') || h.endsWith('.aiquickdraw.com') || h.endsWith('.redpandaai.co') || h === 'kieai.redpandaai.co'
}
function sanitize(name) { return name.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 120) || 'creative.png' }
