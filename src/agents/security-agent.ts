import Anthropic from '@anthropic-ai/sdk';
import type { Finding, DiffFile } from '../types';

const SYSTEM_PROMPT = `You are a security-focused code reviewer. Analyze code diffs for:
- Hardcoded secrets, API keys, passwords, tokens
- OWASP Top 10 vulnerabilities (injection, XSS, CSRF, insecure deserialization, etc.)
- Authentication and authorization flaws
- Sensitive data exposure
- SQL injection, command injection, path traversal
- Insecure direct object references
- Missing input validation or sanitization
- Cryptographic weaknesses

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

export async function runSecurityAgent(
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
        content: `Review this PR diff for security issues:\n\n${diffText}`,
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
