export interface ModelConfig {
  agentModel: string;
  reviewerModel: string;
}

export function getModelConfig(): ModelConfig {
  return {
    agentModel: process.env.AGENT_MODEL ?? 'claude-haiku-4-5',
    reviewerModel: process.env.REVIEWER_MODEL ?? 'claude-sonnet-4-6',
  };
}
