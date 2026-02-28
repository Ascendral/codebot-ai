import { execSync } from 'child_process';
import { Tool } from '../types';

// Block shell injection characters in host/user inputs
const SAFE_HOST = /^[a-zA-Z0-9._\-@:]+$/;

export class SshRemoteTool implements Tool {
  name = 'ssh_remote';
  description = 'Execute commands on remote servers via SSH, or upload/download files via SCP. Actions: exec, upload, download.';
  permission: Tool['permission'] = 'always-ask';
  parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: exec, upload, download' },
      host: { type: 'string', description: 'SSH target (user@hostname or hostname)' },
      command: { type: 'string', description: 'Command to execute remotely (for exec)' },
      local_path: { type: 'string', description: 'Local file path (for upload/download)' },
      remote_path: { type: 'string', description: 'Remote file path (for upload/download)' },
      port: { type: 'number', description: 'SSH port (default: 22)' },
    },
    required: ['action', 'host'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    const host = args.host as string;

    if (!action) return 'Error: action is required';
    if (!host) return 'Error: host is required';
    if (!SAFE_HOST.test(host)) return 'Error: host contains invalid characters (possible injection)';

    const port = (args.port as number) || 22;
    const portFlag = port !== 22 ? `-p ${port}` : '';
    const scpPortFlag = port !== 22 ? `-P ${port}` : '';

    switch (action) {
      case 'exec': {
        const cmd = args.command as string;
        if (!cmd) return 'Error: command is required for exec';
        return this.runSsh(`ssh ${portFlag} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${host} ${JSON.stringify(cmd)}`);
      }
      case 'upload': {
        const local = args.local_path as string;
        const remote = args.remote_path as string;
        if (!local || !remote) return 'Error: local_path and remote_path are required';
        return this.runSsh(`scp ${scpPortFlag} -o ConnectTimeout=10 "${local}" ${host}:"${remote}"`);
      }
      case 'download': {
        const local = args.local_path as string;
        const remote = args.remote_path as string;
        if (!local || !remote) return 'Error: local_path and remote_path are required';
        return this.runSsh(`scp ${scpPortFlag} -o ConnectTimeout=10 ${host}:"${remote}" "${local}"`);
      }
      default:
        return `Error: unknown action "${action}". Use: exec, upload, download`;
    }
  }

  private runSsh(cmd: string): string {
    try {
      const output = execSync(cmd, {
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no output)';
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: string };
      const msg = (e.stderr || 'SSH command failed').trim();
      if (msg.includes('Connection refused') || msg.includes('Connection timed out')) {
        return `Error: could not connect to host. ${msg}`;
      }
      if (msg.includes('Permission denied')) {
        return 'Error: authentication failed. Check SSH key or credentials.';
      }
      return `Exit ${e.status || 1}: ${msg}`;
    }
  }
}
