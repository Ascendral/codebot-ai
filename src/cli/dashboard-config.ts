export const DEFAULT_DASHBOARD_PORT = 3120;

export function resolveDashboardPort(env: Record<string, string | undefined> = process.env): number {
  const rawPort = env.CODEBOT_DASHBOARD_PORT;
  if (!rawPort) return DEFAULT_DASHBOARD_PORT;

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return DEFAULT_DASHBOARD_PORT;
  }

  return port;
}
