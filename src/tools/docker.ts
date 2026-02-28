import { execSync } from 'child_process';
import { Tool } from '../types';

const ALLOWED_ACTIONS = [
  'ps', 'images', 'run', 'stop', 'rm', 'build', 'logs', 'exec',
  'compose_up', 'compose_down', 'compose_ps', 'inspect', 'pull',
];

export class DockerTool implements Tool {
  name = 'docker';
  description = 'Run Docker operations. Actions: ps, images, run, stop, rm, build, logs, exec, compose_up, compose_down, compose_ps, inspect, pull.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Docker action to perform' },
      args: { type: 'string', description: 'Additional arguments (image name, container ID, etc.)' },
      cwd: { type: 'string', description: 'Working directory for compose commands' },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    if (!action) return 'Error: action is required';
    if (!ALLOWED_ACTIONS.includes(action)) {
      return `Error: unknown action "${action}". Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
    }

    const extra = (args.args as string) || '';
    const cwd = (args.cwd as string) || process.cwd();

    // Build the command
    let cmd: string;
    switch (action) {
      case 'ps': cmd = `docker ps ${extra}`; break;
      case 'images': cmd = `docker images ${extra}`; break;
      case 'run': cmd = `docker run ${extra}`; break;
      case 'stop': cmd = `docker stop ${extra}`; break;
      case 'rm': cmd = `docker rm ${extra}`; break;
      case 'build': cmd = `docker build ${extra}`; break;
      case 'logs': cmd = `docker logs --tail 100 ${extra}`; break;
      case 'exec': cmd = `docker exec ${extra}`; break;
      case 'inspect': cmd = `docker inspect ${extra}`; break;
      case 'pull': cmd = `docker pull ${extra}`; break;
      case 'compose_up': cmd = `docker compose up -d ${extra}`; break;
      case 'compose_down': cmd = `docker compose down ${extra}`; break;
      case 'compose_ps': cmd = `docker compose ps ${extra}`; break;
      default: return `Error: unhandled action "${action}"`;
    }

    // Safety: block --privileged and dangerous volume mounts
    if (/--privileged/.test(cmd)) return 'Error: --privileged flag is blocked for safety.';
    if (/-v\s+\/:\//i.test(cmd)) return 'Error: mounting root filesystem is blocked for safety.';

    try {
      const output = execSync(cmd, {
        cwd,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no output)';
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      const msg = (e.stderr || e.stdout || 'command failed').trim();
      if (msg.includes('not found') || msg.includes('Cannot connect')) {
        return 'Error: Docker is not installed or not running. Install Docker Desktop or start the Docker daemon.';
      }
      return `Exit ${e.status || 1}: ${msg}`;
    }
  }
}
