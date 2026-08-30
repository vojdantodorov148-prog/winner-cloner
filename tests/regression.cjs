const assert = require('assert')

process.env.KIE_API_KEY = 'test-key'

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function basePayload(overrides = {}) {
  return {
    winner: { name: 'Winner', sourceMarket: 'US', platform: 'Meta', adType: 'Static', format: '4:5', tags: '', notes: '' },
    winnerImage: 'data:image/webp;base64,AAAA',
    product: { name: 'Product', brand: 'Brand', category: '', summary: '', description: '', mechanism: '', benefits: '', audience: '', objections: '', offer: '', guarantee: '', guardrails: '', notes: '', links: {} },
    productImages: ['data:image/webp;base64,BBBB'],
    market: 'Croatia', outputLanguage: 'Auto — market native', aspectRatio: '4:5',
    model: 'nano-banana-pro', variations: 2, cloneStrength: 95, extraNotes: '',
    ...overrides,
  }
}

async function testGenerateArrayContentAndTaskCreation() {
  delete require.cache[require.resolve('../netlify/functions/generate.js')]
  const generate = require('../netlify/functions/generate.js')
  let uploadIndex = 0
  let taskIndex = 0
  let sawPromptLength = 0
  global.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('file-base64-upload')) {
      uploadIndex++
      return jsonResponse({ success: true, code: 200, data: { downloadUrl: `https://tempfile.redpandaai.co/ref-${uploadIndex}.webp` } })
    }
    if (u.includes('gemini-2.5-pro')) {
      const req = JSON.parse(opts.body)
      assert.equal(req.response_format?.type, 'json_schema')
      assert.equal(req.response_format?.json_schema?.name, 'prompt_master_payload')
      assert.equal(req.response_format?.json_schema?.schema?.type, 'object')
      assert.ok(req.response_format?.json_schema?.schema?.properties?.final_image_prompt)
      const payload = {
        summary: 'ok',
        blueprint: { layout: 'same', copy_structure: '', visual_style: '', persuasion_mechanism: '', product_placement: '', trust_elements: '', text_density: '' },
        final_image_prompt: 'A'.repeat(9000),
        variations: [{ instruction: 'v1' }, { instruction: 'v2' }],
      }
      return jsonResponse({ choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(payload) }] }, finish_reason: 'stop' }] })
    }
    if (u.includes('/api/v1/jobs/createTask')) {
      taskIndex++
      const body = JSON.parse(opts.body)
      sawPromptLength = Math.max(sawPromptLength, body.input.prompt.length)
      return jsonResponse({ code: 200, msg: 'success', data: { taskId: `task-${taskIndex}` } })
    }
    throw new Error(`Unexpected fetch ${u}`)
  }

  const out = await generate.handler({ httpMethod: 'POST', body: JSON.stringify(basePayload()) })
  assert.equal(out.statusCode, 200, out.body)
  const body = JSON.parse(out.body)
  assert.equal(body.taskIds.length, 2)
  assert.ok(sawPromptLength <= 7500, `prompt was not compacted: ${sawPromptLength}`)
}

async function testGenerateRecovery() {
  delete require.cache[require.resolve('../netlify/functions/generate.js')]
  const generate = require('../netlify/functions/generate.js')
  let proCalls = 0
  let flashCalls = 0
  global.fetch = async (url) => {
    const u = String(url)
    if (u.includes('file-base64-upload')) return jsonResponse({ success: true, data: { downloadUrl: 'https://tempfile.redpandaai.co/ref.webp' } })
    if (u.includes('gemini-2.5-pro')) {
      proCalls++
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: 'missing prompt' }) } }] })
    }
    if (u.includes('gemini-2.5-flash')) {
      flashCalls++
      return jsonResponse({ choices: [{ message: { content: 'Create a finished 4:5 static ad that preserves the winner layout exactly, uses the supplied product packaging reference faithfully, and renders concise market-native copy with the same hierarchy and text density.' } }] })
    }
    if (u.includes('/api/v1/jobs/createTask')) return jsonResponse({ code: 200, data: { taskId: 'task-recovered' } })
    throw new Error(`Unexpected fetch ${u}`)
  }
  const out = await generate.handler({ httpMethod: 'POST', body: JSON.stringify(basePayload({ variations: 1 })) })
  assert.equal(out.statusCode, 200, out.body)
  assert.equal(proCalls, 1)
  assert.equal(flashCalls, 1)
  assert.deepEqual(JSON.parse(out.body).taskIds, ['task-recovered'])
}

