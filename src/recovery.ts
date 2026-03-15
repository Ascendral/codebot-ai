/**
 * Recovery Suggestions — Phase D2
 *
 * Pattern-match common errors and return actionable fix suggestions.
 * Used by the agent to emit recovery hints alongside error events.
 *
 * RecoveryAction extends RecoverySuggestion with auto-executable fields
 * so the self-monitoring system can trigger fixes autonomously.
 */

export interface RecoverySuggestion {
  pattern: string;
  suggestion: string;
  command?: string;
}

export interface RecoveryAction extends RecoverySuggestion {
  /** Tool to invoke for autonomous fix */
  tool: string;
  /** Arguments for the tool */
  args: Record<string, unknown>;
  /** Whether this action can be auto-executed without user confirmation */
  autoExecutable: boolean;
  /** Risk score 0-1 — higher values need more caution */
  risk: number;
}

/**
 * Convert a RecoverySuggestion into an auto-executable RecoveryAction
 * when the pattern supports it.
 */
export function toRecoveryAction(suggestion: RecoverySuggestion): RecoveryAction | null {
  if (!suggestion.command) return null;

  // Only auto-execute low-risk commands
  const lowRiskCommands = ['codebot --setup', 'ollama serve', 'npm run build', 'npm test'];
  const isLowRisk = lowRiskCommands.some(cmd => suggestion.command?.includes(cmd));

  return {
    ...suggestion,
    tool: 'execute',
    args: { command: suggestion.command },
    autoExecutable: isLowRisk,
    risk: isLowRisk ? 0.2 : 0.5,
  };
}

const RECOVERY_PATTERNS: Array<{
  test: (msg: string) => boolean;
  suggestion: string;
  command?: string;
}> = [
  {
    test: (m) => /\b(401|403)\b/.test(m) || /unauthorized|forbidden|authentication.*fail/i.test(m),
    suggestion: 'API key expired or invalid. Re-run setup to configure credentials.',
    command: 'codebot --setup',
  },
  {
    test: (m) => /ECONNREFUSED.*(:11434|localhost:11434|127\.0\.0\.1:11434)/i.test(m),
    suggestion: 'Ollama is not running. Start the Ollama server first.',
    command: 'ollama serve',
  },
  {
    test: (m) => /ECONNREFUSED.*(:1234|localhost:1234|127\.0\.0\.1:1234)/i.test(m),
    suggestion: 'LM Studio is not running. Start LM Studio and load a model.',
  },
  {
    test: (m) => /\b429\b|rate.?limit/i.test(m),
    suggestion: 'Rate limited by provider. Consider using a local model to avoid rate limits.',
    command: '--provider ollama',
  },
  {
    test: (m) => /ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(m),
    suggestion: 'DNS resolution failed — no internet connection. Check your network or use a local model.',
    command: '--provider ollama',
  },
  {
    test: (m) => /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up/i.test(m) && !/11434|1234/.test(m),
    suggestion: 'Connection failed. The API endpoint may be down or unreachable. Check your network.',
  },
  {
    test: (m) => /model.*not.*found|does not exist|unknown model|model_not_found/i.test(m),
    suggestion: 'Model not available. If using Ollama, pull the model first.',
    command: 'ollama pull <model-name>',
  },
  {
    test: (m) => /insufficient.?quota|billing|account.*deactivated|account.*suspended/i.test(m),
    suggestion: 'Account billing issue. Check your API provider account status and billing.',
  },
  {
    test: (m) => /context.?length|too many tokens|maximum.*tokens|token.*limit/i.test(m),
    suggestion: 'Context too large for this model. Try compacting (/compact) or using a model with a larger context window.',
  },
  {
    test: (m) => /ENOSPC|no space left/i.test(m),
    suggestion: 'Disk full. Free up space to continue writing files.',
  },
  {
    test: (m) => /EACCES|permission denied/i.test(m) && !/api/i.test(m),
    suggestion: 'File permission denied. Check file ownership and permissions in the project directory.',
  },
];

/**
 * Match an error message against known patterns and return a recovery suggestion.
 * Returns null if no pattern matches.
 */
export function getRecoverySuggestion(errorMessage: string): RecoverySuggestion | null {
  for (const pattern of RECOVERY_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return {
        pattern: errorMessage.substring(0, 100),
        suggestion: pattern.suggestion,
        command: pattern.command,
      };
    }
  }
  return null;
}

/**
 * Format a recovery suggestion for CLI display.
 */
export function formatRecoveryHint(suggestion: RecoverySuggestion): string {
  let hint = `  Hint: ${suggestion.suggestion}`;
  if (suggestion.command) {
    hint += `\n  Try:  ${suggestion.command}`;
  }
  return hint;
}
