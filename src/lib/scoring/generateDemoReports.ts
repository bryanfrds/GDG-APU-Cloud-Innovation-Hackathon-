/**
 * generateDemoReports.ts — Generates 40 synthetic VivaReport records for the
 * Prove It demo (FR-8).
 *
 * PURPOSE:
 *   Produces a realistic, fully populated dataset for the lecturer's
 *   class-wide insights dashboard without making any Gemini API calls or
 *   connecting to Firestore. Task 4 can import generateDemoReports() directly
 *   to seed the UI before live student data is available.
 *
 * DISTRIBUTION (fixed, deterministic):
 *   15 Strong       — overallScore >= 75
 *   15 Adequate     — overallScore >= 50 and < 75
 *   10 Needs Review — overallScore < 50
 *   ~8 with inconsistency.flagged = true (exactly 8, spread across all bands)
 *
 * TOPIC COVERAGE:
 *   Every student answers questions on 5 topics:
 *     "loops", "error handling", "functions", "data structures", "recursion"
 *   Recursion scores are kept deliberately low across all students so that the
 *   class average for recursion is well below 40 (on the 0–100 scale).
 *
 * DETERMINISM:
 *   No Math.random() is used anywhere. All scores, feedback, and timestamps
 *   are fully pre-specified in the STUDENT_PROFILES table below. Repeated
 *   runs always produce identical output.
 *
 * WHAT THIS FILE DOES NOT DO:
 *   - No Gemini API calls.
 *   - No Firestore reads or writes.
 *   - No dependency on Next.js or any framework.
 *   - Does not modify any other scoring file.
 */

import { calculateClassStats } from "./classStats";
import { STRONG_THRESHOLD, ADEQUATE_THRESHOLD } from "./scoringConfig";
import type {
  VivaReport,
  ScoredAnswer,
  AnswerSummary,
  InconsistencyResult,
} from "./types";

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const ASSIGNMENT_ID = "demo-assignment-001";

/**
 * The five topics covered in every student's viva.
 * Each topic maps to a question template (text + code snippet).
 */
const TOPICS = [
  "loops",
  "error handling",
  "functions",
  "data structures",
  "recursion",
] as const;

type Topic = (typeof TOPICS)[number];

// ---------------------------------------------------------------------------
// QUESTION TEMPLATES
// One question per topic — the same five questions are asked of every student.
// The questionId is derived from the topic name so it is consistent and
// traceable. In a real viva these would be generated per-submission by Task 1.
// ---------------------------------------------------------------------------

interface QuestionTemplate {
  questionId: string;
  questionText: string;
  relevantCodeSnippet: string;
}

const QUESTION_TEMPLATES: Record<Topic, QuestionTemplate> = {
  loops: {
    questionId: "q-demo-loops-001",
    questionText:
      "Why did you use a for loop here instead of a while loop?",
    relevantCodeSnippet:
      "for (let i = 0; i < items.length; i++) {\n  process(items[i]);\n}",
  },
  "error handling": {
    questionId: "q-demo-error-001",
    questionText:
      "What does your try-catch block protect against in this function?",
    relevantCodeSnippet:
      "try {\n  const result = riskyOperation(input);\n  return result;\n} catch (err) {\n  console.error(err);\n  return null;\n}",
  },
  functions: {
    questionId: "q-demo-functions-001",
    questionText:
      "Why did you break this logic into a separate helper function?",
    relevantCodeSnippet:
      "function calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}",
  },
  "data structures": {
    questionId: "q-demo-ds-001",
    questionText:
      "Why did you choose an object here rather than an array to store this data?",
    relevantCodeSnippet:
      "const lookup = {};\nfor (const item of items) {\n  lookup[item.id] = item;\n}",
  },
  recursion: {
    questionId: "q-demo-recursion-001",
    questionText:
      "Can you explain the base case in this recursive function and why it is necessary?",
    relevantCodeSnippet:
      "function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}",
  },
};

// ---------------------------------------------------------------------------
// ANSWER BANKS
// Pre-written answer texts and feedback messages for each tier and topic.
// These are indexed by [tier][topic] so every student in a tier gives a
// plausible answer. Determinism is maintained because we pick by student index.
// ---------------------------------------------------------------------------

/** Tier labels used internally in the profile table. */
type Tier = "strong" | "adequate" | "needsReview";

/** Per-topic answer text and Gemini-style feedback for one tier. */
interface AnswerTemplate {
  studentAnswer: string;
  feedback: string;
}

