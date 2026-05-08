import Anthropic from '@anthropic-ai/sdk';
import type { Finding, DiffFile } from '../types';

const SYSTEM_PROMPT = `You are a test quality reviewer. Analyze code diffs for:
- Untested branches (code paths with no corresponding test)
- Missing edge case tests (null/undefined, empty arrays, boundary values, error conditions)
- Brittle assertions (testing implementation details instead of behavior)
- Tests that always pass (trivial assertions, missing assertions)
- Missing negative tests (testing that things fail correctly)
- Test isolation issues (tests depending on each other's state)
- Missing mocks for external dependencies (HTTP calls, databases, file system)
- Test descriptions that don't explain what's being tested
- Missing integration tests for critical paths
- New public functions or exports with no test coverage

Return ONLY a valid JSON array of findings. Each finding must have:
{
  "file": "path/to/file.ts",
  "line": <line number as integer>,
  "severity": "critical" | "warning" | "info",
  "category": "short category name",
  "message": "clear description of the issue",
  "suggestion": "concrete fix or recommendation"
}

If no issues found, return an empty array []. Do not include any explanation outside the JSON.`;

export async function runTestAgent(
  files: DiffFile[],
  apiKey: string
): Promise<Finding[]> {
  const client = new Anthropic({ apiKey });

  const diffText = files
    .filter((f) => f.patch)
    .map((f) => `--- ${f.filename} ---\n${f.patch}`)
    .join('\n\n');

  if (!diffText.trim()) return [];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Review this PR diff for test coverage and quality issues:\n\n${diffText}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned) as Finding[];
}
