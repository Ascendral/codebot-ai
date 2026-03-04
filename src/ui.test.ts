import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { box, riskBar, progressStep, diffPreview, sessionHeader, summaryBox, budgetBar, streamingIndicator, costBadge, timedStep, collapsibleSection, UI } from './ui';

describe('budgetBar', () => {
  it('renders a progress bar with cost info', () => {
    const result = budgetBar(0.12, 1.00);
    assert.ok(result.includes('$0.12'), 'Should include spent amount');
    assert.ok(result.includes('$1.00'), 'Should include limit');
  });

  it('uses green color for low utilization', () => {
    const result = budgetBar(0.10, 1.00);
    assert.ok(result.includes('\x1b[32m'), 'Should use green ANSI for 10%');
  });

  it('uses red color for high utilization', () => {
    const result = budgetBar(0.95, 1.00);
    assert.ok(result.includes('\x1b[31m'), 'Should use red ANSI for 95%');
  });

  it('clamps at 100%', () => {
    const result = budgetBar(2.00, 1.00);
    assert.ok(result.includes('$2.00'), 'Should show overspend amount');
  });

  it('handles zero limit gracefully', () => {
    const result = budgetBar(0.50, 0);
    assert.ok(typeof result === 'string');
  });

  it('respects custom width', () => {
    const result = budgetBar(0.50, 1.00, 20);
    assert.ok(result.length > 0);
  });
});

describe('streamingIndicator', () => {
  it('shows token count', () => {
    const result = streamingIndicator(142, 23);
    assert.ok(result.includes('142'), 'Should include token count');
  });

  it('shows tokens per second', () => {
    const result = streamingIndicator(142, 23);
    assert.ok(result.includes('23'), 'Should include tok/s');
  });

  it('handles zero tokens', () => {
    const result = streamingIndicator(0, 0);
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('0'));
  });
});

describe('costBadge', () => {
  it('renders compact cost without limit', () => {
    const result = costBadge(0.12);
    assert.ok(result.includes('$0.12'));
    assert.ok(!result.includes('/'));
  });

  it('renders cost with limit', () => {
    const result = costBadge(0.12, 1.00);
    assert.ok(result.includes('$0.12'));
    assert.ok(result.includes('$1.00'));
  });

  it('handles zero cost', () => {
    const result = costBadge(0);
    assert.ok(result.includes('$0.00'));
  });
});

describe('timedStep', () => {
  it('renders step with label and elapsed time', () => {
    const result = timedStep(2, 5, 'Editing...', 1200);
    assert.ok(result.includes('[2/5]'), 'Should include step numbers');
    assert.ok(result.includes('Editing...'), 'Should include label');
    assert.ok(result.includes('1.2s'), 'Should include elapsed time');
  });

  it('handles zero elapsed time', () => {
    const result = timedStep(1, 1, 'Starting', 0);
    assert.ok(result.includes('0.0s'));
  });
});

describe('collapsibleSection', () => {
  it('renders collapsed with line count', () => {
    const result = collapsibleSection('Details', 'line1\nline2\nline3', false);
    assert.ok(result.includes('[+]'), 'Should show [+] when collapsed');
    assert.ok(result.includes('Details'), 'Should include title');
    assert.ok(result.includes('3 lines'), 'Should show line count');
  });

  it('renders expanded with content', () => {
    const result = collapsibleSection('Details', 'line1\nline2', true);
    assert.ok(result.includes('[-]'), 'Should show [-] when expanded');
    assert.ok(result.includes('line1'), 'Should include content');
    assert.ok(result.includes('line2'));
  });

  it('handles empty content', () => {
    const result = collapsibleSection('Empty', '', false);
    assert.ok(result.includes('[+]'));
  });
});


// ── providerCard tests ──

import { providerCard, guidedPrompts } from './ui';
import type { ProviderCardItem } from './ui';

describe('providerCard', () => {
  const items: ProviderCardItem[] = [
    { key: '1', icon: '\u{1F5A5}', name: 'Local (Ollama)', detail: 'free, private', subtext: 'Ollama detected (3 models)', recommended: true, available: true },
    { key: '2', icon: '\u{1F7E3}', name: 'Claude', detail: 'best for code', subtext: 'Needs: ANTHROPIC_API_KEY', available: false },
    { key: '3', icon: '\u{1F7E2}', name: 'GPT', detail: 'widely used' },
  ];

  it('renders all item names', () => {
    const result = providerCard({ items });
    assert.ok(result.includes('Local (Ollama)'), 'Should include Ollama');
    assert.ok(result.includes('Claude'), 'Should include Claude');
    assert.ok(result.includes('GPT'), 'Should include GPT');
  });

  it('shows recommended star marker', () => {
    const result = providerCard({ items });
    assert.ok(result.includes('\u2605'), 'Should include star character for recommended item');
  });

  it('shows availability check mark for items with subtext', () => {
    const result = providerCard({ items });
    // The check mark appears in the subtext line for available items
    // It's rendered with ANSI codes, so check the raw output has the check
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('\u2713'), 'Should include check mark in subtext for available item');
  });

  it('includes title', () => {
    const result = providerCard({ items });
    assert.ok(result.includes('Choose your AI provider'), 'Should include title');
  });

  it('renders footer when provided', () => {
    const result = providerCard({ items, footer: 'Run codebot --setup for full wizard' });
    assert.ok(result.includes('Run codebot --setup'), 'Should include footer text');
  });
});

// ── guidedPrompts tests ──

describe('guidedPrompts', () => {
  it('renders prompts in a box', () => {
    const prompts = ['"explain this code"', '"find bugs"'];
    const result = guidedPrompts(prompts);
    assert.ok(result.includes('Try saying:'), 'Should include title');
    assert.ok(result.includes('explain this code'), 'Should include first prompt');
    assert.ok(result.includes('find bugs'), 'Should include second prompt');
  });

  it('includes footer when provided', () => {
    const result = guidedPrompts(['"hello"'], 'Type /help for commands');
    assert.ok(result.includes('/help'), 'Should include footer text');
  });
});
