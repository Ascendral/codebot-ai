# SOC 2 Compliance Readiness Guide

How CodeBot AI maps to the SOC 2 Trust Services Criteria, what's already built, and what organizations need to add for a formal audit.

## What is SOC 2?

SOC 2 (System and Organization Controls 2) is a compliance framework developed by the AICPA. It evaluates how a service organization manages data based on five Trust Services Criteria:

1. **Security** (Common Criteria) — required for all SOC 2 reports
2. **Availability** — system uptime and reliability
3. **Processing Integrity** — accurate, complete, timely processing
4. **Confidentiality** — data classified as confidential is protected
5. **Privacy** — personal information handling

CodeBot AI is a self-hosted, local-first tool. This means many SOC 2 controls shift to the deploying organization. This guide covers what CodeBot provides out of the box and what your organization must layer on top.

---

## Trust Services Criteria Mapping

### CC1: Control Environment

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC1.1 | Demonstrate commitment to integrity and ethical values | MIT license, CONTRIBUTING.md, CLA | Org: Establish code of conduct for AI tool usage |
| CC1.2 | Board/management oversight | N/A (self-hosted tool) | Org: Define AI governance committee or owner |
| CC1.3 | Establish structure, authority, responsibility | Policy engine supports org/team/project hierarchy | Org: Map policy hierarchy to org chart |
| CC1.4 | Demonstrate competency commitment | 483+ tests, TypeScript strict mode, STRIDE threat model | Org: Ensure operators are trained on policy configuration |
| CC1.5 | Enforce accountability | Hash-chained audit log, per-action attribution | Org: Assign session ownership, review audit logs |

### CC2: Communication and Information

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC2.1 | Generate quality information for controls | Structured metrics, risk scoring, SARIF export, audit trail | Org: Route SARIF reports to SIEM or dashboard |
| CC2.2 | Communicate control objectives internally | SECURITY.md, HARDENING.md, POLICY_GUIDE.md, THREAT_MODEL.md | Org: Distribute policies to development teams |
| CC2.3 | Communicate with external parties | Vulnerability disclosure process in SECURITY.md | Org: Publish security contact, incident response plan |

### CC3: Risk Assessment

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC3.1 | Specify objectives with clarity | ROADMAP.md, ARCHITECTURE.md define scope and goals | Org: Map CodeBot usage to business risk register |
| CC3.2 | Identify and analyze risks | STRIDE-based THREAT_MODEL.md, 6-factor risk scoring | Org: Perform risk assessment including CodeBot in scope |
| CC3.3 | Consider fraud risk | Prompt injection analysis in threat model, LLM output treated as untrusted data | Org: Train teams on prompt injection risks |
| CC3.4 | Identify and assess changes | CHANGELOG.md, semantic versioning, CI/CD pipeline | Org: Change management process for policy updates |

### CC4: Monitoring Activities

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC4.1 | Select and develop monitoring activities | `/metrics` command, risk history (`/risk`), OpenTelemetry export | Org: Configure OTEL endpoint for continuous monitoring |
| CC4.2 | Evaluate and communicate deficiencies | `--verify-audit` integrity check, SARIF for CI integration | Org: Set up alerts on audit verification failures |

### CC5: Control Activities

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC5.1 | Select control activities to mitigate risks | 8-layer security stack (policy, capabilities, permissions, risk scoring, path safety, secret detection, SSRF, sandbox) | Already covered |
| CC5.2 | Select technology-based controls | Docker sandbox, secret scanning, path traversal prevention, SSRF protection | Org: Enable Docker sandbox in production deployments |
| CC5.3 | Deploy through policies | Declarative JSON policy engine, per-project policies | Org: Create and maintain organization-level policies |

### CC6: Logical and Physical Access Controls

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC6.1 | Implement logical access security | Permission gates (auto/prompt/always-ask), policy engine controls tool access | Org: RBAC at OS/infrastructure level (CodeBot runs as local process) |
| CC6.2 | Prior to issuing credentials | API keys managed via env vars, never stored in code | Org: Use secrets managers (Vault, AWS Secrets Manager) for API keys |
| CC6.3 | Register and authorize new users | Single-user local tool | Org: Control who can install/run CodeBot via OS permissions |
| CC6.4 | Manage physical and logical access | Filesystem scoping, path safety, project-root isolation | Org: Host-level access controls, directory permissions |
| CC6.5 | Restrict access to information assets | `denied_paths`, `writable_paths`, `allow_outside_project: false` | Org: Configure restrictive filesystem policies |
| CC6.6 | Manage identities and credentials | Secret detection blocks credential leakage in file writes | Org: Rotate API keys regularly, use short-lived tokens |
| CC6.7 | Restrict access transmission | SSRF protection, private IP blocking, HTTPS enforcement | Org: Network-level controls (firewalls, VPNs) |
| CC6.8 | Prevent or detect unauthorized software | Capability-based shell command restrictions, tool enable/disable | Org: Allowlist executables at OS level |

