# Fearao questionnaire thin fork

This is a public fork of [juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono).
Baseline: `2d88b79c08ce19ffeecbe85d5ee1071046b708c0`, questionnaire version `2.13.8`.
Original MIT license and attribution are retained. Nothing is published to the upstream npm scope.

## Install only the questionnaire

```sh
pi install git:github.com/Fearao/rpiv-mono@fearao/ask-user-workflow
```

For reproducibility, replace the branch with a reviewed commit hash. Restart Pi after installation.
The root `pi` manifest selects **one extension** and explicitly no skills/prompts/themes;
other monorepo extensions are not activated. npm still resolves the workspace dependencies.

For a development checkout:

```sh
pi install /absolute/path/to/rpiv-mono
```

Do not enable the old `AskUserQuestion` extension or the upstream npm questionnaire alongside
this fork. Replace references to `AskUserQuestion` in your own instructions with `ask_user_question`.
Those local files are not modified automatically. Removing this Git package and reinstalling
upstream npm is the rollback; local configuration is preserved.

## Changes

| File | Small fork delta |
| --- | --- |
| `tool/types.ts` | Maximum 8 questions; schema and runtime validator share one constant. |
| `ask-user-question.ts` | Sequential execution; default 2–4-question guidance, no permission/plan approval, no inferred unanswered decisions, no mixed batches. |
| `tool/response-envelope.ts` | Explicit cancel terminates; errors don't; empty/partial submissions preserve unanswered indexes with an actionable warning. |
| `workflow-policy.ts` | `tool_result` hook calls `ctx.abort()` only for actual cancellation. Needed because `terminate` alone does not stop mixed batches in Pi 1.1.0. |
| `notifications.ts` | Optional event-driven xnotify adapter, 80-character first-question summary, argv, 5-second timeout, contained failures. |
| `config.ts`, `index.ts`, manifests | Local opt-in/recipient; wire adapters; include modules in published files and Git installation entrypoint. |
| `scripts/prepare.mjs` | Preserve Husky for development installs but skip it when Pi explicitly installs with `--omit=dev`. |

No UI rewrite. Upstream owns previews, tabs, notes/global notes, multiline input/external editor,
draft persistence, folding/scrolling, RPC fallback and no-UI tool hiding. No i18n dependency added.

Cancellation stops the current operation and returns to chat, not the Pi process. It does not undo
already-completed actions. Call the questionnaire alone. In mixed batches, sequential execution
and the abort hook prevent later sibling tools from running; a tool earlier in the batch may
already have run. Hosts/providers must honor Pi's abort signal. Queued future user messages
remain governed by the host; cancellation is not a permanent shutdown.

## Opt-in notification (local only)

In `~/.config/rpiv-ask-user-question/config.json` (or the configured XDG location):

```json
{
  "notification": {
    "enabled": true,
    "receiver": "YOUR_LOCAL_RECEIVER"
  }
}
```

The default is **off**, with no embedded recipient. Install and configure `xnotify` separately.
The current development host does not have `xnotify`; notifications are unit-tested with a fake
subprocess, not sent during verification. No automatic fallback to another notification service.
Enabling notifications sends a bounded first-question summary and question count externally;
no previews, option descriptions, answer text or notes are transmitted. Error diagnostics do
not include the recipient, question or subprocess output.

## Tests and verification

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx vitest run packages/rpiv-ask-user-question --maxWorkers=2
npx tsc --noEmit -p tsconfig.base.json
npm run check:host-provided-deps
```

Fork tests cover 8/9-question validation, eight-question real component submission/folding,
notification opt-in, malformed config, argv, pending sends, synchronous/asynchronous failure,
nonzero exit, TUI/RPC cancellation, invalid/unavailable UI, blank/partial submissions and the
real Pi agent loop with an offline stream provider and a mixed tool batch. Existing upstream
questionnaire tests cover previews, drafts, multiline input, external editors and RPC behavior.

Manual acceptance before replacing a real install:

- [ ] In the actual Ghostty → Zellij → Pi environment, fold/reopen the questionnaire and scroll the transcript.
- [ ] Check multiline custom answers, external editor, restored drafts and global notes.
- [ ] Answer eight questions and review Submit; try a partial and a completely blank submission.
- [ ] Cancel and confirm no additional autonomous work follows; Pi itself remains open.
- [ ] With a locally installed/configured xnotify, opt in and check one real reminder arrives.

Do not infer that automation replaces these real-terminal/real-recipient checks.

## Upgrade discipline

Keep `upstream` pointing to the original repo. Fetch new versions and merge reviewed upstream
commits into this feature branch; do not automatically update a production install. Revisit only
the files in the delta map, retain license, run package tests/type checks and isolated Git install
smoke, then review the delta. Pin the accepted commit in Pi settings. Never run monorepo publish
or release scripts from this fork: they target upstream package names and release automation.
