import Anthropic from '@anthropic-ai/sdk';
import type { Finding, DiffFile } from '../types';

const SYSTEM_PROMPT = `You are a performance-focused code reviewer. Analyze code diffs for:
- N+1 query problems (database calls in loops)
- Blocking I/O operations in async contexts
- Memory leaks (event listeners not removed, closures holding references, infinite growth)
- Inefficient algorithms (O(n²) or worse where better exists)
- Missing database indexes implied by the query patterns
- Unnecessary re-renders or recomputations in UI code
- Large bundle imports (importing entire libraries when only one function is needed)
- Synchronous operations that should be async
- Missing caching opportunities for expensive computations

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

export async function runPerformanceAgent(
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
        content: `Review this PR diff for performance issues:\n\n${diffText}`,
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
