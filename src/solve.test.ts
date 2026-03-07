import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { parseIssueUrl, buildBranchName, buildSolvePrompt, computeConfidence, computeRisk } from './solve';

describe('Solve — parseIssueUrl', () => {
  it('parses full GitHub URL', () => {
    const result = parseIssueUrl('https://github.com/octocat/hello-world/issues/42');
    assert.strictEqual(result.owner, 'octocat');
    assert.strictEqual(result.repo, 'hello-world');
    assert.strictEqual(result.number, 42);
  });

  it('parses URL with trailing slash', () => {
    const result = parseIssueUrl('https://github.com/owner/repo/issues/123');
    assert.strictEqual(result.owner, 'owner');
    assert.strictEqual(result.repo, 'repo');
    assert.strictEqual(result.number, 123);
  });

  it('parses shorthand owner/repo#number', () => {
    const result = parseIssueUrl('facebook/react#12345');
    assert.strictEqual(result.owner, 'facebook');
    assert.strictEqual(result.repo, 'react');
    assert.strictEqual(result.number, 12345);
  });

  it('rejects malformed URL', () => {
    assert.throws(() => parseIssueUrl('not-a-url'), /Invalid GitHub issue URL/);
  });

  it('rejects non-issue GitHub URL', () => {
    assert.throws(() => parseIssueUrl('https://github.com/owner/repo/pull/1'), /Invalid GitHub issue URL/);
  });

  it('rejects random website', () => {
    assert.throws(() => parseIssueUrl('https://example.com/issues/42'), /Invalid GitHub issue URL/);
  });

  it('rejects empty string', () => {
    assert.throws(() => parseIssueUrl(''), /Invalid GitHub issue URL/);
  });
});

describe('Solve — buildBranchName', () => {
  it('creates valid branch name from issue', () => {
    const branch = buildBranchName({ number: 42, title: 'Fix the login bug' });
    assert.strictEqual(branch, 'codebot/solve-42-fix-the-login-bug');
  });

  it('handles special characters', () => {
    const branch = buildBranchName({ number: 99, title: 'Fix: crash on "null" input (critical!)' });
    assert.ok(branch.startsWith('codebot/solve-99-'));
    assert.ok(!branch.includes('"'));
    assert.ok(!branch.includes('!'));
    assert.ok(!branch.includes('('));
  });

  it('truncates long titles', () => {
    const branch = buildBranchName({ number: 1, title: 'This is a very long issue title that should be truncated to keep branch name reasonable' });
    // slug portion should be max 30 chars
    const slug = branch.replace('codebot/solve-1-', '');
    assert.ok(slug.length <= 30, `Slug too long: ${slug.length}`);
  });

  it('handles empty title', () => {
    const branch = buildBranchName({ number: 5, title: '' });
    assert.strictEqual(branch, 'codebot/solve-5-');
  });
});

describe('Solve — buildSolvePrompt', () => {
  const issue = {
    owner: 'test', repo: 'app', number: 1,
    title: 'Bug in parser', body: 'The parser crashes on empty input',
    labels: ['bug'], comments: [{ user: 'alice', body: 'Can reproduce' }],
    url: 'https://github.com/test/app/issues/1', state: 'open',
  };

  it('includes issue title', () => {
    const prompt = buildSolvePrompt(issue, 'src/\n  parser.ts', 'TypeScript', 'jest', '');
    assert.ok(prompt.includes('Bug in parser'));
  });

  it('includes issue body', () => {
    const prompt = buildSolvePrompt(issue, '', 'TypeScript', null, '');
    assert.ok(prompt.includes('The parser crashes on empty input'));
  });

  it('includes comments', () => {
    const prompt = buildSolvePrompt(issue, '', 'TypeScript', null, '');
    assert.ok(prompt.includes('[alice]'));
    assert.ok(prompt.includes('Can reproduce'));
  });

  it('includes triage signals when present', () => {
    const triage = 'Files mentioned: parser.ts\nError signals:\n  TypeError: cannot read null';
    const prompt = buildSolvePrompt(issue, '', 'TypeScript', null, triage);
    assert.ok(prompt.includes('Triage Signals'));
    assert.ok(prompt.includes('parser.ts'));
  });

  it('includes stack and test framework', () => {
    const prompt = buildSolvePrompt(issue, '', 'TypeScript/Node.js', 'vitest', '');
    assert.ok(prompt.includes('TypeScript/Node.js'));
    assert.ok(prompt.includes('vitest'));
  });
});

describe('Solve — computeConfidence', () => {
  it('scores high for few files + tests passing', () => {
    const score = computeConfidence({
      issueBodyLength: 300, filesChanged: 1,
      testsPassed: true, testsExist: true, maxFiles: 10,
    });
    assert.ok(score >= 80, `Expected >= 80, got ${score}`);
  });

  it('scores low for many files + tests failing', () => {
    const score = computeConfidence({
      issueBodyLength: 10, filesChanged: 12,
      testsPassed: false, testsExist: true, maxFiles: 10,
    });
    assert.ok(score <= 30, `Expected <= 30, got ${score}`);
  });

  it('scores moderate when no tests exist', () => {
    const score = computeConfidence({
      issueBodyLength: 100, filesChanged: 2,
      testsPassed: false, testsExist: false, maxFiles: 10,
    });
    assert.ok(score >= 40 && score <= 75, `Expected 40-75, got ${score}`);
  });

  it('never exceeds 100', () => {
    const score = computeConfidence({
      issueBodyLength: 1000, filesChanged: 1,
      testsPassed: true, testsExist: true, maxFiles: 10,
    });
    assert.ok(score <= 100);
  });
});

describe('Solve — computeRisk', () => {
  it('returns low for small passing fix', () => {
    const risk = computeRisk({
      filesChanged: 1, testsPassed: true,
      depsChanged: false, sensitiveFiles: false,
    });
    assert.strictEqual(risk, 'low');
  });

  it('returns medium for larger fix', () => {
    const risk = computeRisk({
      filesChanged: 6, testsPassed: true,
      depsChanged: false, sensitiveFiles: false,
    });
    assert.strictEqual(risk, 'medium');
  });

  it('returns high when deps changed', () => {
    const risk = computeRisk({
      filesChanged: 2, testsPassed: true,
      depsChanged: true, sensitiveFiles: false,
    });
    assert.strictEqual(risk, 'high');
  });

  it('returns high for sensitive files', () => {
    const risk = computeRisk({
      filesChanged: 1, testsPassed: true,
      depsChanged: false, sensitiveFiles: true,
    });
    assert.strictEqual(risk, 'high');
  });

  it('returns high when tests fail with many files', () => {
    const risk = computeRisk({
      filesChanged: 5, testsPassed: false,
      depsChanged: false, sensitiveFiles: false,
    });
    assert.strictEqual(risk, 'high');
  });
});
