# Kilo Code Cost Tracking Rules

## Session Logging

At the END of every task (before using `attempt_completion`), you MUST call the `rlm_log_session` MCP tool to log this session's cost.

### How to extract the required values

- **`costUsd`** — Read the dollar amount from `# Current Cost` in environment_details (e.g., `$0.42` → `0.42`)
- **`model`** — Read the model slug from `<model>` inside `# Current Mode` in environment_details (e.g., `anthropic/claude-sonnet-4-5`)
- **`project`** — Derive from the workspace directory path in environment_details (e.g., `/Users/name/projects/my-app` → `my-app`)
- **`sessionNotes`** — Write a brief 1-line summary of what was accomplished in this task

### Example call

```
Tool: rlm_log_session
Arguments:
  project: "my-app"
  model: "anthropic/claude-sonnet-4-5"
  costUsd: 0.42
  sessionNotes: "Added JWT authentication and updated user model tests"
```

### Important

- This is **mandatory** for all tasks — do not skip it
- Always read `Current Cost` from the **most recent** environment_details before logging (the cost at the end of the task, not the beginning)
- Log the session cost **before** calling `attempt_completion`, not after
