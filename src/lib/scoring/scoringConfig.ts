/**
 * scoringConfig.ts — Central configuration for the Prove It scoring system.
 *
 * This is the SINGLE SOURCE OF TRUTH for all numeric thresholds and score
 * boundaries used in Task 3 (Scoring & Insights).
 *
 * No magic numbers should appear in any other Task 3 file.
 * If a threshold needs to change, change it here — nowhere else.
 *
 * No AI logic, no Gemini calls, no scoring calculations live here.
 * This file only defines constants and types.
 */

// ---------------------------------------------------------------------------
// SCORE LABEL TYPE
// The three human-readable labels that summarise a student's overall score.
// Defined here so every Task 3 file uses the same type, and so Task 4 can
// import it from one place when rendering the report.
// ---------------------------------------------------------------------------

/**
 * The three possible overall score labels for a student's viva result.
 *
 * - "Strong"       — the student demonstrated solid understanding.
 * - "Adequate"     — the student showed acceptable understanding with some gaps.
 * - "Needs Review" — the student's answers suggest significant gaps; the
 *                    lecturer should follow up.
 *
 * The label is NEVER shown to the student directly. It is for the lecturer
 * report only. The lecturer always makes the final judgement.
 */
export type ScoreLabel = "Strong" | "Adequate" | "Needs Review";

// ---------------------------------------------------------------------------
// OVERALL SCORE THRESHOLDS
// The overall score is a number from 0 to 100.
// These thresholds decide which ScoreLabel a student receives.
//
// How to read the thresholds:
//   overallScore >= STRONG_THRESHOLD              → "Strong"
//   overallScore >= ADEQUATE_THRESHOLD            → "Adequate"
//   overallScore <  ADEQUATE_THRESHOLD            → "Needs Review"
// ---------------------------------------------------------------------------

/**
 * The minimum overall score (0–100) required to receive the "Strong" label.
 *
 * Example: a score of 80 is >= 75, so the label is "Strong".
 * Example: a score of 74 is < 75, so it falls to the next check.
 */
export const STRONG_THRESHOLD = 75;

/**
 * The minimum overall score (0–100) required to receive the "Adequate" label.
 * Any score below this threshold receives "Needs Review".
 *
 * Example: a score of 60 is >= 50, so the label is "Adequate".
 * Example: a score of 45 is < 50, so the label is "Needs Review".
 */
export const ADEQUATE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// PER-ANSWER SCORE BOUNDARIES
// Gemini scores each individual answer on a scale of 0 to 10.
// These constants define the allowed minimum and maximum for a single answer.
// Use these when validating Gemini's response or clamping unexpected values.
// ---------------------------------------------------------------------------

/**
 * The lowest score Gemini can give for a single answer.
 * 0 means the student showed no understanding of that question at all.
 */
export const MIN_ANSWER_SCORE = 0;

/**
 * The highest score Gemini can give for a single answer.
 * 10 means the student demonstrated complete and clear understanding.
 */
export const MAX_ANSWER_SCORE = 10;

// ---------------------------------------------------------------------------
// OVERALL SCORE BOUNDARIES
// The overall score is derived from the per-answer scores (average × 10),
// so it sits on a 0–100 scale. These constants define that scale explicitly.
// Use them when displaying, validating, or clamping the overall score.
// ---------------------------------------------------------------------------

/**
 * The lowest possible overall score.
 * A student who scored 0 on every single answer would receive this.
 */
export const MIN_OVERALL_SCORE = 0;

/**
 * The highest possible overall score.
 * A student who scored 10 on every single answer would receive this.
 */
export const MAX_OVERALL_SCORE = 100;
