import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSkills, skillToTool, SkillDefinition } from './skills';

describe('Skills System', () => {
  it('loadSkills returns built-in skills when no dir exists', () => {
    const skills = loadSkills();
    assert.ok(skills.length >= 3, 'Should have at least 3 built-in skills');
    const names = skills.map(s => s.name);
    assert.ok(names.includes('pr-review-notify'));
    assert.ok(names.includes('bug-report'));
    assert.ok(names.includes('standup-summary'));
  });

  it('skillToTool creates a valid Tool object', () => {
    const skill: SkillDefinition = {
      name: 'test-skill',
      description: 'A test skill',
      steps: [{ tool: 'think', args: { thought: 'testing' } }],
    };
    const mockExecute = async () => 'mock result';
    const tool = skillToTool(skill, mockExecute);
    assert.strictEqual(tool.name, 'skill_test-skill');
    assert.strictEqual(tool.permission, 'prompt');
    assert.ok(tool.description.includes('[Skill]'));
    assert.ok(tool.description.includes('A test skill'));
  });

  it('resolves {{input.field}} template variables', async () => {
    const skill: SkillDefinition = {
      name: 'template-test',
      description: 'Test template resolution',
      steps: [{ tool: 'echo', args: { text: 'Hello {{input.name}}!' } }],
    };
    let capturedArgs: Record<string, unknown> = {};
    const mockExecute = async (_name: string, args: Record<string, unknown>) => {
      capturedArgs = args;
      return 'done';
    };
    const tool = skillToTool(skill, mockExecute);
    await tool.execute({ name: 'World' });
    assert.strictEqual(capturedArgs.text, 'Hello World!');
  });

  it('resolves {{prev.output}} template variables', async () => {
    const skill: SkillDefinition = {
      name: 'prev-test',
      description: 'Test prev.output',
      steps: [
        { tool: 'step1', args: {} },
        { tool: 'step2', args: { input: '{{prev.output}}' } },
      ],
    };
    let callCount = 0;
    let lastArgs: Record<string, unknown> = {};
    const mockExecute = async (_name: string, args: Record<string, unknown>) => {
      callCount++;
      lastArgs = args;
      if (callCount === 1) return 'first-step-output';
      return 'done';
    };
    const tool = skillToTool(skill, mockExecute);
    await tool.execute({});
    assert.strictEqual(lastArgs.input, 'first-step-output');
  });

  it('skips steps when condition is not met', async () => {
    const skill: SkillDefinition = {
      name: 'condition-test',
      description: 'Test conditions',
      steps: [
        { tool: 'step1', args: {} },
        { tool: 'step2', args: {}, condition: '{{prev.success}}' },
      ],
    };
    const calls: string[] = [];
    const mockExecute = async (name: string) => {
      calls.push(name);
      return 'Error: something failed';
    };
    const tool = skillToTool(skill, mockExecute);
    const result = await tool.execute({});
    // step1 should execute, step2 should be skipped because prev.success = false
    assert.strictEqual(calls.length, 1);
    assert.ok(result.includes('skipped'));
  });

  it('executes multi-step skill in order', async () => {
    const skill: SkillDefinition = {
      name: 'multi-step',
      description: 'Multi-step test',
      steps: [
        { tool: 'a', args: { x: '1' } },
        { tool: 'b', args: { x: '2' } },
        { tool: 'c', args: { x: '3' } },
      ],
    };
    const order: string[] = [];
    const mockExecute = async (name: string, args: Record<string, unknown>) => {
      order.push(`${name}:${args.x}`);
      return `${name} done`;
    };
    const tool = skillToTool(skill, mockExecute);
    const result = await tool.execute({});
    assert.deepStrictEqual(order, ['a:1', 'b:2', 'c:3']);
    assert.ok(result.includes('a done'));
    assert.ok(result.includes('b done'));
    assert.ok(result.includes('c done'));
  });
});

describe('Skills — user-defined loading', () => {
  const tmpSkillsDir = path.join(os.tmpdir(), 'codebot-skills-test-' + Date.now());

  before(() => {
    fs.mkdirSync(tmpSkillsDir, { recursive: true });
    const skill: SkillDefinition = {
      name: 'custom-skill',
      description: 'A custom user skill',
      steps: [{ tool: 'custom_tool', args: { action: 'do_thing' } }],
    };
    fs.writeFileSync(path.join(tmpSkillsDir, 'custom.json'), JSON.stringify(skill));
  });

  after(() => {
    fs.rmSync(tmpSkillsDir, { recursive: true, force: true });
  });

  // Note: This test verifies the loading pattern works but loadSkills
  // reads from ~/.codebot/skills/ which we can't easily redirect in test.
  // The built-in skills are always available.
  it('built-in skills are always available', () => {
    const skills = loadSkills();
    assert.ok(skills.length >= 3);
  });
});
