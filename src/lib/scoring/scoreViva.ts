/**
 * scoreViva.ts — Orchestrates the full scoring pipeline for one viva session.
 *
 * This is the main entry point for Task 3 (Scoring & Insights).
 * It coordinates the two AI calls (evaluateAnswer and detectInconsistency),
 * calculates the overall score, assigns the score label, and packages
 * everything into a VivaReport that Task 4 can read from Firestore.
 *
 * What this file does:
 *   1. Matches each VivaAnswer to its Question in the Submission by questionId.
 *   2. Calls evaluateAnswer once per matched answer to get a score + feedback.
 *   3. Calculates the overall score (0–100) from the average of individual scores.
 *   4. Assigns a score label ("Strong", "Adequate", or "Needs Review").
 *   5. Identifies the strongest and weakest answers.
 *   6. Calls detectInconsistency once for the full session.
 *   7. Returns a VivaReport that exactly matches the interface in types.ts.
 *
 * What this file does NOT do:
 *   - No Gemini API calls directly (those live in evaluateAnswer.ts and
 *     detectInconsistency.ts — we just call them).
 *   - No Firestore reads or writes.
 *   - No score modification based on follow-up count or answer duration.
 *
 * IMPORTANT: This file must only run server-side because it calls functions
 * that read GEMINI_API_KEY from process.env.
 */

import { evaluateAnswer } from "./evaluateAnswer";
import { detectInconsistency } from "./detectInconsistency";
import {
  STRONG_THRESHOLD,
  ADEQUATE_THRESHOLD,
} from "./scoringConfig";
import type {
  Submission,
  VivaTranscript,
  VivaReport,
  ScoredAnswer,
  AnswerSummary,
} from "./types";

// ---------------------------------------------------------------------------
// HELPER: assignScoreLabel
// Converts a 0–100 overall score into a human-readable label.
// Uses the thresholds from scoringConfig.ts — no magic numbers here.
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate score label for a given overall score.
 *
 * @param overallScore - A number in the range 0–100.
 * @returns "Strong", "Adequate", or "Needs Review".
 *
 * @example
 * assignScoreLabel(80); // → "Strong"
 * assignScoreLabel(60); // → "Adequate"
 * assignScoreLabel(40); // → "Needs Review"
 */
function assignScoreLabel(
  overallScore: number
): "Strong" | "Adequate" | "Needs Review" {
  if (overallScore >= STRONG_THRESHOLD) {
    return "Strong";
  }
  if (overallScore >= ADEQUATE_THRESHOLD) {
    return "Adequate";
  }
  return "Needs Review";
}

// ---------------------------------------------------------------------------
// HELPER: toAnswerSummary
// Extracts the fields needed for the strongestAnswer / weakestAnswer fields.
// ---------------------------------------------------------------------------

/**
 * Creates an AnswerSummary from a ScoredAnswer.
 * Used to populate strongestAnswer and weakestAnswer in the VivaReport.
 */
function toAnswerSummary(scored: ScoredAnswer): AnswerSummary {
  return {
    questionId: scored.questionId,
    questionText: scored.questionText,
    score: scored.score,
    feedback: scored.feedback,
  };
}

// ---------------------------------------------------------------------------
// MAIN EXPORT: scoreViva
// ---------------------------------------------------------------------------

/**
 * Scores a complete viva session and returns a VivaReport.
 *
 * Steps performed:
 *   1. Each answer in the transcript is matched to its Question in the
 *      submission by questionId. Unmatched answers are skipped with a warning
 *      so that one bad questionId does not break the entire scoring run.
 *   2. evaluateAnswer is called for each matched answer.
 *   3. The overall score is the average of all individual scores (0–10),
 *      scaled to 0–100 by multiplying by 10. Result is rounded to 1 decimal.
 *      If no answers were scored (empty or all unmatched), overallScore is 0.
 *   4. The score label is assigned using thresholds from scoringConfig.ts.
 *   5. The strongest and weakest answers are identified.
 *      If only one answer was scored, it is used for both.
 *   6. detectInconsistency is called once for the whole session.
 *   7. A VivaReport is assembled and returned.
 *
 * @param transcript  - The student's complete viva session record (from Task 2).
 * @param submission  - The student's submitted assignment (from Task 1).
 * @returns           A promise resolving to a fully populated VivaReport.
 *
 * @throws If evaluateAnswer or detectInconsistency throw (e.g. missing API key,
 *         Gemini error, invalid response). The caller is responsible for handling
 *         these errors — this function does not silently swallow them.
 *
 * @example
 * const report = await scoreViva(transcript, submission);
 * // report.overallScore → e.g. 73
 * // report.scoreLabel   → "Adequate"
 */
