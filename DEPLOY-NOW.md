# DEPLOY NOW — Winner Cloner

## Fastest route: GitHub → Netlify

1. Unzip this project.
2. Create a new **private** GitHub repository named `winner-cloner`.
3. Upload **all files and folders inside the project** to the repository root.
4. In Netlify choose **Add new site → Import an existing project → GitHub → winner-cloner**.
5. Netlify should detect:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
6. Deploy once.
7. Go to **Site configuration → Environment variables** and add:
   - `KIE_API_KEY` = your private Kie.ai key
8. Go to **Deploys → Trigger deploy → Deploy site**.
9. Open the site:
   - Winners → upload a winner
   - Products → create product + add product photo
   - Generate → select both → Generate

Do not place the Kie API key in GitHub or in the browser settings.

## Updating an existing Winner Cloner site to v1.0.3

Because this reliability update changes frontend code and all Netlify Functions, replace/update the whole repository contents rather than only `generate.js`. Keep the same Netlify site and domain. Your existing browser-local Winners and Products remain on that same site origin. The existing `KIE_API_KEY` Netlify environment variable does not need to be entered again.
