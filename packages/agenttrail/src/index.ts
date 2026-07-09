/**
 * agenttrail — tamper-evident flight recorder + policy gate for AI agents.
 *
 * Four pillars, zero runtime dependencies:
 *  - audit:  SHA-256 hash-chained append-only log of agent actions
 *  - policy: declarative enforcement (paths, tools, limits, RBAC)
 *  - risk:   7-factor 0-100 risk scoring per action
 *  - sarif:  SARIF 2.1.0 export for CI/SIEM integration
 */

// Audit chain (the core asset)
export { AuditLogger } from './audit';
export type { AuditEntry, VerifyResult } from './audit';

// Policy enforcement
export { PolicyEnforcer, DEFAULT_POLICY, loadPolicy, generateDefaultPolicyFile } from './policy';
export type {
  Policy,
  PolicyFilesystem,
  PolicyExecution,
  PolicyGit,
  PolicyLimits,
  PolicyMcp,
  PolicyRbac,
  PolicyRisk,
  PolicyRole,
  PolicySecrets,
  PolicyTools,
  PolicyToolPermission,
  PolicyConstitutional,
} from './policy';

// Risk scoring
export { RiskScorer } from './risk';
export type { RiskAssessment, RiskFactor } from './risk';

// SARIF export
export { exportSarif, sarifToString } from './sarif';
export type {
  SarifExportOptions,
  SarifLog,
  SarifRun,
  SarifResult,
  SarifRule,
  SarifLocation,
  SarifInvocation,
} from './sarif';

// Session integrity (HMAC)
export { deriveSessionKey, signMessage, verifyMessage, verifyMessages } from './integrity';
export type { IntegrityResult } from './integrity';

// Capability labels + gating
export { CapabilityChecker } from './capabilities';
export type { ToolCapabilities, CapabilityConfig } from './capabilities';
export {
  escalatePermissionFromCapabilityLabels,
  strictestPermissionForCapabilityLabels,
  labelsRequiringPermission,
  permissionRank,
  LABEL_TO_PERMISSION,
} from './capability-gating';
export type { CapabilityEscalation, Permission } from './capability-gating';
export {
  parseAllowCapabilityFlag,
  CapabilityAllowlistError,
  CURRENTLY_ALLOWABLE,
  NEVER_ALLOWABLE,
} from './capability-allowlist';

// Secret masking (applied before entries hit the log)
export { scanForSecrets, hasSecrets, maskSecretsInString } from './secrets';
export type { SecretMatch } from './secrets';

// At-rest log encryption
export {
  encrypt,
  decrypt,
  encryptLine,
  decryptLine,
  encryptContent,
  decryptContent,
  isEncryptionEnabled,
} from './encryption';
export type { EncryptionConfig } from './encryption';

// State-dir resolution (AGENTTRAIL_HOME, default ~/.agenttrail)
export { trailHome, trailPath } from './paths';

// Vendored shared types
export type { CapabilityLabel, ConstitutionalResult, CordDecision, VigilAlert } from './types';