async function testPromptMasterSchemaFallback() {
  delete require.cache[require.resolve('../netlify/functions/generate.js')]
  const generate = require('../netlify/functions/generate.js')
  let geminiCalls = 0
  global.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('file-base64-upload')) return jsonResponse({ success: true, data: { downloadUrl: 'https://tempfile.redpandaai.co/ref.webp' } })
    if (u.includes('gemini-2.5-pro')) {
      geminiCalls++
      const body = JSON.parse(opts.body)
      if (geminiCalls === 1) {
        assert.ok(body.response_format)
        return jsonResponse({ msg: 'unsupported response_format envelope' }, 400)
      }
      assert.equal(body.response_format, undefined)
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: 'fallback ok', blueprint: {}, final_image_prompt: 'Create a finished static ad that preserves the winner layout, hierarchy, product placement, text density and product fidelity while adapting the copy for the selected market.', variations: [] }) } }] })
    }
    if (u.includes('/api/v1/jobs/createTask')) return jsonResponse({ code: 200, data: { taskId: 'task-schema-fallback' } })
    throw new Error(`Unexpected fetch ${u}`)
  }
  const out = await generate.handler({ httpMethod: 'POST', body: JSON.stringify(basePayload({ variations: 1 })) })
  assert.equal(out.statusCode, 200, out.body)
  assert.equal(geminiCalls, 2)
  assert.deepEqual(JSON.parse(out.body).taskIds, ['task-schema-fallback'])
}

async function testDeterministicPromptMasterSafetyFallback() {
  delete require.cache[require.resolve('../netlify/functions/generate.js')]
  const generate = require('../netlify/functions/generate.js')
  let createBody
  global.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('file-base64-upload')) return jsonResponse({ success: true, data: { downloadUrl: 'https://tempfile.redpandaai.co/ref.webp' } })
    if (u.includes('gemini-2.5-pro')) return jsonResponse({ choices: [{ message: { content: '' } }] })
    if (u.includes('gemini-2.5-flash')) return jsonResponse({ choices: [{ message: { content: '' } }] })
    if (u.includes('/api/v1/jobs/createTask')) {
      createBody = JSON.parse(opts.body)
      return jsonResponse({ code: 200, data: { taskId: 'task-safety' } })
    }
    throw new Error(`Unexpected fetch ${u}`)
  }
  const out = await generate.handler({ httpMethod: 'POST', body: JSON.stringify(basePayload({ variations: 1 })) })
  assert.equal(out.statusCode, 200, out.body)
  assert.deepEqual(JSON.parse(out.body).taskIds, ['task-safety'])
  assert.ok(createBody.input.prompt.includes('PROMPT MASTER'))
  assert.ok(createBody.input.prompt.includes('Reference image #1'))
}

async function testPartialTaskCreationStillReturnsSuccess() {
  delete require.cache[require.resolve('../netlify/functions/generate.js')]
  const generate = require('../netlify/functions/generate.js')
  let task = 0
  global.fetch = async (url) => {
    const u = String(url)
    if (u.includes('file-base64-upload')) return jsonResponse({ success: true, data: { downloadUrl: 'https://tempfile.redpandaai.co/ref.webp' } })
    if (u.includes('gemini-2.5-pro')) return jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: 'ok', blueprint: {}, final_image_prompt: 'Create a finished static ad that preserves the winner layout, hierarchy, product placement, text density and product fidelity while adapting the copy for the selected market.', variations: [] }) } }] })
    if (u.includes('/api/v1/jobs/createTask')) {
      task++
      return task === 1 ? jsonResponse({ code: 400, msg: 'bad task' }, 400) : jsonResponse({ code: 200, data: { taskId: 'task-good' } })
    }
    throw new Error(`Unexpected fetch ${u}`)
  }
  const out = await generate.handler({ httpMethod: 'POST', body: JSON.stringify(basePayload({ variations: 2 })) })
  assert.equal(out.statusCode, 200, out.body)
  const body = JSON.parse(out.body)
  assert.deepEqual(body.taskIds, ['task-good'])
  assert.ok(body.warning)
}

async function testStatusNeverReturnsInputReference() {
  delete require.cache[require.resolve('../netlify/functions/status.js')]
  const status = require('../netlify/functions/status.js')
  global.fetch = async () => jsonResponse({
    code: 200,
    data: {
      state: 'success',
      param: JSON.stringify({ input: { image_input: ['https://tempfile.redpandaai.co/INPUT-WINNER.webp'] } }),
      resultJson: JSON.stringify({ resultUrls: ['https://tempfile.redpandaai.co/GENERATED-OUTPUT.png'] }),
      progress: 100,
    },
  })
  const out = await status.handler({ httpMethod: 'GET', queryStringParameters: { taskId: 'x' } })
  assert.equal(out.statusCode, 200)
  const body = JSON.parse(out.body)
  assert.equal(body.status, 'success')
  assert.equal(body.imageUrl, 'https://tempfile.redpandaai.co/GENERATED-OUTPUT.png')
}

async function testStatusSuccessWithoutUrlKeepsPolling() {
  delete require.cache[require.resolve('../netlify/functions/status.js')]
  const status = require('../netlify/functions/status.js')
  global.fetch = async () => jsonResponse({ code: 200, data: { state: 'success', resultJson: '{}' } })
  const out = await status.handler({ httpMethod: 'GET', queryStringParameters: { taskId: 'x' } })
  const body = JSON.parse(out.body)
  assert.equal(body.status, 'generating')
  assert.equal(body.imageUrl, undefined)
}

