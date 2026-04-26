/**
 * CodeBot AI mascot and CLI banner.
 *
 * Mascot name: Codi
 * Three designs: Core, Terminal, Sentinel
 * See BRANDING.md for full identity guide.
 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m',
  brightWhite: '\x1b[97m',
  brightRed: '\x1b[91m',
  brightBlue: '\x1b[94m',
};

export type CodiMood = 'ready' | 'working' | 'success' | 'error' | 'thinking' | 'idle' | 'alert';

// ─────────────────────────────────────────────────────────────
// DESIGN 1: "Core" — Solid block-character robot head
// Double-thick walls. Heavy, industrial, enterprise.
// ─────────────────────────────────────────────────────────────
export const MASCOT_1 = `
        ▄██████████████████▄
       ██                  ██
       ██   ▄██▄    ▄██▄   ██
       ██   ▀██▀    ▀██▀   ██
       ██                  ██
       ██     ▀██████▀     ██
        ▀██████████████████▀
`;

export const BANNER_1 = (version: string, model: string, provider: string, session: string, autonomous: boolean): string => {
  const f = C.cyan;
  const e = C.brightGreen;
  const m = C.brightCyan;
  const d = C.dim;
  const r = C.reset;
  const lines = [
    '',
    `${f}        ▄██████████████████▄${r}`,
    `${f}       ██${r}                  ${f}██${r}`,
    `${f}       ██${r}   ${e}▄██▄${r}    ${e}▄██▄${r}   ${f}██${r}   ${C.bold}${C.brightCyan}CodeBot AI${r} ${d}v${version}${r}`,
    `${f}       ██${r}   ${e}▀██▀${r}    ${e}▀██▀${r}   ${f}██${r}   ${d}Think local. Code global.${r}`,
    `${f}       ██${r}                  ${f}██${r}`,
    `${f}       ██${r}     ${m}▀██████▀${r}     ${f}██${r}   ${d}Model:    ${C.white}${model}${r}`,
    `${f}        ▀██████████████████▀${r}    ${d}Provider: ${C.white}${provider}${r}`,
    `                                ${d}Session:  ${C.white}${session}${r}`,
    autonomous ? `                                ${C.brightYellow}${C.bold}⚡ AUTONOMOUS${r}` : '',
    '',
  ];
  return lines.join('\n');
};

// ─────────────────────────────────────────────────────────────
// DESIGN 2: "Terminal" — Clean double-line border monitor
// Formal, corporate. Minimal decoration.
// ─────────────────────────────────────────────────────────────
export const MASCOT_2 = `
       ╔══════════════════════╗
       ║                      ║
       ║     ●          ●     ║
       ║                      ║
       ║      ╰────────╯      ║
       ║                      ║
       ╚══════════════════════╝
`;

export const BANNER_2 = (version: string, model: string, provider: string, session: string, autonomous: boolean): string => {
  const f = C.cyan;
  const e = C.brightGreen;
  const m = C.brightCyan;
  const d = C.dim;
  const r = C.reset;
  const lines = [
    '',
    `${f}       ╔══════════════════════╗${r}`,
    `${f}       ║${r}                      ${f}║${r}`,
    `${f}       ║${r}     ${e}●${r}          ${e}●${r}     ${f}║${r}   ${C.bold}${C.brightCyan}CodeBot AI${r} ${d}v${version}${r}`,
    `${f}       ║${r}                      ${f}║${r}   ${d}Think local. Code global.${r}`,
    `${f}       ║${r}      ${m}╰────────╯${r}      ${f}║${r}`,
    `${f}       ║${r}                      ${f}║${r}   ${d}Model:    ${C.white}${model}${r}`,
    `${f}       ╚══════════════════════╝${r}   ${d}Provider: ${C.white}${provider}${r}`,
    `                                   ${d}Session:  ${C.white}${session}${r}`,
    autonomous ? `                                   ${C.brightYellow}${C.bold}⚡ AUTONOMOUS${r}` : '',
    '',
  ];
  return lines.join('\n');
};

// ─────────────────────────────────────────────────────────────
// DESIGN 3: "Sentinel" — Visor helmet with gradient scan bar
// Sleek armor plating. Diamond silhouette.
// ─────────────────────────────────────────────────────────────
export const MASCOT_3 = `
          ▄████████████▄
        ▄█▀            ▀█▄
       █▀ ░░▒▓██████▓▒░░ ▀█
       █▄ ░░░░░░░░░░░░░░ ▄█
        ▀█▄            ▄█▀
          ▀████████████▀
`;

export const BANNER_3 = (version: string, model: string, provider: string, session: string, autonomous: boolean): string => {
  const f = C.cyan;
  const v = C.brightCyan;
  const g = C.brightGreen;
  const d = C.dim;
  const r = C.reset;
  const lines = [
    '',
    `${f}          ▄████████████▄${r}`,
    `${f}        ▄█▀${r}            ${f}▀█▄${r}        ${C.bold}${C.brightCyan}CodeBot AI${r} ${d}v${version}${r}`,
    `${f}       █▀${r} ${v}░░▒▓${g}██████${v}▓▒░░${r} ${f}▀█${r}       ${d}Think local. Code global.${r}`,
    `${f}       █▄${r} ${d}░░░░░░░░░░░░░░${r} ${f}▄█${r}`,
    `${f}        ▀█▄${r}            ${f}▄█▀${r}        ${d}Model:    ${C.white}${model}${r}`,
    `${f}          ▀████████████▀${r}          ${d}Provider: ${C.white}${provider}${r}`,
    `                                   ${d}Session:  ${C.white}${session}${r}`,
    autonomous ? `                                   ${C.brightYellow}${C.bold}⚡ AUTONOMOUS${r}` : '',
    '',
  ];
  return lines.join('\n');
};

// ─────────────────────────────────────────────────────────────
// Default banner (Design 1 — Core)
// ─────────────────────────────────────────────────────────────
export const banner = BANNER_1;

// ─────────────────────────────────────────────────────────────
// Inline status indicators
// ─────────────────────────────────────────────────────────────

export const CODI_FACE: Record<CodiMood, string> = {
  ready:    `${C.cyan}[${C.brightGreen}◉ ◉${C.cyan}]${C.reset}`,
  working:  `${C.cyan}[${C.brightCyan}◎ ◎${C.cyan}]${C.reset}`,
  success:  `${C.cyan}[${C.brightGreen}● ●${C.cyan}]${C.reset}`,
  error:    `${C.cyan}[${C.brightRed}✕ ✕${C.cyan}]${C.reset}`,
  thinking: `${C.cyan}[${C.brightYellow}◉ ${C.dim}·${C.cyan}]${C.reset}`,
  idle:     `${C.cyan}[${C.dim}· ·${C.cyan}]${C.reset}`,
  alert:    `${C.cyan}[${C.brightYellow}▲ ▲${C.cyan}]${C.reset}`,
};

// ─────────────────────────────────────────────────────────────
// Greeting System
// ─────────────────────────────────────────────────────────────

const GREETINGS_BY_MOOD: Record<string, string[]> = {
  confident: [
    "Systems online. Let's ship.",
    "All circuits green. Ready to code.",
    "No cloud. No limits. Let's go.",
    "Standing by. Say the word.",
    "Initialized. Awaiting instructions.",
    "Signal locked. Ready to transmit.",
    "Provider connected. Model hot. Let's go.",
  ],
  playful: [
    "What are we building today?",
    "I read your codebase. We need to talk.",
    "Your code, your machine, your move.",
    "Another day, another deploy.",
    "Booted up. Zero dependencies loaded.",
    "Local power, global ambitions.",
    "Scanned your repo. I have thoughts.",
  ],
  security: [
    "Eight security layers active. You're safe.",
    "Hash chain intact. Trust verified.",
    "Sandbox locked. Creativity unlocked.",
    "Audit trail recording. Every move counts.",
    "Policy loaded. Rules are rules.",
    "Risk score: 0. Let's keep it that way.",
  ],
  resuming: [
    "Memory loaded. I remember everything.",
    "Picking up where we left off.",
    "Context restored. Continuity maintained.",
    "Back online. Nothing lost.",
    "Session recovered. Let's continue.",
  ],
};

const ALL_GREETINGS = Object.values(GREETINGS_BY_MOOD).flat();

export function randomGreeting(mood?: string): string {
  const pool = mood && GREETINGS_BY_MOOD[mood]
    ? GREETINGS_BY_MOOD[mood]
    : ALL_GREETINGS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─────────────────────────────────────────────────────────────
// Reactions
// ─────────────────────────────────────────────────────────────

export interface CodiReaction {
  face: string;
  message: string;
}

const REACTIONS: Record<string, string[]> = {
  tool_success: [
    "Done.",
    "Clean.",
    "Handled.",
    "Next?",
    "Complete.",
  ],
  tool_error: [
    "That broke. Fixing.",
    "Error caught. Adjusting.",
    "Not ideal. Recovering.",
    "Blocked. Finding another way.",
    "Retrying with different approach.",
  ],
  security_block: [
    "Blocked. Policy violation.",
    "Access denied. Security boundary hit.",
    "Risk threshold exceeded. Skipping.",
    "Denied. Policy enforced.",
    "Path restricted. Cannot proceed.",
  ],
  session_end: [
    "Session complete. Audit trail sealed.",
    "Signing off. All changes persisted.",
    "Done. Metrics saved.",
    "Session closed. Everything committed.",
    "Shutting down cleanly.",
  ],
  thinking: [
    "Analyzing...",
    "Processing...",
    "Evaluating options...",
    "Computing...",
    "Working through it...",
  ],
  cost_warning: [
    "Token usage elevated.",
    "Cost accumulating. Monitor budget.",
    "High token throughput detected.",
    "Budget advisory: cost climbing.",
  ],
  autonomous_start: [
    "Autonomous mode engaged.",
    "Full automation active. No prompts.",
    "Auto-pilot initialized.",
    "Running unattended. All tools approved.",
    "Autonomous. Maximum throughput.",
  ],
};

export function codiReact(event: string): CodiReaction {
  let mood: CodiMood = 'ready';
  if (event === 'tool_success' || event === 'session_end') mood = 'success';
  else if (event === 'tool_error') mood = 'error';
  else if (event === 'security_block') mood = 'alert';
  else if (event === 'thinking') mood = 'thinking';
  else if (event === 'cost_warning') mood = 'alert';
  else if (event === 'autonomous_start') mood = 'working';

  const messages = REACTIONS[event] || REACTIONS.tool_success;
  const message = messages[Math.floor(Math.random() * messages.length)];

  return { face: CODI_FACE[mood], message };
}

export function formatReaction(event: string): string {
  const reaction = codiReact(event);
  return `  ${reaction.face} ${C.dim}${reaction.message}${C.reset}`;
}

// ─────────────────────────────────────────────────────────────
// Session Summary Banner
// ─────────────────────────────────────────────────────────────

export function sessionSummaryBanner(stats: {
  iterations: number;
  toolCalls: number;
  tokensUsed: number;
  cost?: number;
  duration?: number;
  /**
   * PR 6 — effective budget cap and remaining USD.
   * `budgetCapUsd` 0 / undefined or `budgetRemainingUsd` Infinity → "no limit".
   */
  budgetCapUsd?: number;
  budgetRemainingUsd?: number;
}): string {
  const durationStr = stats.duration !== undefined
    ? `${Math.floor(stats.duration / 60)}m ${Math.round(stats.duration % 60)}s`
    : 'N/A';
  const costStr = stats.cost !== undefined ? `$${stats.cost.toFixed(4)}` : 'N/A';

  // PR 6 — render budget remaining only when there is an effective cap.
  // `budgetRemainingUsd === Infinity` means "no cap set," which we omit
  // rather than pretend.
  const hasCap = (stats.budgetCapUsd ?? 0) > 0
    && stats.budgetRemainingUsd !== undefined
    && Number.isFinite(stats.budgetRemainingUsd);
  const budgetStr = hasCap
    ? `$${(stats.budgetRemainingUsd as number).toFixed(4)} / $${(stats.budgetCapUsd as number).toFixed(2)}`
    : 'no cap';

  const lines = [
    '',
    `${C.dim}${'─'.repeat(50)}${C.reset}`,
    `${CODI_FACE.success} ${C.bold}${C.brightCyan}Session Complete${C.reset}`,
    `${C.dim}${'─'.repeat(50)}${C.reset}`,
    `  ${C.dim}Iterations:${C.reset}  ${stats.iterations}`,
    `  ${C.dim}Tool calls:${C.reset}  ${stats.toolCalls}`,
    `  ${C.dim}Tokens:${C.reset}      ${stats.tokensUsed.toLocaleString()}`,
    `  ${C.dim}Cost:${C.reset}        ${costStr}`,
    `  ${C.dim}Budget:${C.reset}      ${budgetStr}`,
    `  ${C.dim}Duration:${C.reset}    ${durationStr}`,
    `${C.dim}${'─'.repeat(50)}${C.reset}`,
    `  ${C.dim}${randomGreeting('confident')}${C.reset}`,
    '',
  ];

  return lines.join('\n');
}

