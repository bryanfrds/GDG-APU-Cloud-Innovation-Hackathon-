# Prove It — Python submission service (local/demo)

This service is separate from Next.js. The Next viva **does not automatically**
fetch these questions until Bryan wires `submissionId` handling into
`app/api/viva/token/route.ts` (or the team consolidates the services).

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

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/submissions` | Multipart `title` (1–120 plain characters), `file` (PDF/py/java/cpp/txt), max 10 MiB, max 30,000 extracted characters |
| GET | `/api/submissions/{submission_id}` | Saved metadata and status |
| GET | `/api/submissions/{submission_id}/content` | Extracted private assignment text |
| POST | `/api/submissions/{submission_id}/generate` | Generates five private questions with Gemini, returns public fields |
| GET | `/api/submissions/{submission_id}/questions` | Five student-safe questions; no grading rubric |
| GET | `/api/submissions/{submission_id}/viva-plan` | `{ assignmentTitle, questions: [{ id, text, focus }] }`, four questions for Next's `parsePlan()` |

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
- **Cloud mode:** set `PROVE_IT_STORE=gcp` with `GCS_BUCKET` and `GOOGLE_CLOUD_PROJECT`. Files go to the
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
