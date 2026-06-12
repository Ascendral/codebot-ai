import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodingAgentRegistry } from './registry';
import { EchoCodingAgentProvider } from './echo';
import { listTasks, readTask } from './state';
import { VaultManager } from '../vault';
import { AuditLogger } from '../audit';
import { makeTestVaultPath } from '../test-vault-isolation';
import { makeTestAuditDir } from '../test-audit-isolation';
import type { TaskSpec, TaskEvent } from './types';

// Each test file gets its own CODEBOT_HOME so writeTask doesn't smear into the
// user's real ~/.codebot/tasks/.
let codebotHome: string;
let prevHome: string | undefined;

before(() => {
  codebotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-tasks-'));
  prevHome = process.env.CODEBOT_HOME;
  process.env.CODEBOT_HOME = codebotHome;
});

after(() => {
  if (prevHome === undefined) {
    delete process.env.CODEBOT_HOME;
  } else {
    process.env.CODEBOT_HOME = prevHome;
  }
  try {
    fs.rmSync(codebotHome, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function makeSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    provider: 'echo',
    title: 'demo',
    prompt: 'say hi',
    cwd: '/tmp',
    permissions: { allow: ['read-only'] },
    ...overrides,
  };
}

async function drain(events: AsyncIterable<TaskEvent>): Promise<TaskEvent[]> {
  const out: TaskEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('CodingAgentRegistry — boundary contract', () => {
  it('rejects unknown provider', async () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const reg = new CodingAgentRegistry(vault);
    await assert.rejects(() => reg.submit(makeSpec({ provider: 'does-not-exist' })), /unknown coding-agent provider/);
  });

  it('forwards validateSpec failures with provider message', async () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const reg = new CodingAgentRegistry(vault);
    reg.register(new EchoCodingAgentProvider());
    await assert.rejects(() => reg.submit(makeSpec({ title: '' })), /invalid task spec.*title is required/);
  });

  it('rejects double registration', () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const reg = new CodingAgentRegistry(vault);
    reg.register(new EchoCodingAgentProvider());
    assert.throws(() => reg.register(new EchoCodingAgentProvider()), /already registered: echo/);
  });

  it('persists task state and writes task_start audit row on submit', async () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const audit = new AuditLogger(makeTestAuditDir());
    const reg = new CodingAgentRegistry(vault, audit);
    reg.register(new EchoCodingAgentProvider(audit));

    const handle = await reg.submit(makeSpec({ title: 'persist-test' }));
    // State file exists immediately, before the stream completes.
    const persisted = readTask(handle.id);
    assert.ok(persisted, 'state file should exist after submit');
    assert.strictEqual(persisted!.spec.title, 'persist-test');
    assert.match(persisted!.status, /^(queued|running|succeeded)$/);

    const startRow = audit.query({ action: 'task_start', sessionId: audit.getSessionId() });
    assert.strictEqual(startRow.length, 1);
    assert.strictEqual(startRow[0].tool, 'coding-agent:echo');

    // Drain so the test doesn't leave background work hanging.
    await drain(handle.events());
  });
});

describe('EchoCodingAgentProvider — end-to-end stream', () => {
  it('emits status=running, log, result and ends at status=succeeded', async () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const audit = new AuditLogger(makeTestAuditDir());
    const reg = new CodingAgentRegistry(vault, audit);
    reg.register(new EchoCodingAgentProvider(audit));

    const handle = await reg.submit(makeSpec());
    const events = await drain(handle.events());

    assert.strictEqual(events.length, 3, `expected 3 events, got ${events.length}`);
    assert.deepStrictEqual(
      events.map((e) => e.type),
      ['status', 'log', 'result'],
    );
    const result = events[2];
    if (result.type !== 'result') throw new Error('expected result');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(handle.status(), 'succeeded');

    // Audit chain has task_event x2 + task_complete x1.
    const eventRows = audit.query({ action: 'task_event' });
    const completeRows = audit.query({ action: 'task_complete' });
    assert.strictEqual(eventRows.length, 2);
    assert.strictEqual(completeRows.length, 1);
  });

  it('listTasks returns persisted task after run', async () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const reg = new CodingAgentRegistry(vault);
    reg.register(new EchoCodingAgentProvider());

    const handle = await reg.submit(makeSpec({ title: 'listed' }));
    await drain(handle.events());

    const all = listTasks();
    const found = all.find((t) => t.id === handle.id);
    assert.ok(found, 'task should appear in listTasks()');
    assert.strictEqual(found!.spec.title, 'listed');
    assert.strictEqual(found!.status, 'succeeded');
    assert.ok(found!.endedAt);
  });

  it('cancel before terminal flips status to cancelled and writes audit row', async () => {
    const vault = new VaultManager({ vaultPath: makeTestVaultPath() });
    const audit = new AuditLogger(makeTestAuditDir());
    const reg = new CodingAgentRegistry(vault, audit);
    reg.register(new EchoCodingAgentProvider(audit));

    const handle = await reg.submit(makeSpec({ title: 'to-cancel' }));
    // Cancel synchronously after submit, BEFORE the deferred run() fires.
    await handle.cancel('test wants out');

    assert.strictEqual(handle.status(), 'cancelled');
    const cancelRows = audit.query({ action: 'task_cancelled' });
    assert.strictEqual(cancelRows.length, 1);

    // The events iterator must terminate cleanly.
    const events = await drain(handle.events());
    // After cancel, the only event seen is the cancellation log.
    assert.ok(events.some((e) => e.type === 'log' && e.message.includes('cancelled')));
  });

  it('validateSpec returns null on a clean spec', () => {
    const provider = new EchoCodingAgentProvider();
    assert.strictEqual(provider.validateSpec(makeSpec()), null);
  });

  it('validateSpec returns specific error strings', () => {
    const provider = new EchoCodingAgentProvider();
    assert.match(provider.validateSpec(makeSpec({ title: '' }))!, /title is required/);
    assert.match(provider.validateSpec(makeSpec({ prompt: '' }))!, /prompt is required/);
    assert.match(provider.validateSpec(makeSpec({ cwd: '' }))!, /cwd is required/);
  });
});
