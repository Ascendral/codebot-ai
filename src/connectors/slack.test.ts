import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SlackConnector } from './slack';

describe('SlackConnector', () => {
  it('has correct metadata', () => {
    const slack = new SlackConnector();
    assert.strictEqual(slack.name, 'slack');
    assert.strictEqual(slack.displayName, 'Slack');
    assert.strictEqual(slack.envKey, 'SLACK_TOKEN');
    assert.strictEqual(slack.authType, 'api_key');
  });

  it('has all expected actions', () => {
    const slack = new SlackConnector();
    const names = slack.actions.map(a => a.name);
    assert.ok(names.includes('post_message'));
    assert.ok(names.includes('list_channels'));
    assert.ok(names.includes('search_messages'));
    assert.strictEqual(slack.actions.length, 3);
  });

  it('post_message requires channel and message', async () => {
    const slack = new SlackConnector();
    const action = slack.actions.find(a => a.name === 'post_message')!;
    const result = await action.execute({ channel: '', message: '' }, 'xoxb-fake');
    assert.ok(result.includes('Error:'));
  });

  it('validates webhook URLs as valid format', async () => {
    const slack = new SlackConnector();
    // Webhook URLs are validated by URL format only
    const valid = await slack.validate('https://hooks.slack.com/services/T00/B00/xxx');
    assert.ok(valid);
  });
});
