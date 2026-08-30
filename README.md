# Winner Cloner v1.0.7

Minimal winner-ad cloning app for Netlify + Kie.ai. Prompt Master stays enabled in the backend.

## Reliability changes in v1.0.7
- Retries async Kie provider failures (including `generate playground failed, task id is blank`) after the task has already been created.
- Uses MIME-correct filenames for uploaded references.
- Prefers Kie's direct `fileUrl` for image model references.
- Caps Nano Banana prompts conservatively before provider submission.
- Keeps output on the Generate page with Copy / Download / ZIP download.

Deploy through GitHub -> Netlify and keep `KIE_API_KEY` in Netlify environment variables.
