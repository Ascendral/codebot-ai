/**
 * Secret detection module for CodeBot.
 *
 * Scans content for common credential patterns (API keys, tokens, passwords).
 * Returns matches with line numbers and masked excerpts.
 * Used to warn before writing secrets to files — does NOT block writes.
 */

export interface SecretMatch {
  type: string;
  line: number;
  snippet: string; // masked excerpt
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'aws_access_key',    pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'aws_secret_key',    pattern: /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/ },
  { name: 'private_key',       pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'github_token',      pattern: /gh[ps]_[A-Za-z0-9_]{36,}/ },
  { name: 'github_oauth',      pattern: /gho_[A-Za-z0-9_]{36,}/ },
  { name: 'github_finegrained',pattern: /github_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'anthropic_key',     pattern: /sk-ant-api\d+-[A-Za-z0-9_\-]{80,}/ },
  { name: 'openai_project_key',pattern: /sk-proj-[A-Za-z0-9_\-]{50,}/ },
  { name: 'google_api_key',    pattern: /AIza[A-Za-z0-9_\-]{35}/ },
  { name: 'groq_key',          pattern: /gsk_[A-Za-z0-9]{48,}/ },
  { name: 'generic_api_key',   pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}/i },
  { name: 'jwt',               pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-]+/ },
  { name: 'password_assign',   pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  { name: 'connection_string', pattern: /(?:mongodb|postgres|postgresql|mysql|redis|amqp):\/\/[^\s]{10,}/ },
  { name: 'slack_token',       pattern: /xox[bprs]-[0-9]{10,}-[A-Za-z0-9\-]+/ },
  { name: 'slack_webhook',     pattern: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { name: 'generic_secret',    pattern: /(?:secret|token|credential|auth_token)\s*[:=]\s*['"][^'"]{16,}['"]/i },
  { name: 'npm_token',         pattern: /\/\/registry\.npmjs\.org\/:_authToken=[^\s]+/ },
  { name: 'sendgrid_key',      pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/ },
  { name: 'stripe_key',        pattern: /sk_(live|test)_[A-Za-z0-9]{24,}/ },
];

/**
 * Mask a matched secret for safe display.
 * Shows first 4 chars + **** + last 4 chars for strings >= 12 chars.
 * For shorter strings, shows first 2 + **** + last 2.
 */
function maskSecret(match: string): string {
  if (match.length >= 12) {
    return match.substring(0, 4) + '****' + match.substring(match.length - 4);
  }
  if (match.length >= 6) {
    return match.substring(0, 2) + '****' + match.substring(match.length - 2);
  }
  return '****';
}

/**
 * Scan content for secrets. Returns array of matches with line numbers and masked snippets.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        matches.push({
          type: name,
          line: i + 1,
          snippet: maskSecret(match[0]),
        });
      }
    }
  }

  return matches;
}

/**
 * Quick check: does the content contain any secrets?
 */
export function hasSecrets(content: string): boolean {
  for (const { pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

/**
 * Mask secrets in an arbitrary string (e.g., for audit logging).
 * Replaces all detected secret matches with masked versions.
 */
export function maskSecretsInString(text: string): string {
  let masked = text;
  for (const { pattern } of SECRET_PATTERNS) {
    masked = masked.replace(new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g')), match => maskSecret(match));
  }
  return masked;
}