export async function scoreViva(
  transcript: VivaTranscript,
  submission: Submission
): Promise<VivaReport> {
  // -------------------------------------------------------------------------
  // GUARD — Ensure the transcript and submission belong to the same submission.
  //
  // If a caller accidentally passes a transcript and a submission that are not
  // paired, every questionId lookup will fail (or silently match the wrong
  // question), and the inconsistency check will compare the wrong submitted
  // text against the student's answers. We catch this early with a clear error
  // rather than letting it produce a silently corrupt report.
  // -------------------------------------------------------------------------

  if (transcript.submissionId !== submission.submissionId) {
    throw new Error(
      `Mismatched documents: transcript "${transcript.vivaId}" belongs to submission ` +
        `"${transcript.submissionId}", but the submission passed in has id ` +
        `"${submission.submissionId}". The transcript and submission must belong to ` +
        `the same student assignment before scoring can proceed.`
    );
  }

  // -------------------------------------------------------------------------
  // STEP 1 — Match each answer to its Question and call evaluateAnswer.
  //
  // We process answers sequentially (one at a time) rather than in parallel
  // to avoid overwhelming the Gemini API with concurrent requests. If the
  // project later needs faster scoring, this can be changed to Promise.all,
  // but sequential is clearer for a hackathon prototype.
  // -------------------------------------------------------------------------

  const scoredAnswers: ScoredAnswer[] = [];

  for (const vivaAnswer of transcript.answers) {
    // Look up the matching question in the submission using questionId.
    const matchedQuestion = submission.questions.find(
      (q) => q.questionId === vivaAnswer.questionId
    );

    // Safety check: if no matching question exists, skip this answer.
    // This prevents scoring an answer against the wrong question or
    // inventing question details that were not in the submission.
    if (!matchedQuestion) {
      console.warn(
        `[scoreViva] No matching question found for questionId "${vivaAnswer.questionId}" ` +
          `in submission "${submission.submissionId}". Skipping this answer.`
      );
      continue; // Move on to the next answer — do not crash the whole run.
    }

    // Call evaluateAnswer with the four fields it needs.
    // evaluateAnswer handles the empty-answer case internally (returns score 0).
    const evaluation = await evaluateAnswer({
      questionText: vivaAnswer.questionText,
      relevantCodeSnippet: matchedQuestion.relevantCodeSnippet,
      topic: matchedQuestion.topic,
      studentAnswer: vivaAnswer.studentAnswer,
    });

    // Build the ScoredAnswer by combining:
    //   - identifiers and display text from the VivaAnswer and matched Question
    //   - score + feedback from Gemini (via evaluateAnswer)
    //   - informational fields (followUpCount, answerDurationMs) from VivaAnswer,
    //     carried through unchanged and NOT used in any score calculation
    const scoredAnswer: ScoredAnswer = {
      questionId: vivaAnswer.questionId,
      questionText: vivaAnswer.questionText,
      studentAnswer: vivaAnswer.studentAnswer,
      topic: matchedQuestion.topic,
      score: evaluation.score,
      feedback: evaluation.feedback,
      // Informational only — carried through for the lecturer report display.
      followUpCount: vivaAnswer.followUpCount,
      answerDurationMs: vivaAnswer.answerDurationMs,
    };

    scoredAnswers.push(scoredAnswer);
  }

  // -------------------------------------------------------------------------
  // STEP 2 — Calculate the overall score (0–100).
  //
  // Formula: (sum of individual scores) / (number of scores) * 10
  //
  // Each individual score is 0–10, so the average is also 0–10.
  // Multiplying by 10 scales it to the 0–100 range required by VivaReport.
  //
  // Edge case: if no answers were scored (empty transcript or all unmatched),
  // we default to 0 to avoid division by zero.
  // -------------------------------------------------------------------------

  let overallScore: number;

  if (scoredAnswers.length === 0) {
    // No answers to average — overall score is 0 by definition.
    overallScore = 0;
  } else {
    const totalScore = scoredAnswers.reduce(
      (sum, answer) => sum + answer.score,
      0 // Initial accumulator value.
    );

    // Step 1: compute the average of the 0–10 per-answer scores.
    const average = totalScore / scoredAnswers.length; // range: 0–10

    // Step 2: scale to 0–100 by multiplying by 10.
    const scaledTo100 = average * 10; // range: 0–100

    // Step 3: round to 1 decimal place to avoid floating-point noise
    // (e.g. average = 6.6666... → scaledTo100 = 66.6666... → 66.7).
    // Technique: multiply by 10, round to nearest integer, divide by 10.
    overallScore = Math.round(scaledTo100 * 10) / 10;
  }

  // -------------------------------------------------------------------------
  // STEP 3 — Assign the score label using scoringConfig.ts thresholds.
  // -------------------------------------------------------------------------

  const scoreLabel = assignScoreLabel(overallScore);

  // -------------------------------------------------------------------------
  // STEP 4 — Identify the strongest and weakest answers.
  //
  // We sort a copy of the scored answers by score descending to find the
  // highest and lowest. The original scoredAnswers array order is preserved
  // for the report.
  //
  // If only one answer exists, it becomes both strongest and weakest.
  // If no answers exist, we use a placeholder (overallScore is already 0
  // in that case, so the report is internally consistent).
  // -------------------------------------------------------------------------

  let strongestAnswer: AnswerSummary;
  let weakestAnswer: AnswerSummary;

  if (scoredAnswers.length === 0) {
    // Edge case: no answers were scored. Use a neutral placeholder so the
    // VivaReport can still be constructed and stored without crashing.
    // The overallScore will be 0 and the lecturer will see an empty answer list.
    //
    // IMPORTANT FOR TASK 4:
    // An empty questionId ("") is a sentinel value that means no answers were
    // successfully scored — it does NOT refer to a real question in Firestore.
    // Before rendering strongestAnswer or weakestAnswer as a real question (e.g.
    // displaying its text or linking to it), Task 4 must first check:
    //   if (report.scoredAnswers.length === 0) { /* skip or hide these fields */ }
    const emptyPlaceholder: AnswerSummary = {
      questionId: "",
      questionText: "No answers were scored.",
      score: 0,
      feedback: "No answers were available to evaluate.",
    };
    strongestAnswer = emptyPlaceholder;
    weakestAnswer = emptyPlaceholder;
  } else {
    // Sort a copy by score descending — highest score first.
    const sortedByScore = [...scoredAnswers].sort(
      (a, b) => b.score - a.score
    );

    // First element after descending sort is the strongest.
    strongestAnswer = toAnswerSummary(sortedByScore[0]);

    // Last element after descending sort is the weakest.
    weakestAnswer = toAnswerSummary(sortedByScore[sortedByScore.length - 1]);
  }

  // -------------------------------------------------------------------------
  // STEP 5 — Run the inconsistency check.
  //
  // detectInconsistency is called exactly once for the whole session.
  // Its result is NEVER used to adjust overallScore or scoreLabel.
  // It is included in the report as a separate, independent data point for
  // the lecturer to review.
  // -------------------------------------------------------------------------

  const inconsistency = await detectInconsistency(transcript, submission);

  // -------------------------------------------------------------------------
  // STEP 6 — Assemble and return the VivaReport.
  //
  // Every field required by the VivaReport interface in types.ts is populated
  // here. Fields are sourced from the transcript, submission, calculated values
  // above, and a fresh timestamp for scoredAt.
  // -------------------------------------------------------------------------

  const vivaReport: VivaReport = {
    // Identity fields — copied from the transcript to link this report back
    // to the correct session, student, and assignment.
    vivaId: transcript.vivaId,
    submissionId: transcript.submissionId,
    studentId: transcript.studentId,
    assignmentId: transcript.assignmentId,

    // Attempt number — copied from the transcript so Task 4 can display
    // "Attempt 1", "Attempt 2", etc. in the lecturer view.
    attemptNumber: transcript.attemptNumber,

    // When this report was generated.
    scoredAt: new Date().toISOString(),

    // The calculated overall score (0–100) and its label.
    overallScore,
    scoreLabel,

    // All individually scored answers, in original transcript order.
    scoredAnswers,

    // Best and worst individual answers for the report summary.
    strongestAnswer,
    weakestAnswer,

    // Inconsistency check result — separate from the score.
    inconsistency,
  };

  return vivaReport;
}
