# multi-agent-pr-reviewer

A CLI tool that runs 4 specialized AI agents in parallel to review GitHub PRs, then posts inline comments and a summary scorecard.

```
npx review https://github.com/owner/repo/pull/42
```

## Architecture

```
                        ┌─────────────────────┐
                        │   CLI  (review <URL>)│
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │   OrchestratorAgent  │
                        │  fetch PR diff/files │
                        └──┬───┬───┬───┬──────┘
                           │   │   │   │  Promise.all
           ┌───────────────┘   │   │   └───────────────┐
           │               ┌───┘   └───┐               │
    ┌──────▼──────┐  ┌─────▼─────┐  ┌─▼──────────┐  ┌─▼──────────┐
    │🔒 Security  │  │⚡ Perform  │  │🎨 Style     │  │🧪 Test      │
    │  Agent      │  │  Agent     │  │  Agent      │  │  Agent      │
    └──────┬──────┘  └─────┬─────┘  └─────┬───────┘  └─────┬──────┘
           └───────────────┴───────────────┴────────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  Deduplicate &       │
                        │  Post GitHub Review  │
                        └─────────────────────┘
```

Each agent makes an independent Claude API call with a specialized system prompt and returns structured JSON findings.

## Agents

| Agent | Focus |
|-------|-------|
| 🔒 SecurityAgent | Hardcoded secrets, OWASP Top 10, injection risks |
| ⚡ PerformanceAgent | N+1 queries, blocking I/O, memory leaks |
| 🎨 StyleAgent | Naming, dead code, complexity, TypeScript types |
| 🧪 TestAgent | Missing tests, edge cases, brittle assertions |

## Setup

```bash
git clone https://github.com/DS436/reviewbot-swarm.git
cd reviewbot-swarm
npm install
cp .env.example .env
# Edit .env and add your tokens
npm run build
```

## Configuration

Copy `.env.example` to `.env` and fill in:

```
GITHUB_TOKEN=ghp_yourtoken        # needs pull_requests: write
ANTHROPIC_API_KEY=sk-ant-yourkey
```

The `GITHUB_TOKEN` needs `pull_requests: write` scope to post review comments.

## Usage

```bash
# After build
npx review https://github.com/owner/repo/pull/42

# During development
npm run dev -- https://github.com/owner/repo/pull/42
```

## Output

The tool posts a GitHub PR review with:
- **Inline comments** on diff lines, labeled by agent and severity
- **Summary scorecard** showing findings per agent
- **Additional findings** for lines not directly in the diff

### Severity levels

| Emoji | Level | Meaning |
|-------|-------|---------|
| 🔴 | critical | Must fix before merge |
| 🟡 | warning | Should fix |
| 🔵 | info | Consider fixing |
