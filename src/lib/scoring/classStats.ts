/**
 * classStats.ts — Calculates class-wide statistics for one assignment.
 *
 * This is the second output of Task 3 (Scoring & Insights), alongside
 * scoreViva.ts. It takes the array of VivaReport documents that Task 3
 * has already produced and aggregates them into a single ClassStats document
 * that Task 4 displays on the lecturer's class-wide dashboard.
 *
 * What this file does:
 *   1. Filters out any reports that do not belong to the requested assignment.
 *   2. Keeps only the latest viva attempt per student.
 *   3. Counts total students and calculates the average overall score.
 *   4. Counts how many students fall into each score band (Strong / Adequate /
 *      Needs Review).
 *   5. Builds a per-topic performance breakdown from all scored answers.
 *   6. Lists students whose inconsistency check was flagged.
 *
 * What this file does NOT do:
 *   - No Gemini API calls.
 *   - No Firestore reads or writes.
 *   - No score modification of any kind.
 *   - followUpCount and answerDurationMs are completely ignored.
 *
 * This function is synchronous. All the data it needs arrives in the
 * VivaReport array — no async operations are required.
 */

import { ADEQUATE_THRESHOLD, STRONG_THRESHOLD } from "./scoringConfig";
import type {
  VivaReport,
  ClassStats,
  TopicBreakdown,
  FlaggedStudent,
} from "./types";

// ---------------------------------------------------------------------------
// HELPER: selectLatestReports
//
// Given a flat array of VivaReport records (possibly containing multiple
// attempts from the same student), returns a new array containing only the
// single most-recent report for each unique studentId.
//
// Selection rules (applied in order):
//   1. Keep the report with the higher attemptNumber.
//   2. If attemptNumber is tied, keep the report with the later scoredAt
//      timestamp. ISO 8601 strings sort lexicographically in date order, so
//      a plain string comparison is correct here.
//
// Reports belonging to a different assignmentId have already been removed
// by the caller before this function is called.
// ---------------------------------------------------------------------------

/**
 * Returns one VivaReport per student — the latest attempt for each.
 *
 * @param reports - All valid VivaReport records for a single assignment.
 * @returns        An array with at most one entry per studentId.
 */
function selectLatestReports(reports: VivaReport[]): VivaReport[] {
  // We use a Map keyed by studentId. The value is the "best" report seen so
  // far for that student. We iterate once through the array and update the
  // Map whenever we find a newer attempt.
  const latestByStudent = new Map<string, VivaReport>();

  for (const report of reports) {
    const existing = latestByStudent.get(report.studentId);

    if (!existing) {
      // First time we've seen this student — store the report.
      latestByStudent.set(report.studentId, report);
      continue;
    }

    // Compare this report against the one already stored for this student.
    // Rule 1: higher attemptNumber wins.
    if (report.attemptNumber > existing.attemptNumber) {
      latestByStudent.set(report.studentId, report);
      continue;
    }

    // Rule 2: if attemptNumber is the same, the later scoredAt wins.
    // ISO 8601 strings (e.g. "2026-11-05T10:30:00.000Z") compare correctly
    // as plain strings because the format is zero-padded and date-first.
    if (
      report.attemptNumber === existing.attemptNumber &&
      report.scoredAt > existing.scoredAt
    ) {
      latestByStudent.set(report.studentId, report);
    }

    // If neither condition is true, the existing entry is already the better
    // one — leave it in place.
  }

  // Convert the Map values to a plain array.
  return Array.from(latestByStudent.values());
}

// ---------------------------------------------------------------------------
// HELPER: buildTopicBreakdown
//
// Groups every ScoredAnswer from every report by its topic field, then
// calculates a per-topic average score and question count.
//
// Key details:
//   - ScoredAnswer.score is on a 0–10 scale.
//   - TopicBreakdown.averageScore is specified as 0–100 in types.ts.
//   - We scale by multiplying the 0–10 average by 10, rounded to 1 decimal.
//   - A topic is flagged when its 0–100 average is below ADEQUATE_THRESHOLD.
//   - The result is sorted ascending by averageScore (weakest topics first),
//     matching the sort order described in types.ts for the lecturer view.
// ---------------------------------------------------------------------------

