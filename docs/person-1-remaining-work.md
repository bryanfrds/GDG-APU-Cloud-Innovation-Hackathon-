# Person 1 — Remaining Work

**Branch:** `feature/gemini-viva-integration` (PR #18)
**Updated:** 12 November 2026
**Source:** `PROVE_IT_PERSON_1_COMPLETE_TASK_CHECKLIST.md`

## Done so far

- Vercel build fixed: `vercel.json` pins `"framework": "nextjs"` (the project preset was "services" with no services declared). `.vercelignore` keeps `backend/` out of the Next build.
- `backend/requirements.txt` re-encoded from UTF-16 to UTF-8; fresh-venv install and the 11 pytest tests pass.
- `POST /api/viva/token` accepts `submissionId`, loads the saved plan server-side from the Python service (`PROVE_IT_API_URL`), validates it with `parsePlan()`, stores `submissionId` in the viva session, and refuses client-written plans once the service is configured. Error mapping (404/409/422/429/502) and tests are in place (`lib/viva/submission-plan.ts`, `app/api/viva/token/submission.test.ts`).

- Upload page `/submit` and Next proxy routes (`/api/submissions`, `/api/submissions/[id]/generate`): passcode stays server-side, rate limited, double clicks blocked, retry without re-uploading.
- `/viva-test?submission=<id>` sends the `submissionId`; the sample plan is only the fallback with no id.
- PDF fix: Gemini's page citations are now checked against the `[Page N]` markers instead of failing every PDF.
- Fixed the `/dev/null` test and removed the Windows-only failure (the stray `C:\dev` folder still needs deleting by hand).
- Real runs with Gemini: a tiny `.py`, a `.cpp`, a text PDF and a 45-line Python file with a prompt-injection comment all produced specific questions and valid plans. Injection text had no effect.
- Bad-input checks done: empty, 11 MB, over 30,000 characters, invalid UTF-8, fake PDF, unsupported type, traversal and Unicode filenames, long/missing title, malformed multipart. No orphaned files or rows.
- Three parallel `generate` calls returned 200 and left one saved set (but each called Gemini).

## Blocked on a team decision (do these first)

- [ ] **Architecture:** keep Python FastAPI as a second deployed service (A), or port upload/extraction/generation to Next.js (B). Do not build both. The work above assumes A.
- [ ] **Deployment:** who deploys the Python service, its base URL, secrets and cloud permissions. Until it is deployed, `PROVE_IT_API_URL` has nothing to point at.
- [ ] **Durable storage:** Cloud Storage for files and Firestore for submissions/questions (per `CONTRIBUTING.md`), or an approved alternative. SQLite plus a local `uploads/` folder is not enough on Vercel or Cloud Run.
- [ ] Record the decision in the docs and agree the interface with Persons 2, 3 and 4.

## Viva integration (2B)

- [ ] Verify the viva-plan endpoint against real Gemini-generated records, not only mocks.
- [ ] Set `PROVE_IT_API_URL` and a matching `DEMO_PASSCODE` on the deployed Next app and the Python service.
- [x] Update the viva page (`app/viva-test/page.tsx`) to send a `submissionId`. It still sends `SAMPLE_PLAN`. Coordinate with Bryan. **Done** (`?submission=`); still coordinate with Bryan.
- [ ] Confirm the saved viva record references the locked plan and `submissionId`; coordinate any schema change with Persons 2 and 3.
- [ ] End-to-end test with one real submission: upload, generate, fetch plan, start viva, confirm it asks that student's questions.
- [ ] Contract test: run real generated plans through the actual `parsePlan()` or a shared fixture.

## Upload UI (2C) — with Person 4

- [ ] Agree how Next calls upload and generate (server proxy route handlers preferred, so the passcode stays server-side).
- [x] Upload form (title + PDF/code file) and Next proxy routes for upload, generate and status. **Done** (`/submit`). Status route not needed: generate is synchronous.
- [x] Loading / processing / ready / failed states with clear 4xx/5xx messages. **Done.** Browser test on mobile still to do.
- [x] Prevent duplicate generation on repeated clicks. **Done in the UI**; the service is not locked yet.
- [ ] Browser test on desktop and mobile with real files.

## Private storage and data model

- [ ] Write `docs/data-model.md` (Submission, File, ExtractedContent, QuestionSet, VivaPlan, VivaSession/Record references, grading access; ID types; status flow `uploaded` → `processing` → `ready` / `failed`; timestamps, owners, retention). Needs the storage decision first.
- [ ] Durable private file storage: upload, fetch by internal key, cleanup on failure, retention policy, no guessable public URLs. **Code written** (`backend/cloud.py`, `PROVE_IT_STORE=gcp`, tested with fakes); still needs a real bucket and a real-credentials test, plus a retention policy.
- [ ] Durable submission and question-set records that survive restarts and work across instances. **Firestore done and verified** against a real project (`PROVE_IT_STORE=firestore`): records and questions survive a backend restart and the viva starts from them. The extracted text is stored in the record, so no file store is needed for generation or grading; original files are not kept.
- [ ] Per-student ownership checks. The shared demo passcode is only a demo gate.
- [ ] Authenticated internal grading contract for Person 3 (submission reference, evidence, private rubric). Never expose `expected_points` to students, bundles, logs or viva prompts.
- [ ] Safe deletion and retention behaviour for student files and records.

## Upload and extraction hardening

- [ ] Test valid `.py`, `.java`, `.cpp`, `.txt` and selectable-text `.pdf`. (`.py`, `.cpp`, `.pdf` done; `.java`, `.txt` left.)
- [ ] Test bad input (corrupted/encrypted/scanned/over-50-page PDFs left): unsupported extension, empty, over 10 MiB, over 30,000 characters, invalid UTF-8, corrupted / encrypted / scanned / over-50-page PDF.
- [x] Test path traversal, long or Unicode filenames, invalid titles, malformed multipart.
- [x] Confirm failed uploads leave no stored file or orphaned database row.
- [ ] Test concurrent submissions and idempotent generation.
- [ ] Confirm timeouts and body limits at the deployment proxy.
- [ ] Confirm extracted content is never logged or shown in errors.

## Gemini generation hardening

- [x] Real Gemini run on at least two different assignments; confirm questions are specific to each. (Done on four. One hard question had a wrong premise, so questions need lecturer review.)
- [ ] Check line references stay within source bounds and PDF citations are not invented.
- [ ] Prompt injection (one real test passed; escaping is in code): escape `<`/`>` in assignment text, use a safe filename in the prompt.
- [ ] Fake-response tests: invalid JSON, empty, wrong IDs, missing fields, fake source lines, overlong text, line breaks, hidden characters.
- [ ] Error handling for 429, timeouts, 500–504, missing key or model. Lower the 90 s timeout (about 30 s) and bound fallback retries.
- [ ] Measure real latency and quota behaviour.
- [ ] Confirm saved question sets are reused after restart; confirm status changes on every failure path.
- [ ] Decide whether and how an instructor can regenerate questions (audit, attempt limits).

## Security before a public deployment

- [ ] Every private route enforces auth (`/content`, questions, viva-plan, internal grading).
- [ ] `DEMO_PASSCODE` set on all deployed services and never in client code.
- [ ] Rate-limit wrong-passcode guesses; replace the per-process limiter with a shared one and a trusted client-IP strategy; restrict Gemini generation separately.
- [ ] Secrets only from environment (no `load_dotenv(override=True)`, no `NEXT_PUBLIC_`).
- [ ] Log redaction review; file malware and content policy.

## Tests, CI and docs

- [ ] Integration tests for the cross-service route, including failure cases.
- [ ] Python tests in a clean venv, with the result saved in PR notes.
- [ ] CI for Python dependencies and tests (if the team agrees).
- [x] Fix `app/api/viva/token/route.test.ts` "still starts the viva when its session can't be saved": it uses `/dev/null/...`, which is writable on Windows and creates `C:\dev\null`. Use a path that is unwritable on every OS. **Done.**
- [ ] Delete the stray `C:\dev` folder that test left behind.
- [ ] Update `docs/backend-api.md` (base URL, protected request samples, error codes, config, caveats).
- [ ] Update the PR #18 description (routes, extraction, generation/persistence, requirements, security, tests, limitations).
- [ ] Check no scripts, test PDFs, `.exe`, large files, `.env.local`, databases or `.venv` are tracked.
- [ ] Get a teammate's approval, merge into `dev`, then re-run build and tests on the merged branch.
- [ ] Hand over a sample `submissionId`, a sample public viva-plan JSON, and how Persons 2 and 3 get authorized data.
- [ ] One sanitised end-to-end scenario using synthetic assignments.

## Done when

Architecture implemented and documented; uploads private and durable; Gemini questions valid, grounded and saved; the viva uses the right saved questions by `submissionId`; Person 3 has a protected source/rubric contract; Person 4 has a tested upload UI connection; abusive requests are blocked; fresh-install, unit, integration and browser tests pass; docs complete; PR #18 reviewed, merged and verified.
