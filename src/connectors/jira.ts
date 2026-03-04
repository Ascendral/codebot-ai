/**
 * Jira Connector — REST API v3
 *
 * Auth: API token + email + base URL (Basic auth)
 * Credential stored as JSON: { "JIRA_TOKEN": "...", "JIRA_EMAIL": "...", "JIRA_URL": "..." }
 * Or auto-detected from individual env vars.
 */

import { Connector, ConnectorAction } from './base';

const TIMEOUT = 15_000;
const MAX_RESPONSE = 10_000;

interface JiraAuth {
  token: string;
  email: string;
  url: string; // e.g., https://mycompany.atlassian.net
}

function parseAuth(credential: string): JiraAuth | null {
  try {
    const parsed = JSON.parse(credential);
    const token = parsed.JIRA_TOKEN || parsed.token;
    const email = parsed.JIRA_EMAIL || parsed.email;
    const url = (parsed.JIRA_URL || parsed.url || '').replace(/\/+$/, '');
    if (!token || !email || !url) return null;
    return { token, email, url };
  } catch {
    return null;
  }
}

async function apiRequest(
  method: string,
  path: string,
  auth: JiraAuth,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const basic = Buffer.from(`${auth.email}:${auth.token}`).toString('base64');

  try {
    const opts: RequestInit = {
      method,
      headers: {
        'Authorization': `Basic ${basic}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${auth.url}/rest/api/3${path}`, opts);
    clearTimeout(timer);
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

function truncate(text: string): string {
  return text.length <= MAX_RESPONSE ? text : text.substring(0, MAX_RESPONSE) + '\n... (truncated)';
}

function formatError(status: number, data: unknown): string {
  if (typeof data === 'object' && data && 'errorMessages' in data) {
    const msgs = (data as { errorMessages: string[] }).errorMessages;
    return `Error: Jira API ${status}: ${msgs.join(', ')}`;
  }
  return `Error: Jira API ${status}: ${JSON.stringify(data).substring(0, 200)}`;
}

export class JiraConnector implements Connector {
  name = 'jira';
  displayName = 'Jira';
  description = 'Create and manage issues, search with JQL, and add comments in Jira.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'JIRA_TOKEN';
  requiredEnvKeys = ['JIRA_TOKEN', 'JIRA_EMAIL', 'JIRA_URL'];

  actions: ConnectorAction[] = [
    {
      name: 'create_issue',
      description: 'Create a new Jira issue',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project key (e.g., PROJ)' },
          summary: { type: 'string', description: 'Issue summary/title' },
          description: { type: 'string', description: 'Issue description' },
          issuetype: { type: 'string', description: 'Issue type: Bug, Task, Story, Epic (default: Task)' },
          priority: { type: 'string', description: 'Priority: Highest, High, Medium, Low, Lowest' },
          assignee: { type: 'string', description: 'Assignee account ID or email' },
          labels: { type: 'string', description: 'Comma-separated labels' },
        },
        required: ['project', 'summary'],
      },
      execute: async (args, cred) => {
        const auth = parseAuth(cred);
        if (!auth) return 'Error: invalid Jira credentials (need token, email, and URL)';
        const project = args.project as string;
        const summary = args.summary as string;
        if (!project || !summary) return 'Error: project and summary are required';

        const fields: Record<string, unknown> = {
          project: { key: project },
          summary,
          issuetype: { name: (args.issuetype as string) || 'Task' },
        };
        if (args.description) {
          fields.description = {
            type: 'doc', version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description as string }] }],
          };
        }
        if (args.priority) fields.priority = { name: args.priority };
        if (args.assignee) fields.assignee = { id: args.assignee };
        if (args.labels) fields.labels = (args.labels as string).split(',').map(l => l.trim());

        try {
          const { status, data } = await apiRequest('POST', '/issue', auth, { fields });
          if (status !== 201) return formatError(status, data);
          const issue = data as { key: string; self: string };
          return `Issue ${issue.key} created: ${auth.url}/browse/${issue.key}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_issues',
      description: 'List issues in a project',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project key' },
          status: { type: 'string', description: 'Filter by status (e.g., "To Do", "In Progress", "Done")' },
          max_results: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['project'],
      },
      execute: async (args, cred) => {
        const auth = parseAuth(cred);
        if (!auth) return 'Error: invalid Jira credentials';
        const project = args.project as string;
        if (!project) return 'Error: project is required';

        let jql = `project = ${project}`;
        if (args.status) jql += ` AND status = "${args.status}"`;
        jql += ' ORDER BY updated DESC';
        const maxResults = Math.min((args.max_results as number) || 10, 50);

        try {
          const { status, data } = await apiRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,updated`, auth);
          if (status !== 200) return formatError(status, data);
          const result = data as { issues: Array<{ key: string; fields: { summary: string; status: { name: string }; assignee: { displayName: string } | null; priority: { name: string } } }> };
          if (!result.issues?.length) return 'No issues found.';
          const lines = result.issues.map(i =>
            `  ${i.key} [${i.fields.status?.name}] ${i.fields.summary} (${i.fields.assignee?.displayName || 'unassigned'}, ${i.fields.priority?.name || '?'})`
          );
          return truncate(`Issues (${result.issues.length}):\n${lines.join('\n')}`);
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'update_issue',
      description: 'Update an existing Jira issue',
      parameters: {
        type: 'object',
        properties: {
          issue_key: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
          summary: { type: 'string', description: 'New summary' },
          description: { type: 'string', description: 'New description' },
          status: { type: 'string', description: 'Transition to status (e.g., "In Progress", "Done")' },
          assignee: { type: 'string', description: 'New assignee account ID' },
        },
        required: ['issue_key'],
      },
      execute: async (args, cred) => {
        const auth = parseAuth(cred);
        if (!auth) return 'Error: invalid Jira credentials';
        const issueKey = args.issue_key as string;
        if (!issueKey) return 'Error: issue_key is required';

        try {
          const fields: Record<string, unknown> = {};
          if (args.summary) fields.summary = args.summary;
          if (args.description) {
            fields.description = {
              type: 'doc', version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description as string }] }],
            };
          }
          if (args.assignee) fields.assignee = { id: args.assignee };

          if (Object.keys(fields).length > 0) {
            const { status, data } = await apiRequest('PUT', `/issue/${encodeURIComponent(issueKey)}`, auth, { fields });
            if (status !== 204 && status !== 200) return formatError(status, data);
          }

          // Handle status transition separately
          if (args.status) {
            // Get available transitions
            const { status: tStatus, data: tData } = await apiRequest('GET', `/issue/${encodeURIComponent(issueKey)}/transitions`, auth);
            if (tStatus !== 200) return `Updated fields but could not transition status: ${formatError(tStatus, tData)}`;
            const transitions = (tData as { transitions: Array<{ id: string; name: string }> }).transitions || [];
            const target = transitions.find(t => t.name.toLowerCase() === (args.status as string).toLowerCase());
            if (!target) return `Updated fields but status "${args.status}" not available. Available: ${transitions.map(t => t.name).join(', ')}`;

            const { status: pStatus, data: pData } = await apiRequest('POST', `/issue/${encodeURIComponent(issueKey)}/transitions`, auth, { transition: { id: target.id } });
            if (pStatus !== 204 && pStatus !== 200) return `Updated fields but transition failed: ${formatError(pStatus, pData)}`;
          }

          return `Issue ${issueKey} updated.`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'add_comment',
      description: 'Add a comment to a Jira issue',
      parameters: {
        type: 'object',
        properties: {
          issue_key: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
          comment: { type: 'string', description: 'Comment text' },
        },
        required: ['issue_key', 'comment'],
      },
      execute: async (args, cred) => {
        const auth = parseAuth(cred);
        if (!auth) return 'Error: invalid Jira credentials';
        const issueKey = args.issue_key as string;
        const comment = args.comment as string;
        if (!issueKey || !comment) return 'Error: issue_key and comment are required';

        try {
          const body = {
            body: {
              type: 'doc', version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }],
            },
          };
          const { status, data } = await apiRequest('POST', `/issue/${encodeURIComponent(issueKey)}/comment`, auth, body);
          if (status !== 201) return formatError(status, data);
          return `Comment added to ${issueKey}.`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'search',
      description: 'Search issues using JQL (Jira Query Language)',
      parameters: {
        type: 'object',
        properties: {
          jql: { type: 'string', description: 'JQL query (e.g., "project = PROJ AND status = Open")' },
          max_results: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['jql'],
      },
      execute: async (args, cred) => {
        const auth = parseAuth(cred);
        if (!auth) return 'Error: invalid Jira credentials';
        const jql = args.jql as string;
        if (!jql) return 'Error: jql is required';
        const maxResults = Math.min((args.max_results as number) || 10, 50);

        try {
          const { status, data } = await apiRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,assignee,priority,updated`, auth);
          if (status !== 200) return formatError(status, data);
          const result = data as { total: number; issues: Array<{ key: string; fields: { summary: string; status: { name: string }; assignee: { displayName: string } | null; priority: { name: string } } }> };
          if (!result.issues?.length) return 'No issues found.';
          const lines = result.issues.map(i =>
            `  ${i.key} [${i.fields.status?.name}] ${i.fields.summary} (${i.fields.assignee?.displayName || 'unassigned'})`
          );
          return truncate(`Search results (${result.issues.length} of ${result.total}):\n${lines.join('\n')}`);
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];

  async validate(credential: string): Promise<boolean> {
    const auth = parseAuth(credential);
    if (!auth) return false;
    try {
      const { status } = await apiRequest('GET', '/myself', auth);
      return status === 200;
    } catch {
      return false;
    }
  }
}
