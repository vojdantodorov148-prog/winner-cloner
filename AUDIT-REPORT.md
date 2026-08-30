# Winner Cloner v1.0.4 — Runtime Audit

## Root cause of the 504 shown on 2026-08-30

The v1.0.3 `generate` Netlify Function could execute these Prompt Master calls sequentially:

- Gemini 2.5 Pro: up to 26s
- Pro schema fallback: up to 20s
- Gemini 2.5 Flash recovery: up to 15s

That is up to 61 seconds inside Prompt Master alone, before the final image task creation. Netlify synchronous Functions have a fixed 60 second execution limit. The function itself only returned 200/405/500, so the observed HTTP 504 was infrastructure-level timeout behavior rather than an application-generated 504.

## v1.0.4 fix

- Prompt Master now makes **at most one AI call** per generation.
- Gemini 2.5 Pro has an 18 second hard timeout.
- If Pro times out, returns malformed output, or rejects the request, generation **does not fail**. The same Prompt Master rules are compiled into a deterministic downstream production prompt and the winner/product reference images still go to the selected image model.
- Page scraping is bounded (DNS 1.8s, page fetch 4s) and context is clipped.
- Uploads are bounded to 7s per attempt with one retry, in parallel.
- Image task creation is bounded to 7s and runs variations in parallel.
- Prompt/context sizes are clipped to reduce model latency and provider rejection risk.

## Additional API bug fixed

v1.0.3 incorrectly migrated Grok Imagine 2.0 reference generation to `grok-imagine-image-2-0/image-edit` while still calling the generic `/api/v1/jobs/createTask` image-to-image request shape. The current reference-image route is `grok-imagine-image-2-0/image-to-image` with `image_urls`. v1.0.4 uses that route and migrates the broken v1.0.3 saved ID automatically.

## Current model request shapes checked

- Nano Banana Pro → `nano-banana-pro` + `image_input`
- Nano Banana 2 → `nano-banana-2` + `image_input`
- GPT Image 2 image-to-image → `gpt-image-2-image-to-image` + `input_urls`
- Grok Imagine Image 2.0 image-to-image → `grok-imagine-image-2-0/image-to-image` + `image_urls`

## Local verification

- `node --check`: all 4 Netlify functions pass syntax validation.
- TypeScript/TSX syntax transpilation: all source files pass.
- Regression suite: **12 / 12 passed**.
- Added a simulated Prompt Master timeout test that proves the request falls back and proceeds to image-task creation without a second AI call.

## Limitation

A live paid Kie generation was not run in the sandbox because the production `KIE_API_KEY` is intentionally not available. `npm install` also timed out in the sandbox, so the final Vite dependency-resolved production build is still performed by Netlify during deploy. The application source and server-function syntax were checked locally.
