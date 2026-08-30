# Winner Cloner v1.0.5 — deploy

This update changes the frontend and adds one Netlify Function for Copy / Download all.

## GitHub → Netlify
1. Replace the repository files with the contents of this ZIP.
2. Commit the changes.
3. Netlify will auto-deploy the same site.
4. Keep the existing `KIE_API_KEY` environment variable unchanged.
5. Hard refresh `winner-cloner.netlify.app` after the deploy is Published.

Important: upload the new `netlify/functions/asset.js` file too. Copy and ZIP download use it.

Your saved Winners, Products and History stay in the browser because the Netlify domain remains the same.
