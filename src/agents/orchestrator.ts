import { parsePrUrl, fetchPRDetails, fetchPRFiles, extractValidLines, postReview } from '../github';
import { runSecurityAgent } from './security-agent';
import { runPerformanceAgent } from './performance-agent';
import { runStyleAgent } from './style-agent';
import { runTestAgent } from './test-agent';
import { runReviewerAgent } from './reviewer-agent';
import { getModelConfig } from '../config';
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

function buildSummary(
  agentResults: AgentResult[],
  assessment: string,
  orphanFindings: (Finding & { agentName: string; emoji: string })[],
  agentModel: string,
  reviewerModel: string
): string {
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
    lines.push(`| ${result.emoji} ${result.agentName} | ${result.findings.length} |`);
  }

  lines.push('', '---', '');
  lines.push('### Summary');
  lines.push('');
  lines.push(
    `🔴 **${critical} critical** · 🟡 **${warning} warnings** · 🔵 **${info} info** · **${total} total**`
  );

  lines.push('', '---', '');
  lines.push('### Overall Assessment');
  lines.push('');
  lines.push(assessment);

  lines.push('', '---', '');
  lines.push(
    `<sub>Agents: \`${agentModel}\` · Reviewer: \`${reviewerModel}\`</sub>`
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

function buildCommentBody(
  finding: Finding & { agentName: string; emoji: string }
): string {
  return [
    `${finding.emoji} **${finding.agentName}** · ${severityEmoji(finding.severity)} \`${finding.severity.toUpperCase()}\` · **${finding.category}**`,
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

  const { agentModel, reviewerModel } = getModelConfig();

  const prInfo = parsePrUrl(prUrl);
  console.log(`\n🔍 Fetching PR #${prInfo.pullNumber} from ${prInfo.owner}/${prInfo.repo}...`);

  const [prDetails, files] = await Promise.all([
    fetchPRDetails(prInfo, githubToken),
    fetchPRFiles(prInfo, githubToken),
  ]);

  console.log(`📄 PR: "${prDetails.title}" (${files.length} files changed)`);
  console.log(`\n🚀 Running agents in parallel [${agentModel}]...`);

  const [securityFindings, performanceFindings, styleFindings, testFindings] =
    await Promise.all([
      runSecurityAgent(files, anthropicKey, agentModel).then((f) => {
        console.log(`  🔒 SecurityAgent: ${f.length} findings`);
        return f;
      }),
      runPerformanceAgent(files, anthropicKey, agentModel).then((f) => {
        console.log(`  ⚡ PerformanceAgent: ${f.length} findings`);
        return f;
      }),
      runStyleAgent(files, anthropicKey, agentModel).then((f) => {
        console.log(`  🎨 StyleAgent: ${f.length} findings`);
        return f;
      }),
      runTestAgent(files, anthropicKey, agentModel).then((f) => {
        console.log(`  🧪 TestAgent: ${f.length} findings`);
        return f;
      }),
    ]);

  const rawAgentResults: AgentResult[] = [
    { agentName: 'SecurityAgent', emoji: '🔒', findings: deduplicateFindings(securityFindings) },
    { agentName: 'PerformanceAgent', emoji: '⚡', findings: deduplicateFindings(performanceFindings) },
    { agentName: 'StyleAgent', emoji: '🎨', findings: deduplicateFindings(styleFindings) },
    { agentName: 'TestAgent', emoji: '🧪', findings: deduplicateFindings(testFindings) },
  ];

  const totalRaw = rawAgentResults.reduce((n, r) => n + r.findings.length, 0);
  console.log(`\n🧠 Final review pass [${reviewerModel}] on ${totalRaw} findings...`);

  const { findings: reviewedFindings, assessment } = await runReviewerAgent(
    rawAgentResults,
    files,
    anthropicKey,
    reviewerModel
  );

  // Rebuild agentResults from reviewed findings so scorecard reflects post-review counts
  const agentResultMap = new Map<string, AgentResult>();
  for (const r of rawAgentResults) {
    agentResultMap.set(r.agentName, { ...r, findings: [] });
  }
  for (const f of reviewedFindings) {
    agentResultMap.get(f.agentName)?.findings.push(f);
  }
  const agentResults = [...agentResultMap.values()];

  // Build valid-line map for inline comment eligibility
  const validLinesByFile = new Map<string, Set<number>>();
  for (const file of files) {
    if (file.patch) {
      validLinesByFile.set(file.filename, extractValidLines(file.patch));
    }
  }

  const inlineComments: ReviewComment[] = [];
  const orphanFindings: (Finding & { agentName: string; emoji: string })[] = [];

  for (const finding of reviewedFindings) {
    const validLines = validLinesByFile.get(finding.file);
    if (validLines && validLines.has(finding.line)) {
      inlineComments.push({
        path: finding.file,
        line: finding.line,
        body: buildCommentBody(finding),
      });
    } else {
      orphanFindings.push(finding);
    }
  }

  const summary = buildSummary(agentResults, assessment, orphanFindings, agentModel, reviewerModel);

  console.log(`\n📝 Posting review with ${inlineComments.length} inline comments...`);
  await postReview(prInfo, githubToken, summary, inlineComments);

  console.log(`\n✅ Review posted! ${reviewedFindings.length} findings (${totalRaw - reviewedFindings.length} removed by reviewer).`);
}