### CC7: System Operations

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC7.1 | Detect and manage changes to infrastructure | CI/CD workflow, TypeScript strict mode, 483+ tests | Org: Pin CodeBot version in deployments |
| CC7.2 | Monitor for anomalies | Risk scoring with threshold alerts, cost limit enforcement, iteration limits | Org: Alert on high-risk scores, audit log anomalies |
| CC7.3 | Evaluate security events | Audit trail records every security block, denial, and error | Org: Review audit logs periodically |
| CC7.4 | Respond to identified anomalies | Circuit breakers (cost limit, iteration limit), risk-based confirmation gates | Org: Incident response plan including AI tool incidents |

### CC8: Change Management

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC8.1 | Manage changes to infrastructure and software | Semantic versioning, CHANGELOG.md, CI matrix (3 OS x 3 Node versions) | Org: Test policy changes before deployment |

### CC9: Risk Mitigation

| Control | SOC 2 Requirement | CodeBot Coverage | Gap / Org Responsibility |
|---------|-------------------|-----------------|--------------------------|
| CC9.1 | Identify and assess risks from third parties | LLM provider interaction documented in PRIVACY.md, SSRF protection | Org: Vendor risk assessment for LLM providers |
| CC9.2 | Assess and manage risks from third-party components | Zero runtime dependencies eliminates supply chain risk | Already covered — 0 dependencies |

---

## Availability Criteria

| Area | CodeBot Coverage |
|------|-----------------|
| Recovery | Automatic retry with exponential backoff for network errors, rate limits (429), server errors (5xx) |
| Stream resilience | Mid-response connection drops are retried on next iteration |
| Context management | Automatic compaction prevents context window overflow |
| Process resilience | Unhandled exceptions caught, REPL keeps running |
| Routine timeouts | Scheduled tasks capped at 5 minutes |
| Cost protection | Hard `cost_limit_usd` stops runaway sessions |

**Org responsibility:** Define SLA for CodeBot availability if used in CI/CD pipelines. Monitor LLM provider uptime independently.

---

## Confidentiality Criteria

| Area | CodeBot Coverage |
|------|-----------------|
| Secret detection | Scans for AWS keys, GitHub tokens, JWTs, private keys, connection strings before file writes |
| Data locality | All data stays on local machine — no cloud storage, no telemetry by default |
| LLM data handling | PRIVACY.md documents what is/isn't sent to LLM providers |
| Audit log protection | Hash-chained JSONL prevents tampering |
| Filesystem isolation | Project-scoped file access, path traversal prevention |

**Org responsibility:** Classify data in repositories. Enable `block_on_detect: true` for secrets. Review PRIVACY.md against your data handling policies.

---

## Processing Integrity Criteria

| Area | CodeBot Coverage |
|------|-----------------|
| Tool validation | Schema validation on all tool call arguments |
| Hash verification | `--verify-audit` validates SHA-256 hash chain integrity |
| Session integrity | HMAC-SHA256 message signing for session history |
| Deterministic policies | JSON policy engine with documented merge precedence |

**Org responsibility:** Verify audit integrity on a schedule. Review tool results before merging AI-generated changes.

---

## Privacy Criteria

| Area | CodeBot Coverage |
|------|-----------------|
| No PII collection | CodeBot collects zero personal information |
| No telemetry | Telemetry is opt-in only (via OpenTelemetry) |
| Data deletion | PRIVACY.md documents data locations and deletion instructions |
| Local-first | No cloud accounts, no SaaS services, no data transmission beyond LLM API calls |

**Org responsibility:** Review what code/data is sent to LLM providers. Use local models (Ollama) for maximum data sovereignty.

---

## SOC 2 Readiness Checklist

### Already Provided by CodeBot

- [x] Hash-chained, tamper-evident audit logs
- [x] SARIF export for CI/CD security scanning integration
- [x] 6-factor risk scoring on every action (0-100)
- [x] Declarative JSON policy engine
- [x] Capability-based access controls
- [x] Secret detection and blocking
- [x] Docker sandbox execution
- [x] SSRF protection (private IP, metadata endpoint blocking)
- [x] Path safety (system directory protection, traversal prevention)
- [x] Session integrity (HMAC-SHA256 signatures)
- [x] STRIDE-based threat model
- [x] Vulnerability disclosure process
- [x] Zero runtime dependencies (zero supply chain risk)
- [x] 483+ automated tests
- [x] OpenTelemetry metrics export (opt-in)
- [x] Comprehensive security documentation

### Required from Your Organization

