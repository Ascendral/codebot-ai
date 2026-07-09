import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuditLogger } from './audit';
import { PolicyEnforcer } from './policy';
import { RiskScorer } from './risk';
import {
  labelsForClaudeTool,
  decidePreToolUse,
  handleHookEvent,
  initClaudeSettings,
  auditSessionId,
  HookEvent,
} from './claude-hooks';

let tmpHome: string;
let origHome: string | undefined;

before(() => {
  origHome = process.env.AGENTTRAIL_HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-hooks-test-'));
  process.env.AGENTTRAIL_HOME = tmpHome;
});

after(() => {
  if (origHome !== undefined) process.env.AGENTTRAIL_HOME = origHome;
  else delete process.env.AGENTTRAIL_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('labelsForClaudeTool', () => {
  it('maps read tools to read-only', () => {
    assert.deepStrictEqual(labelsForClaudeTool('Read'), ['read-only']);
    assert.deepStrictEqual(labelsForClaudeTool('Grep'), ['read-only']);
  });

  it('maps write tools to write-fs', () => {
    assert.deepStrictEqual(labelsForClaudeTool('Edit'), ['write-fs']);
    assert.deepStrictEqual(labelsForClaudeTool('Write'), ['write-fs']);
  });

  it('maps Bash to run-cmd and WebFetch to net-fetch', () => {
    assert.deepStrictEqual(labelsForClaudeTool('Bash'), ['run-cmd']);
    assert.deepStrictEqual(labelsForClaudeTool('WebFetch'), ['net-fetch']);
  });

  it('maps mcp__ tools to account-access', () => {
    assert.deepStrictEqual(labelsForClaudeTool('mcp__github__create_issue'), ['account-access']);
  });

  it('maps unknown tools to run-cmd (conservative default)', () => {
    assert.deepStrictEqual(labelsForClaudeTool('SomeFutureTool'), ['run-cmd']);
  });
});

describe('decidePreToolUse', () => {
  const scorer = () => new RiskScorer();

  it('has no opinion on a plain Read (Claude Code gate stays primary)', () => {
    const decision = decidePreToolUse(
      { tool_name: 'Read', tool_input: { file_path: '/tmp/x.ts' } },
      new PolicyEnforcer(),
      scorer()
    );
    assert.strictEqual(decision.permissionDecision, undefined);
    assert.deepStrictEqual(decision.labels, ['read-only']);
  });

  it('denies a tool disabled by policy', () => {
    const enforcer = new PolicyEnforcer({
      version: 1,
      tools: { disabled: ['Bash'] },
    } as never);
    const decision = decidePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'ls' } },
      enforcer,
      scorer()
    );
    assert.strictEqual(decision.permissionDecision, 'deny');
    assert.match(decision.reason || '', /disabled by policy/);
  });

  it('records risk assessment on every decision', () => {
    const decision = decidePreToolUse(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
      new PolicyEnforcer(),
      scorer()
    );
    assert.ok(decision.risk.score >= 0 && decision.risk.score <= 100);
    assert.ok(decision.risk.factors.length > 0);
  });
});

describe('handleHookEvent chain', () => {
  const event = (over: Partial<HookEvent> = {}): HookEvent => ({
    session_id: 'chain-test',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
    ...over,
  });

  it('pre + post + pre across separate handler calls form ONE valid chain', () => {
    // Each handleHookEvent call resumes from disk — this simulates the
    // three separate hook processes Claude Code would spawn.
    handleHookEvent('pre', event());
    handleHookEvent('post', event({ hook_event_name: 'PostToolUse', tool_response: { ok: 1 } }));
    handleHookEvent('pre', event({ tool_name: 'Read', tool_input: { file_path: 'a.ts' } }));

    const logger = new AuditLogger();
    const sid = auditSessionId(event());
    const entries = logger.query({ sessionId: sid });
    assert.strictEqual(entries.length, 3, 'three entries recorded');
    const result = logger.verifySession(sid);
    assert.strictEqual(result.valid, true, `chain must verify: ${result.reason}`);
    assert.strictEqual(result.entriesChecked, 3);
    // Sequences continue across processes instead of restarting at 1
    assert.deepStrictEqual(
      entries.map((e) => e.sequence).sort((a, b) => a - b),
      [1, 2, 3]
    );
  });

  it('deny decision returns permissionDecision JSON on stdout', () => {
    // Write a project policy that disables Bash, into a temp project root
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-proj-'));
    const policyDir = path.join(projectRoot, '.agenttrail');
    fs.mkdirSync(policyDir, { recursive: true });
    fs.writeFileSync(
      path.join(policyDir, 'policy.json'),
      JSON.stringify({ version: '1', tools: { disabled: ['Bash'] } })
    );
    const { stdout, exitCode } = handleHookEvent(
      'pre',
      event({ session_id: 'deny-test', cwd: projectRoot })
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });

    assert.strictEqual(exitCode, 0);
    assert.ok(stdout, 'deny must produce stdout JSON');
    const parsed = JSON.parse(stdout as string);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /agenttrail/);

    // And the denial itself is on the chain
    const logger = new AuditLogger();
    const entries = logger.query({ sessionId: 'cc-deny-test' });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].action, 'policy_block');
  });

  it('allow path emits nothing on stdout (Claude Code gate proceeds)', () => {
    const { stdout, exitCode } = handleHookEvent(
      'pre',
      event({ session_id: 'silent-test', tool_name: 'Read', tool_input: { file_path: 'x' } })
    );
    assert.strictEqual(stdout, null);
    assert.strictEqual(exitCode, 0);
  });
});

describe('AuditLogger.resume', () => {
  it('continues the chain from disk across logger instances', () => {
    const first = AuditLogger.resume('resume-unit');
    first.log({ tool: 'a', action: 'execute', args: {} });
    first.log({ tool: 'b', action: 'execute', args: {} });

    const second = AuditLogger.resume('resume-unit');
    second.log({ tool: 'c', action: 'execute', args: {} });

    const result = second.verifySession('resume-unit');
    assert.strictEqual(result.valid, true, result.reason);
    assert.strictEqual(result.entriesChecked, 3);
  });
});

describe('initClaudeSettings', () => {
  it('creates settings.json with both hooks, idempotently, preserving content', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-init-'));
    try {
      // Pre-existing settings must survive
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, '.claude', 'settings.json'),
        JSON.stringify({ model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter' }] }] } })
      );

      const first = initClaudeSettings(projectRoot);
      assert.strictEqual(first.changed, true);

      const settings = JSON.parse(
        fs.readFileSync(path.join(projectRoot, '.claude', 'settings.json'), 'utf-8')
      );
      assert.strictEqual(settings.model, 'opus', 'unrelated settings preserved');
      assert.strictEqual(settings.hooks.PreToolUse.length, 2, 'existing hook preserved');
      assert.ok(
        JSON.stringify(settings.hooks.PreToolUse).includes('agenttrail hook pre'),
        'our pre hook added'
      );
      assert.ok(
        JSON.stringify(settings.hooks.PostToolUse).includes('agenttrail hook post'),
        'our post hook added'
      );

      const second = initClaudeSettings(projectRoot);
      assert.strictEqual(second.alreadyInstalled, true, 'second init is a no-op');
      const settings2 = JSON.parse(
        fs.readFileSync(path.join(projectRoot, '.claude', 'settings.json'), 'utf-8')
      );
      assert.strictEqual(settings2.hooks.PreToolUse.length, 2, 'no duplicate hooks');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses to clobber a corrupt settings.json', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-corrupt-'));
    try {
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), '{not json');
      assert.throws(() => initClaudeSettings(projectRoot));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
