---
description: Checkpoint per AGENTS.md Rule 10 — summarize done/verified/left and update tasks/todo.md
---

Perform a checkpoint (AGENTS.md Rule 10: "Don't continue from a state you can't describe back").

1. Summarize the current session state in three sections:
   - **Done**: what was actually changed — files touched, commands run, decisions made.
   - **Verified**: what was proven to work and HOW (command output, test run, manual check).
     Only list something here if you have concrete evidence from this session.
   - **Left**: what remains, including work discovered along the way.
2. Apply Rule 12 (Fail loud): anything skipped, assumed, or unverified MUST be stated
   explicitly in the summary. "Completed" is wrong if anything was skipped silently.
   If you cannot describe the current state accurately, say so and restate from evidence.
3. Update /Users/macco/Documents/evertrust-erp-marketing/tasks/todo.md:
   - Create the tasks/ directory and todo.md if they do not exist yet.
   - Mark items completed in this session as `[x]`.
   - Add newly discovered work as unchecked `[ ]` items.
   - Do not delete or rewrite existing items — only check off or append.
4. Show the user the three-section summary and the updated todo.md content.
