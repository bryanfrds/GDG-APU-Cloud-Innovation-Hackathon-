# Prove It

**An AI viva for every assignment.** After a student hands in an assignment, an AI asks them
questions about it out loud to check they really understand it, then gives the lecturer a
short report.

Our entry for the **APU Cloud Innovation Hackathon 2026** (GDG on Campus APU), under
**Track 2: Intelligent Automation & Digital Transformation**.

> Status: in progress. Prototype due 10 Nov 2026, 11:59 PM MYT.

## The problem

Students can now hand in work an AI wrote, and lecturers can't reliably tell. A viva (a short
oral check where the student explains their work) makes it obvious, but no lecturer has time to run
200 of them. So they either guess or let it slide.

## How it will work (planned)

1. **The student submits** their assignment as usual: code, a report, or both.
2. **The AI will read the whole submission** and write questions about *that student's* work,
   for example "Why did you use a loop on line 40 instead of recursion?" or "What happens
   if this input is empty?"
3. **The student does a 5-minute spoken viva** with the AI in the browser. It will listen, ask
   follow-up questions when an answer is vague, and move on when they clearly know it.
4. **The lecturer will get a one-page report** per student: an understanding score, the strongest
   and weakest answers, and a flag when the answers don't match the code.
5. **A class view** will show what the whole class struggled with, for example "70% couldn't
   explain recursion", so the lecturer knows what to reteach.

The lecturer always makes the final call. Prove It will flag and explain; it will never fail a
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
| 6 | Polish, backup demo video, README final pass |
| 7 | Pitch deck and rehearsal |

## Demo (2 minutes)

The demo is staged so judges can see both outcomes, and it uses a shortened viva of about
30 seconds per student.

1. Submit two versions of the same assignment: one written by a teammate, one written by AI.
2. The teammate does the viva, answers well, and gets a green score.
3. A second teammate does the viva on the AI-written version, struggles, and gets flagged,
   with the exact questions they missed.
4. Show the class view across 40 synthetic (made-up) student records and the topic most of them didn't understand.

## Risks and how we handle them

- **Fairness:** a flag is a prompt for the lecturer to talk to the student, not a penalty.
- **Nervous students, accents, non-native English:** score understanding of the work, not
  fluency, and let students answer in text if they prefer.
- **Privacy:** ask for consent before recording, keep transcripts rather than audio, and
  delete them after the course, in line with Malaysia's Personal Data Protection Act (PDPA).
- **Cheating on the viva itself:** questions are specific to the student's own code and
  follow-ups come quickly, so reading answers from another screen is hard to keep up.
- **Slow campus Wi-Fi:** a text-chat fallback, plus a recorded backup demo.

## Running it locally

Coming soon.
