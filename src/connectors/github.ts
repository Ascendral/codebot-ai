/**
 * GitHub Connector — REST API v3
 *
 * Auth: Bearer token (Personal Access Token or GITHUB_TOKEN)
 * Actions: list_repos, create_issue, list_issues, create_pr, list_prs, get_repo_info
 */

import { Connector, ConnectorAction } from './base';

const BASE_URL = 'https://api.github.com';
const TIMEOUT = 15_000;
const MAX_RESPONSE = 10_000;

async function apiRequest(
  method: string,
  path: string,
  credential: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const opts: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${credential}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'CodeBot-AI',
      },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, opts);
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
  if (text.length <= MAX_RESPONSE) return text;
  return text.substring(0, MAX_RESPONSE) + '\n... (truncated)';
}

function formatError(status: number, data: unknown): string {
  const msg = typeof data === 'object' && data && 'message' in data
    ? (data as { message: string }).message
    : JSON.stringify(data).substring(0, 200);
  return `Error: GitHub API ${status}: ${msg}`;
}

export class GitHubConnector implements Connector {
  name = 'github';
  displayName = 'GitHub';
  description = 'Create issues, PRs, review code, and manage repositories on GitHub.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'GITHUB_TOKEN';

  actions: ConnectorAction[] = [
    {
      name: 'list_repos',
      description: 'List repositories for the authenticated user or a specific user/org',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'User or org (omit for authenticated user)' },
          per_page: { type: 'number', description: 'Results per page (default 10, max 100)' },
        },
      },
      execute: async (args, cred) => {
        const owner = args.owner as string;
        const perPage = Math.min((args.per_page as number) || 10, 100);
        const path = owner
          ? `/users/${encodeURIComponent(owner)}/repos?per_page=${perPage}&sort=updated`
          : `/user/repos?per_page=${perPage}&sort=updated`;
        const { status, data } = await apiRequest('GET', path, cred);
        if (status !== 200) return formatError(status, data);
        const repos = data as Array<{ full_name: string; description: string; stargazers_count: number; language: string; updated_at: string }>;
        if (!repos.length) return 'No repositories found.';
        const lines = repos.map(r =>
          `  ${r.full_name} — ${r.description || '(no description)'} [${r.language || '?'}, ★${r.stargazers_count}]`
        );
        return truncate(`Repositories (${repos.length}):\n${lines.join('\n')}`);
      },
    },
    {
      name: 'create_issue',
      description: 'Create a new issue in a GitHub repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body (Markdown)' },
          labels: { type: 'string', description: 'Comma-separated label names' },
          assignees: { type: 'string', description: 'Comma-separated assignee usernames' },
        },
        required: ['owner', 'repo', 'title'],
      },
      execute: async (args, cred) => {
        const owner = args.owner as string;
        const repo = args.repo as string;
        const title = args.title as string;
        if (!owner || !repo || !title) return 'Error: owner, repo, and title are required';

        const payload: Record<string, unknown> = { title, body: (args.body as string) || '' };
        if (args.labels) payload.labels = (args.labels as string).split(',').map(l => l.trim());
        if (args.assignees) payload.assignees = (args.assignees as string).split(',').map(a => a.trim());

        const { status, data } = await apiRequest('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, cred, payload);
        if (status !== 201) return formatError(status, data);
        const issue = data as { number: number; html_url: string; title: string };
        return `Issue #${issue.number} created: ${issue.title}\n${issue.html_url}`;
      },
    },
    {
      name: 'list_issues',
      description: 'List open issues in a repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          state: { type: 'string', description: 'State: open, closed, all (default: open)' },
          per_page: { type: 'number', description: 'Results per page (default 10)' },
        },
        required: ['owner', 'repo'],
      },
      execute: async (args, cred) => {
        const owner = args.owner as string;
        const repo = args.repo as string;
        if (!owner || !repo) return 'Error: owner and repo are required';
        const state = (args.state as string) || 'open';
        const perPage = Math.min((args.per_page as number) || 10, 100);
        const { status, data } = await apiRequest('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&per_page=${perPage}`, cred);
        if (status !== 200) return formatError(status, data);
        const issues = data as Array<{ number: number; title: string; state: string; user: { login: string }; labels: Array<{ name: string }> }>;
        if (!issues.length) return `No ${state} issues found.`;
        const lines = issues.map(i => {
          const labels = i.labels.map(l => l.name).join(', ');
          return `  #${i.number} [${i.state}] ${i.title} (by ${i.user.login})${labels ? ` [${labels}]` : ''}`;
        });
        return truncate(`Issues (${issues.length}):\n${lines.join('\n')}`);
      },
    },
    {
      name: 'create_pr',
      description: 'Create a pull request',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR description (Markdown)' },
          head: { type: 'string', description: 'Branch with changes' },
          base: { type: 'string', description: 'Target branch (default: main)' },
        },
        required: ['owner', 'repo', 'title', 'head'],
      },
      execute: async (args, cred) => {
        const owner = args.owner as string;
        const repo = args.repo as string;
        const title = args.title as string;
        const head = args.head as string;
        if (!owner || !repo || !title || !head) return 'Error: owner, repo, title, and head are required';

        const payload = {
          title,
          body: (args.body as string) || '',
          head,
          base: (args.base as string) || 'main',
        };
        const { status, data } = await apiRequest('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, cred, payload);
        if (status !== 201) return formatError(status, data);
        const pr = data as { number: number; html_url: string; title: string };
        return `PR #${pr.number} created: ${pr.title}\n${pr.html_url}`;
      },
    },
    {
      name: 'list_prs',
      description: 'List pull requests in a repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          state: { type: 'string', description: 'State: open, closed, all (default: open)' },
          per_page: { type: 'number', description: 'Results per page (default 10)' },
        },
        required: ['owner', 'repo'],
      },
      execute: async (args, cred) => {
        const owner = args.owner as string;
        const repo = args.repo as string;
        if (!owner || !repo) return 'Error: owner and repo are required';
        const state = (args.state as string) || 'open';
        const perPage = Math.min((args.per_page as number) || 10, 100);
        const { status, data } = await apiRequest('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=${perPage}`, cred);
        if (status !== 200) return formatError(status, data);
        const prs = data as Array<{ number: number; title: string; state: string; user: { login: string }; head: { ref: string } }>;
        if (!prs.length) return `No ${state} pull requests found.`;
        const lines = prs.map(p =>
          `  #${p.number} [${p.state}] ${p.title} (${p.head.ref} by ${p.user.login})`
        );
        return truncate(`Pull Requests (${prs.length}):\n${lines.join('\n')}`);
      },
    },
    {
      name: 'get_repo_info',
      description: 'Get detailed information about a repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
        },
        required: ['owner', 'repo'],
      },
      execute: async (args, cred) => {
        const owner = args.owner as string;
        const repo = args.repo as string;
        if (!owner || !repo) return 'Error: owner and repo are required';
        const { status, data } = await apiRequest('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, cred);
        if (status !== 200) return formatError(status, data);
        const r = data as {
          full_name: string; description: string; language: string;
          stargazers_count: number; forks_count: number; open_issues_count: number;
          default_branch: string; html_url: string; created_at: string; updated_at: string;
          topics: string[];
        };
        return [
          `${r.full_name}`,
          `  ${r.description || '(no description)'}`,
          `  Language: ${r.language || 'N/A'}  Stars: ${r.stargazers_count}  Forks: ${r.forks_count}  Issues: ${r.open_issues_count}`,
          `  Default branch: ${r.default_branch}`,
          r.topics?.length ? `  Topics: ${r.topics.join(', ')}` : '',
          `  URL: ${r.html_url}`,
          `  Updated: ${r.updated_at}`,
        ].filter(Boolean).join('\n');
      },
    },
  ];

  async validate(credential: string): Promise<boolean> {
    try {
      const { status } = await apiRequest('GET', '/user', credential);
      return status === 200;
    } catch {
      return false;
    }
  }
}
