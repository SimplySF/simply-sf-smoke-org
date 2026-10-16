// aloop loop config — implement: gpt-6.1-sol (medium), review: gpt-6-luna (high), docs: claude-haiku-5-5
// The gate is offline (syntax, lint, harness unit tests). Live scratch-org runs are verified outside the gate.
export default {
  baseBranch: 'main',
  branchPrefix: 'feat/',
  remote: 'origin',
  preset: 'work-item',
  engines: {
    default: { name: 'codex', model: 'gpt-6.1-sol', effort: 'medium' },
    review: { name: 'codex', model: 'gpt-6-luna', effort: 'high' },
    docs: { name: 'claude', model: 'claude-haiku-5-5', effort: 'high' },
    'pr-description': { name: 'claude', model: 'claude-haiku-5-5', effort: 'high' },
  },
  phases: ['implement', 'docs', 'gate', 'review', 'address', 'pr-description', 'publish'],
  setup: ['if [ -f package-lock.json ]; then npm ci --ignore-scripts; fi'],
  gate: ['npm test'],
  maxRounds: 5,
  timeoutMs: 45 * 60 * 1000,
};