async function testStatusFailure() {
  delete require.cache[require.resolve('../netlify/functions/status.js')]
  const status = require('../netlify/functions/status.js')
  global.fetch = async () => jsonResponse({ code: 200, data: { state: 'fail', failMsg: 'model rejected input' } })
  const out = await status.handler({ httpMethod: 'GET', queryStringParameters: { taskId: 'x' } })
  const body = JSON.parse(out.body)
  assert.equal(body.status, 'fail')
  assert.equal(body.error, 'model rejected input')
}

async function testCredits() {
  delete require.cache[require.resolve('../netlify/functions/credits.js')]
  const credits = require('../netlify/functions/credits.js')
  global.fetch = async () => jsonResponse({ code: 200, msg: 'success', data: 1234 })
  const out = await credits.handler({ httpMethod: 'GET' })
  assert.equal(out.statusCode, 200)
  assert.equal(JSON.parse(out.body).credits, 1234)
}

async function testDownloadUsesKieDownloadUrl() {
  delete require.cache[require.resolve('../netlify/functions/download.js')]
  const download = require('../netlify/functions/download.js')
  let calls = []
  global.fetch = async (url, opts = {}) => {
    calls.push(String(url))
    if (String(url).includes('/api/v1/common/download-url')) {
      assert.equal(JSON.parse(opts.body).url, 'https://tempfile.redpandaai.co/generated.png')
      return jsonResponse({ code: 200, msg: 'success', data: 'https://tempfile.redpandaai.co/token-file' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  const out = await download.handler({ httpMethod: 'GET', queryStringParameters: { url: 'https://tempfile.redpandaai.co/generated.png', filename: 'x.png' } })
  assert.equal(out.statusCode, 302, out.body)
  assert.equal(out.headers.Location, 'https://tempfile.redpandaai.co/token-file')
  assert.equal(calls.length, 1)
}

async function testAllModelRequestShapesAndGrokMigration() {
  const cases = [
    ['nano-banana-pro', 'nano-banana-pro', 'image_input'],
    ['nano-banana-2', 'nano-banana-2', 'image_input'],
    ['gpt-image-2-image-to-image', 'gpt-image-2-image-to-image', 'input_urls'],
    ['grok-imagine-image-2-0/image-edit', 'grok-imagine-image-2-0/image-edit', 'image_urls'],
    // Existing users may have the old ID saved; server must migrate it.
    ['grok-imagine-image-2-0/image-to-image', 'grok-imagine-image-2-0/image-edit', 'image_urls'],
  ]

  for (const [requestedModel, expectedModel, refKey] of cases) {
    delete require.cache[require.resolve('../netlify/functions/generate.js')]
    const generate = require('../netlify/functions/generate.js')
    let createBody
    global.fetch = async (url, opts = {}) => {
      const u = String(url)
      if (u.includes('file-base64-upload')) return jsonResponse({ success: true, data: { downloadUrl: 'https://tempfile.redpandaai.co/ref.webp' } })
      if (u.includes('gemini-2.5-pro')) return jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: 'ok', blueprint: {}, final_image_prompt: 'Create a finished static ad that preserves the winner layout, hierarchy, product placement, text density and product fidelity while adapting the copy for the selected market.', variations: [] }) } }] })
      if (u.includes('/api/v1/jobs/createTask')) {
        createBody = JSON.parse(opts.body)
        return jsonResponse({ code: 200, data: { taskId: 'task-model' } })
      }
      throw new Error(`Unexpected fetch ${u}`)
    }
    const out = await generate.handler({ httpMethod: 'POST', body: JSON.stringify(basePayload({ model: requestedModel, variations: 1 })) })
    assert.equal(out.statusCode, 200, `${requestedModel}: ${out.body}`)
    assert.equal(createBody.model, expectedModel)
    assert.ok(Array.isArray(createBody.input[refKey]), `${expectedModel} missing ${refKey}`)
    assert.equal(createBody.input.aspect_ratio, '4:5')
  }
}

async function main() {
  const tests = [
    testGenerateArrayContentAndTaskCreation,
    testGenerateRecovery,
    testPromptMasterSchemaFallback,
    testDeterministicPromptMasterSafetyFallback,
    testPartialTaskCreationStillReturnsSuccess,
    testStatusNeverReturnsInputReference,
    testStatusSuccessWithoutUrlKeepsPolling,
    testStatusFailure,
    testCredits,
    testDownloadUsesKieDownloadUrl,
    testAllModelRequestShapesAndGrokMigration,
  ]
  for (const test of tests) {
    await test()
    console.log(`PASS ${test.name}`)
  }
  console.log(`\n${tests.length} regression tests passed.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
