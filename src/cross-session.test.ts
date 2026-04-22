import { describe, it, before, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrossSessionLearning, Episode, EpisodePattern } from './cross-session';

describe('CrossSessionLearning', () => {
  let tmpDir: string;
  let learning: CrossSessionLearning;
  const origEnv = process.env.CODEBOT_HOME;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-session-'));
    process.env.CODEBOT_HOME = tmpDir;
    learning = new CrossSessionLearning();
  });

  afterEach(() => {
    // Reset for each test
    if (origEnv) process.env.CODEBOT_HOME = origEnv;
    else delete process.env.CODEBOT_HOME;
  });

  function makeEpisode(overrides?: Partial<Episode>): Episode {
    // Use current time so default fixtures don't get auto-pruned by the
    // 30-day age limit baked into recordEpisode. Tests that need old/custom
    // dates pass them via overrides (see the pruneByAge test below).
    const now = new Date().toISOString();
    return {
      sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      projectRoot: '/tmp/project',
      startedAt: now,
      endedAt: now,
      goal: 'Fix a bug',
      toolsUsed: ['grep', 'read_file', 'edit_file'],
      iterationCount: 5,
      success: true,
      outcomes: ['Bug fixed'],
      patterns: [],
      tokenUsage: { input: 1000, output: 500 },
      ...overrides,
    };
  }

  describe('extractPatterns', () => {
    it('extracts patterns from tool calls', () => {
      process.env.CODEBOT_HOME = tmpDir;
      const calls = [
        { tool: 'grep', success: true },
        { tool: 'read_file', success: true },
        { tool: 'edit_file', success: true },
        { tool: 'read_file', success: true },
      ];
      const patterns = learning.extractPatterns(calls);
      assert.ok(patterns.length > 0, 'should extract at least one pattern');
    });

    it('returns empty for single tool call', () => {
      process.env.CODEBOT_HOME = tmpDir;
      assert.deepStrictEqual(learning.extractPatterns([{ tool: 'grep', success: true }]), []);
    });

    it('marks failed chains as not effective', () => {
      process.env.CODEBOT_HOME = tmpDir;
      const calls = [
        { tool: 'grep', success: true },
        { tool: 'edit_file', success: false },
      ];
      const patterns = learning.extractPatterns(calls);
      const failedPattern = patterns.find(p => p.toolChain.includes('edit_file'));
      if (failedPattern) {
        assert.strictEqual(failedPattern.effective, false);
      }
    });
  });

  describe('buildEpisode', () => {
    it('builds episode from session data', () => {
      process.env.CODEBOT_HOME = tmpDir;
      const episode = learning.buildEpisode({
        sessionId: 'test_session',
        projectRoot: '/tmp/proj',
        startedAt: '2026-03-15T00:00:00Z',
        goal: 'Add feature',
        toolCalls: [
          { tool: 'grep', success: true },
          { tool: 'read_file', success: true },
          { tool: 'edit_file', success: true },
        ],
        success: true,
        outcomes: ['Feature added'],
        tokenUsage: { input: 500, output: 300 },
      });

      assert.strictEqual(episode.sessionId, 'test_session');
      assert.ok(episode.toolsUsed.includes('grep'), 'should include grep');
      assert.strictEqual(episode.iterationCount, 3);
      assert.strictEqual(episode.success, true);
    });
  });

  describe('recordEpisode', () => {
    it('saves episode to disk', () => {
      process.env.CODEBOT_HOME = tmpDir;
      const episode = makeEpisode({ sessionId: 'saved_session' });
      learning.recordEpisode(episode);

      const loaded = learning.getEpisode('saved_session');
      assert.notStrictEqual(loaded, null);
      assert.strictEqual(loaded!.goal, 'Fix a bug');
    });

    it('updates pattern index', () => {
      process.env.CODEBOT_HOME = tmpDir;
      const episode = makeEpisode({
        sessionId: 'idx_test',
        patterns: [{
          description: 'grep → read_file',
          toolChain: ['grep', 'read_file'],
          effective: true,
          frequency: 3,
        }],
      });
      learning.recordEpisode(episode);

      const indexPath = path.join(tmpDir, 'episodes', 'index.json');
      assert.ok(fs.existsSync(indexPath), 'index.json should exist');
    });
  });

  describe('getTopPatterns', () => {
    it('returns patterns sorted by success rate', () => {
      process.env.CODEBOT_HOME = tmpDir;
      learning.recordEpisode(makeEpisode({
        sessionId: 'top_sess1',
        patterns: [
          { description: 'a → b', toolChain: ['a', 'b'], effective: true, frequency: 3 },
          { description: 'c → d', toolChain: ['c', 'd'], effective: false, frequency: 2 },
        ],
      }));

      const top = learning.getTopPatterns(5);
      if (top.length >= 2) {
        assert.ok(top[0].successRate >= top[1].successRate, 'first pattern should have higher success rate');
      }
    });

    it('filters patterns with less than 2 occurrences', () => {
      process.env.CODEBOT_HOME = tmpDir;
      learning.recordEpisode(makeEpisode({
        sessionId: 'filter_sess',
        patterns: [
          { description: 'x → y', toolChain: ['x', 'y'], effective: true, frequency: 1 },
        ],
      }));

      const top = learning.getTopPatterns(5);
      const found = top.find(p => p.toolChain.join(':') === 'x:y');
      assert.strictEqual(found, undefined);
    });
  });

  describe('buildPromptBlock', () => {
    it('returns empty string when no patterns', () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-prompt-'));
      process.env.CODEBOT_HOME = cleanDir;
      const fresh = new CrossSessionLearning();
      assert.strictEqual(fresh.buildPromptBlock(), '');
      fs.rmSync(cleanDir, { recursive: true, force: true });
    });

    it('includes effective patterns', () => {
      process.env.CODEBOT_HOME = tmpDir;
      learning.recordEpisode(makeEpisode({
        sessionId: 'prompt_test',
        patterns: [
          { description: 'grep → edit', toolChain: ['grep', 'edit'], effective: true, frequency: 5 },
        ],
      }));

      const block = learning.buildPromptBlock();
      if (block) {
        assert.ok(block.includes('Cross-Session'), 'block should contain Cross-Session');
      }
    });
  });

  describe('listEpisodes', () => {
    it('lists all episode IDs', () => {
      process.env.CODEBOT_HOME = tmpDir;
      learning.recordEpisode(makeEpisode({ sessionId: 'list_ep1' }));
      learning.recordEpisode(makeEpisode({ sessionId: 'list_ep2' }));

      const list = learning.listEpisodes();
      assert.ok(list.includes('list_ep1'), 'should include list_ep1');
      assert.ok(list.includes('list_ep2'), 'should include list_ep2');
    });

    it('returns empty array when no episodes', () => {
      process.env.CODEBOT_HOME = tmpDir;
      const fresh = new CrossSessionLearning();
      // Use a clean tmp dir for this test
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-empty-'));
      process.env.CODEBOT_HOME = cleanDir;
      const empty = new CrossSessionLearning();
      assert.deepStrictEqual(empty.listEpisodes(), []);
      fs.rmSync(cleanDir, { recursive: true, force: true });
    });
  });

  describe('summarize', () => {
    it('returns message when no data', () => {
      const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-sum-'));
      process.env.CODEBOT_HOME = cleanDir;
      const fresh = new CrossSessionLearning();
      assert.ok(fresh.summarize().includes('No cross-session'), 'should contain No cross-session');
      fs.rmSync(cleanDir, { recursive: true, force: true });
    });

    it('includes episode count', () => {
      const sumDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-sumcount-'));
      process.env.CODEBOT_HOME = sumDir;
      const sl = new CrossSessionLearning();
      sl.recordEpisode(makeEpisode({ sessionId: 'sum1' }));
      sl.recordEpisode(makeEpisode({ sessionId: 'sum2' }));
      assert.ok(sl.summarize().includes('2 episodes'), 'should mention 2 episodes');
      fs.rmSync(sumDir, { recursive: true, force: true });
    });
  });

  describe('verification retrieval', () => {
    // These tests bypass recordEpisode() and write episode JSON directly so
    // they exercise the retrieval-side filter/sort/tag logic WITHOUT spawning
    // the theater-check.sh child process. The writeback path (runVerifier) is
    // exercised end-to-end by scripts/theater-check.sh's own golden tests.
    function writeEpisodeFile(dir: string, sessionId: string, patch: Partial<Episode>): void {
      const ep: Episode = {
        sessionId,
        projectRoot: '/tmp/project',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        goal: 'Fix a bug',
        toolsUsed: ['grep', 'edit'],
        iterationCount: 3,
        success: true,
        outcomes: [`${sessionId} outcome`],
        patterns: [],
        tokenUsage: { input: 0, output: 0 },
        ...patch,
      };
      const episodesDir = path.join(dir, 'episodes');
      fs.mkdirSync(episodesDir, { recursive: true });
      fs.writeFileSync(path.join(episodesDir, `${sessionId}.json`), JSON.stringify(ep, null, 2));
    }

    it('filters out challenged episodes from getRecentEpisodes', () => {
      const vDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-verif-'));
      process.env.CODEBOT_HOME = vDir;
      writeEpisodeFile(vDir, 'clean_ep', {
        verification: { state: 'verified', honestyScore: 95, verifierKind: 'diff-review' },
      });
      writeEpisodeFile(vDir, 'poison_ep', {
        verification: { state: 'challenged', honestyScore: 60, verifierKind: 'diff-review',
          reason: 'literal_swap block finding' },
      });
      writeEpisodeFile(vDir, 'legacy_ep', {}); // no verification field

      const sl = new CrossSessionLearning();
      const recent = sl.getRecentEpisodes(10);
      const ids = recent.map(e => e.sessionId);
      assert.ok(ids.includes('clean_ep'), 'verified episode should surface');
      assert.ok(ids.includes('legacy_ep'), 'legacy (no verification) should surface as unverified');
      assert.ok(!ids.includes('poison_ep'), 'challenged episode must NOT surface');
      fs.rmSync(vDir, { recursive: true, force: true });
    });

    it('sorts verified above unverified in getRecentEpisodes', () => {
      const vDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-verif-sort-'));
      process.env.CODEBOT_HOME = vDir;
      // Note: older-by-endedAt so endedAt alone wouldn't put it first — rank rules.
      const older = new Date(Date.now() - 60_000).toISOString();
      writeEpisodeFile(vDir, 'unver_ep', {
        endedAt: new Date().toISOString(),
        verification: { state: 'unverified', honestyScore: 80 },
      });
      writeEpisodeFile(vDir, 'ver_ep', {
        endedAt: older,
        verification: { state: 'verified', honestyScore: 85 },
      });

      const sl = new CrossSessionLearning();
      const recent = sl.getRecentEpisodes(5);
      assert.strictEqual(recent[0].sessionId, 'ver_ep', 'verified should come first even if older');
      fs.rmSync(vDir, { recursive: true, force: true });
    });

    it('buildPromptBlock annotates outcomes with verification tags', () => {
      const vDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-verif-tag-'));
      process.env.CODEBOT_HOME = vDir;
      writeEpisodeFile(vDir, 'clean_ep', {
        outcomes: ['tests green on fx triangle'],
        verification: { state: 'verified', honestyScore: 95 },
      });
      writeEpisodeFile(vDir, 'susp_ep', {
        outcomes: ['did something'],
        verification: { state: 'unverified', honestyScore: 55 },
      });
      writeEpisodeFile(vDir, 'legacy_ep', { outcomes: ['pre-verification work'] });

      const sl = new CrossSessionLearning();
      const block = sl.buildPromptBlock();
      assert.ok(block.includes('[verified]'), `expected [verified] tag in:\n${block}`);
      assert.ok(/\[suspicious, score=55\]/.test(block), `expected [suspicious, score=55] tag in:\n${block}`);
      assert.ok(block.includes('[unverified]'), `expected [unverified] tag for legacy episode in:\n${block}`);
      fs.rmSync(vDir, { recursive: true, force: true });
    });
  });

  describe('prune', () => {
    it('removes old episodes', () => {
      const pruneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-prune-'));
      process.env.CODEBOT_HOME = pruneDir;
      const plearning = new CrossSessionLearning();
      for (let i = 0; i < 5; i++) {
        plearning.recordEpisode(makeEpisode({ sessionId: `prune_${i}` }));
      }
      const pruned = plearning.prune(2);
      assert.strictEqual(pruned, 3);
      assert.strictEqual(plearning.listEpisodes().length, 2);
      fs.rmSync(pruneDir, { recursive: true, force: true });
    });

    it('does nothing when under limit', () => {
      const pruneDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-prune2-'));
      process.env.CODEBOT_HOME = pruneDir2;
      const plearning = new CrossSessionLearning();
      plearning.recordEpisode(makeEpisode({ sessionId: 'keep' }));
      assert.strictEqual(plearning.prune(10), 0);
      fs.rmSync(pruneDir2, { recursive: true, force: true });
    });

    it('pruneByAge removes episodes older than maxAgeDays', () => {
      const ageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-age-'));
      process.env.CODEBOT_HOME = ageDir;
      // Disable auto-prune during the test so we can record old episodes
      // and then assert that the manual pruneByAge call removes them.
      process.env.CODEBOT_EPISODES_MAX_AGE_DAYS = '99999';
      process.env.CODEBOT_EPISODES_MAX_COUNT = '99999';
      const alearning = new CrossSessionLearning();
      const now = Date.now();
      const oldIso = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
      const freshIso = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      alearning.recordEpisode(makeEpisode({ sessionId: 'old_a', endedAt: oldIso, startedAt: oldIso }));
      alearning.recordEpisode(makeEpisode({ sessionId: 'old_b', endedAt: oldIso, startedAt: oldIso }));
      alearning.recordEpisode(makeEpisode({ sessionId: 'fresh_a', endedAt: freshIso, startedAt: freshIso }));

      const pruned = alearning.pruneByAge(30);
      assert.strictEqual(pruned, 2, 'should prune both 40-day-old episodes');
      const remaining = alearning.listEpisodes();
      assert.ok(remaining.includes('fresh_a'), 'fresh episode should remain');
      assert.ok(!remaining.includes('old_a'), 'old episode should be gone');
      delete process.env.CODEBOT_EPISODES_MAX_AGE_DAYS;
      delete process.env.CODEBOT_EPISODES_MAX_COUNT;
      fs.rmSync(ageDir, { recursive: true, force: true });
    });

    it('recordEpisode auto-prunes using env limits', () => {
      const autoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-auto-'));
      process.env.CODEBOT_HOME = autoDir;
      process.env.CODEBOT_EPISODES_MAX_COUNT = '3';
      const alearning = new CrossSessionLearning();
      for (let i = 0; i < 5; i++) {
        alearning.recordEpisode(makeEpisode({ sessionId: `auto_${i}` }));
      }
      assert.strictEqual(alearning.listEpisodes().length, 3, 'should auto-prune to 3');
      delete process.env.CODEBOT_EPISODES_MAX_COUNT;
      fs.rmSync(autoDir, { recursive: true, force: true });
    });
  });

  describe('theater-detector wiring (end-to-end)', () => {
    // These tests prove that recordEpisode() actually spawns the detector
    // and writes verification back to the episode file. Without them, the
    // detector is dead code — `cross-session.ts` describes the writeback
    // but nothing proves it fires against a real audit slice.
    //
    // We build a minimal but REAL adversarial audit log (lockstep source/
    // test literal flip with no grounding — the Task W-dark fingerprint),
    // record an episode whose timestamp window covers those audit entries,
    // and assert the episode file on disk carries verification.state =
    // 'challenged' with verdict=THEATER.
    //
    // If someone breaks the packaging (scripts/ not bundled), breaks the
    // path resolution, breaks the detector itself, or changes the verdict
    // contract — these tests fail.
    it('recordEpisode marks THEATER pattern as challenged', () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theater-wiring-'));
      process.env.CODEBOT_HOME = testDir;

      // 1. Build a fake repo where source and test literals move in lockstep
      //    (no grounding doc → ungrounded → THEATER verdict).
      const repo = path.join(testDir, 'repo');
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });

      // 2. Build the audit log covering the "session" window.
      const today = new Date().toISOString().slice(0, 10);
      const auditDir = path.join(testDir, 'audit');
      fs.mkdirSync(auditDir, { recursive: true });
      const auditPath = path.join(auditDir, `audit-${today}.jsonl`);

      const t0 = new Date().toISOString();
      const t1 = new Date(Date.now() + 5_000).toISOString();
      const auditEntries = [
        {
          sequence: 1, timestamp: t0, tool: 'edit_file',
          args: { path: `${repo}/src/calc.py`, old_string: 'RATE = 10', new_string: 'RATE = 20' },
          result: 'success',
        },
        {
          sequence: 2, timestamp: t1, tool: 'edit_file',
          args: {
            path: `${repo}/tests/test_calc.py`,
            old_string: 'assert compute() == 10',
            new_string: 'assert compute() == 20',
          },
          result: 'success',
        },
      ];
      fs.writeFileSync(auditPath, auditEntries.map(e => JSON.stringify(e)).join('\n') + '\n');

      // 3. Record an episode spanning that audit window. recordEpisode should
      //    spawn scripts/theater-check.sh, which should flag this as THEATER
      //    (lockstep, ungrounded).
      process.env.CODEBOT_EPISODES_MAX_AGE_DAYS = '99999';
      process.env.CODEBOT_EPISODES_MAX_COUNT = '99999';
      const learn = new CrossSessionLearning();
      const ep: Episode = {
        sessionId: 'theater_wiring_ep',
        projectRoot: repo,
        startedAt: t0,
        endedAt: t1,
        goal: 'flip the rate',
        toolsUsed: ['edit_file'],
        iterationCount: 2,
        success: true,
        outcomes: ['Updated rate to 20. Tests green.'],
        patterns: [],
        tokenUsage: { input: 0, output: 0 },
      };
      learn.recordEpisode(ep);

      // 4. Read the written episode and assert verification landed.
      const epOnDisk: Episode = JSON.parse(
        fs.readFileSync(path.join(testDir, 'episodes', 'theater_wiring_ep.json'), 'utf-8'),
      );
      assert.ok(epOnDisk.verification, 'verification must be written to disk');
      assert.strictEqual(
        epOnDisk.verification.state, 'challenged',
        `expected state=challenged, got ${JSON.stringify(epOnDisk.verification)}`,
      );
      assert.strictEqual(epOnDisk.verification.verifierKind, 'diff-review');
      assert.ok(
        epOnDisk.verification.findings && epOnDisk.verification.findings.length > 0,
        'challenged episode must carry at least one finding',
      );

      delete process.env.CODEBOT_EPISODES_MAX_AGE_DAYS;
      delete process.env.CODEBOT_EPISODES_MAX_COUNT;
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('recordEpisode leaves clean sessions unverified (no false positive)', () => {
      // Session with no source+test lockstep (just a read + non-test edit) —
      // detector should NOT flag. This guards against the opposite failure
      // mode: a detector that flags everything is also useless.
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theater-clean-'));
      process.env.CODEBOT_HOME = testDir;

      const repo = path.join(testDir, 'repo');
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });

      const today = new Date().toISOString().slice(0, 10);
      const auditDir = path.join(testDir, 'audit');
      fs.mkdirSync(auditDir, { recursive: true });
      const auditPath = path.join(auditDir, `audit-${today}.jsonl`);
      const t0 = new Date().toISOString();
      const t1 = new Date(Date.now() + 5_000).toISOString();
      const auditEntries = [
        { sequence: 1, timestamp: t0, tool: 'read_file', args: { path: `${repo}/src/calc.py` }, result: 'success' },
        {
          sequence: 2, timestamp: t1, tool: 'edit_file',
          args: {
            path: `${repo}/src/calc.py`,
            old_string: 'def foo():\n    pass',
            new_string: 'def foo():\n    return 1',
          },
          result: 'success',
        },
      ];
      fs.writeFileSync(auditPath, auditEntries.map(e => JSON.stringify(e)).join('\n') + '\n');

      process.env.CODEBOT_EPISODES_MAX_AGE_DAYS = '99999';
      process.env.CODEBOT_EPISODES_MAX_COUNT = '99999';
      const learn = new CrossSessionLearning();
      learn.recordEpisode({
        sessionId: 'theater_clean_ep',
        projectRoot: repo,
        startedAt: t0,
        endedAt: t1,
        goal: 'implement foo',
        toolsUsed: ['read_file', 'edit_file'],
        iterationCount: 2,
        success: true,
        outcomes: ['foo returns 1 now'],
        patterns: [],
        tokenUsage: { input: 0, output: 0 },
      });

      const epOnDisk: Episode = JSON.parse(
        fs.readFileSync(path.join(testDir, 'episodes', 'theater_clean_ep.json'), 'utf-8'),
      );
      // verification MAY be present (if detector runs) — if so, must not be
      // challenged. It's OK if runVerifier returns null (e.g. the installed
      // bundle is missing scripts/ during local dev) — the test's primary
      // purpose is "no false positive", not "detector always runs".
      if (epOnDisk.verification) {
        assert.notStrictEqual(
          epOnDisk.verification.state, 'challenged',
          `clean session must not be flagged: ${JSON.stringify(epOnDisk.verification)}`,
        );
      }

      delete process.env.CODEBOT_EPISODES_MAX_AGE_DAYS;
      delete process.env.CODEBOT_EPISODES_MAX_COUNT;
      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });
});