export function compactBanner(version: string, model: string): string {
  return `${C.bold}${C.brightCyan}CodeBot AI${C.reset} ${C.dim}v${version}${C.reset} ${C.dim}[${model}]${C.reset}`;
}

export function randomBanner(): typeof BANNER_1 {
  const banners = [BANNER_1, BANNER_2, BANNER_3];
  return banners[Math.floor(Math.random() * banners.length)];
}

// ─────────────────────────────────────────────────────────────
// Terminal Animation System
// ─────────────────────────────────────────────────────────────

const ANSI = {
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine:  '\x1b[2K',
  moveUp:     (n: number) => `\x1b[${n}A`,
  moveDown:   (n: number) => `\x1b[${n}B`,
  moveToCol:  (n: number) => `\x1b[${n}G`,
  saveCursor: '\x1b7',
  restoreCursor: '\x1b8',
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type AnimationWriter = (text: string) => void;

function defaultWriter(text: string): void {
  process.stdout.write(text);
}

export type AnimationSpeed = 'fast' | 'normal' | 'slow';

export interface AnimationOptions {
  speed?: AnimationSpeed;
  writer?: AnimationWriter;
}

function getDelay(speed: AnimationSpeed): { line: number; char: number; pause: number; frame: number } {
  switch (speed) {
    case 'fast':   return { line: 40,  char: 15,  pause: 200, frame: 50  };
    case 'normal': return { line: 70,  char: 25,  pause: 300, frame: 80  };
    case 'slow':   return { line: 100, char: 40,  pause: 400, frame: 120 };
  }
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─────────────────────────────────────────────────────────────
// Animation 1: Line-by-line reveal
// Renders the banner one line at a time with a delay.
// ─────────────────────────────────────────────────────────────

export async function animateReveal(
  bannerFn: typeof BANNER_1,
  version: string,
  model: string,
  provider: string,
  session: string,
  autonomous: boolean,
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);
  const output = bannerFn(version, model, provider, session, autonomous);
  const lines = output.split('\n');

  w(ANSI.hideCursor);
  try {
    for (const line of lines) {
      w(line + '\n');
      if (stripAnsi(line).trim().length > 0) {
        await sleep(delay.line);
      }
    }
  } finally {
    w(ANSI.showCursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Animation 2: Sentinel visor scan
// The gradient highlight sweeps across the visor bar.
// ─────────────────────────────────────────────────────────────

const VISOR_WIDTH = 14; // character width of the visor zone

function renderVisorFrame(position: number): string {
  const chars: string[] = [];
  for (let i = 0; i < VISOR_WIDTH; i++) {
    const dist = Math.abs(i - position);
    if (dist === 0)      chars.push(`${C.brightGreen}██${C.reset}`);
    else if (dist === 1) chars.push(`${C.brightCyan}▓▓${C.reset}`);
    else if (dist === 2) chars.push(`${C.cyan}▒▒${C.reset}`);
    else if (dist === 3) chars.push(`${C.dim}░░${C.reset}`);
    else                 chars.push(`${C.dim}░░${C.reset}`);
  }
  return chars.join('').replace(/(░░)+$/, m => `${C.dim}${m}${C.reset}`);
}

export async function animateVisorScan(
  sweeps: number = 2,
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);
  const f = C.cyan;
  const r = C.reset;

  // Render the static sentinel frame first
  const staticLines = [
    '',
    `${f}          ▄████████████▄${r}`,
    `${f}        ▄█▀${r}            ${f}▀█▄${r}`,
    '', // visor line — will be animated
    `${f}       █▄${r} ${C.dim}░░░░░░░░░░░░░░${r} ${f}▄█${r}`,
    `${f}        ▀█▄${r}            ${f}▄█▀${r}`,
    `${f}          ▀████████████▀${r}`,
    '',
  ];

  w(ANSI.hideCursor);
  try {
    // Print static lines, inserting placeholder for visor
    for (let i = 0; i < staticLines.length; i++) {
      if (i === 3) {
        w(`${f}       █▀${r} ${C.dim}░░░░░░░░░░░░░░░░░░░░░░░░░░░░${r} ${f}▀█${r}\n`);
      } else {
        w(staticLines[i] + '\n');
      }
    }

    // Now animate the visor line (line index 3, which is 5 lines up from bottom)
    const linesBelow = staticLines.length - 3 - 1; // lines printed after the visor line

    for (let sweep = 0; sweep < sweeps; sweep++) {
      // Sweep right
      for (let pos = 0; pos <= 6; pos++) {
        w(ANSI.moveUp(linesBelow + 1));
        w('\r' + ANSI.clearLine);
        const visor = renderVisorFrame(pos);
        w(`${f}       █▀${r} ${visor} ${f}▀█${r}`);
        w('\n' + ANSI.moveDown(linesBelow));
        await sleep(delay.frame);
      }
      // Sweep left
      for (let pos = 6; pos >= 0; pos--) {
        w(ANSI.moveUp(linesBelow + 1));
        w('\r' + ANSI.clearLine);
        const visor = renderVisorFrame(pos);
        w(`${f}       █▀${r} ${visor} ${f}▀█${r}`);
        w('\n' + ANSI.moveDown(linesBelow));
        await sleep(delay.frame);
      }
    }

    // Final state — render the standard visor
    w(ANSI.moveUp(linesBelow + 1));
    w('\r' + ANSI.clearLine);
    const v = C.brightCyan;
    const g = C.brightGreen;
    w(`${f}       █▀${r} ${v}░░▒▓${g}██████${v}▓▒░░${r} ${f}▀█${r}`);
    w('\n' + ANSI.moveDown(linesBelow));
  } finally {
    w(ANSI.showCursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Animation 3: Core eye boot sequence
// Eyes power on: dim → medium → bright
// ─────────────────────────────────────────────────────────────

export async function animateEyeBoot(
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);
  const f = C.cyan;
  const r = C.reset;

  // Phase frames for the eyes powering on
  const eyeFrames = [
    // Phase 0: Dark — no eyes
    { top: `${C.dim}·  ·${r}    ${C.dim}·  ·${r}`, bot: `${C.dim}·  ·${r}    ${C.dim}·  ·${r}` },
    // Phase 1: Dim blocks
    { top: `${C.dim}▄██▄${r}    ${C.dim}▄██▄${r}`, bot: `${C.dim}▀██▀${r}    ${C.dim}▀██▀${r}` },
    // Phase 2: Cyan glow
    { top: `${C.cyan}▄██▄${r}    ${C.cyan}▄██▄${r}`, bot: `${C.cyan}▀██▀${r}    ${C.cyan}▀██▀${r}` },
    // Phase 3: Bright green — fully online
    { top: `${C.brightGreen}▄██▄${r}    ${C.brightGreen}▄██▄${r}`, bot: `${C.brightGreen}▀██▀${r}    ${C.brightGreen}▀██▀${r}` },
  ];

  // Print the Core mascot with blank eyes first
  const lines = [
    '',
    `${f}        ▄██████████████████▄${r}`,
    `${f}       ██${r}                  ${f}██${r}`,
    `${f}       ██${r}   ${eyeFrames[0].top}   ${f}██${r}`,
    `${f}       ██${r}   ${eyeFrames[0].bot}   ${f}██${r}`,
    `${f}       ██${r}                  ${f}██${r}`,
    `${f}       ██${r}     ${C.dim}·  ·  ·  ·${r}     ${f}██${r}`,
    `${f}        ▀██████████████████▀${r}`,
    '',
  ];

  w(ANSI.hideCursor);
  try {
    for (const line of lines) {
      w(line + '\n');
    }

    await sleep(delay.pause * 2);

    // Animate eye phases
    for (let phase = 1; phase < eyeFrames.length; phase++) {
      const frame = eyeFrames[phase];
      w(ANSI.moveUp(6));
      w('\r' + ANSI.clearLine);
      w(`${f}       ██${r}   ${frame.top}   ${f}██${r}`);
      w('\n' + ANSI.clearLine);
      w(`${f}       ██${r}   ${frame.bot}   ${f}██${r}`);
      w('\n' + ANSI.moveDown(4));

      if (phase === eyeFrames.length - 1) {
        // Also light up the mouth
        w(ANSI.moveUp(3));
        w('\r' + ANSI.clearLine);
        w(`${f}       ██${r}     ${C.brightCyan}▀██████▀${r}     ${f}██${r}`);
        w('\n' + ANSI.moveDown(2));
      }

      await sleep(delay.pause);
    }
  } finally {
    w(ANSI.showCursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Animation 4: Full boot sequence
// Combines: scanline effect → mascot build → info fade-in
// ─────────────────────────────────────────────────────────────

export async function animateBootSequence(
  bannerFn: typeof BANNER_1,
  version: string,
  model: string,
  provider: string,
  session: string,
  autonomous: boolean,
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);
  const output = bannerFn(version, model, provider, session, autonomous);
  const lines = output.split('\n');
  const r = C.reset;

  w(ANSI.hideCursor);
  try {
    // Brief settle before animation starts
    await sleep(150);

    // Phase 1: Scanline — print each line dim first, then brighten
    let artDone = false;
    for (const line of lines) {
      const stripped = stripAnsi(line).trim();
      if (stripped.length === 0) {
        w('\n');
        continue;
      }

      // Detect transition from mascot art to info lines (Model/Provider/Session)
      if (!artDone && stripped.startsWith('Model:')) {
        artDone = true;
        await sleep(delay.pause / 2); // pause between art and info
      }

      // Print dim version first — hold long enough to see
      w(`${C.dim}${stripAnsi(line)}${r}`);
      await sleep(delay.line);
      // Overwrite with full color
      w('\r' + ANSI.clearLine + line + '\n');
      await sleep(delay.line / 3);
    }

    await sleep(delay.pause);

    // Phase 2: Greeting — type character by character
    const greeting = randomGreeting('confident');
    w('  ' + CODI_FACE.ready + ' ' + C.dim);
    for (const ch of greeting) {
      w(ch);
      await sleep(delay.char);
    }
    w(r + '\n');

    // Hold the completed banner visible briefly
    await sleep(200);
  } finally {
    w(ANSI.showCursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Animation 5: Terminal typing effect
// Types out text character by character.
// ─────────────────────────────────────────────────────────────

export async function animateTyping(
  text: string,
  color: string = C.dim,
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);
  w(color);
  for (const ch of text) {
    w(ch);
    await sleep(delay.char);
  }
  w(C.reset);
}

// ─────────────────────────────────────────────────────────────
// Animation 6: Session end — fade out with status
// ─────────────────────────────────────────────────────────────

export async function animateSessionEnd(
  stats: {
    iterations: number;
    toolCalls: number;
    tokensUsed: number;
    cost?: number;
    duration?: number;
  },
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);

  const summaryText = sessionSummaryBanner(stats);
  const lines = summaryText.split('\n');

  w(ANSI.hideCursor);
  try {
    for (const line of lines) {
      w(line + '\n');
      if (stripAnsi(line).trim().length > 0) {
        await sleep(delay.line);
      }
    }
  } finally {
    w(ANSI.showCursor);
  }
}

// ─────────────────────────────────────────────────────────────
// Utility: Check if animations should run
// Only animate in interactive TTY terminals.
// ─────────────────────────────────────────────────────────────

export function shouldAnimate(): boolean {
  return !!(process.stdout.isTTY) && process.env.TERM !== 'dumb' && !process.env.CI;
}


// ─────────────────────────────────────────────────────────────
// Animation 7: Welcome boot — fused detection + banner
// Shows detection results, then transitions into full banner.
// ─────────────────────────────────────────────────────────────

export async function animateWelcomeBoot(
  bannerFn: typeof BANNER_1,
  version: string,
  model: string,
  provider: string,
  session: string,
  autonomous: boolean,
  detectionSteps: string[],
  speed: AnimationSpeed = 'normal',
  opts?: { writer?: AnimationWriter },
): Promise<void> {
  const w = opts?.writer ?? defaultWriter;
  const delay = getDelay(speed);

  w(ANSI.hideCursor);
  try {
    // Phase 1: Show detection results one by one
    for (const step of detectionSteps) {
      w(`  ${C.brightGreen}\u2713${C.reset} ${C.dim}${step}${C.reset}\n`);
      await sleep(delay.line);
    }

    if (detectionSteps.length > 0) {
      await sleep(delay.pause / 2);
      // Clear detection lines by moving up and clearing
      for (let i = 0; i < detectionSteps.length; i++) {
        w(ANSI.moveUp(1) + ANSI.clearLine);
      }
    }

    // Phase 2: Full boot sequence (reuse existing)
    w(ANSI.showCursor);
    await animateBootSequence(bannerFn, version, model, provider, session, autonomous, speed, opts);
  } catch {
    w(ANSI.showCursor);
  }
}
