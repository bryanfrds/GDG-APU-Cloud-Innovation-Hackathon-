# Prove It

**An AI viva for every assignment.** After a student hands in an assignment, an AI asks them
questions about it out loud to check they really understand it, then gives the lecturer a
short report.

Our entry for the **APU Cloud Innovation Hackathon 2026** (GDG on Campus APU), under
**Track 2: Intelligent Automation & Digital Transformation**.

> Status: in progress. Prototype due 10 Nov 2026, 11:59 PM MYT.

## The problem

Students can now hand in work an AI wrote, and lecturers can't reliably tell. A viva (a short
oral check where the student explains their work) catches it, but no lecturer has time to run
200 of them. So they either guess or let it slide.

## How it works

1. **The student submits** their assignment as usual: code, a report, or both.
2. **The AI reads the whole submission** and writes questions about *that student's* work,
   for example "Why did you use a loop on line 40 instead of recursion?" or "What happens
   if this input is empty?"
3. **The student does a 5-minute spoken viva** with the AI in the browser. It listens, asks
   follow-up questions when an answer is vague, and moves on when they clearly know it.
4. **The lecturer gets a one-page report** per student: an understanding score, the strongest
   and weakest answers, and a flag when the answers don't match the code.
5. **A class view** shows what the whole class struggled with, for example "70% couldn't
   explain recursion", so the lecturer knows what to reteach.

The lecturer always makes the final call. Prove It flags and explains; it never fails a
student on its own.

## Built on Google Cloud

| Part | What it does |
|---|---|
| Gemini | Reads the submission, writes the questions, scores the answers |
| Gemini Live API | Runs the real-time spoken viva |
| Cloud Run | Hosts the web app (Next.js) |
| Firestore | Stores submissions, vivas and reports |
| Cloud Storage | Holds the uploaded files |

## Build plan

| Days | Goal |
|---|---|
| 1–2 | Upload a submission and get questions generated about it |
| 3–4 | Spoken viva working end to end |
| 5 | Lecturer report and class view |
| 6 | Polish, backup demo video, README |
| 7 | Pitch deck and rehearsal |

## Demo (2 minutes)

1. Submit two versions of the same assignment: one written by a teammate, one written by AI.
2. The teammate does the viva, answers well, and gets a green score.
3. A second teammate does the viva on the AI-written version, struggles, and gets flagged,
   with the exact questions they missed.
4. Show the class view across 40 sample students and the topic most of them didn't understand.

## Risks and how we handle them

- **Fairness:** it starts a conversation with the lecturer; it is not a punishment.
- **Slow campus Wi-Fi:** a text-chat fallback, plus a recorded backup demo.

## Running it locally

Coming soon.
