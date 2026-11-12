# Task 3 — Scoring & Insights: Requirements, Design & Tasks

---

## Requirements

### What Task 3 does

Task 3 receives the output of the viva (a `VivaTranscript` from Task 2) and produces two Firestore documents:

1. **`VivaReport`** — a per-student scored report, written to `vivaReports/{vivaId}`
2. **`ClassStats`** — class-wide aggregated statistics, written to `classStats/{assignmentId}`

Task 4 reads both of these to render the lecturer's UI.

---

### Functional Requirements

**FR-1 Score each answer**
Call Gemini to score every `VivaAnswer` in the transcript on a 0–10 scale based on understanding of the student's own code — not fluency, grammar, or correctness of English. The relevant code snippet (`relevantCodeSnippet` from the `Question`) must be included in the Gemini prompt so scoring is grounded in the actual submission.

**FR-2 Compute overall score**
Calculate `overallScore` (0–100) as: `average(question scores) × 10`. This is pure arithmetic — no AI involvement.

**FR-3 Assign score label**
Map `overallScore` to `"Strong"`, `"Adequate"`, or `"Needs Review"` using thresholds defined in a `scoringConfig.ts` file (not hardcoded). Provisional thresholds: Strong ≥ 75, Adequate ≥ 50, Needs Review < 50.

**FR-4 Identify strongest and weakest answers**
Pick the `ScoredAnswer` with the highest and lowest score respectively and write them into `strongestAnswer` / `weakestAnswer` on the report.

**FR-5 Inconsistency detection**
Run a separate Gemini call that compares the student's answers (the full transcript) against their submitted code/text. The output is an `InconsistencyResult` with three fields: `flagged` (boolean), `evidence` (a specific quote or reference — not a vague summary), and `severity` (`"minor"` or `"notable"`). This result is kept completely separate from the understanding score and never changes it.

**FR-6 Write VivaReport to Firestore**
Write the completed `VivaReport` document to `vivaReports/{vivaId}`. Never overwrite an existing document — each viva attempt is immutable once scored.

**FR-7 Update ClassStats in Firestore**
After writing the `VivaReport`, recalculate and overwrite `classStats/{assignmentId}`. Use only the latest attempt per student (highest `attemptNumber`). ClassStats includes: `totalStudents`, `averageScore`, `scoreDistribution` (strong / adequate / needsReview counts), `topicBreakdown` (sorted weakest-first, flagged if below threshold), and `flaggedStudents` (anyone below Needs Review threshold or with an inconsistency flag).

**FR-8 40 synthetic demo students**
Provide a seed script that writes 40 realistic fake `VivaReport` documents to Firestore for a fixed demo `assignmentId`. The data must span all three score bands and include a mix of flagged/unflagged inconsistencies, so the class view is interesting for the demo. Running the seed must also trigger a `ClassStats` recalculation.

**FR-9 Expose a callable entry point**
Task 3's logic must be triggerable by Task 2 (after the viva ends) via a single async function call or an HTTP endpoint on Cloud Run — whichever fits the team's integration pattern. This must be agreed with the Task 2 owner.

---

### Non-Functional Requirements

- **NFR-1** The entire scoring pipeline (FR-1 through FR-6) must complete within 30 seconds for a 5-question viva on a standard Cloud Run instance, so the lecturer report is ready before the student leaves the page.
- **NFR-2** Gemini prompts must explicitly instruct the model not to penalise non-native English, nervousness, or hesitation.
- **NFR-3** The inconsistency check must use language that is neutral and evidential ("the student's answer does not reference X, but X is central to line 40") — never accusatory ("likely AI-generated", "suspicious").
- **NFR-4** `scoringConfig.ts` must be the single source of truth for all numeric thresholds. No magic numbers in scoring logic.
- **NFR-5** All Firestore writes must be idempotent for the `VivaReport` (write-once, guarded by existence check) and safe-to-overwrite for `ClassStats`.

---

## Design