- [ ] Define AI governance policy and assign ownership
- [ ] Configure organization-level `.codebot/policy.json`
- [ ] Enable Docker sandbox for all production/CI deployments
- [ ] Route SARIF reports to your SIEM or security dashboard
- [ ] Configure OpenTelemetry export to your monitoring stack
- [ ] Store LLM API keys in a secrets manager (not env files)
- [ ] Schedule periodic `--verify-audit` integrity checks
- [ ] Establish audit log review cadence (weekly/monthly)
- [ ] Pin CodeBot version in deployment configurations
- [ ] Train developers on policy configuration and prompt injection risks
- [ ] Include CodeBot in your change management process
- [ ] Add CodeBot to your vendor risk assessment for LLM providers
- [ ] Define incident response procedures for AI-related security events
- [ ] Classify data in repositories that CodeBot can access
- [ ] Document data flow between CodeBot and LLM providers

### For SOC 2 Type II (Continuous Compliance)

- [ ] Automated audit log shipping to central logging (ELK, Splunk, Datadog)
- [ ] Automated alerts on risk score thresholds
- [ ] Quarterly policy reviews and updates
- [ ] Annual STRIDE threat model refresh
- [ ] Penetration testing including AI-specific attack vectors
- [ ] Evidence collection automation for audit periods

---

## Sample Policy for SOC 2 Environments

```json
{
  "version": "1.0",
  "execution": {
    "sandbox": "docker",
    "network": false,
    "timeout_seconds": 60,
    "max_memory_mb": 512
  },
  "filesystem": {
    "writable_paths": ["./src/**", "./tests/**", "./docs/**"],
    "denied_paths": [
      "./.env", "./.env.*",
      "./secrets/", "./.aws/",
      "./.ssh/", "./.gnupg/",
      "./.git/config"
    ],
    "allow_outside_project": false
  },
  "tools": {
    "disabled": ["ssh_remote", "docker", "database"],
    "permissions": {
      "execute": "always-ask",
      "write_file": "prompt",
      "git": "prompt",
      "browser": "always-ask",
      "http_client": "always-ask"
    },
    "capabilities": {
      "execute": {
        "shell_commands": [
          "npm test", "npm run build", "npm run lint",
          "tsc", "git status", "git diff", "git log"
        ]
      }
    }
  },
  "secrets": {
    "block_on_detect": true,
    "scan_on_write": true
  },
  "limits": {
    "max_iterations": 25,
    "cost_limit_usd": 5.00,
    "max_file_size_kb": 200
  },
  "git": {
    "always_branch": true,
    "never_push_main": true,
    "branch_prefix": "codebot/"
  }
}
```

---

## Evidence Artifacts for Auditors

When preparing for a SOC 2 audit, point auditors to these CodeBot artifacts:

| Evidence | Location | SOC 2 Criteria |
|----------|----------|---------------|
| Security architecture | `SECURITY.md` | CC5.1, CC6.1 |
| Threat model | `docs/THREAT_MODEL.md` | CC3.2, CC3.3 |
| Hardening guide | `docs/HARDENING.md` | CC5.2, CC6.5 |
| Policy documentation | `docs/POLICY_GUIDE.md` | CC5.3, CC2.2 |
| Architecture diagram | `docs/ARCHITECTURE.md` | CC1.3, CC7.1 |
| Privacy policy | `PRIVACY.md` | Privacy criteria |
| Audit logs | `~/.codebot/audit/*.jsonl` | CC4.1, CC7.3 |
| SARIF reports | `--export-audit sarif` output | CC2.1, CC7.2 |
| Test results | `npm test` output (483+ tests) | CC8.1 |
| Changelog | `CHANGELOG.md` | CC8.1, CC3.4 |
| Risk assessments | `/risk` command output | CC3.2, CC7.2 |
| Metrics | `/metrics` command or OTEL export | CC4.1 |
| Integrity verification | `--verify-audit` output | CC7.3 |

---

## Comparison: CodeBot vs. Typical AI Tools for SOC 2

| SOC 2 Control Area | GitHub Copilot | Cursor | Auto-GPT | **CodeBot AI** |
|--------------------|---------------|--------|----------|---------------|
| Audit trail | None | None | None | **Hash-chained JSONL** |
| Risk scoring | None | None | None | **6-factor (0-100)** |
| Policy engine | None | None | None | **Declarative JSON** |
| Secret detection | None | None | None | **Built-in scanner** |
| SARIF export | None | None | None | **SARIF 2.1.0** |
| Sandbox execution | N/A (cloud) | N/A (cloud) | None | **Docker sandbox** |
| Integrity verification | N/A | N/A | None | **SHA-256 hash chain** |
| Data locality | Cloud only | Cloud only | Local | **Local-first** |
| Zero dependencies | No | No | No (100+) | **Yes** |
| Threat model | Not public | Not public | None | **STRIDE-based** |

CodeBot AI is the only AI coding agent with built-in controls that map directly to SOC 2 criteria.
