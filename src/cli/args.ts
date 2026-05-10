/**
 * CLI argument parsing and help display.
 * Extracted from cli.ts for maintainability.
 */

import { DEFAULT_DASHBOARD_PORT } from './dashboard-config';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function c(text: string, style: keyof typeof C): string {
  return `${C[style]}${text}${C.reset}`;
}

/** Flags that take no value — set to `true` when present. */
const BOOLEAN_FLAGS = new Set([
  '--help', '-h',
  '--version', '-v',
  '--continue', '-c',
  '--setup', '--init',
  '--init-policy',
  '--sandbox-info',
  '--dashboard',
  '--vault-writable',
  '--vault-allow-network',
  '--daemon',
  '--tui',
  '--no-stream',
  '--doctor',
  '--core-only',
  '--open-pr',
  '--safe',
  '--no-constitutional',
  '--dry-run', '--estimate',
  '--deterministic',
  '--no-auto-approve',
  '--listen',
]);

/** Aliases that set multiple keys simultaneously. */
const ALIAS_FLAGS: Record<string, string[]> = {
  '--help': ['help'],
  '-h': ['help'],
  '--version': ['version'],
  '-v': ['version'],
  '--continue': ['continue'],
  '-c': ['continue'],
  '--setup': ['setup'],
  '--init': ['setup'],
  '--dry-run': ['dry-run'],
  '--estimate': ['dry-run'],
  '--auto-approve': ['auto-approve', 'autonomous', 'auto'],
  '--autonomous': ['auto-approve', 'autonomous', 'auto'],
  '--auto': ['auto-approve', 'autonomous', 'auto'],
};

/** Flags whose canonical result key differs from the flag name (strip `--`). */
const KEY_OVERRIDE: Record<string, string> = {
  '--no-stream': 'noStream',
};

/** Flags that accept an optional next argument (string if present, true if absent). */
const OPTIONAL_VALUE_FLAGS = new Set([
  '--verify-audit',
  '--export-audit',
  '--replay',
  '--solve',
  '--theme',
  '--preset',
  '--init-preset',
  '--task',
]);

/** Flags that require a next argument (error if missing or starts with --). */
const REQUIRED_VALUE_FLAGS = new Set([
  '--vault',
  '--allow-capability',
  '--host',
  '--audit-log',
  '--output',
  '--max-cost',
]);

/** Derive the result key for a flag. */
function flagKey(flag: string): string {
  if (KEY_OVERRIDE[flag]) return KEY_OVERRIDE[flag];
  // Strip leading '--' or '-'
  return flag.replace(/^-+/, '');
}

function isBoolean(flag: string): boolean {
  return BOOLEAN_FLAGS.has(flag);
}

function hasOptionalValue(flag: string): boolean {
  return OPTIONAL_VALUE_FLAGS.has(flag);
}

function hasRequiredValue(flag: string): boolean {
  return REQUIRED_VALUE_FLAGS.has(flag);
}

function applyAliases(
  result: Record<string, string | boolean>,
  flag: string,
  value: string | boolean,
): void {
  const aliases = ALIAS_FLAGS[flag];
  if (aliases) {
    for (const k of aliases) result[k] = value;
  } else {
    result[flagKey(flag)] = value;
  }
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }

    if (isBoolean(arg)) {
      applyAliases(result, arg, true);
      continue;
    }

    if (hasRequiredValue(arg)) {
      i = parseRequiredValue(argv, i, arg, result);
      continue;
    }

    if (hasOptionalValue(arg)) {
      i = parseOptionalValue(argv, i, arg, result);
      continue;
    }

    // Unknown --flag: generic key=value or boolean
    if (arg.startsWith('--')) {
      i = parseUnknownFlag(argv, i, arg, result);
      continue;
    }

    // Unrecognised single-dash flag — treat as positional
    positional.push(arg);
  }

  if (positional.length > 0) {
    result.message = positional.join(' ');
  }

  return result;
}

