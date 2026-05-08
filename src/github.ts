import { Octokit } from '@octokit/rest';
import type { PRInfo, PRDetails, DiffFile, ReviewComment } from './types';

export function parsePrUrl(url: string): PRInfo {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: ${url}`);
  }
  return {
    owner: match[1],
    repo: match[2],
    pullNumber: parseInt(match[3], 10),
  };
}

export async function fetchPRDetails(info: PRInfo, token: string): Promise<PRDetails> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.pulls.get({
    owner: info.owner,
    repo: info.repo,
    pull_number: info.pullNumber,
  });
  return {
    title: data.title,
    body: data.body,
    baseRef: data.base.ref,
    headRef: data.head.ref,
  };
}

export async function fetchPRFiles(info: PRInfo, token: string): Promise<DiffFile[]> {
  const octokit = new Octokit({ auth: token });
  const files: DiffFile[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner: info.owner,
      repo: info.repo,
      pull_number: info.pullNumber,
      per_page: 100,
      page,
    });

    for (const f of data) {
      files.push({
        filename: f.filename,
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
        status: f.status,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return files;
}

export function extractValidLines(patch: string): Set<number> {
  const validLines = new Set<number>();
  let currentNewLine = 0;

  for (const line of patch.split('\n')) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentNewLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    if (line.startsWith('+')) {
      currentNewLine++;
      validLines.add(currentNewLine);
    } else if (!line.startsWith('-')) {
      currentNewLine++;
    }
  }

  return validLines;
}

export async function postReview(
  info: PRInfo,
  token: string,
  summary: string,
  comments: ReviewComment[]
): Promise<void> {
  const octokit = new Octokit({ auth: token });

  await octokit.pulls.createReview({
    owner: info.owner,
    repo: info.repo,
    pull_number: info.pullNumber,
    event: 'COMMENT',
    body: summary,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: 'RIGHT' as const,
      body: c.body,
    })),
  });
}
