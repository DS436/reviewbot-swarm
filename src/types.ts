export type Severity = 'critical' | 'warning' | 'info';

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  category: string;
  message: string;
  suggestion: string;
}

export interface DiffFile {
  filename: string;
  patch?: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface PRInfo {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface PRDetails {
  title: string;
  body: string | null;
  baseRef: string;
  headRef: string;
}

export interface AgentResult {
  agentName: string;
  emoji: string;
  findings: Finding[];
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}