function parseRequiredValue(
  argv: string[],
  i: number,
  flag: string,
  result: Record<string, string | boolean>,
): number {
  const next = argv[i + 1];
  if (flag === '--vault') {
    if (!next || next.startsWith('--')) {
      throw new Error('--vault requires a path argument, e.g. --vault ~/Documents/my-notes');
    }
    result['vault'] = next;
    return i + 1;
  }
  if (flag === '--allow-capability') {
    // PR 11 — `--allow-capability <comma-list>`. Session-only opt-in
    // for labels that would otherwise force interactive approval. The
    // raw string is preserved here; parseAllowCapabilityFlag() in
    // capability-allowlist.ts validates the closed set and the
    // never-allowable hard excludes (move-money, spend-money,
    // send-on-behalf, delete-data) at agent startup.
    if (!next || next.startsWith('--')) {
      // Surfaces as a startup-time validation error rather than a
      // silent ignore — see config.ts for the exact message.
      result['allow-capability'] = '';
    } else {
      result['allow-capability'] = next;
      return i + 1;
    }
    return i;
  }
  // Generic required-value flags
  const key = flagKey(flag);
  if (next && !next.startsWith('--')) {
    result[key] = next;
    return i + 1;
  }
  result[key] = '';
  return i;
}

function parseOptionalValue(
  argv: string[],
  i: number,
  flag: string,
  result: Record<string, string | boolean>,
): number {
  const next = argv[i + 1];
  const key = flagKey(flag);
  if (next && !next.startsWith('--')) {
    result[key] = next;
    return i + 1;
  }
  result[key] = true;
  return i;
}

function parseUnknownFlag(
  argv: string[],
  i: number,
  flag: string,
  result: Record<string, string | boolean>,
): number {
  const key = flag.slice(2);
  const next = argv[i + 1];
  // Issue #7: don't let an unknown flag swallow the user's task message.
  //
  // Legitimate flag values are short identifiers (URLs, model names,
  // file paths, numbers, integers). Real task messages are long and
  // typically contain spaces. If `next` looks like a sentence rather
  // than a flag value, treat the current flag as a boolean and let
  // `next` fall through to the positional path on the next iteration.
  const looksLikeMessage = !!next && (next.length > 60 || /\s/.test(next));
  if (next && !next.startsWith('--') && !looksLikeMessage) {
    result[key] = next;
    return i + 1;
  }
  result[key] = true;
  return i;
}

