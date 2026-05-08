import Anthropic from '@anthropic-ai/sdk';
import type { Finding, DiffFile } from '../types';

const SYSTEM_PROMPT = `You are a code style and quality reviewer. Analyze code diffs for:
- Naming convention violations (variables, functions, classes, constants)
- Dead code (unreachable code, unused variables, imports that are never used)
- Cyclomatic complexity (functions doing too many things, deeply nested conditionals)
- Magic numbers and strings (literals that should be named constants)
- Inconsistent error handling patterns
- Missing or incorrect TypeScript types (any, implicit any, overly broad types)
- Code duplication that should be extracted into reusable functions
- Long functions that should be broken down
- Misleading or outdated comments
- Violation of single-responsibility principle

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

export async function runStyleAgent(
  files: DiffFile[],
  apiKey: string,
  model: string
): Promise<Finding[]> {
  const client = new Anthropic({ apiKey });

  const diffText = files
    .filter((f) => f.patch)
    .map((f) => `--- ${f.filename} ---\n${f.patch}`)
    .join('\n\n');

  if (!diffText.trim()) return [];

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Review this PR diff for style and code quality issues:\n\n${diffText}`,
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
