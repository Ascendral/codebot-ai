/**
 * ConnectorRegistry — manages app connectors and credential resolution.
 *
 * Credential lookup: vault first → env var fallback.
 * This means users with GITHUB_TOKEN already set need zero configuration.
 */

import { Connector } from './base';
import { VaultManager } from '../vault';

export class ConnectorRegistry {
  private connectors: Map<string, Connector> = new Map();
  private vault: VaultManager;

  constructor(vault: VaultManager) {
    this.vault = vault;
  }

  register(connector: Connector): void {
    this.connectors.set(connector.name, connector);
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  all(): Connector[] {
    return Array.from(this.connectors.values());
  }

  /** Return connectors that have a credential in the vault OR matching env var */
  getConnected(): Connector[] {
    return this.all().filter(c => this.isConnected(c.name));
  }

  /** Check if a connector has credentials available */
  isConnected(name: string): boolean {
    const connector = this.connectors.get(name);
    if (!connector) return false;
    if (this.vault.has(name)) return true;
    if (connector.envKey && process.env[connector.envKey]) return true;
    // Multi-key: check all required env keys
    if (connector.requiredEnvKeys) {
      return connector.requiredEnvKeys.every(k => !!process.env[k]);
    }
    return false;
  }

  /** Get credential for a connector (vault first, then env) */
  getCredential(name: string): string | null {
    const connector = this.connectors.get(name);
    if (!connector) return null;

    // Vault first
    const vaultCred = this.vault.get(name);
    if (vaultCred) return vaultCred.value;

    // Env var fallback
    if (connector.envKey && process.env[connector.envKey]) {
      return process.env[connector.envKey]!;
    }

    // Multi-key: bundle as JSON
    if (connector.requiredEnvKeys) {
      const allPresent = connector.requiredEnvKeys.every(k => !!process.env[k]);
      if (allPresent) {
        const bundle: Record<string, string> = {};
        for (const k of connector.requiredEnvKeys) {
          bundle[k] = process.env[k]!;
        }
        return JSON.stringify(bundle);
      }
    }

    return null;
  }

  /** Get the VaultManager instance (for connect/disconnect operations) */
  getVault(): VaultManager {
    return this.vault;
  }
}
