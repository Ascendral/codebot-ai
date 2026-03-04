/**
 * Linear Connector — GraphQL API
 *
 * Auth: API key (LINEAR_API_KEY)
 * All actions use the single GraphQL endpoint: https://api.linear.app/graphql
 */

import { Connector, ConnectorAction } from './base';

const ENDPOINT = 'https://api.linear.app/graphql';
const TIMEOUT = 15_000;
const MAX_RESPONSE = 10_000;

async function gql(
  query: string,
  variables: Record<string, unknown>,
  credential: string,
): Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': credential,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

function formatErrors(errors: Array<{ message: string }>): string {
  return `Error: Linear API: ${errors.map(e => e.message).join(', ')}`;
}

function truncate(text: string): string {
  return text.length <= MAX_RESPONSE ? text : text.substring(0, MAX_RESPONSE) + '\n... (truncated)';
}

export class LinearConnector implements Connector {
  name = 'linear';
  displayName = 'Linear';
  description = 'Create and manage issues, list teams, and track work in Linear.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'LINEAR_API_KEY';

  actions: ConnectorAction[] = [
    {
      name: 'create_issue',
      description: 'Create a new Linear issue',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Issue title' },
          description: { type: 'string', description: 'Issue description (Markdown)' },
          team_id: { type: 'string', description: 'Team ID (use list_teams to find)' },
          priority: { type: 'number', description: 'Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low' },
          assignee_id: { type: 'string', description: 'Assignee user ID' },
          labels: { type: 'string', description: 'Comma-separated label IDs' },
        },
        required: ['title', 'team_id'],
      },
      execute: async (args, cred) => {
        const title = args.title as string;
        const teamId = args.team_id as string;
        if (!title || !teamId) return 'Error: title and team_id are required';

        const input: Record<string, unknown> = { title, teamId };
        if (args.description) input.description = args.description;
        if (args.priority !== undefined) input.priority = args.priority;
        if (args.assignee_id) input.assigneeId = args.assignee_id;
        if (args.labels) input.labelIds = (args.labels as string).split(',').map(l => l.trim());

        try {
          const result = await gql(`
            mutation CreateIssue($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue { id identifier title url }
              }
            }
          `, { input }, cred);

          if (result.errors) return formatErrors(result.errors);
          const create = result.data?.issueCreate as { success: boolean; issue: { identifier: string; title: string; url: string } };
          if (!create?.success) return 'Error: issue creation failed';
          return `Issue ${create.issue.identifier} created: ${create.issue.title}\n${create.issue.url}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_issues',
      description: 'List issues (optionally filtered by team)',
      parameters: {
        type: 'object',
        properties: {
          team_id: { type: 'string', description: 'Filter by team ID' },
          first: { type: 'number', description: 'Number of issues to return (default 10)' },
          state: { type: 'string', description: 'Filter by state name (e.g., "In Progress", "Done")' },
        },
      },
      execute: async (args, cred) => {
        const first = Math.min((args.first as number) || 10, 50);
        const filters: string[] = [];
        if (args.team_id) filters.push(`team: { id: { eq: "${args.team_id}" } }`);
        if (args.state) filters.push(`state: { name: { eq: "${args.state}" } }`);
        const filterStr = filters.length ? `(filter: { ${filters.join(', ')} })` : '';

        try {
          const result = await gql(`
            query ListIssues($first: Int!) {
              issues${filterStr}(first: $first, orderBy: updatedAt) {
                nodes {
                  identifier title
                  state { name }
                  assignee { name }
                  priority priorityLabel
                  url
                }
              }
            }
          `, { first }, cred);

          if (result.errors) return formatErrors(result.errors);
          const issues = (result.data?.issues as { nodes: Array<{ identifier: string; title: string; state: { name: string }; assignee: { name: string } | null; priorityLabel: string; url: string }> })?.nodes || [];
          if (!issues.length) return 'No issues found.';
          const lines = issues.map(i =>
            `  ${i.identifier} [${i.state?.name}] ${i.title} (${i.assignee?.name || 'unassigned'}, ${i.priorityLabel})`
          );
          return truncate(`Issues (${issues.length}):\n${lines.join('\n')}`);
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'update_issue',
      description: 'Update an existing Linear issue',
      parameters: {
        type: 'object',
        properties: {
          issue_id: { type: 'string', description: 'Issue ID (UUID) or identifier (e.g., TEAM-123)' },
          title: { type: 'string', description: 'New title' },
          description: { type: 'string', description: 'New description' },
          state_id: { type: 'string', description: 'New state ID' },
          priority: { type: 'number', description: 'New priority (0-4)' },
          assignee_id: { type: 'string', description: 'New assignee ID' },
        },
        required: ['issue_id'],
      },
      execute: async (args, cred) => {
        const issueId = args.issue_id as string;
        if (!issueId) return 'Error: issue_id is required';

        const input: Record<string, unknown> = {};
        if (args.title) input.title = args.title;
        if (args.description) input.description = args.description;
        if (args.state_id) input.stateId = args.state_id;
        if (args.priority !== undefined) input.priority = args.priority;
        if (args.assignee_id) input.assigneeId = args.assignee_id;

        if (Object.keys(input).length === 0) return 'Error: at least one field to update is required';

        try {
          const result = await gql(`
            mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
              issueUpdate(id: $id, input: $input) {
                success
                issue { identifier title url }
              }
            }
          `, { id: issueId, input }, cred);

          if (result.errors) return formatErrors(result.errors);
          const update = result.data?.issueUpdate as { success: boolean; issue: { identifier: string; title: string; url: string } };
          if (!update?.success) return 'Error: issue update failed';
          return `Issue ${update.issue.identifier} updated: ${update.issue.title}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_teams',
      description: 'List all teams in the workspace',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async (_args, cred) => {
        try {
          const result = await gql(`
            query ListTeams {
              teams {
                nodes {
                  id name key description
                  members { nodes { name } }
                  states { nodes { id name } }
                }
              }
            }
          `, {}, cred);

          if (result.errors) return formatErrors(result.errors);
          const teams = (result.data?.teams as { nodes: Array<{ id: string; name: string; key: string; description: string; members: { nodes: Array<{ name: string }> }; states: { nodes: Array<{ id: string; name: string }> } }> })?.nodes || [];
          if (!teams.length) return 'No teams found.';
          const lines = teams.map(t => {
            const members = t.members?.nodes?.length || 0;
            const states = t.states?.nodes?.map(s => s.name).join(', ') || 'N/A';
            return `  ${t.key} — ${t.name} (${members} members)\n    ID: ${t.id}\n    States: ${states}${t.description ? `\n    ${t.description}` : ''}`;
          });
          return truncate(`Teams (${teams.length}):\n${lines.join('\n')}`);
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];

  async validate(credential: string): Promise<boolean> {
    try {
      const result = await gql('query { viewer { id name } }', {}, credential);
      return !result.errors && !!result.data?.viewer;
    } catch {
      return false;
    }
  }
}
