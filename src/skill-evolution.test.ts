import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillEvolution } from './skill-evolution';
import { SkillDefinition } from './skills';

describe('SkillEvolution', () => {
  const tmpDir = path.join(os.tmpdir(), 'codebot-evolution-test-' + Date.now());
  const skillsDir = path.join(tmpDir, 'skills');
  const healthDir = path.join(tmpDir, 'health');

  before(() => {
    process.env.CODEBOT_HOME = tmpDir;
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(healthDir, { recursive: true });
  });

  after(() => {
    delete process.env.CODEBOT_HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkill(skill: Partial<SkillDefinition> & { name: string }): void {
    const full: SkillDefinition = {
      name: skill.name,
      description: skill.description || 'Test skill',
      steps: skill.steps || [{ tool: 'think', args: { thought: 'test' } }],
      confidence: skill.confidence ?? 0.5,
      use_count: skill.use_count ?? 0,
      author: skill.author || 'codebot',
      origin: skill.origin || 'forged',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(skillsDir, `${skill.name}.json`), JSON.stringify(full, null, 2));
  }

  it('testSkill passes valid skills', async () => {
    const evo = new SkillEvolution();
    const skill: SkillDefinition = {
      name: 'valid-skill',
      description: 'Test',
      steps: [{ tool: 'grep', args: { pattern: 'test' } }],
    };
    const result = await evo.testSkill(skill);
    assert.strictEqual(result.passed, true);
    assert.ok(result.message.includes('passed'));
  });

  it('testSkill fails skills with no steps', async () => {
    const evo = new SkillEvolution();
    const skill: SkillDefinition = {
      name: 'empty-skill',
      description: 'Test',
      steps: [],
    };
    const result = await evo.testSkill(skill);
    assert.strictEqual(result.passed, false);
  });

  it('testSkill fails skills with invalid step', async () => {
    const evo = new SkillEvolution();
    const skill: SkillDefinition = {
      name: 'bad-step',
      description: 'Test',
      steps: [{ tool: '', args: {} }],
    };
    const result = await evo.testSkill(skill);
    assert.strictEqual(result.passed, false);
  });

  it('testSkill uses custom runner when provided', async () => {
    const evo = new SkillEvolution();
    const skill: SkillDefinition = {
      name: 'custom-test',
      description: 'Test',
      steps: [{ tool: 'grep', args: {} }],
    };
    const result = await evo.testSkill(skill, async () => ({
      passed: true,
      message: 'Custom pass',
    }));
    assert.strictEqual(result.passed, true);
    assert.ok(result.message.includes('Custom'));
  });

  it('retireFailures moves low-confidence skills', () => {
    writeSkill({ name: 'low-conf', confidence: 0.05 });
    writeSkill({ name: 'high-conf', confidence: 0.9 });

    const skills = [
      { name: 'low-conf', description: '', steps: [], confidence: 0.05 } as SkillDefinition,
      { name: 'high-conf', description: '', steps: [], confidence: 0.9 } as SkillDefinition,
    ];

    const evo = new SkillEvolution();
    const retired = evo.retireFailures(skills);

    assert.ok(retired.includes('low-conf'));
    assert.ok(!retired.includes('high-conf'));
    assert.ok(fs.existsSync(path.join(skillsDir, 'retired', 'low-conf.json')));
    assert.ok(!fs.existsSync(path.join(skillsDir, 'low-conf.json')));
  });

  it('generateVariants creates evolved skills', () => {
    writeSkill({ name: 'top-skill', confidence: 0.9, use_count: 5 });

    const skills = [
      {
        name: 'top-skill',
        description: 'A top skill',
        steps: [{ tool: 'grep', args: { pattern: 'test' } }],
        confidence: 0.9,
        use_count: 5,
      } as SkillDefinition,
    ];

    const evo = new SkillEvolution();
    const variants = evo.generateVariants(skills);

    assert.ok(variants.length >= 1);
    const variantFile = path.join(skillsDir, `${variants[0]}.json`);
    assert.ok(fs.existsSync(variantFile));

    const data = JSON.parse(fs.readFileSync(variantFile, 'utf-8'));
    assert.strictEqual(data.origin, 'evolved');
    assert.ok(data.description.includes('Evolved'));
  });

  it('generateVariants skips low-confidence skills', () => {
    const skills = [
      {
        name: 'low-skill',
        description: 'Low',
        steps: [{ tool: 'think', args: {} }],
        confidence: 0.3,
        use_count: 1,
      } as SkillDefinition,
    ];

    const evo = new SkillEvolution();
    const variants = evo.generateVariants(skills);
    assert.strictEqual(variants.length, 0);
  });

  it('composeSkills combines complementary skills', () => {
    writeSkill({
      name: 'search-skill',
      confidence: 0.8,
      steps: [{ tool: 'grep', args: { pattern: 'test' } }],
    });
    writeSkill({
      name: 'write-skill',
      confidence: 0.8,
      steps: [{ tool: 'write_file', args: { path: 'test.txt' } }],
    });

    const skills = [
      {
        name: 'search-skill',
        description: 'Search',
        steps: [{ tool: 'grep', args: { pattern: 'test' } }],
        confidence: 0.8,
      } as SkillDefinition,
      {
        name: 'write-skill',
        description: 'Write',
        steps: [{ tool: 'write_file', args: { path: 'test.txt' } }],
        confidence: 0.8,
      } as SkillDefinition,
    ];

    const evo = new SkillEvolution();
    const composed = evo.composeSkills(skills);

    assert.ok(composed.length >= 1);
    const composedFile = path.join(skillsDir, `${composed[0]}.json`);
    assert.ok(fs.existsSync(composedFile));

    const data = JSON.parse(fs.readFileSync(composedFile, 'utf-8'));
    assert.strictEqual(data.origin, 'composed');
    assert.strictEqual(data.steps.length, 2);
  });

  it('composeSkills skips overlapping skills', () => {
    const skills = [
      {
        name: 'grep1',
        description: 'G1',
        steps: [{ tool: 'grep', args: {} }],
        confidence: 0.9,
      } as SkillDefinition,
      {
        name: 'grep2',
        description: 'G2',
        steps: [{ tool: 'grep', args: {} }],
        confidence: 0.9,
      } as SkillDefinition,
    ];

    const evo = new SkillEvolution();
    const composed = evo.composeSkills(skills);
    assert.strictEqual(composed.length, 0);
  });

  it('evolve runs full cycle', async () => {
    // Clean slate
    const remaining = fs.readdirSync(skillsDir).filter(f => f.endsWith('.json'));
    // Write fresh skills
    writeSkill({ name: 'evo-test-1', confidence: 0.9, use_count: 5, steps: [{ tool: 'grep', args: {} }] });
    writeSkill({ name: 'evo-test-2', confidence: 0.05, steps: [{ tool: 'think', args: {} }] });

    const evo = new SkillEvolution();
    const report = await evo.evolve();

    assert.ok(report.tested.length >= 2);
    assert.ok(report.timestamp);
  });

  it('formatReport produces readable output', async () => {
    const evo = new SkillEvolution();
    const report = await evo.evolve();
    const formatted = SkillEvolution.formatReport(report);
    assert.ok(formatted.includes('Evolution Report'));
    assert.ok(formatted.includes('Tested'));
  });

  it('persists evolution report to disk', async () => {
    const evo = new SkillEvolution();
    await evo.evolve();
    assert.ok(fs.existsSync(path.join(healthDir, 'last-evolution-report.json')));
  });
});
