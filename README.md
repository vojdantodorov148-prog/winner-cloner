# Winner Cloner v1.0.4

Winner Cloner turns a proven static-ad reference into product-specific variations through one UI workflow:

**Winner → Product → Market / Format / Model / Variations / Clone Strength → Generate**

## Prompt Master

Prompt Master is permanently active. Every generation first attempts a multimodal Gemini 2.5 Pro Prompt Master pass. To prevent Netlify 504 timeouts, v1.0.4 performs only one bounded Prompt Master API call. If that call fails or exceeds its 18-second budget, the app automatically compiles the same Prompt Master rules into the downstream image-generation prompt and continues instead of failing the job.

## Deploy

1. Push the project contents to GitHub.
2. Import the repository in Netlify.
3. Set environment variable `KIE_API_KEY` in Netlify.
4. Deploy.

Netlify settings are already in `netlify.toml`:

- Build: `npm run build`
- Publish: `dist`
- Functions: `netlify/functions`

## Storage

Products, winners, settings, and result metadata are stored in browser local storage / IndexedDB. Kie reference uploads are temporary.

## Current image models

- Nano Banana Pro
- Nano Banana 2
- GPT Image 2 image-to-image
- Grok Imagine Image 2.0 image-to-image

See `AUDIT-REPORT.md` for the v1.0.4 runtime audit.
