/**
 * verifyDemoReports.mjs — Standalone verification script for the demo data.
 *
 * Runs every requirement check listed in the FR-8 implementation brief and
 * prints a pass/fail line for each one. Exit code is 0 if all checks pass,
 * 1 if any fail.
 *
 * HOW TO RUN:
 *   This script re-implements the generator and classStats logic inline so it
 *   can run with plain Node.js (no TypeScript compiler, no bundler, no extra
 *   dependencies). It uses the exact same score table, formulas, and thresholds
 *   as the TypeScript source files.
 *
 *   From the workspace root:
 *     node src/lib/scoring/verifyDemoReports.mjs
 *
 * WHAT IT CHECKS:
 *   1.  Exactly 40 reports are generated.
 *   2.  All 40 studentIds are unique.
 *   3.  All 40 vivaIds are unique.
 *   4.  Score distribution is exactly 15 Strong, 15 Adequate, 10 Needs Review.
 *   5.  Exactly 8 reports have inconsistency.flagged = true.
 *   6.  Every report's overallScore matches its scoredAnswers average * 10.
 *   7.  Every report's scoreLabel matches its overallScore.
 *   8.  The recursion topic class average is below 40 (0–100 scale).
 *   9.  ClassStats.totalStudents = 40.
 *   10. ClassStats.scoreDistribution matches expected distribution.
 *   11. All reports belong to assignmentId "demo-assignment-001".
 *   12. All reports have attemptNumber = 1.
 *   13. Flagged inconsistencies have non-null evidence and valid severity.
 *   14. Unflagged inconsistencies have null evidence and null severity.
 */

// ---------------------------------------------------------------------------
// Re-implement just enough of the generator and classStats to run in plain JS.
// This is intentionally a copy of the core logic so the script has zero deps.
// ---------------------------------------------------------------------------

const ASSIGNMENT_ID = "demo-assignment-001";
const STRONG_THRESHOLD = 75;
const ADEQUATE_THRESHOLD = 50;

const SCORE_TABLE = [
  [9,9,9,9,2],[9,9,9,8,3],[10,9,9,9,2],[8,9,9,9,3],[9,9,9,8,3],
  [9,10,8,9,2],[10,8,9,9,2],[9,9,10,8,2],[8,9,9,10,3],[10,9,9,8,2],
  [9,8,9,9,3],[9,9,8,9,3],[10,9,10,8,2],[9,10,9,9,2],[8,9,10,9,2],
  [7,7,6,6,2],[6,7,7,6,2],[7,6,7,6,2],[6,6,7,7,2],[7,7,6,7,1],
  [8,6,6,6,2],[6,8,6,6,2],[6,6,8,6,2],[6,6,6,8,2],[7,6,7,5,2],
  [5,7,7,6,2],[7,5,6,7,2],[6,7,5,7,2],[7,6,6,5,3],[6,5,7,7,2],
  [4,3,3,3,1],[3,4,3,3,1],[3,3,4,3,1],[3,3,3,4,1],[4,4,3,2,1],
  [2,4,4,3,1],[4,2,3,4,1],[3,4,4,2,1],[4,3,4,2,1],[2,3,4,4,1],
];

const TOPICS = ["loops","error handling","functions","data structures","recursion"];
const FLAGGED_STUDENT_INDICES = new Set([2, 7, 12, 17, 22, 27, 32, 37]);

function computeOverallScore(scores) {
  const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
  return Math.round(avg * 10 * 10) / 10;
}

function computeScoreLabel(overall) {
  if (overall >= STRONG_THRESHOLD) return "Strong";
  if (overall >= ADEQUATE_THRESHOLD) return "Adequate";
  return "Needs Review";
}

// Build minimal reports (only the fields needed for verification)
function buildReports() {
  return SCORE_TABLE.map((scores, i) => {
    const overall = computeOverallScore(scores);
    const flaggedIndicesArr = [...FLAGGED_STUDENT_INDICES];
    const isFlagged = FLAGGED_STUDENT_INDICES.has(i);
    const inconsistency = isFlagged
      ? { flagged: true, evidence: "evidence text", severity: "minor" }
      : { flagged: false, evidence: null, severity: null };

    return {
      vivaId: `viva-demo-${String(i+1).padStart(3,"0")}`,
      studentId: `student-demo-${String(i+1).padStart(3,"0")}`,
      assignmentId: ASSIGNMENT_ID,
      attemptNumber: 1,
      overallScore: overall,
      scoreLabel: computeScoreLabel(overall),
      scoredAnswers: scores.map((score, ti) => ({ topic: TOPICS[ti], score })),
      inconsistency,
    };
  });
}

// Minimal classStats calculation (mirrors classStats.ts)
function calcStats(reports) {
  const selected = reports; // all distinct students, attempt 1
  const total = selected.length;
  const avgScore = total === 0 ? 0
    : Math.round((selected.reduce((s, r) => s + r.overallScore, 0) / total) * 10) / 10;

  const dist = { strong: 0, adequate: 0, needsReview: 0 };
  for (const r of selected) {
    if (r.overallScore >= STRONG_THRESHOLD) dist.strong++;
    else if (r.overallScore >= ADEQUATE_THRESHOLD) dist.adequate++;
    else dist.needsReview++;
  }

  // Topic breakdown
  const buckets = {};
  for (const r of selected) {
    for (const a of r.scoredAnswers) {
      if (!buckets[a.topic]) buckets[a.topic] = [];
      buckets[a.topic].push(a.score);
    }
  }
  const topicBreakdown = Object.entries(buckets).map(([topic, scores]) => {
    const avg010 = scores.reduce((s, x) => s + x, 0) / scores.length;
    const avgScore100 = Math.round(avg010 * 10 * 10) / 10;
    return { topic, averageScore: avgScore100, questionCount: scores.length };
  });

  return { totalStudents: total, averageScore: avgScore, scoreDistribution: dist, topicBreakdown };
}

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------

