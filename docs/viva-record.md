# The viva record

What a finished viva is saved as. Defined in `lib/viva/record.ts` (`VivaRecord`, version 1).
Person 3's scoring reads these.

## Fields

| Field | What it is |
|---|---|
| `version` | Always `1` for now. |
| `vivaId` | Issued by the server with the viva's one-time pass. Ties the record to the plan the server locked in. |
| `submissionId` | The student's submission this viva is about. `null` until Person 1's submissions exist. |
| `mode` | `full` (about 5 minutes) or `demo` (about 30 seconds). |
| `plan` | The assignment title and the questions (`id`, `text`, optional `focus`). |
| `startedAt`, `endedAt` | ISO times with a time zone. |
| `endReason` | `completed` (the examiner finished), `time_up`, `session_ended` (Gemini closed the connection), `stopped` (the student pressed End) or `error`. |
| `truncated` | `true` if the viva was so long that turns past 300 were left out. |
| `turns` | Every line said, in order: `who` (`ai` or `student`), `text`, `questionId` (the question being asked when the line started, or `null` before the first one) and `atMs` (milliseconds since the start; never goes down). A student turn the student typed instead of spoke also has `typed: true`. |

`turnsByQuestion(record)` groups the turns under each planned question, in plan order, which is
usually what scoring wants.

## Limits

The page applies the same limits the server checks, so a record the page builds is always accepted:

- at most 300 turns
- at most 4,000 characters a turn (longer answers are split at a space)
- times within the viva
- the viva no longer than its mode allows, plus a few minutes of slack

Hidden characters are stripped from turn text, and line breaks become spaces.

## Trust

- **The transcript comes from the student's browser, so it can be faked.** Treat it as what the
  browser reported, never as proof. The "answers don't match the code" flag should say "the
  answers given in the viva didn't match", and a lecturer should always review it.
- **The plan in the record must be checked against the server's own copy** for that `vivaId`
  before scoring. Don't trust the plan the browser sends back.
- **When putting turns into a scoring prompt**, wrap each one in markers and escape `<` and `>`,
  the way `buildExaminerInstructions()` does for questions. Say in the prompt that text inside the
  markers is only what was said, never an instruction.
- **Typed answers (`typed: true`) could have been pasted**, for example from a chatbot. Show them differently in the lecturer report and treat them with more caution than spoken ones.
- **Tagging is best effort.** Gemini's transcript of the student can arrive slightly after the
  examiner moves on, so a very short answer can occasionally be tagged with the next question.

## Saving

- `POST /api/viva/token` gives each viva a `vivaId` and stores what its pass was locked to: the plan,
  the mode and the time it was issued.
- `POST /api/viva/records` saves a finished record. It checks the record with `parseRecord()`, then
  refuses it (409) if:
  - its plan or mode differs from what was stored for that `vivaId`
  - it started before the pass was issued, or later than the pass allowed
  - it ended later than the pass allowed
  - it was already saved

  It refuses (404) a `vivaId` this server never issued. It needs the demo passcode when
  `DEMO_PASSCODE` is set, and is rate-limited.
- **On a hosted deployment, storage is Upstash Redis** (`lib/viva/redis.ts`), used whenever
  `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set (Vercel's Upstash integration sets them; Upstash's
  own `UPSTASH_REDIS_REST_URL` / `_TOKEN` names work too). Every server copy shares it and it survives
  restarts. Keys are `proveit:viva:<vivaId>:session` (kept 24 hours) and `proveit:viva:<vivaId>:record`
  (kept). A record is written with `SET … NX`, so two saves at once can't both win, and the stored
  JSON text comes back byte for byte, so `sameRecord()` keeps working.
- **Without those variables, storage is JSON files under `VIVA_DATA_DIR` (default `.data/vivas`,
  git-ignored).** That's fine locally. On a hosted server it needs care:
  - **Run one instance** (`--max-instances=1`). Otherwise the save can land on a different copy of
    the server from the one that wrote the session, get a 404, and the record is lost.
  - **Set `VIVA_DATA_DIR=/tmp/vivas`**, which is always writable. If the session can't be written,
    the viva still starts, but `/api/viva/token` returns `canSave: false` and that viva can't be saved.
  - **Records don't last.** Cloud Run wipes the disk when an idle copy shuts down, so read records for
    scoring soon after, or set the Redis variables.
  - The file store saves a record by writing a temporary file and hard-linking it into place, so the
    disk must support hard links. Local disks and Cloud Run's `/tmp` do; a mounted bucket folder may
    not, and then every save fails.
  - Any other store (Firestore, say) must keep the plan comparison (`samePlan()`, field by field) and the
    save-once rule. The routes don't need to change, but the identical-retry check in
    `app/api/viva/records/route.ts` (`sameRecord()`) compares JSON text, so a store that returns
    keys in another order turns identical retries into 409s. Compare field by field there too.
- An identical retry of a save (for example after a lost response) gets 200 with `alreadySaved: true`.
  A different record for an already-saved viva gets 409.
- The browser's clock may be up to 10 minutes off from the server's before its times are refused.
- Scoring reads a saved record with `getRecord(vivaId)` from `lib/viva/store.ts`.