### Technology

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Next.js API route or Cloud Run HTTP handler (TypeScript) | Matches the team's stack (Cloud Run + Next.js) |
| AI calls | `@google/generative-ai` SDK, `gemini-2.0-flash` | Fast, low-cost, sufficient for scoring |
| Database | Firestore SDK (`firebase-admin`) | Matches the shared data contract |
| Config | `scoringConfig.ts` | Single source of truth for thresholds |

---

### Module Structure

```
src/lib/scoring/
  types.ts                 ← already exists (shared contract, do not modify without team agreement)
  scoringConfig.ts         ← thresholds and prompt templates
  scoreAnswers.ts          ← FR-1: calls Gemini to score each answer
  computeReport.ts         ← FR-2, FR-3, FR-4: pure arithmetic, builds VivaReport
  detectInconsistency.ts   ← FR-5: calls Gemini for the inconsistency check
  updateClassStats.ts      ← FR-7: reads all VivaReports for an assignment, recalculates ClassStats
  scoringPipeline.ts       ← FR-6, FR-9: orchestrates the full pipeline, entry point for Task 2

src/app/api/score/route.ts ← HTTP entry point (POST /api/score) for Cloud Run / Task 2

scripts/
  seedDemoStudents.ts      ← FR-8: writes 40 synthetic VivaReports + triggers ClassStats
```

---

### Data Flow

```
Task 2 completes viva
        │
        ▼
POST /api/score  { vivaId }
        │
        ▼
scoringPipeline.ts
  1. Read VivaTranscript from Firestore         (vivaTranscripts/{vivaId})
  2. Read Submission from Firestore             (submissions/{submissionId})
  3. scoreAnswers()      → ScoredAnswer[]       (Gemini call, parallel per answer)
  4. computeReport()     → VivaReport draft     (pure arithmetic, no AI)
  5. detectInconsistency() → InconsistencyResult (Gemini call, one call)
  6. Write VivaReport to Firestore              (vivaReports/{vivaId}, write-once)
  7. updateClassStats()  → ClassStats           (read all reports, recalculate, overwrite)
        │
        ▼
Task 4 reads VivaReport + ClassStats to render UI
```

---

### Gemini Prompt Design

**Answer scoring prompt (one call per answer, or batched):**
- Inputs: question text, relevant code snippet, student's full answer
- Instruction: score 0–10 for understanding of the student's own code; ignore fluency; ignore grammar; one sentence of feedback; return JSON `{ score: number, feedback: string }`

**Inconsistency detection prompt (one call for the whole viva):**
- Inputs: full submitted code/text, all Q&A pairs
- Instruction: compare whether the answers show knowledge of the submitted code; flag only if there is specific, citable evidence; return JSON `{ flagged: boolean, evidence: string | null, severity: "minor" | "notable" | null }`; never use words like "suspicious" or "AI-generated"

---

### `scoringConfig.ts` Shape

```typescript
export const SCORING_CONFIG = {
  thresholds: {
    strong: 75,
    adequate: 50,
    // below adequate = "Needs Review"
  },
  flaggedTopicThreshold: 50,   // topics below this score are flagged in ClassStats
  geminiModel: "gemini-2.0-flash",
  maxScoringRetries: 2,
} as const;
```

---

## Tasks

Work through these in order. Each task is independently testable.

---

### T3-1 — Scaffold the module structure
Create the empty files listed in the module structure above with their export signatures but no implementation. This lets the rest of the team import from your module immediately even before the logic is done.

**Done when:** `src/lib/scoring/scoringConfig.ts`, `scoreAnswers.ts`, `computeReport.ts`, `detectInconsistency.ts`, `updateClassStats.ts`, `scoringPipeline.ts`, and `src/app/api/score/route.ts` all exist and TypeScript compiles without errors.

---

### T3-2 — `scoringConfig.ts`
Fill in the config object with all thresholds and the Gemini model name. Add the two prompt template strings (answer scoring and inconsistency detection) with `{placeholder}` slots for dynamic values.

**Done when:** the file exports `SCORING_CONFIG` and both prompt templates; values match the Requirements section above.

---

