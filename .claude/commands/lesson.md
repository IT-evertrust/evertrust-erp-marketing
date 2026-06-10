---
description: Append a structured lesson entry to tasks/lessons.md after a correction
argument-hint: [lesson topic]
---

Record a lesson in /Users/macco/Documents/evertrust-erp-marketing/tasks/lessons.md.

Topic: $ARGUMENTS
If no topic was given, derive it from the most recent user correction in this conversation —
what did the user have to fix, redirect, or push back on?

1. Create the tasks/ directory and lessons.md if they do not exist yet.
2. APPEND one entry at the end of the file in exactly the template format documented in
   tasks/lessons.md (use today's date):

   ### YYYY-MM-DD - <short title>
   - **Trigger:** <what happened / what the user corrected>
   - **Lesson:** <the underlying pattern or mistake, not just the surface symptom>
   - **Rule going forward:** <one concrete, checkable rule that prevents a repeat>

3. Never rewrite, edit, or delete existing entries — this file is append-only history.
4. Keep the entry concise and specific to this project; vague lessons ("be more careful")
   are useless. The rule must be something a future session can actually follow.
5. Show the appended entry to the user.
