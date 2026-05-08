import Anthropic from '@anthropic-ai/sdk';
import type { Finding, AgentResult, DiffFile } from '../types';

const SYSTEM_PROMPT = `You are a senior code reviewer validating findings from automated analysis agents.

You will receive:
1. The original PR diff
2. Raw findings from 4 specialized agents (security, performance, style, test)

Your job:
- Remove false positives (findings that don't apply to the actual diff)
- Remove duplicate findings that report the same underlying issue
- Adjust severity if a finding is over- or under-stated
- Keep all genuine issues unchanged

Return a JSON object with exactly this shape:
{
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": <integer>,
      "severity": "critical" | "warning" | "info",
      "category": "short category name",
      "message": "clear description",
      "suggestion": "concrete fix",
      "agentName": "SecurityAgent | PerformanceAgent | StyleAgent | TestAgent",
      "emoji": "🔒 | ⚡ | 🎨 | 🧪"
    }
  ],
  "assessment": "One paragraph overall assessment of the PR quality and main concerns."
}

Do not include any explanation outside the JSON.`;

interface ReviewedFinding extends Finding {
  agentName: string;
  emoji: string;
}

export interface ReviewerOutput {
  findings: ReviewedFinding[];
  assessment: string;
}

export async function runReviewerAgent(
  agentResults: AgentResult[],
  files: DiffFile[],
  apiKey: string,
  model: string
): Promise<ReviewerOutput> {
  const client = new Anthropic({ apiKey });

  const diffText = files
    .filter((f) => f.patch)
    .map((f) => `--- ${f.filename} ---\n${f.patch}`)
    .join('\n\n');

  const rawFindings = agentResults.flatMap((r) =>
    r.findings.map((f) => ({ ...f, agentName: r.agentName, emoji: r.emoji }))
  );

  const userMessage = [
    '## PR Diff',
    '',
    diffText,
    '',
    '## Raw Agent Findings',
    '',
    JSON.stringify(rawFindings, null, 2),
  ].join('\n');

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned) as ReviewerOutput;
}
