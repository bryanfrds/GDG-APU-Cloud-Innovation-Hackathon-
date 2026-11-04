# Prove It: how we work

Team rules for the four of us. Read this before your first PR.

## Branches and PRs

- `main` stays untouched until the final merge on 10 Nov. Never push or merge into `main` before then.
- All work: branch from `dev`, open a PR into `dev`, and get a teammate to review it before merging.
- The author merges after one approval. If nobody reviews within 3 hours, ping Bryan.
- One topic per PR, small commits, clear messages.
- Touching someone else's area? Ask them first, or tag them on the PR.

## Secrets

- API keys (Gemini, Google Cloud) go in `.env.local` only. Never commit them, and never paste them in
  chat, issues or PRs.
- `.env.example` lists the variable names with empty values. Copy it to `.env.local` and fill it in.
- Never put a key in a `NEXT_PUBLIC_` variable: those are sent to the browser. The browser gets
  short-lived tokens from our server instead.
- Deployed keys live in Cloud Run environment variables (or Secret Manager), set by Bryan.
- Bryan owns the Google Cloud project and adds everyone to it; ask him for access.

## Product rules

- The main journey must work end to end before any extras start:
  **submit → questions generated → spoken viva → scored → lecturer report → class view.**
- One look across all screens. Realistic sample data, loading and error states, no dead buttons.
- Check UI changes in a browser before calling them done.
- The AI flags and explains; it never fails a student on its own. Keep this true in the UI wording.

## Who owns what

Agree the shared data (what a submission, question, viva and report look like) and how the parts
talk to each other **before** building separately. Person 1 writes it up in `docs/data-model.md`
by the end of 4 Nov; everyone reviews it. Each owner writes the code **and the tests** for their
area (`npm test`, using Vitest, once the app is set up).

Names go next to each person below once we've agreed who takes what.

- **Person 1 (name TBC): submissions and questions.** The upload API, private file storage (Cloud Storage),
  reading code and reports, Gemini writing questions about the student's own work, and saving
  submissions and questions (Firestore).
- **Person 2 (name TBC): the voice viva.** The real-time spoken conversation (Gemini Live API), follow-up
  questions when an answer is vague, the transcript, time limits (including a ~30-second demo
  mode), and the text-chat fallback. This is the riskiest part, so prove it works early.
- **Person 3 (name TBC): scoring and insights.** Scoring each answer against the submission, the "answers
  don't match the code" flag, the per-student report data, class-wide stats, and the 40 synthetic
  demo students.
- **Person 4 (Bryan): the app, deployment and submission.** Every screen (student submit and viva
  pages, lecturer report and class view), the recording-consent step, sign-in, phone layout,
  deploying to Cloud Run, the
  resettable demo data, the README, and the pitch deck and backup video.

## Milestones (prototype due 10 Nov, 11:59 PM MYT)

1. **4–5 Nov: first loop.** Shared data agreed (4 Nov). Upload a submission and get questions back (P1).
   A spoken back-and-forth working on its own (P2). Scoring a hard-coded answer (P3). Basic
   submit page deployed on Cloud Run from `dev` (P4).
2. **6–7 Nov: viva connected.** Real questions feed the viva (P1+P2), text-chat fallback working
   as the safety net (P2), transcripts get scored (P3),
   student flow joined up in the app (P4).
3. **8 Nov: lecturer side.** Reports and class stats (P3), report page and class view (P4).
4. **9 Nov: demo ready.** Demo mode (P2), demo data and the two staged submissions (P3),
   polish and backup video (P4). Everyone: bug fixes.
5. **10 Nov: submit.** Code freeze at 6 PM MYT. Bryan merges `dev` into `main`, final README, pitch deck PDF, submit on the
   hackathon workspace. Everyone rehearses the demo.
