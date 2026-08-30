# Winner Cloner v1.0.6

Minimal winner-ad cloning workflow.

## Main workflow
Winner + Product + Setup → Generate → Output on the same page.

Prompt Master stays permanently enabled in the backend.

## v1.0.6
- Redesigned Generate UI: less text, fewer panels, faster input flow.
- Output now appears directly beside the inputs on the Generate page.
- Each generated creative has Copy and Download actions.
- Multiple creatives can be downloaded together as one ZIP.
- History remains available as a compact secondary page.
- Winners, Products and Settings were simplified.
- Added `netlify/functions/asset.js` to support browser image copy and ZIP creation.

## Stack
React + Vite + TypeScript + Netlify Functions + Kie.ai.

## Environment
Set `KIE_API_KEY` in Netlify environment variables. Never put the key in frontend code or GitHub.