const ANSWER_BANK: Record<Tier, Record<Topic, AnswerTemplate[]>> = {
  strong: {
    loops: [
      {
        studentAnswer:
          "I used a for loop because the array length is known before iteration starts, making the bounds explicit and easier to read.",
        feedback:
          "Student correctly identified a fixed iteration count as the reason to prefer a for loop.",
      },
      {
        studentAnswer:
          "A for loop keeps the initialiser, condition and increment in one line, which makes it clearer when you are iterating over a collection sequentially.",
        feedback:
          "Accurate and precise explanation of the syntactic advantage of a for loop for indexed iteration.",
      },
      {
        studentAnswer:
          "The for loop makes the start and end of the range immediately obvious to anyone reading the code.",
        feedback:
          "Student demonstrated understanding of readability benefits of a for loop.",
      },
    ],
    "error handling": [
      {
        studentAnswer:
          "The try block wraps riskyOperation because it might throw if the input is malformed. The catch ensures we return null instead of crashing the caller.",
        feedback:
          "Student correctly identified the risky call and explained the graceful fallback.",
      },
      {
        studentAnswer:
          "This protects against runtime exceptions from riskyOperation and ensures the function always returns a value rather than propagating an unhandled error.",
        feedback:
          "Clear explanation of defensive programming with an accurate description of the error boundary.",
      },
      {
        studentAnswer:
          "The catch block prevents an unhandled exception from bubbling up. It logs the error for debugging and returns null as a safe default.",
        feedback:
          "Student understood both the logging purpose and the safe default return.",
      },
    ],
    functions: [
      {
        studentAnswer:
          "I extracted calculateTotal so it can be reused in other parts of the application without duplicating the reduce logic.",
        feedback:
          "Student demonstrated understanding of the DRY principle and reusability.",
      },
      {
        studentAnswer:
          "Separating it makes the main function shorter and easier to test. I can unit test calculateTotal independently.",
        feedback:
          "Student showed awareness of testability as a motivation for extraction.",
      },
      {
        studentAnswer:
          "The helper keeps the price summation logic in one place. If the pricing rule changes, I only update it here.",
        feedback:
          "Student correctly identified the single-responsibility benefit.",
      },
    ],
    "data structures": [
      {
        studentAnswer:
          "An object gives O(1) lookup by id. An array would require a linear search each time I need to find an item.",
        feedback:
          "Student correctly cited time complexity as the reason for choosing an object over an array.",
      },
      {
        studentAnswer:
          "I use an object as a hash map here because I need to retrieve items by their id frequently. Array.find would be slower for large datasets.",
        feedback:
          "Accurate explanation of the performance trade-off between object lookup and array search.",
      },
      {
        studentAnswer:
          "Objects work like dictionaries. Keying by id means I can do lookup[id] in constant time instead of iterating the whole list.",
        feedback:
          "Student demonstrated understanding of key-value lookup semantics.",
      },
    ],
    recursion: [
      {
        // Score 1–3: answer shows no meaningful understanding of the base case.
        // Strong students still score low on recursion in this demo because the
        // class as a whole struggled with it — not because they have no coding
        // ability, but because this specific concept was not well understood.
        studentAnswer:
          "I think it just keeps going until the number gets small. I am not sure what the if statement is really for.",
        feedback:
          "Student could not explain the base case or its role; the answer shows only a vague impression of how the function terminates.",
      },
      {
        studentAnswer:
          "It is a recursive function. I know it calls itself but I cannot explain the stopping condition properly.",
        feedback:
          "Student identified that the function is recursive but was unable to explain the base case or why it prevents infinite recursion.",
      },
      {
        studentAnswer:
          "I think the base case is the return 1 at the bottom, but I am not certain why it is needed there.",
        feedback:
          "Student approximately located the base case but could not articulate its purpose, demonstrating very limited understanding.",
      },
    ],
  },

  adequate: {
    loops: [
      {
        studentAnswer:
          "I used a for loop. I think it is more common for arrays so I went with that.",
        feedback:
          "Student showed awareness that for loops are idiomatic for arrays but did not explain the underlying reason.",
      },
      {
        studentAnswer:
          "The for loop works fine here. I could have used while but this felt cleaner.",
        feedback:
          "Student recognised the choice but did not articulate the specific advantage.",
      },
      {
        studentAnswer: "Arrays are usually done with for loops in my experience.",
        feedback:
          "Shows practical familiarity with the pattern but lacks conceptual justification.",
      },
    ],
    "error handling": [
      {
        studentAnswer:
          "The try-catch is there in case something goes wrong. It stops the app from crashing.",
        feedback:
          "Student understood the protective purpose but could not identify what specifically might go wrong.",
      },
      {
        studentAnswer:
          "It catches errors from inside the try block and handles them so the function can still return something.",
        feedback:
          "Correct at a general level but the student did not identify the specific risky call.",
      },
      {
        studentAnswer: "If the operation fails, the catch runs and returns null.",
        feedback:
          "Accurate description of the execution flow but missing the explanation of why failure is possible.",
      },
    ],
    functions: [
      {
        studentAnswer:
          "I made a separate function to keep the code tidy and not repeat the same logic.",
        feedback:
          "Student understood the general motivation but the explanation was vague.",
      },
      {
        studentAnswer:
          "It is a helper function so the main logic is not too long.",
        feedback:
          "Correct intent expressed but the student did not articulate the reusability benefit.",
      },
      {
        studentAnswer: "I extracted it to make the code easier to read.",
        feedback:
          "Reasonable justification, though readability alone does not fully explain the architectural choice.",
      },
    ],
    "data structures": [
      {
        studentAnswer:
          "I used an object because it is easy to access things by their id.",
        feedback:
          "Correct intuition about key-based access but the student did not mention performance implications.",
      },
      {
        studentAnswer:
          "Objects let me use the id as a key, which is convenient for lookups.",
        feedback:
          "Demonstrates practical understanding without deeper analysis of why this is more efficient.",
      },
      {
        studentAnswer: "I thought a dictionary-style object would be easier to use here than an array.",
        feedback:
          "Shows awareness of the conceptual similarity to a dictionary but lacks technical depth.",
      },
    ],
    recursion: [
      {
        // Adequate students also score low on recursion (1–2) in this demo.
        studentAnswer:
          "I am not really sure. I think it stops the loop.",
        feedback:
          "Student confused recursion with a loop and could not identify the base case, showing minimal understanding.",
      },
      {
        studentAnswer:
          "Something at the top makes it stop but I cannot explain exactly what.",
        feedback:
          "Student was vaguely aware of a termination condition but could not identify or explain it.",
      },
      {
        studentAnswer:
          "I have seen recursive functions before but I struggle to explain this one.",
        feedback:
          "Student acknowledged a lack of understanding and could not describe the base case at all.",
      },
    ],
  },

  needsReview: {
    loops: [
      {
        studentAnswer: "I do not remember, I just wrote it that way.",
        feedback:
          "Student could not explain the choice of loop construct, suggesting the code was not written with clear intent.",
      },
      {
        studentAnswer: "It just loops through the items.",
        feedback:
          "Response describes what the code does but shows no understanding of why this loop type was chosen.",
      },
      {
        studentAnswer: "I copied a similar pattern from earlier in the code.",
        feedback:
          "Student admitted to copying without understanding, showing limited comprehension of the pattern.",
      },
    ],
    "error handling": [
      {
        studentAnswer: "I added it because the IDE suggested it.",
        feedback:
          "Student could not explain the purpose of the try-catch block.",
      },
      {
        studentAnswer: "I am not sure what errors it catches.",
        feedback:
          "Student demonstrated no understanding of what the error handling protects against.",
      },
      {
        studentAnswer: "It is just standard error handling I always include.",
        feedback:
          "Student treated error handling as boilerplate without understanding its specific purpose here.",
      },
    ],
    functions: [
      {
        studentAnswer: "I do not know why it is a separate function, it was just like that.",
        feedback:
          "Student showed no understanding of why the function was extracted.",
      },
      {
        studentAnswer: "I think it makes the code shorter.",
        feedback:
          "Very vague response that does not address reusability or single responsibility.",
      },
      {
        studentAnswer: "My friend told me to put it there.",
        feedback:
          "Student could not independently justify the design decision.",
      },
    ],
    "data structures": [
      {
        studentAnswer: "I thought objects were better than arrays, I am not sure why.",
        feedback:
          "Student could not articulate the difference between an object and an array for this use case.",
      },
      {
        studentAnswer: "It was the first thing I thought of.",
        feedback:
          "No justification provided for the data structure choice.",
      },
      {
        studentAnswer: "I just used an object because I have seen it done that way before.",
        feedback:
          "Student relied on pattern recognition without understanding the underlying reason.",
      },
    ],
    recursion: [
      {
        // Needs Review students score 1 on recursion.
        studentAnswer:
          "I have no idea how this function works.",
        feedback:
          "Student demonstrated no understanding of recursion or the base case.",
      },
      {
        studentAnswer:
          "It is recursive but I did not write this part.",
        feedback:
          "Student disclaimed ownership of the code, indicating no understanding of the recursive function.",
      },
      {
        studentAnswer:
          "I think it multiplies n by itself but I am not sure.",
        feedback:
          "Factually incorrect description of factorial, showing a fundamental misunderstanding.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// INCONSISTENCY TEMPLATES
// Eight flagged inconsistency records spread across the 40 students.
// The rest use the canonical unflagged result.
// ---------------------------------------------------------------------------

interface FlaggedInconsistency extends InconsistencyResult {
  flagged: true;
  evidence: string;
  severity: "minor" | "notable";
}

/**
 * Eight specific flagged inconsistency records.
 * These are assigned to student indices listed in FLAGGED_STUDENT_INDICES below.
 */
const FLAGGED_INCONSISTENCIES: FlaggedInconsistency[] = [
  {
    flagged: true,
    severity: "notable",
    evidence:
      "The student's answer stated 'I used recursion for the loop', but the submitted code shows a standard for loop at the relevant location.",
  },
  {
    flagged: true,
    severity: "minor",
    evidence:
      "The student's answer stated 'there is no error handling in this function', but the submitted code shows a try-catch block wrapping the main operation.",
  },
  {
    flagged: true,
    severity: "notable",
    evidence:
      "The student's answer stated 'I used an array to store the lookup data', but the submitted code clearly uses an object keyed by id.",
  },
  {
    flagged: true,
    severity: "minor",
    evidence:
      "The student's answer stated 'the function does not return anything', but the submitted code shows a return statement at the end of calculateTotal.",
  },
  {
    flagged: true,
    severity: "notable",
    evidence:
      "The student's answer stated 'I wrote this using a while loop', but the submitted code uses a for loop with an explicit index variable.",
  },
  {
    flagged: true,
    severity: "minor",
    evidence:
      "The student's answer stated 'the base case checks for zero', but the submitted code shows the condition as n <= 1.",
  },
  {
    flagged: true,
    severity: "notable",
    evidence:
      "The student's answer stated 'there is no try-catch here', but the submitted code contains a try-catch block around the riskyOperation call.",
  },
  {
    flagged: true,
    severity: "minor",
    evidence:
      "The student's answer stated 'I used reduce to build the object', but the submitted code uses a for-of loop to populate the lookup object.",
  },
];

const UNFLAGGED_INCONSISTENCY: InconsistencyResult = {
  flagged: false,
  evidence: null,
  severity: null,
};

/**
 * Zero-based student indices (within the full 40-student array) that receive
 * a flagged inconsistency. These are spread deliberately across all three
 * score bands so the demo shows flags at different performance levels.
 *
 * Indices used: 2, 7, 12, 17, 22, 27, 32, 37
 * (one roughly every 5 students, spanning all bands)
 */
const FLAGGED_STUDENT_INDICES = new Set([2, 7, 12, 17, 22, 27, 32, 37]);

// ---------------------------------------------------------------------------
// SCORE TABLES
//
// Each entry defines the exact per-answer scores for one student.
// Scores are on the 0–10 scale, one per topic in TOPICS order:
//   [loops, error handling, functions, data structures, recursion]
//
// The overallScore is computed programmatically from these scores using the
// same formula as scoreViva.ts, not hardcoded, so it stays consistent.
//
// Design constraints:
//   - Strong:       average of scores * 10 >= 75  →  average >= 7.5
//   - Adequate:     average of scores * 10 in [50, 75)  →  average in [5.0, 7.5)
//   - Needs Review: average of scores * 10 < 50  →  average < 5.0
//   - Recursion scores are kept at 1–3 for all students so the class average
//     for recursion stays well below 40 on the 0–100 scale.
// ---------------------------------------------------------------------------

/**
 * Per-student score rows.
 * Format: [loops, errorHandling, functions, dataStructures, recursion]
 *
 * 15 Strong rows (indices 0–14)
 * 15 Adequate rows (indices 15–29)
 * 10 Needs Review rows (indices 30–39)
 */
const SCORE_TABLE: [number, number, number, number, number][] = [
  // --- Strong students (indices 0–14) ---
  // All have high scores on the first four topics; recursion stays low.
  // Indices 2, 7, 12 are flagged — their overridden topic score comes from
  // INCONSISTENCY_ANSWER_OVERRIDES (score: 6). The remaining four non-recursion
  // scores are set to 10 to compensate so overallScore stays in the Strong band.
  [9, 9, 9, 9, 2],    // 0  avg 7.6 → 76
  [9, 9, 9, 8, 3],    // 1  avg 7.6 → 76
  [6, 10, 10, 10, 2], // 2  flagged: loops override score=6; others maxed → 38/5=7.6→76
  [8, 9, 9, 9, 3],    // 3  avg 7.6 → 76
  [9, 9, 9, 8, 3],    // 4  avg 7.6 → 76
  [9, 10, 8, 9, 2],   // 5  avg 7.6 → 76
  [10, 8, 9, 9, 2],   // 6  avg 7.6 → 76
  [10, 6, 10, 10, 2], // 7  flagged: error-handling override score=6; others maxed → 38/5=7.6→76
  [8, 9, 9, 10, 3],   // 8  avg 7.8 → 78
  [10, 9, 9, 8, 2],   // 9  avg 7.6 → 76
  [9, 8, 9, 9, 3],    // 10 avg 7.6 → 76
  [9, 9, 8, 9, 3],    // 11 avg 7.6 → 76
  [10, 10, 10, 6, 2], // 12 flagged: data-structures override score=6; others maxed → 38/5=7.6→76
  [9, 10, 9, 9, 2],   // 13 avg 7.8 → 78
  [8, 9, 10, 9, 2],   // 14 avg 7.6 → 76

  // --- Adequate students (indices 15–29) ---
  // Moderate scores; recursion still low.
  // Indices 17, 22 are flagged — their overridden topic score is 2.
  // Remaining non-recursion scores are raised to keep overallScore in Adequate band.
  [7, 7, 6, 6, 2],    // 15 avg 5.6 → 56
  [6, 7, 7, 6, 2],    // 16 avg 5.6 → 56
  [7, 7, 2, 8, 2],    // 17 flagged: functions override score=2; others adjusted → 26/5=5.2→52
  [6, 6, 7, 7, 2],    // 18 avg 5.6 → 56
  [7, 7, 6, 7, 1],    // 19 avg 5.6 → 56
  [8, 6, 6, 6, 2],    // 20 avg 5.6 → 56
  [6, 8, 6, 6, 2],    // 21 avg 5.6 → 56
  [2, 8, 8, 8, 2],    // 22 flagged: loops override score=2; others adjusted → 28/5=5.6→56
  [6, 6, 6, 8, 2],    // 23 avg 5.6 → 56
  [7, 6, 7, 5, 2],    // 24 avg 5.4 → 54
  [5, 7, 7, 6, 2],    // 25 avg 5.4 → 54
  [7, 5, 6, 7, 2],    // 26 avg 5.4 → 54
  [6, 7, 5, 7, 2],    // 27 flagged: recursion override score=2 (same as SCORE_TABLE) → 27/5=5.4→54
  [7, 6, 6, 5, 3],    // 28 avg 5.4 → 54
  [6, 5, 7, 7, 2],    // 29 avg 5.4 → 54

  // --- Needs Review students (indices 30–39) ---
  // Low scores across the board; recursion very low.
  // Index 32 is flagged — error handling override score=1 (lower than SCORE_TABLE's 3).
  // Index 37 is flagged — data structures override score=2 (same as SCORE_TABLE).
  [4, 3, 3, 3, 1],    // 30 avg 2.8 → 28
  [3, 4, 3, 3, 1],    // 31 avg 2.8 → 28
  [3, 1, 4, 3, 1],    // 32 flagged: error-handling override score=1 → 12/5=2.4→24
  [3, 3, 3, 4, 1],    // 33 avg 2.8 → 28
  [4, 4, 3, 2, 1],    // 34 avg 2.8 → 28
  [2, 4, 4, 3, 1],    // 35 avg 2.8 → 28
  [4, 2, 3, 4, 1],    // 36 avg 2.8 → 28
  [3, 4, 4, 2, 1],    // 37 flagged: data-structures override score=2 (matches SCORE_TABLE) → 14/5=2.8→28
  [4, 3, 4, 2, 1],    // 38 avg 2.8 → 28
  [2, 3, 4, 4, 1],    // 39 avg 2.8 → 28
];

// ---------------------------------------------------------------------------
// HELPER: computeOverallScore
// Mirrors the exact formula in scoreViva.ts to guarantee consistency.
// ---------------------------------------------------------------------------

/**
 * Computes overallScore from raw answer scores using the same formula as
 * scoreViva.ts: average of 0–10 scores, scaled to 0–100, rounded to 1 dp.
 */
function computeOverallScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s, 0);
  const average = total / scores.length;         // 0–10 range
  const scaledTo100 = average * 10;              // 0–100 range
  return Math.round(scaledTo100 * 10) / 10;      // 1 decimal place
}

// ---------------------------------------------------------------------------
// HELPER: computeScoreLabel
// Mirrors the exact logic in scoreViva.ts (assignScoreLabel).
// ---------------------------------------------------------------------------

/**
 * Returns the scoreLabel for a given overallScore using the same thresholds
 * as scoreViva.ts. Uses STRONG_THRESHOLD and ADEQUATE_THRESHOLD imported from
 * scoringConfig.ts — no values are duplicated here.
 */
function computeScoreLabel(
  overallScore: number
): "Strong" | "Adequate" | "Needs Review" {
  if (overallScore >= STRONG_THRESHOLD) return "Strong";
  if (overallScore >= ADEQUATE_THRESHOLD) return "Adequate";
  return "Needs Review";
}

// ---------------------------------------------------------------------------
// INCONSISTENCY ANSWER OVERRIDES
//
// Each of the 8 flagged students (by zero-based index) must say something in
// their answer that directly contradicts what is in their submitted code —
// that is what makes the inconsistency flag credible and auditable.
//
// For each flagged student we specify:
//   - The topic whose answer contains the contradiction.
//   - A replacement studentAnswer that includes the contradicting phrase.
//
// buildScoredAnswers() checks this map before falling back to the tier bank,
// so only the one contradicting answer per student is overridden; all other
// topic answers for that student remain unchanged.
//
// The overriding phrase in each studentAnswer matches the quoted text in the
// corresponding FLAGGED_INCONSISTENCIES evidence entry exactly.
// ---------------------------------------------------------------------------

interface AnswerOverride {
  topic: Topic;
  studentAnswer: string;
  /** Feedback that accurately describes the overridden studentAnswer. */
  feedback: string;
  /**
   * The score (0–10) that reflects the understanding shown in the overridden
   * studentAnswer. This replaces the SCORE_TABLE value for this topic only.
   * Inconsistency detection does NOT automatically lower this score — the
   * score is set explicitly based on answer quality.
   */
  score: number;
}

/**
 * Maps a zero-based student index to the one answer that contains the
 * contradiction described in the flagged inconsistency evidence.
 *
 * Index → { topic, studentAnswer }
 *
 * Flagged indices: 2, 7, 12, 17, 22, 27, 32, 37
 * Each maps to FLAGGED_INCONSISTENCIES[0..7] in set insertion order.
 */
const INCONSISTENCY_ANSWER_OVERRIDES: Map<number, AnswerOverride> = new Map([
  // Index 2 — topic: loops — score: 6
  // Answer names the wrong control structure (recursion vs for loop).
  // Score 6: the student is aware something iterates but is factually wrong
  // about the mechanism. Not zero — demonstrates contextual awareness.
  // SCORE_TABLE row compensated so overallScore stays in Strong band.
  [2, {
    topic: "loops",
    score: 6,
    studentAnswer:
      "I used recursion for the loop here because I thought it would be cleaner than writing out the index manually.",
    feedback:
      "Student incorrectly described the loop as recursion. The submitted code uses a standard for loop, not a recursive call.",
  }],

  // Index 7 — topic: error handling — score: 6
  // Answer flatly denies the presence of a try-catch block that is plainly in the code.
  // Score 6: the student shows enough awareness of the function to discuss it,
  // but makes a clear factual error about the error-handling mechanism.
  // SCORE_TABLE row compensated so overallScore stays in Strong band.
  [7, {
    topic: "error handling",
    score: 6,
    studentAnswer:
      "There is no error handling in this function. I did not think it needed any because the input should always be valid.",
    feedback:
      "Student stated there is no error handling, but the submitted code contains a try-catch block. The answer directly contradicts the code.",
  }],

  // Index 12 — topic: data structures — score: 6
  // Answer names an array where the code builds a keyed object.
  // Score 6: the student describes a plausible alternative structure,
  // but names the wrong one actually used in the submission.
  // SCORE_TABLE row compensated so overallScore stays in Strong band.
  [12, {
    topic: "data structures",
    score: 6,
    studentAnswer:
      "I used an array to store the lookup data because I wanted to keep the items in order.",
    feedback:
      "Student described using an array, but the submitted code builds a keyed object for O(1) lookup. The data structure described does not match the code.",
  }],

  // Index 17 — topic: functions — score: 2
  // Answer denies the visible return statement in calculateTotal.
  // Score 2: a specific, checkable factual claim is directly wrong.
  // SCORE_TABLE row compensated so overallScore stays in Adequate band.
  [17, {
    topic: "functions",
    score: 2,
    studentAnswer:
      "The function does not return anything, it just processes the items in place.",
    feedback:
      "Student claimed the function has no return value, but the submitted code shows calculateTotal returning the reduced sum. The answer is factually incorrect.",
  }],

  // Index 22 — topic: loops — score: 2
  // Answer names a while loop where the code uses a for loop.
  // Score 2: the student names the wrong loop construct with no qualification.
  // SCORE_TABLE row compensated so overallScore stays in Adequate band.
  [22, {
    topic: "loops",
    score: 2,
    studentAnswer:
      "I wrote this using a while loop because I find while loops easier to control than for loops.",
    feedback:
      "Student described using a while loop, but the submitted code uses a for loop with an explicit index variable. The loop type described does not match the code.",
  }],

  // Index 27 — topic: recursion — score: 2
  // Answer states the base case condition is zero; the code shows n <= 1.
  // Score 2: the student identifies that a base case exists but states the
  // wrong condition. This is consistent with the recursion score already in
  // SCORE_TABLE for this student (also 2). No score change needed.
  [27, {
    topic: "recursion",
    score: 2,
    studentAnswer:
      "The base case checks for zero, so when n reaches zero the function returns.",
    feedback:
      "Student stated the base case condition is zero, but the submitted code shows n <= 1. The condition described does not match the actual code.",
  }],

  // Index 32 — topic: error handling — score: 1
  // Answer flatly denies try-catch that is plainly visible in the code.
  // Score 1: this is a Needs Review student with no meaningful understanding;
  // a flat denial of visible code warrants the minimum non-zero score.
  // SCORE_TABLE row adjusted so error handling drops from 3 to 1.
  [32, {
    topic: "error handling",
    score: 1,
    studentAnswer:
      "There is no try-catch here. I handle errors by checking the return value instead.",
    feedback:
      "Student claimed no try-catch is used, but the submitted code wraps riskyOperation in a try-catch block. The answer directly contradicts the code.",
  }],

  // Index 37 — topic: data structures — score: 2
  // Answer describes reduce where the code uses a for-of loop.
  // Score 2: the student names an incorrect method but shows some awareness
  // that an accumulation operation is happening. Consistent with the existing
  // SCORE_TABLE score for this student (also 2). No score change needed.
  [37, {
    topic: "data structures",
    score: 2,
    studentAnswer:
      "I used reduce to build the object because it is a more functional style of writing the accumulation.",
    feedback:
      "Student described using reduce to build the object, but the submitted code uses a for-of loop to populate the lookup. The method described does not match the code.",
  }],
]);

// ---------------------------------------------------------------------------
// HELPER: buildScoredAnswers
// Constructs the ScoredAnswer array for one student.
// ---------------------------------------------------------------------------

/**
 * Builds the 5-element ScoredAnswer array for one student.
 *
 * @param tier        - The student's performance tier.
 * @param scores      - The 5 pre-specified scores, one per topic.
 * @param studentIndex - 0-based index within the full 40-student list,
 *                       used to pick varied answer/feedback text.
 */
function buildScoredAnswers(
  tier: Tier,
  scores: [number, number, number, number, number],
  studentIndex: number
): ScoredAnswer[] {
  return TOPICS.map((topic, topicIndex) => {
    const template = QUESTION_TEMPLATES[topic];
    const score = scores[topicIndex];

    // Cycle through the 3 available answer templates for this tier+topic
    // using the student index so consecutive students get different text.
    const answerBank = ANSWER_BANK[tier][topic];
    const answerTemplate = answerBank[studentIndex % answerBank.length];

    // Check whether this student+topic combination has a contradiction override.
    // If so, replace the studentAnswer, feedback AND score with the override values.
    // The override score reflects the quality of the contradicting answer itself —
    // it is NOT automatically reduced because an inconsistency flag is present.
    const override = INCONSISTENCY_ANSWER_OVERRIDES.get(studentIndex);
    const isOverridden = override !== undefined && override.topic === topic;
    const studentAnswer = isOverridden ? override.studentAnswer : answerTemplate.studentAnswer;
    const feedback      = isOverridden ? override.feedback      : answerTemplate.feedback;
    // When overridden, use the override score; otherwise use the SCORE_TABLE value.
    const finalScore    = isOverridden ? override.score         : score;

    return {
      questionId: template.questionId,
      questionText: template.questionText,
      studentAnswer,
      topic,
      score: finalScore,
      feedback,
      // Informational fields — vary deterministically by student index.
      followUpCount: (studentIndex % 3),          // 0, 1, or 2 follow-ups
      answerDurationMs: 30000 + (studentIndex * 1500) + (topicIndex * 2000),
    };
  });
}

// ---------------------------------------------------------------------------
// HELPER: buildAnswerSummary
// Picks strongest and weakest answers from the scoredAnswers array.
// ---------------------------------------------------------------------------

/**
 * Returns the AnswerSummary for the highest-scoring answer.
 */
function findStrongest(scoredAnswers: ScoredAnswer[]): AnswerSummary {
  const best = scoredAnswers.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    questionId: best.questionId,
    questionText: best.questionText,
    score: best.score,
    feedback: best.feedback,
  };
}

/**
 * Returns the AnswerSummary for the lowest-scoring answer.
 */
function findWeakest(scoredAnswers: ScoredAnswer[]): AnswerSummary {
  const worst = scoredAnswers.reduce((a, b) => (b.score < a.score ? b : a));
  return {
    questionId: worst.questionId,
    questionText: worst.questionText,
    score: worst.score,
    feedback: worst.feedback,
  };
}

// ---------------------------------------------------------------------------
// MAIN EXPORT: generateDemoReports
// ---------------------------------------------------------------------------

/**
 * Generates 40 synthetic VivaReport records for the demo assignment.
 *
 * The returned array contains exactly:
 *   - 40 reports with unique vivaId and studentId values.
 *   - 15 Strong, 15 Adequate, 10 Needs Review (by overallScore).
 *   - 8 reports with inconsistency.flagged = true.
 *   - A recursion topic class average well below 40 (0–100 scale).
 *
 * All overallScore values are computed from the actual answer scores using the
 * same formula as scoreViva.ts, ensuring full internal consistency.
 * All scoreLabel values are derived from the computed overallScore.
 *
 * @returns Array of 40 VivaReport records — identical on every call.
 *
 * @example
 * import { generateDemoReports } from "./generateDemoReports";
 * const reports = generateDemoReports();
 * // reports.length === 40
 */
export function generateDemoReports(): VivaReport[] {
  const reports: VivaReport[] = [];

  for (let i = 0; i < 40; i++) {
    // Determine tier from position in the score table.
    //   Indices  0–14 → strong       (15 students)
    //   Indices 15–29 → adequate     (15 students)
    //   Indices 30–39 → needsReview  (10 students)
    const tier: Tier =
      i < 15 ? "strong" : i < 30 ? "adequate" : "needsReview";

    const scores = SCORE_TABLE[i];

    // Build the detailed answer list first. buildScoredAnswers applies any
    // override score for flagged students, so scoredAnswers contains the
    // final, correct per-answer scores.
    const scoredAnswers = buildScoredAnswers(tier, scores, i);

    // Derive overallScore from the actual scoredAnswers scores, not directly
    // from SCORE_TABLE. This ensures overallScore always matches the average
    // of the answers shown in the report, even when an override score differs
    // from the SCORE_TABLE value.
    const overallScore = computeOverallScore(scoredAnswers.map((a) => a.score));
    const scoreLabel = computeScoreLabel(overallScore);

    // Pick inconsistency — exactly 8 students are flagged.
    const inconsistency: InconsistencyResult = FLAGGED_STUDENT_INDICES.has(i)
      ? FLAGGED_INCONSISTENCIES[
          // Map the set of 8 flagged indices to the 8 inconsistency records
          // in order of their appearance in FLAGGED_STUDENT_INDICES.
          [...FLAGGED_STUDENT_INDICES].indexOf(i)
        ]
      : UNFLAGGED_INCONSISTENCY;

    // Use zero-padded indices for readability and stable sorting.
    const paddedIndex = String(i + 1).padStart(3, "0");

    const report: VivaReport = {
      vivaId: `viva-demo-${paddedIndex}`,
      submissionId: `sub-demo-${paddedIndex}`,
      studentId: `student-demo-${paddedIndex}`,
      assignmentId: ASSIGNMENT_ID,
      attemptNumber: 1,
      // Space scoredAt timestamps 15 minutes apart for realism.
      scoredAt: new Date(
        new Date("2026-11-05T08:00:00.000Z").getTime() + i * 15 * 60 * 1000
      ).toISOString(),
      overallScore,
      scoreLabel,
      scoredAnswers,
      strongestAnswer: findStrongest(scoredAnswers),
      weakestAnswer: findWeakest(scoredAnswers),
      inconsistency,
    };

    reports.push(report);
  }

  return reports;
}

// ---------------------------------------------------------------------------
// CONVENIENCE EXPORT: generateDemoClassStats
// Runs calculateClassStats on the generated reports so callers get both
// outputs in one place.
// ---------------------------------------------------------------------------

/**
 * Generates 40 synthetic VivaReport records and calculates ClassStats from
 * them using the real calculateClassStats() function.
 *
 * @returns An object containing both the reports array and the ClassStats.
 *
 * @example
 * const { reports, stats } = generateDemoClassStats();
 * console.log(stats.totalStudents);       // 40
 * console.log(stats.scoreDistribution);   // { strong: 15, adequate: 15, needsReview: 10 }
 */
export function generateDemoClassStats(): {
  reports: VivaReport[];
  stats: ReturnType<typeof calculateClassStats>;
} {
  const reports = generateDemoReports();
  const stats = calculateClassStats(ASSIGNMENT_ID, reports);
  return { reports, stats };
}
