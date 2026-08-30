# Deploy v1.0.4 to the existing Netlify site

## Fastest fix (recommended for the current Nano Banana workflow)

Replace only:

`netlify/functions/generate.js`

with the v1.0.4 version, commit to GitHub, and let Netlify redeploy.

This fixes the 504 runtime chain immediately and does not change browser-stored products/winners.

## Full update

Replace the repository contents with v1.0.4 and commit. This also fixes the Grok Imagine model identifier in the frontend and local-state migration.

Your existing `KIE_API_KEY` environment variable remains configured in Netlify and does not need to be entered again.
