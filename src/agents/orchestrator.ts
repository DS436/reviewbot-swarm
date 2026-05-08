import { parsePrUrl, fetchPRDetails, fetchPRFiles, extractValidLines, postReview } from '../github';
import { runSecurityAgent } from './security-agent';
import { runPerformanceAgent } from './performance-agent';
import { runStyleAgent } from './style-agent';
import { runTestAgent } from './test-agent';
import type { Finding, AgentResult, ReviewComment } from '../types';

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function severityEmoji(severity: string): string {
  if (severity === 'critical') return '🔴';
  if (severity === 'warning') return '🟡';
  return '🔵';
}

function buildSummary(agentResults: AgentResult[], orphanFindings: Finding[]): string {
  const allFindings = agentResults.flatMap((r) => r.findings);
  const critical = allFindings.filter((f) => f.severity === 'critical').length;
  const warning = allFindings.filter((f) => f.severity === 'warning').length;
  const info = allFindings.filter((f) => f.severity === 'info').length;
  const total = allFindings.length;

  const lines: string[] = [
    '## 🤖 Multi-Agent PR Review',
    '',
    '### Scorecard',
    '',
    '| Agent | Findings |',
    '|-------|----------|',
  ];

  for (const result of agentResults) {
    const count = result.findings.length;
    lines.push(`| ${result.emoji} ${result.agentName} | ${count} |`);
  }

  lines.push('', '---', '');
  lines.push('### Summary');
  lines.push('');
  lines.push(
    `🔴 **${critical} critical** · 🟡 **${warning} warnings** · 🔵 **${info} info** · **${total} total**`
  );

  if (orphanFindings.length > 0) {
    lines.push('', '---', '');
    lines.push('### Additional Findings (lines not in diff)');
    lines.push('');

    const sorted = [...orphanFindings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    for (const f of sorted) {
      lines.push(
        `- ${severityEmoji(f.severity)} **[${f.category}]** \`${f.file}:${f.line}\` — ${f.message}`
      );
      lines.push(`  > ${f.suggestion}`);
    }
  }

  return lines.join('\n');
}

function buildCommentBody(finding: Finding, agentEmoji: string, agentName: string): string {
  return [
    `${agentEmoji} **${agentName}** · ${severityEmoji(finding.severity)} \`${finding.severity.toUpperCase()}\` · **${finding.category}**`,
    '',
    finding.message,
    '',
    `**Suggestion:** ${finding.suggestion}`,
  ].join('\n');
}

export async function orchestrate(prUrl: string): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!githubToken) throw new Error('GITHUB_TOKEN is not set');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const prInfo = parsePrUrl(prUrl);
  console.log(`\n🔍 Fetching PR #${prInfo.pullNumber} from ${prInfo.owner}/${prInfo.repo}...`);

  const [prDetails, files] = await Promise.all([
    fetchPRDetails(prInfo, githubToken),
    fetchPRFiles(prInfo, githubToken),
  ]);

  console.log(`📄 PR: "${prDetails.title}" (${files.length} files changed)`);
  console.log('\n🚀 Running agents in parallel...');

  const [securityFindings, performanceFindings, styleFindings, testFindings] =
    await Promise.all([
      runSecurityAgent(files, anthropicKey).then((f) => {
        console.log(`  🔒 SecurityAgent: ${f.length} findings`);
        return f;
      }),
      runPerformanceAgent(files, anthropicKey).then((f) => {
        console.log(`  ⚡ PerformanceAgent: ${f.length} findings`);
        return f;
      }),
      runStyleAgent(files, anthropicKey).then((f) => {
        console.log(`  🎨 StyleAgent: ${f.length} findings`);
        return f;
      }),
      runTestAgent(files, anthropicKey).then((f) => {
        console.log(`  🧪 TestAgent: ${f.length} findings`);
        return f;
      }),
    ]);

  const agentResults: AgentResult[] = [
    { agentName: 'SecurityAgent', emoji: '🔒', findings: deduplicateFindings(securityFindings) },
    { agentName: 'PerformanceAgent', emoji: '⚡', findings: deduplicateFindings(performanceFindings) },
    { agentName: 'StyleAgent', emoji: '🎨', findings: deduplicateFindings(styleFindings) },
    { agentName: 'TestAgent', emoji: '🧪', findings: deduplicateFindings(testFindings) },
  ];

  // Build a map of valid diff lines per file
  const validLinesByFile = new Map<string, Set<number>>();
  for (const file of files) {
    if (file.patch) {
      validLinesByFile.set(file.filename, extractValidLines(file.patch));
    }
  }

  // Separate findings into inline comments vs orphans (not in diff)
  const inlineComments: ReviewComment[] = [];
  const orphanFindings: Finding[] = [];

  for (const result of agentResults) {
    for (const finding of result.findings) {
      const validLines = validLinesByFile.get(finding.file);
      if (validLines && validLines.has(finding.line)) {
        inlineComments.push({
          path: finding.file,
          line: finding.line,
          body: buildCommentBody(finding, result.emoji, result.agentName),
        });
      } else {
        orphanFindings.push(finding);
      }
    }
  }

  const summary = buildSummary(agentResults, orphanFindings);

  console.log(`\n📝 Posting review with ${inlineComments.length} inline comments...`);
  await postReview(prInfo, githubToken, summary, inlineComments);

  const totalFindings = agentResults.reduce((n, r) => n + r.findings.length, 0);
  console.log(`\n✅ Review posted! ${totalFindings} findings across all agents.`);
}
