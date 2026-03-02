import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { TaskPlannerTool } from './task-planner';

describe('TaskPlannerTool', () => {
  let tool: TaskPlannerTool;
  const tasksDir = path.join(process.cwd(), '.codebot');
  const tasksFile = path.join(tasksDir, 'tasks.json');

  before(() => {
    tool = new TaskPlannerTool();
  });

  beforeEach(() => {
    // Clean up tasks file before each test for isolation
    try {
      if (fs.existsSync(tasksFile)) {
        fs.writeFileSync(tasksFile, '[]');
      }
    } catch { /* ignore */ }
  });

  after(() => {
    // Clean up
    try {
      if (fs.existsSync(tasksFile)) {
        fs.unlinkSync(tasksFile);
      }
    } catch { /* ignore */ }
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'task_planner');
    assert.strictEqual(tool.permission, 'auto');
  });

  it('should return error when action is missing', async () => {
    const result = await tool.execute({ action: '' });
    assert.strictEqual(result, 'Error: action is required');
  });

  it('should return error for unknown action', async () => {
    const result = await tool.execute({ action: 'foobar' });
    assert.match(result, /Error: unknown action "foobar"/);
    assert.match(result, /add, list, update, complete, remove, clear/);
  });

  it('should return error when adding without title', async () => {
    const result = await tool.execute({ action: 'add' });
    assert.strictEqual(result, 'Error: title is required for add');
  });

  it('should add a task with default priority', async () => {
    const result = await tool.execute({ action: 'add', title: 'Test task' });
    assert.match(result, /Added task #\d+: Test task \[medium\]/);
  });

  it('should add a task with high priority', async () => {
    const result = await tool.execute({ action: 'add', title: 'Urgent task', priority: 'high' });
    assert.match(result, /Added task #\d+: Urgent task \[high\]/);
  });

  it('should list tasks', async () => {
    await tool.execute({ action: 'add', title: 'Task A' });
    await tool.execute({ action: 'add', title: 'Task B' });

    const result = await tool.execute({ action: 'list' });
    assert.match(result, /Task A/);
    assert.match(result, /Task B/);
    assert.match(result, /pending/);
  });

  it('should return "No tasks." when list is empty', async () => {
    const result = await tool.execute({ action: 'list' });
    assert.strictEqual(result, 'No tasks.');
  });

  it('should complete a task', async () => {
    await tool.execute({ action: 'add', title: 'Complete me' });
    // Find the task ID
    const listResult = await tool.execute({ action: 'list' });
    const idMatch = listResult.match(/#(\d+)/);
    assert.ok(idMatch, 'Should find a task ID in list');
    const id = parseInt(idMatch[1]);

    const result = await tool.execute({ action: 'complete', id });
    assert.match(result, /Completed task/);
    assert.match(result, /Complete me/);
  });

  it('should return error when completing without id', async () => {
    const result = await tool.execute({ action: 'complete' });
    assert.strictEqual(result, 'Error: id is required for complete');
  });

  it('should return error when completing nonexistent task', async () => {
    const result = await tool.execute({ action: 'complete', id: 9999 });
    assert.match(result, /Error: task #9999 not found/);
  });

  it('should remove a task', async () => {
    await tool.execute({ action: 'add', title: 'Remove me' });
    const listResult = await tool.execute({ action: 'list' });
    const idMatch = listResult.match(/#(\d+)/);
    assert.ok(idMatch);
    const id = parseInt(idMatch[1]);

    const result = await tool.execute({ action: 'remove', id });
    assert.match(result, /Removed task/);
    assert.match(result, /Remove me/);
  });

  it('should return error when removing without id', async () => {
    const result = await tool.execute({ action: 'remove' });
    assert.strictEqual(result, 'Error: id is required for remove');
  });

  it('should clear completed tasks', async () => {
    await tool.execute({ action: 'add', title: 'Done task' });
    const listResult = await tool.execute({ action: 'list' });
    const idMatch = listResult.match(/#(\d+)/);
    assert.ok(idMatch);
    const id = parseInt(idMatch[1]);

    await tool.execute({ action: 'complete', id });

    const result = await tool.execute({ action: 'clear' });
    assert.match(result, /Cleared 1 completed task/);
  });

  it('should update task status and title', async () => {
    await tool.execute({ action: 'add', title: 'Original title' });
    const listResult = await tool.execute({ action: 'list' });
    const idMatch = listResult.match(/#(\d+)/);
    assert.ok(idMatch);
    const id = parseInt(idMatch[1]);

    const result = await tool.execute({
      action: 'update',
      id,
      title: 'Updated title',
      status: 'in_progress',
    });
    assert.match(result, /Updated task/);
    assert.match(result, /Updated title/);
    assert.match(result, /in_progress/);
  });

  it('should return error when updating without id', async () => {
    const result = await tool.execute({ action: 'update' });
    assert.strictEqual(result, 'Error: id is required for update');
  });
});
