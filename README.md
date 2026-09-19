# Safe Log Explainer

A local-first tool that turns a pasted (or uploaded) application log into a
redacted, structured **debug packet** you can safely hand to an AI assistant.

Nothing leaves your machine. The tool classifies the failure, pulls out the
relevant lines with surrounding context, redacts sensitive values, and emits
Markdown or JSON that already contains instructions for whichever AI you paste
it into.

https://github.com/user-attachments/assets/b388da9a-805b-45aa-973f-c1e57b8d4c8e

## What it does

1. **Parse** — splits the log into lines and finds error-like lines
   (`error`, `warn`, `exception`, `timeout`, `401`, `429`, …), keeping a small
   window of surrounding context and the original line numbers.
2. **Classify** — scores the log against keyword patterns in
   [`patterns/default-patterns.json`](patterns/default-patterns.json)
   (Timeout, Authentication Failure, Rate Limiting, Application Crash) and
   picks the strongest match, with a likely cause and a checklist of next
   steps.
3. **Extract context** — correlation ID, endpoint, HTTP status, and duration
   when they appear as `key=value` pairs or `GET /path` fragments.
4. **Redact** — replaces sensitive values with `[REDACTED:type]` markers
   before they reach the output, and lists what was caught (with counts) in a
   warnings section. Built-in rules cover:

   | Type | Example | Marker |
   |---|---|---|
   | `bearer` | `Authorization: Bearer eyJ…` | `Bearer [REDACTED:bearer]` |
   | `jwt` | bare `eyJ….….…` tokens | `[REDACTED:jwt]` |
   | `secret` | `password=`, `api_key=`, `token=`, `client_secret:` … (also JSON-quoted) | `key=[REDACTED:secret]` |
   | `awsKey` | `AKIA…` / `ASIA…` access key IDs | `[REDACTED:awsKey]` |
   | `email` | `jane@example.com` | `[REDACTED:email]` |
   | `ipv6` | `2001:db8::1`, `::1` | `[REDACTED:ipv6]` |
   | `ip` | `203.0.113.42` | `[REDACTED:ip]` |
   | `userId` | `userId=abc-123` | `userId=[REDACTED:userId]` |

   You can add your own rules — see [Custom redaction rules](#custom-redaction-rules).
5. **Render** — Markdown (for humans and chat assistants) or JSON (for
   programs), each prefixed with a fixed "Instructions for AI assistants"
   block that tells the model to treat redaction markers as unknowns and to
   answer five triage questions.

Two analysis modes:

| Mode | Use for | Output |
|---|---|---|
| **Guided** | A short, single-incident excerpt | One category, one evidence list |
| **Raw dump** | A large, unconstrained paste with several incidents mixed together | Up to 5 ranked matches, each with its own evidence; input capped at 20,000 lines |

## Requirements

Node.js 22 or newer. No runtime dependencies.

## Install

```sh
npm install
```

This also builds the project (`prepare` runs `npm run build`).

## CLI

```sh
safe-log-explainer path/to/app.log            # after npm link / global install
node dist/src/cli.js path/to/app.log          # from a checkout
kubectl logs my-pod | safe-log-explainer      # or read from stdin
```

```
Usage: safe-log-explainer [options] [file]

  -j, --json                   Output JSON instead of Markdown
  -r, --raw-dump               Treat the input as a large multi-incident dump and
                               report up to --max-matches ranked matches
      --no-redact              Leave sensitive values in place (local use only)
  -p, --patterns <file>        Error-pattern JSON to use instead of the bundled set
      --redaction-rules <file> Extra redaction rules JSON, appended to the built-ins
  -c, --context <n>            Context lines shown around each matched line (default 2)
  -m, --max-matches <n>        Raw dump only: matches to report (default 5)
  -h, --help                   Show this help
  -v, --version                Show the version
```

The packet goes to stdout; usage and errors go to stderr, so
`safe-log-explainer app.log > packet.md` is safe. Exit code is 0 on success
and 1 on any error. A worked example is in [`test/fixtures/`](test/fixtures/):
the input log and the exact packet it produces.

## Web UI

```sh
npm run serve:ui
```

Open the printed URL (default `http://127.0.0.1:4173`). The UI is a static
page served by a tiny Node HTTP server; all analysis runs in the browser and
no log content is sent anywhere.

From the UI you can:

- paste or upload a log file,
- switch between **Guided Demo** and **Raw Dump** mode,
- load a sample log to see what the output looks like,
- toggle redaction on or off,
- browse the packet by tab (overview, evidence, matches, context, checks,
  raw lines),
- copy the Markdown or download it as `.md` / `.json`.

The "In-app AI summary" step is a placeholder — see
[docs/integration-path.md](docs/integration-path.md) for the roadmap.

## Output example

```markdown
# Debug Packet

## Instructions for AI assistants
…

## Summary
The log shows a request failure caused by repeated timeout errors.

## Error category
Timeout

## Context
- Correlation ID: req_7f92
- Endpoint: GET /api/orders/active
- Status: 500
- Duration: 30000ms

## Relevant lines
- `L6` [match]: `2026-05-31T09:14:34Z ERROR Database timeout while executing query …`
- `L7` [match]: `2026-05-31T09:14:34Z ERROR TimeoutException: The operation timed out …`
…

## Sensitive-data warnings
- Possible bearer token: `Bearer [REDACTED:bearer]`
- Possible email address: `[REDACTED:email]`
- Possible IP address: `[REDACTED:ip]` (×2)
- Possible user identifier: `userId=[REDACTED:userId]`

## Human review required
Yes. This tool provides triage guidance only.
```

## Project layout

```
src/
  cli.ts             CLI entry point (file or stdin in → Markdown/JSON out)
  explain.ts         Orchestrates parse → redact for both modes
  parser.ts          Relevant-line extraction, pattern scoring, context extraction
  sanitiser.ts       Sensitive-data detection and redaction
  pattern-loader.ts  Loads error-pattern and redaction-rule JSON files
  output.ts          Markdown / JSON renderers + AI instructions block
  types.ts           DebugPacket, RawDumpResult and friends
  web-ui.ts          Browser UI (runs the same pipeline client-side)
  static-server.ts   Minimal local file server for the UI
patterns/            Error-classification patterns + example redaction rules
public/              UI HTML and CSS
test/                node:test suites and golden fixtures
docs/                Roadmap (integration-path.md)
```

## Custom redaction rules

Pass `--redaction-rules <file>` with a JSON array; each entry is appended to
the built-in rules. See
[`patterns/example-redaction-rules.json`](patterns/example-redaction-rules.json):

```json
[
  {
    "type": "hostname",
    "label": "Possible internal hostname",
    "pattern": "\\b[a-z0-9-]+\\.(?:corp|internal)\\.example\\b",
    "flags": "gi"
  },
  {
    "type": "accountId",
    "pattern": "accountId=[A-Za-z0-9-]+",
    "replacement": "accountId=[REDACTED:accountId]"
  }
]
```

`pattern` is a JavaScript regex source string (so backslashes are doubled in
JSON). `flags` defaults to `g` and always gets `g` added. `label` defaults to
`Possible <type>` and `replacement` to `[REDACTED:<type>]`. Use a
`replacement` that keeps the key when you want the output to stay readable,
as in the `accountId` example.

Programmatically, pass `redactionRules` to `explainRawLog` /
`explainRawDump`; `defaultRedactionRules` is exported from
`src/sanitiser.ts` so you can extend rather than replace it.

## Adding an error pattern

Append an entry to `patterns/default-patterns.json`:

```json
{
  "id": "disk-full",
  "category": "Disk Full",
  "keywords": ["no space left on device", "enospc", "disk quota exceeded"],
  "summary": "The log shows writes failing because the disk is full.",
  "likelyCause": "Log or temp files filling the volume, or a runaway write.",
  "nextChecks": ["Check free space on the affected volume.", "Look for large recent files."],
  "confidence": "Medium"
}
```

Keywords are matched case-insensitively as substrings; the score is the total
number of keyword hits across all lines. Update the category list in
`test/pattern-loader.test.ts` when you add one.

## Test

```sh
npm test
```

Builds, then runs the compiled suites under `dist/test` with `node --test`.
CI runs the same on Node 22 and 24, Ubuntu and Windows. The golden test in
`test/golden-output.test.ts` pins the full CLI output for
`test/fixtures/synthetic-timeout-log.txt`; if you intentionally change the
Markdown format, regenerate it with:

```sh
node dist/src/cli.js test/fixtures/synthetic-timeout-log.txt > test/fixtures/timeout-debug-packet.md
```

## Limits

- Redaction is pattern-based. The built-in rules catch the common shapes
  listed above, but anything that doesn't look like them (internal
  hostnames, account numbers in free text, customer names) passes through.
  Add custom rules for your environment and review the output before
  sharing it.
- Classification is keyword scoring, not parsing; it's a triage aid, not a
  diagnosis.

## License

MIT — see [LICENSE](LICENSE).
