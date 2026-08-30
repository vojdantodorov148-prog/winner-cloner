# Deploy v1.0.7

Replace the project files in the existing GitHub repository with this version and commit. Netlify will redeploy automatically. Keep the existing `KIE_API_KEY`. After Netlify shows Published, hard refresh the same site.

For this fix, do not replace only `generate.js`: `status.js`, `src/App.tsx`, `src/lib/api.ts`, and `src/types.ts` also changed because recovery now handles failures that occur after Kie has already returned a task ID.
