import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskStateStore } from './task-state';

function makeProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-task-state-'));
}

describe('TaskStateStore', () => {
  it('creates a durable active task with progress details', () => {
    const projectRoot = makeProjectDir();
    const store = new TaskStateStore(projectRoot);

    const tracksTask = store.beginTurn('Fix the dashboard port mismatch');
    store.recordToolResult('grep', true, 'Found matching dashboard references.', { path: 'src/cli.ts' });

    const snapshot = store.getSnapshot();
    const promptBlock = store.buildPromptBlock('dashboard port');

    assert.strictEqual(tracksTask, true);
    assert.ok(snapshot.activeTask, 'expected an active task');
    assert.ok(snapshot.activeTask?.goal.includes('Fix the dashboard port mismatch'));
    assert.ok(promptBlock.includes('Active task: Fix the dashboard port mismatch'));
    assert.ok(promptBlock.includes('grep succeeded'));
    assert.ok(promptBlock.includes('src/cli.ts'));
  });

  it('keeps failed work as pending and reloads it across instances', () => {
    const projectRoot = makeProjectDir();
    const store = new TaskStateStore(projectRoot);

    store.beginTurn('Stabilize the persistent memory pipeline');
    store.recordToolResult('execute', false, 'Error: test suite failed on memory wiring.', { command: 'npm test' });
    store.completeActiveTask('execute failed: test suite failed on memory wiring.', false);

    const freshStore = new TaskStateStore(projectRoot);
    const snapshot = freshStore.getSnapshot();
    const promptBlock = freshStore.buildPromptBlock('continue memory work');

    assert.strictEqual(snapshot.activeTask, null);
    assert.strictEqual(snapshot.pendingTasks.length, 1);
    assert.ok(snapshot.pendingTasks[0].goal.includes('Stabilize the persistent memory pipeline'));
    assert.ok(promptBlock.includes('Unfinished tasks to keep in mind'));
    assert.ok(promptBlock.includes('memory wiring'));
  });

  it('does not create a new task for a throwaway message', () => {
    const projectRoot = makeProjectDir();
    const store = new TaskStateStore(projectRoot);

    const tracksTask = store.beginTurn('thanks');

    assert.strictEqual(tracksTask, false);
    assert.strictEqual(store.getSnapshot().activeTask, null);
  });

  it('restores the last pending task when the user says continue', () => {
    const projectRoot = makeProjectDir();
    const store = new TaskStateStore(projectRoot);

    store.beginTurn('Wire in desktop runtime checks');
    store.completeActiveTask('Stopped before completion.', false);

    const resumed = store.beginTurn('continue');

    assert.strictEqual(resumed, true);
    assert.ok(store.getSnapshot().activeTask?.goal.includes('Wire in desktop runtime checks'));
  });
});
