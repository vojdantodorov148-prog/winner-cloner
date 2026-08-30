# Winner Cloner v1.0.2 — Reliability Audit

Audit date: 2026-08-29

## Result

This build is the version intended for the next GitHub/Netlify update. The earlier single-file `generate.js` hotfix should **not** be used by itself because the deeper audit found issues in the status flow, model routing, browser asset handling, downloads and refresh recovery as well.

## Fixed in this audit

1. **Prompt Master structured-response parsing**
   - Accepts string, array and nested/object response shapes.
   - Requires a real `final_image_prompt` rather than mistaking a wrapper object for the payload.
   - Automatically performs one recovery pass if Prompt Master returns a successful but incomplete payload.
   - If Kie rejects the optional structured-output `response_format` envelope with 400/422, retries once without that optional envelope while preserving the Prompt Master JSON instruction.

2. **Generated-result URL parsing**
   - Reads generated output from Kie task result fields (`resultJson`/result/output fallbacks) only.
   - Never scans `param`, so the original winner/product reference URL cannot be returned as if it were the generated creative.
   - A task marked success before a result URL exists stays in `generating` and continues polling.

3. **Refresh/reopen recovery**
   - Unfinished jobs resume polling when the app is reopened instead of remaining stuck forever.

4. **Polling reliability**
   - Exponential backoff.
   - Transient status-check failures do not instantly fail the generation.
   - 15-minute overall client polling deadline with explicit timeout result.

5. **Image request-size protection**
   - New image assets are resized/compressed before storage.
   - Existing assets saved by older builds are re-optimized at generation time, so the user does not need to re-upload them after this update.
   - This reduces risk of Netlify request payload rejection.

6. **Product/winner asset integrity**
   - Replacing/removing assets inside an editor no longer destroys the previously saved asset before Save.
   - Cancel preserves the saved library record and cleans up current unsaved draft assets.
   - Winner image replacement updates image + fallback name atomically to avoid stale-state overwrites.

7. **Image-model request routing**
   - Nano Banana Pro: `nano-banana-pro` + `image_input`.
   - Nano Banana 2: `nano-banana-2` + `image_input`.
   - GPT Image 2: `gpt-image-2-image-to-image` + `input_urls`.
   - Grok Imagine 2.0: current `grok-imagine-image-2-0/image-edit` + `image_urls`.
   - Older saved Grok `image-to-image` IDs migrate automatically to the current ID.

8. **Partial task creation**
   - If one image task fails to start but others start successfully, the successful tasks continue and the UI receives a warning.
   - The whole generation fails only if zero image tasks were created.

9. **Prompt-size control**
   - Final image prompts are compacted to model-specific limits before task submission.

10. **Download reliability**
   - Uses Kie's authenticated generated-file download-link API.
   - Redirects to the temporary Kie download URL instead of buffering large generated PNGs through Netlify's smaller buffered response limit.

11. **Netlify execution-window hardening**
   - Page-context fetching and reference-image uploads start in parallel.
   - Provider call timeouts are bounded.
   - Up to six image task-create calls run in the same batch, reducing the chance of crossing Netlify's synchronous function execution limit.

12. **Build drift reduction**
   - Top-level npm dependency versions are pinned instead of using caret ranges.

## Automated regression tests

`node tests/regression.cjs`

Current result: **10/10 passed**

Covered scenarios:
- Prompt Master array-content response
- Prompt Master automatic incomplete-output recovery
- Prompt Master structured-output schema rejection fallback
- Partial image task creation
- Generated URL must not equal an input/reference URL
- Kie success-without-result URL keeps polling
- Failed Kie task surfaces the provider error
- Kie credits response
- Kie generated-file download URL flow
- Request shape for all four image-model choices + old Grok ID migration

All four Netlify function files also pass Node syntax checking.

## Verification limitations

- A full local `npm install && npm run build` could not be completed in the execution sandbox because package installation timed out. The source was syntax-audited, Netlify function JavaScript was checked directly, and top-level package versions are pinned, but the definitive Vite production build will still occur on Netlify.
- No paid live Kie generation was executed from the audit environment because the user's private `KIE_API_KEY` is intentionally not present there. Provider behavior was tested with mocked responses matching the current documented Kie shapes.
- No integration can guarantee that an external provider will never change an API or have an outage. The build now fails with explicit messages and has fallbacks for the response-shape/provider issues identified in this audit.
