/**
 * Connector framework — base interfaces for app integrations.
 */

export interface ConnectorAction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, credential: string): Promise<string>;
}

export interface Connector {
  /** Lowercase slug: 'github', 'slack', 'jira', 'linear' */
  name: string;
  /** Human-readable: 'GitHub', 'Slack', 'Jira', 'Linear' */
  displayName: string;
  description: string;
  authType: 'api_key' | 'oauth' | 'webhook_url';
  /** Auto-detect env var: 'GITHUB_TOKEN' */
  envKey?: string;
  /** For multi-key auth like Jira (token + email + url) */
  requiredEnvKeys?: string[];
  actions: ConnectorAction[];
  /** Test if the credential is valid (makes a real API call) */
  validate(credential: string): Promise<boolean>;
}
