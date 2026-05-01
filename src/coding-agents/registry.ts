/**
 * CodingAgentRegistry — manages CodingAgentProvider instances.
 *
 * Mirrors the shape of ConnectorRegistry: vault-first credential lookup,
 * env-var fallback, register/get/all. The registry is the only thing
 * allowed to read credentials; providers receive them as a string arg
 * to start().
 */

import * as crypto from 'crypto';
import { VaultManager } from '../vault';
import { AuditLogger } from '../audit';
import type { CodingAgentProvider, TaskSpec, TaskHandle } from './types';
import { writeTask } from './state';

export class CodingAgentRegistry {
  private providers: Map<string, CodingAgentProvider> = new Map();
  private vault: VaultManager;
  private audit: AuditLogger | null;

  constructor(vault: VaultManager, audit?: AuditLogger) {
    this.vault = vault;
    this.audit = audit ?? null;
  }

  register(provider: CodingAgentProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`coding-agent provider already registered: ${provider.name}`);
    }
    this.providers.set(provider.name, provider);
  }

  get(name: string): CodingAgentProvider | undefined {
    return this.providers.get(name);
  }

  all(): CodingAgentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Submit a task spec. Validates, resolves credential, audits, persists,
   * then hands off to the provider's start().
   */
  async submit(spec: TaskSpec): Promise<TaskHandle> {
    const provider = this.providers.get(spec.provider);
    if (!provider) {
      throw new Error(`unknown coding-agent provider: ${spec.provider}`);
    }

    const validationError = provider.validateSpec(spec);
    if (validationError) {
      throw new Error(`invalid task spec: ${validationError}`);
    }

    const id = spec.id || crypto.randomUUID();
    const realized: TaskSpec = { ...spec, id };

    // Vault-first credential resolution. Provider may declare none.
    let credential: string | null = null;
    if (provider.vaultKeyName) {
      const v = this.vault.get(provider.vaultKeyName);
      if (v) credential = v.value;
    }

    // Persist before start so a crash mid-handoff still leaves a row.
    writeTask({
      id,
      spec: realized,
      status: 'queued',
      startedAt: new Date().toISOString(),
      recentEvents: [],
    });

    this.audit?.log({
      tool: `coding-agent:${provider.name}`,
      action: 'task_start',
      args: { id, title: spec.title, cwd: spec.cwd, allow: spec.permissions.allow },
    });

    return provider.start(realized, credential);
  }
}