/**
 * Builds the per-topic performance breakdown from the selected latest reports.
 *
 * @param selectedReports - One report per student (latest attempt).
 * @returns                An array of TopicBreakdown objects, sorted by
 *                         averageScore ascending (weakest topic first).
 */
function buildTopicBreakdown(selectedReports: VivaReport[]): TopicBreakdown[] {
  // Accumulate scores per topic.
  // Key: topic name (string).
  // Value: array of individual ScoredAnswer scores (each 0–10).
  const scoresByTopic = new Map<string, number[]>();

  for (const report of selectedReports) {
    for (const scoredAnswer of report.scoredAnswers) {
      // Skip any answer with a missing or empty topic — we cannot group it.
      if (!scoredAnswer.topic || scoredAnswer.topic.trim() === "") {
        continue;
      }

      const existing = scoresByTopic.get(scoredAnswer.topic);
      if (existing) {
        existing.push(scoredAnswer.score);
      } else {
        // First time seeing this topic — start a new bucket.
        scoresByTopic.set(scoredAnswer.topic, [scoredAnswer.score]);
      }
    }
  }

  // Convert each topic bucket into a TopicBreakdown entry.
  const breakdown: TopicBreakdown[] = [];

  for (const [topic, scores] of scoresByTopic.entries()) {
    const questionCount = scores.length;

    // Average of the 0–10 per-answer scores.
    const average010 = scores.reduce((sum, s) => sum + s, 0) / questionCount;

    // Scale to 0–100 (same convention as overallScore in VivaReport).
    // Round to 1 decimal to avoid floating-point noise.
    const averageScore = Math.round(average010 * 10 * 10) / 10;

    // Flag the topic when its class-wide average is below the Adequate threshold.
    // This signals to the lecturer that the topic may need to be retaught.
    // ADEQUATE_THRESHOLD is in the 0–100 scale (value: 50), which matches
    // the averageScore we calculated above.
    const flagged = averageScore < ADEQUATE_THRESHOLD;

    breakdown.push({ topic, averageScore, questionCount, flagged });
  }

  // Sort ascending by averageScore so the weakest topics appear first.
  // Flagged topics will naturally appear at the top of this sorted list.
  breakdown.sort((a, b) => a.averageScore - b.averageScore);

  return breakdown;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT: calculateClassStats
// ---------------------------------------------------------------------------

/**
 * Calculates class-wide statistics for one assignment from an array of
 * VivaReport records and returns a ClassStats object.
 *
 * Only the latest viva attempt per student is included. Reports that belong
 * to a different assignment are silently ignored.
 *
 * This function is synchronous — it performs only in-memory calculations on
 * the data provided and makes no API calls or database reads.
 *
 * @param assignmentId - The assignment these stats are being calculated for.
 * @param reports      - All VivaReport records available (may include reports
 *                       from other assignments or multiple attempts per student;
 *                       this function filters and deduplicates them).
 * @returns             A ClassStats object ready to be written to Firestore
 *                      (or used by Task 4 directly).
 *
 * @example
 * const stats = calculateClassStats("assignment-abc", allReports);
 * // stats.totalStudents  → e.g. 12
 * // stats.averageScore   → e.g. 68.3
 * // stats.scoreDistribution.strong → e.g. 4
 */
export function calculateClassStats(
  assignmentId: string,
  reports: VivaReport[]
): ClassStats {
  // -------------------------------------------------------------------------
  // STEP 1 — Filter to only reports that belong to the requested assignment.
  //
  // The caller may pass in all reports from a collection. We discard anything
  // that does not match assignmentId so it never contaminates the stats.
  // -------------------------------------------------------------------------

  const assignmentReports = reports.filter(
    (r) => r.assignmentId === assignmentId
  );

  // -------------------------------------------------------------------------
  // STEP 2 — Select the latest attempt per student.
  //
  // A student may have completed multiple viva attempts. We only count the
  // most recent one. The helper function handles the comparison logic.
  // -------------------------------------------------------------------------

  const selectedReports = selectLatestReports(assignmentReports);

  // -------------------------------------------------------------------------
  // STEP 3 — Total students.
  //
  // One selected report = one unique student with a completed viva.
  // -------------------------------------------------------------------------

  const totalStudents = selectedReports.length;

  // -------------------------------------------------------------------------
  // STEP 4 — Average overall score (0–100).
  //
  // Guard against division by zero when there are no valid reports.
  // -------------------------------------------------------------------------

  let averageScore: number;

  if (totalStudents === 0) {
    averageScore = 0;
  } else {
    const totalOverallScore = selectedReports.reduce(
      (sum, r) => sum + r.overallScore,
      0
    );
    // Round to 1 decimal place for consistency with individual overallScores.
    averageScore = Math.round((totalOverallScore / totalStudents) * 10) / 10;
  }

  // -------------------------------------------------------------------------
  // STEP 5 — Score distribution.
  //
  // Count how many students fall into each of the three score bands.
  // We derive the band from overallScore using the same thresholds from
  // scoringConfig.ts that scoreViva.ts used to assign scoreLabel. This is
  // equivalent for all well-formed reports, but is more robust: if a report
  // arrives with a missing or unexpected scoreLabel string (e.g. due to a
  // Firestore read issue), the number in overallScore still classifies it
  // correctly rather than silently falling into the needsReview bucket.
  // -------------------------------------------------------------------------

  const scoreDistribution = {
    strong: 0,
    adequate: 0,
    needsReview: 0,
  };

  for (const report of selectedReports) {
    if (report.overallScore >= STRONG_THRESHOLD) {
      scoreDistribution.strong += 1;
    } else if (report.overallScore >= ADEQUATE_THRESHOLD) {
      scoreDistribution.adequate += 1;
    } else {
      // overallScore < ADEQUATE_THRESHOLD → Needs Review band.
      scoreDistribution.needsReview += 1;
    }
  }

  // -------------------------------------------------------------------------
  // STEP 6 — Topic breakdown.
  //
  // Delegate to the helper function which groups all scoredAnswers by topic,
  // calculates averages, and sorts the result weakest-first.
  // -------------------------------------------------------------------------

  const topicBreakdown: TopicBreakdown[] = buildTopicBreakdown(selectedReports);

  // -------------------------------------------------------------------------
  // STEP 7 — Flagged students (FR-7).
  //
  // A student is included in this list if EITHER condition is true:
  //   (a) Their overallScore is below ADEQUATE_THRESHOLD (i.e. Needs Review band).
  //   (b) Their inconsistency check was flagged by Gemini.
  //
  // OR logic: a student satisfying both conditions is still included only once
  // because we filter the selectedReports array (one entry per student) and
  // then map each matching report to a single FlaggedStudent record.
  //
  // inconsistencyFlagged is set from the report's actual inconsistency.flagged
  // value, not hardcoded to true, so a student included purely for a low score
  // correctly shows inconsistencyFlagged: false on their record.
  //
  // This list is informational for the lecturer — it signals who may need
  // follow-up. It is NOT evidence of misconduct.
  // -------------------------------------------------------------------------

  const flaggedStudents: FlaggedStudent[] = selectedReports
    .filter(
      (r) =>
        r.overallScore < ADEQUATE_THRESHOLD ||  // condition (a): Needs Review band
        r.inconsistency.flagged === true         // condition (b): inconsistency flag
    )
    .map((r) => ({
      studentId: r.studentId,
      overallScore: r.overallScore,
      // Reflects the actual inconsistency result, not assumed to be true.
      // A student included only for a low score will have inconsistencyFlagged: false.
      inconsistencyFlagged: r.inconsistency.flagged,
    }));

  // -------------------------------------------------------------------------
  // STEP 8 — Assemble and return the ClassStats object.
  // -------------------------------------------------------------------------

  const classStats: ClassStats = {
    assignmentId,

    // Timestamp marking when this calculation was performed.
    calculatedAt: new Date().toISOString(),

    totalStudents,
    averageScore,
    scoreDistribution,
    topicBreakdown,
    flaggedStudents,
  };

  return classStats;
}