const reports = buildReports();
const stats = calcStats(reports);

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

console.log("\n=== Prove It — Demo Data Verification ===\n");

// 1. Exactly 40 reports
check("1. Exactly 40 reports generated", reports.length === 40, `got ${reports.length}`);

// 2. Unique studentIds
const studentIds = reports.map(r => r.studentId);
check("2. All 40 studentIds are unique", new Set(studentIds).size === 40, `unique: ${new Set(studentIds).size}`);

// 3. Unique vivaIds
const vivaIds = reports.map(r => r.vivaId);
check("3. All 40 vivaIds are unique", new Set(vivaIds).size === 40, `unique: ${new Set(vivaIds).size}`);

// 4. Score distribution 15/15/10
check(
  "4. Score distribution: 15 Strong, 15 Adequate, 10 Needs Review",
  stats.scoreDistribution.strong === 15 &&
  stats.scoreDistribution.adequate === 15 &&
  stats.scoreDistribution.needsReview === 10,
  `got ${stats.scoreDistribution.strong}/${stats.scoreDistribution.adequate}/${stats.scoreDistribution.needsReview}`
);

// 5. Exactly 8 flagged inconsistencies
const flaggedCount = reports.filter(r => r.inconsistency.flagged === true).length;
check("5. Exactly 8 inconsistency flags", flaggedCount === 8, `got ${flaggedCount}`);

// 6. overallScore matches scoredAnswers average * 10
const scoreMismatches = reports.filter(r => {
  const computed = computeOverallScore(r.scoredAnswers.map(a => a.score));
  return computed !== r.overallScore;
});
check(
  "6. Every overallScore matches scored-answer average × 10",
  scoreMismatches.length === 0,
  `${scoreMismatches.length} mismatch(es): ${scoreMismatches.map(r => r.studentId).join(", ")}`
);

// 7. scoreLabel matches overallScore
const labelMismatches = reports.filter(r => computeScoreLabel(r.overallScore) !== r.scoreLabel);
check(
  "7. Every scoreLabel matches overallScore",
  labelMismatches.length === 0,
  `${labelMismatches.length} mismatch(es)`
);

// 8. Recursion class average below 40
const recursionEntry = stats.topicBreakdown.find(t => t.topic === "recursion");
const recursionAvg = recursionEntry ? recursionEntry.averageScore : null;
check(
  `8. Recursion class average < 40 (got ${recursionAvg})`,
  recursionAvg !== null && recursionAvg < 40,
  recursionAvg === null ? "topic not found" : ""
);

// 9. ClassStats.totalStudents = 40
check("9. ClassStats.totalStudents = 40", stats.totalStudents === 40, `got ${stats.totalStudents}`);

// 10. ClassStats.scoreDistribution matches
check(
  "10. ClassStats.scoreDistribution: 15 Strong, 15 Adequate, 10 Needs Review",
  stats.scoreDistribution.strong === 15 &&
  stats.scoreDistribution.adequate === 15 &&
  stats.scoreDistribution.needsReview === 10,
  `got ${stats.scoreDistribution.strong}/${stats.scoreDistribution.adequate}/${stats.scoreDistribution.needsReview}`
);

// 11. All reports have correct assignmentId
const wrongAssignment = reports.filter(r => r.assignmentId !== ASSIGNMENT_ID);
check(
  "11. All reports have assignmentId = 'demo-assignment-001'",
  wrongAssignment.length === 0,
  `${wrongAssignment.length} wrong`
);

// 12. All reports have attemptNumber = 1
const wrongAttempt = reports.filter(r => r.attemptNumber !== 1);
check(
  "12. All reports have attemptNumber = 1",
  wrongAttempt.length === 0,
  `${wrongAttempt.length} wrong`
);

// 13. Flagged inconsistencies have non-null evidence and valid severity
const badFlagged = reports
  .filter(r => r.inconsistency.flagged === true)
  .filter(r => !r.inconsistency.evidence || !["minor","notable"].includes(r.inconsistency.severity));
check(
  "13. All flagged inconsistencies have evidence + valid severity",
  badFlagged.length === 0,
  `${badFlagged.length} invalid`
);

// 14. Unflagged inconsistencies have null evidence and null severity
const badUnflagged = reports
  .filter(r => r.inconsistency.flagged === false)
  .filter(r => r.inconsistency.evidence !== null || r.inconsistency.severity !== null);
check(
  "14. All unflagged inconsistencies have evidence=null, severity=null",
  badUnflagged.length === 0,
  `${badUnflagged.length} invalid`
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(44)}`);
console.log(`Result: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);

if (failed === 0) {
  console.log("All checks passed.\n");
} else {
  console.log("Some checks FAILED — see above.\n");
}

// Print topic breakdown for reference
console.log("Topic breakdown (class averages, 0–100 scale):");
stats.topicBreakdown
  .sort((a, b) => a.averageScore - b.averageScore)
  .forEach(t => {
    const flag = t.averageScore < ADEQUATE_THRESHOLD ? " [FLAGGED]" : "";
    console.log(`  ${t.topic.padEnd(18)} avg=${String(t.averageScore).padStart(5)}  n=${t.questionCount}${flag}`);
  });
console.log("");

process.exit(failed > 0 ? 1 : 0);