export function showHelp() {
  console.log(`${c('CodeBot AI', 'bold')} - Local-first AI coding assistant

${c('Quick Start:', 'bold')}
  codebot --setup                  Run interactive setup wizard
  codebot                          Start interactive mode
  codebot "fix the bug in app.ts"  Single message mode
  echo "explain this" | codebot    Pipe mode

${c('Options:', 'bold')}
  --setup              Run the setup wizard (auto-runs on first use)
  --model <name>       Model to use (default: qwen2.5-coder:32b)
  --provider <name>    Provider: openai, anthropic, gemini, deepseek, groq, mistral, xai
  --base-url <url>     LLM API base URL (auto-detects Ollama/LM Studio/vLLM + cloud)
  --api-key <key>      API key (or set provider-specific env var)
  --dashboard          Start web dashboard on port ${DEFAULT_DASHBOARD_PORT}
  --daemon             Start persistent background daemon
  --vault <path>       Vault Mode: research-assistant over a folder of markdown notes
                       (read-only by default, no network calls, full audit log)
  --vault-writable     Allow edit_file / write_file in vault mode
  --vault-allow-network  Allow web_fetch / http_client in vault mode
  --host <addr>        Dashboard bind address (default: 127.0.0.1, use 0.0.0.0 for LAN)
  --tui                Full-screen TUI mode with panels
  --no-stream          Suppress streaming progress indicators
  --theme <name>       Theme: dark, light, mono (default: auto)
  --autonomous         Skip ALL permission prompts — full auto mode
  --auto-approve       Same as --autonomous
                       (env: CODEBOT_AUTO_APPROVE=true)
  --allow-capability <list>  Comma-separated capability labels to bypass
                       interactive approval in unattended mode. Required
                       alongside --auto-approve for any tool that carries
                       account-access / write-fs / run-cmd / net-fetch /
                       browser-write labels. Refuses move-money,
                       spend-money, send-on-behalf, delete-data — those
                       still require per-call interactive approval.
                       Example: --allow-capability account-access,net-fetch
  --resume <id>        Resume a previous session by ID
  --continue, -c       Resume the most recent session
  --max-iterations <n> Max agent loop iterations (default: 50)
  --sandbox <mode>     Execution sandbox: docker, host, auto (default: auto)
  -h, --help           Show this help
  -v, --version        Show version

${c('Security & Policy:', 'bold')}
  --init-policy        Generate default .codebot/policy.json
  --verify-audit [id]  Verify audit log hash chain integrity
  --export-audit sarif Export audit log as SARIF 2.1.0 JSON
  --sandbox-info       Show Docker sandbox status

${c('Diagnostics:', 'bold')}
  --doctor             Run environment health check
  --dry-run, --estimate Estimate cost without executing
  --heartbeat <on|off|status>
                       Anonymous opt-in install ping (see docs/PRIVACY.md)

${c('Issue Solving:', 'bold')}
  --solve <url>          Solve a GitHub issue autonomously
  --open-pr              Push branch and create PR (default: dry-run)
  --safe                 Conservative mode (max 3 files, no dep changes)
  --max-files <n>        Max files to modify (default: 10)
  --timeout-min <n>      Hard timeout in minutes (default: 20)
  --json                 Structured JSON output

${c('Constitutional Safety:', 'bold')}
  --no-constitutional    Disable CORD + VIGIL safety layer
  (enabled by default — 14-dimension constitutional evaluation + threat patrol)

${c('Debugging & Replay:', 'bold')}
  --replay [id]        Replay a session, re-execute tools, compare outputs
  --deterministic      Set temperature=0 for reproducible outputs

${c('Supported Providers:', 'bold')}
  Local:      Ollama, LM Studio, vLLM (auto-detected)
  Anthropic:  Claude Opus/Sonnet/Haiku (ANTHROPIC_API_KEY)
  OpenAI:     GPT-4o, GPT-4.1, o1/o3/o4 (OPENAI_API_KEY)
  Google:     Gemini 2.5/2.0/1.5 (GEMINI_API_KEY)
  DeepSeek:   deepseek-chat, deepseek-reasoner (DEEPSEEK_API_KEY)
  Groq:       Llama, Mixtral on Groq (GROQ_API_KEY)
  Mistral:    mistral-large, codestral (MISTRAL_API_KEY)
  xAI:        Grok-3 (XAI_API_KEY)

${c('Examples:', 'bold')}
  codebot --model claude-opus-4-6          Uses Anthropic API
  codebot --model gpt-4o                   Uses OpenAI API
  codebot --model gemini-2.5-pro           Uses Gemini API
  codebot --model deepseek-chat            Uses DeepSeek API
  codebot --model qwen2.5-coder:32b        Uses local Ollama
  codebot --autonomous "refactor src/"     Full auto, no prompts
  codebot --init-policy                    Create security policy
  codebot --verify-audit                   Check audit integrity
  codebot --export-audit sarif > r.sarif   Export SARIF report

${c('Interactive Commands:', 'bold')}
  /help      Show commands
  /model     Show or change model
  /models    List all supported models
  /sessions  List saved sessions
  /auto      Toggle autonomous mode
  /clear     Clear conversation
  /compact   Force context compaction
  /usage     Show token usage & cost
  /cost      Show running cost
  /metrics   Show session metrics
  /risk      Show risk assessment summary
  /policy    Show security policy
  /audit     Verify session audit chain
  /rate      Show provider rate limits
  /theme     Show or change theme
  /doctor    Run environment health check
  /toolcost  Show per-tool cost breakdown
  /config    Show configuration
  /quit      Exit`);
}
