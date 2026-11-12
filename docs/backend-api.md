# Prove It — Python submission service (local/demo)

This service is separate from Next.js. The Next app talks to it server to server:

- `POST /api/viva/token` takes a `submissionId` and loads the saved viva plan from here.
- `POST /api/submissions` and `POST /api/submissions/[id]/generate` (Next) proxy the upload and
  question generation, so the service URL and the real passcode never reach the browser.
- The student pages are `/submit` (upload, then generate) and `/viva-test?submission=<id>`.

Set `PROVE_IT_API_URL` (this service's base URL) and the **same** `DEMO_PASSCODE` on both the Next app
and this service.

## Local setup

From repo root, install `backend/requirements.txt` into a Python 3.12 virtualenv,
set `DEMO_PASSCODE` and `GEMINI_API_KEY` in `.env.local` (never commit them), then:

```powershell
cd backend
python -m uvicorn main:app --reload
python -m pytest -q tests
```

Use `x-demo-code: <DEMO_PASSCODE>` on every submission and question API call.
Missing `DEMO_PASSCODE` fails closed with HTTP 503, including locally.

Errors use `{"detail": "..."}`: 400 bad title/empty file/malformed form, 401 wrong passcode, 404 unknown
submission or questions not generated, 413 over 10 MiB, 415 unsupported type, 422 unreadable file,
over the character limit, or invalid Gemini output, 429 too many requests or Gemini quota, 502 other
generation failure, 503 `DEMO_PASSCODE` not configured or Gemini unavailable.

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/submissions` | Multipart `title` (1–120 plain characters), `file` (PDF/py/java/cpp/txt), max 10 MiB, max 30,000 extracted characters |
| GET | `/api/submissions/{submission_id}` | Saved metadata and status |
| GET | `/api/submissions/{submission_id}/content` | Extracted private assignment text |
| POST | `/api/submissions/{submission_id}/generate` | Generates five private questions with Gemini, returns public fields |
| GET | `/api/submissions/{submission_id}/questions` | Five student-safe questions; no grading rubric |
| GET | `/api/submissions/{submission_id}/viva-plan` | `{ assignmentTitle, questions: [{ id, text, focus }] }`, four questions for Next's `parsePlan()` |

For PDFs, Gemini may cite `source_pages`; each must match a `[Page N]` marker the extractor saw.
PDF line numbers are always rejected. Code files must cite real line numbers.

The viva-plan endpoint selects q1/q2/q3/q5 (two easy, medium, hard).
The `focus` field contains only the public topic, not grading rubric points.
Every field is validated for single-line/hidden characters and size limits.

## Limits and deployment

- Uploads: 10 attempts per client peer address per 60 seconds.
- Generation: 5 attempts per client peer address per 60 seconds, including wrong passcodes.
- Gemini: 30 seconds per model, at most 2 attempted models; 429 propagates as HTTP 429.
- Set `PROVE_IT_DATA_DIR` for local persistent storage (SQLite + uploads).
- This rate limiter is in-memory **per process**; it is not distributed and
  must not be the only public-network protection at scale.
- **Firestore-only mode (verified):** `PROVE_IT_STORE=firestore` with `GOOGLE_CLOUD_PROJECT` needs no billing card (free Spark plan). The extracted text (at most 30,000 characters) is saved in the Firestore submission record under `extracted`, and the local upload is deleted, so nothing private stays on disk and a restarted or second instance loses nothing. The original file is not kept (generation and grading only need the text). `GET /api/submissions/{id}` never returns `extracted`; only `/content` does. Verified against a real project with a `.py` and a PDF: upload, generate, restart, read back and viva start all worked.
- **Full cloud mode:** set `PROVE_IT_STORE=gcp` with `GCS_BUCKET` and `GOOGLE_CLOUD_PROJECT`. Files go to the
  bucket under `uploads/<id>.<ext>`; records go to Firestore collections `submissions` and
  `question_sets` (full question set, including the private rubric, as one JSON string). The service
  refuses to start if the settings are missing. Credentials come from Application Default Credentials
  (a Cloud Run service account, or `gcloud auth application-default login` locally). The service account
  needs Storage Object Admin on the bucket and Cloud Datastore User. The bucket must be private
  (uniform bucket-level access, public access prevention on). Tested only against in-memory fakes so far.
- In local mode, SQLite and local file uploads **are not durable across Cloud Run replicas**
  or Vercel instances. Use a persistent shared database and object store
  before production deployment. A Next.js-only Vercel deployment does not
  deploy the Python service automatically.
- Do **not** expose `/content` to students in production; implement per-user
  ownership checks rather than shared passcode alone.

## Known limitations

- Generation is not locked: parallel `generate` calls for one submission each call Gemini
  (the first saved set is reused afterwards). Add a lock or `processing` check before a public launch.
- Gemini latency varies (about 10-25 s, occasionally over the 30 s per-model limit, which returns 503).
  The upload page lets the student retry without uploading again.
- Questions are checked for shape and real line/page references, not for factual correctness.
  A hard question can contain a wrong premise, so a lecturer should review before grading uses them.
