# Winner Cloner

A deployable React + Netlify Functions app for cloning high-performing static ad concepts. The Prompt Master workflow is permanently enabled server-side: winner analysis → product/context adaptation → final image prompt → Kie.ai image generation.

## What is included

- Generate screen: winner + product + market + language + ratio + model + variation count + clone strength
- Prompt Master always ON and not exposed as a toggle
- Winners Library with multiple upload and paste-from-clipboard
- Detailed editable Products Library with product explanation, mechanism, benefits, offer, guarantee, audience, objections, guardrails, notes, reference images and URLs
- Product/winner image persistence in browser IndexedDB
- Results/jobs history in browser localStorage
- Kie.ai server-side integration through Netlify Functions
- Prompt Master: Gemini 2.5 Pro multimodal through Kie.ai
- Image models: Nano Banana Pro, Nano Banana 2, GPT Image 2 image-to-image, Grok Imagine Image 2.0 image-to-image
- Polling for Kie job completion
- Working server-side image download proxy
- Kie credit check in Settings
- Safe server-side page fetching for landing/advertorial/offer/checkout context (best effort)

## Important architecture note

This first production-ready build is intentionally single-user and does **not** need Supabase. Product/winner metadata is stored in the browser and images use IndexedDB. The Kie API key stays on the Netlify server and is never exposed in frontend code.

If you later want shared team access, cross-device sync or permanent cloud asset storage, add Supabase without changing the generation pipeline.

## Deploy — recommended GitHub + Netlify

### 1. Upload this project to GitHub

Create a new empty GitHub repository (for example `winner-cloner`). Upload all files from this folder, or push with Git.

Do **not** add a Kie API key to the repository.

### 2. Import the repository in Netlify

In Netlify:

1. Add new site → Import an existing project
2. Choose GitHub
3. Select the `winner-cloner` repository
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Functions directory: `netlify/functions`
7. Deploy

`netlify.toml` already contains these settings, so Netlify should detect them automatically.

### 3. Add the Kie secret

Netlify → your site → Site configuration → Environment variables → Add variable:

- Key: `KIE_API_KEY`
- Value: your private Kie.ai API key

Save it.

### 4. Redeploy

Deploys → Trigger deploy → Deploy site.

The app should now be live and the Kie backend should work.

## First test

1. Open Winners → upload one proven static ad
2. Open Products → New product
3. Fill the product explanation and add at least one real product/package image
4. Add offer, audience, objections and page URLs if available
5. Save
6. Go to Generate
7. Select the winner and product
8. Keep `Nano Banana Pro`, `4:5`, 4 variations and ~92% clone strength for the first test
9. Generate
10. Results will show the job while it is processing, then display each image with a Download button

## Local development

```bash
npm install
npm run dev
```

The visual app will run locally, but Kie generation calls require Netlify Functions. For full local functions support, use Netlify's local dev environment or deploy to a Netlify draft site.

## Storage behavior

The app stores product/winner data in the current browser. Clearing browser site data removes the local library. Generated Kie image URLs are external and may expire according to Kie.ai retention policies, so download important outputs.

## Security

- Kie key: server environment variable only
- No Kie key is written to localStorage
- Product page URL fetching blocks localhost/private-network targets
- Download proxy only accepts Kie-related asset hosts
