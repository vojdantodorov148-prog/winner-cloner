# v1.0.7 audit

Root cause corrected: previous retry logic only handled createTask failures. The observed error can arrive later from Kie's task-status `failMsg`, after a valid task ID was already returned. v1.0.7 classifies that async failure as retryable and automatically creates a replacement task up to two times.

Additional hardening: MIME-correct upload filenames, direct file URL preference, conservative Nano Banana prompt length, and regression coverage for retryable async provider failures.