### T3-3 — `scoreAnswers.ts`
Implement `scoreAnswers(answers: VivaAnswer[], questions: Question[], submittedText: string | null): Promise<ScoredAnswer[]>`. Call Gemini once per answer (or batch if the model supports it). Parse the JSON response; if parsing fails, retry up to `maxScoringRetries` times before throwing. Carry through `followUpCount` and `answerDurationMs` unchanged.

**Done when:** unit-testable with a mocked Gemini client; returns correctly shaped `ScoredAnswer[]` for a 3-question fixture.

---

### T3-4 — `computeReport.ts`
Implement `computeReport(transcript: VivaTranscript, scoredAnswers: ScoredAnswer[], inconsistency: InconsistencyResult): VivaReport`. Pure function — no I/O, no AI. Computes `overallScore`, `scoreLabel`, `strongestAnswer`, `weakestAnswer`, and assembles the full `VivaReport` object.

**Done when:** unit-testable with no mocks; deterministic for the same input.

---

### T3-5 — `detectInconsistency.ts`
Implement `detectInconsistency(transcript: VivaTranscript, submission: Submission): Promise<InconsistencyResult>`. One Gemini call. Parse the JSON response with retry. Never produce language that implies guilt. Return `{ flagged: false, evidence: null, severity: null }` if `submission.submittedText` is null (nothing to compare against).

**Done when:** returns a valid `InconsistencyResult` for a fixture; gracefully handles a null `submittedText`.

---

### T3-6 — `scoringPipeline.ts` + Firestore writes
Implement `runScoringPipeline(vivaId: string): Promise<VivaReport>`. Orchestrates T3-3 through T3-5, writes the report to Firestore (guarded by existence check), then calls `updateClassStats`. Return the completed `VivaReport`.

**Done when:** calling it with a real `vivaId` (with a test transcript in Firestore) produces a written `VivaReport` document and an updated `ClassStats` document.

---

### T3-7 — `updateClassStats.ts`
Implement `updateClassStats(assignmentId: string): Promise<ClassStats>`. Query all `VivaReport` documents for the assignment, deduplicate to latest attempt per student, calculate all stats, overwrite `classStats/{assignmentId}`.

**Done when:** produces correct counts and topic breakdown for a set of 5 manually written fixture reports covering all three score bands.

---

### T3-8 — `src/app/api/score/route.ts`
POST handler that accepts `{ vivaId: string }`, calls `runScoringPipeline(vivaId)`, and returns `{ success: true, vivaId, overallScore, scoreLabel }`. Returns 400 if `vivaId` is missing, 404 if the transcript doesn't exist, 500 on pipeline failure.

**Done when:** deployable to Cloud Run; Task 2 can call it and get a 200 back with the correct shape.

---

### T3-9 — `scripts/seedDemoStudents.ts`
Write 40 synthetic `VivaTranscript` + `Submission` documents to Firestore (with `assignmentId = "demo-assignment-001"`), run `runScoringPipeline` for each, then call `updateClassStats`. Distribution: ~15 Strong, ~15 Adequate, ~10 Needs Review; ~8 with inconsistency flags; topic breakdown must show at least one clearly weak topic (e.g. "recursion" averaging < 40).

**Done when:** running the script results in 40 `VivaReport` documents and one `ClassStats` document in Firestore, and the class view demo looks credible.

---

### T3-10 — Integration check with Task 2 and Task 4
Coordinate with the Task 2 owner: confirm the POST `/api/score` endpoint URL and payload shape. Coordinate with the Task 4 owner: confirm they can read `VivaReport` and `ClassStats` with the types from `types.ts`. No code changes expected — this is a verification step.

**Done when:** Task 2 has called the endpoint at least once in a shared Firestore environment and Task 4 can render a report from real data.

---

## Summary of Dependencies

| You need from | What |
|---|---|
| Task 1 | `Submission` documents in Firestore with `questions[].relevantCodeSnippet` and `questions[].topic` populated — without these, FR-1 and FR-7 cannot work. Flag this early. |
| Task 2 | `VivaTranscript` documents in Firestore before you can test the pipeline end-to-end. Use fixture data locally until Task 2 is ready. |
| Task 4 | Nothing — they depend on you, not the other way around. |
