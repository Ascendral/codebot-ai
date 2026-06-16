import React from 'react';
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Sequence } from 'remotion';

const GOLD = '#f4a93d';
const GOLD_HI = '#ffd05d';
const GOLD_PALE = '#ffe38a';
const WHITE = '#ffffff';
const DIM = '#8a8170';
const FAINT = '#3a342a';
const RED = '#e2564a';
const PANEL = '#0c0a06';
const STROKE = '#2a2418';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const SANS = 'system-ui, "Avenir Next", Helvetica, Arial, sans-serif';

const GLOW_BG: React.CSSProperties = {
  background:
    'radial-gradient(44% 34% at 50% 44%, rgba(74,50,21,0.34), rgba(33,20,7,0.13) 50%, #000000 100%)',
  backgroundColor: '#000000',
};

const goldGlow = (px = 30, a = 0.5) => ({ textShadow: `0 0 ${px}px rgba(244,169,61,${a})` });
const redGlow = (px = 26, a = 0.45) => ({ textShadow: `0 0 ${px}px rgba(226,86,74,${a})` });

// Moving film grain — fractal noise re-seeded per frame, screen-blended low opacity
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = frame % 12;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='420'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='${seed}'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
        backgroundSize: '420px 735px',
        opacity: 0.09,
        mixBlendMode: 'overlay',
        pointerEvents: 'none',
      }}
    />
  );
};

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: 'radial-gradient(62% 50% at 50% 45%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.62) 100%)',
      pointerEvents: 'none',
    }}
  />
);

const FadeIn: React.FC<{ children: React.ReactNode; delay?: number; dy?: number }> = ({ children, delay = 0, dy = 28 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(frame - delay, [0, 14], [dy, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ opacity: o, transform: `translateY(${y}px)` }}>{children}</div>;
};

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = GOLD }) => (
  <div style={{ fontSize: 30, color, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: 8, marginBottom: 44, ...(color === RED ? redGlow(18, 0.4) : goldGlow(18, 0.4)) }}>
    {children}
  </div>
);

// Alex's actual logo — exact paths, gold gradient + glow from ascendral-logo.svg
const LogoFull: React.FC<{ width?: number }> = ({ width = 460 }) => (
  <svg width={width} height={width} viewBox="0 0 460 460" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hcGold" x1="160" y1="145" x2="305" y2="305" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fff2a8" />
        <stop offset="25%" stopColor="#ffd05d" />
        <stop offset="58%" stopColor="#f4a93d" />
        <stop offset="100%" stopColor="#fff1a0" />
      </linearGradient>
      <filter id="hcSoft" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5" result="b1" />
        <feColorMatrix in="b1" type="matrix" values="1 0 0 0 1  0 1 0 0 0.66  0 0 1 0 0.18  0 0 0 1 0" result="gb" />
        <feMerge><feMergeNode in="gb" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="hcText" x="-35%" y="-70%" width="170%" height="240%">
        <feGaussianBlur stdDeviation="1.8" result="bt" />
        <feColorMatrix in="bt" type="matrix" values="1 0 0 0 1  0 1 0 0 0.72  0 0 1 0 0.25  0 0 0 .85 0" result="gt" />
        <feMerge><feMergeNode in="gt" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    <g filter="url(#hcSoft)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M177 235 L229 146 L282 235 L248 218 L229 181 L210 218 Z" fill="none" stroke="url(#hcGold)" strokeWidth="4.4" />
      <path d="M219 216 L250 201" fill="none" stroke="url(#hcGold)" strokeWidth="4.4" />
      <path d="M211 231 L257 209" fill="none" stroke="url(#hcGold)" strokeWidth="4.4" />
      <path d="M203 247 L264 218" fill="none" stroke="url(#hcGold)" strokeWidth="4.4" />
    </g>
    <g filter="url(#hcText)" fill="#ffe38a" textAnchor="middle">
      <text x="230" y="291" fontFamily="Montserrat, Avenir Next, Arial, sans-serif" fontSize="31" fontWeight="800" letterSpacing="2.4">ASCENDRAL</text>
      <text x="230" y="305" fontFamily="Montserrat, Avenir Next, Arial, sans-serif" fontSize="7.4" fontWeight="700" letterSpacing="1.25">SOFTWARE DEVELOPMENT &amp; INNOVATION</text>
    </g>
  </svg>
);

const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ ...GLOW_BG, justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <div style={{ textAlign: 'center', transform: `scale(${scale})` }}>
        <Eyebrow>Tamper-evident logging</Eyebrow>
        <div style={{ fontSize: 96, fontWeight: 800, color: WHITE, fontFamily: SANS, lineHeight: 1.08, letterSpacing: -2 }}>
          Your agent's log
        </div>
        <FadeIn delay={18}>
          <div style={{ fontSize: 96, fontWeight: 800, color: RED, fontFamily: SANS, lineHeight: 1.08, letterSpacing: -2, ...redGlow(40, 0.5) }}>
            can be edited.
          </div>
        </FadeIn>
        <FadeIn delay={42}>
          <div style={{ fontSize: 38, color: DIM, fontFamily: SANS, marginTop: 40 }}>Unless every line is chained.</div>
        </FadeIn>
      </div>
    </AbsoluteFill>
  );
};

const LogScene: React.FC = () => {
  const rows = [
    ['[seq 1]', 'read_file', 'execute'],
    ['[seq 2]', 'shell', 'execute'],
    ['[seq 3]', 'write_file', 'execute'],
  ];
  return (
    <AbsoluteFill style={{ ...GLOW_BG, justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <FadeIn><Eyebrow>The agent writes a log</Eyebrow></FadeIn>
      <FadeIn delay={8}>
        <div style={{ width: 840, background: '#000', border: `1px solid ${STROKE}`, borderRadius: 10, padding: '40px 46px', fontFamily: MONO }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 30 }}>
            <div style={{ width: 18, height: 18, borderRadius: 999, background: '#2a2418' }} />
            <div style={{ width: 18, height: 18, borderRadius: 999, background: '#2a2418' }} />
            <div style={{ width: 18, height: 18, borderRadius: 999, background: '#2a2418' }} />
            <div style={{ marginLeft: 16, color: DIM, fontSize: 28 }}>~/.codebot/audit/audit.jsonl</div>
          </div>
          {rows.map((r, i) => (
            <FadeIn key={i} delay={20 + i * 16} dy={12}>
              <div style={{ fontSize: 36, lineHeight: 2, color: WHITE }}>
                <span style={{ color: DIM }}>{r[0]}</span> {r[1]} <span style={{ color: DIM }}>{r[2]}</span>
              </div>
            </FadeIn>
          ))}
        </div>
      </FadeIn>
      <FadeIn delay={70}>
        <div style={{ fontSize: 34, color: DIM, fontFamily: MONO, marginTop: 50 }}>append-only on disk is a convention.</div>
      </FadeIn>
    </AbsoluteFill>
  );
};

const Block: React.FC<{ seq: string; line: string; broken?: boolean }> = ({ seq, line, broken }) => (
  <div
    style={{
      width: 760,
      background: PANEL,
      border: `2px solid ${broken ? RED : STROKE}`,
      borderRadius: 8,
      padding: '34px 40px',
      fontFamily: MONO,
      boxShadow: broken ? '0 0 50px rgba(226,86,74,0.16)' : '0 0 50px rgba(244,169,61,0.07)',
    }}
  >
    <div style={{ fontSize: 28, color: DIM, marginBottom: 12 }}>{seq}</div>
    <div style={{ fontSize: 52, fontWeight: 700, color: broken ? RED : GOLD, ...(broken ? redGlow(26, 0.45) : goldGlow(26, 0.4)) }}>{line}</div>
  </div>
);

const Connector: React.FC<{ label: string; broken?: boolean }> = ({ label, broken }) => (
  <div style={{ width: 760, display: 'flex', alignItems: 'center', height: 90 }}>
    <div style={{ width: 0, height: 90, marginLeft: 40, borderLeft: `2px ${broken ? 'dashed' : 'solid'} ${broken ? RED : FAINT}` }} />
    <div style={{ fontSize: 28, color: broken ? RED : DIM, fontFamily: MONO, marginLeft: 36 }}>{label}</div>
  </div>
);

const ChainScene: React.FC<{ broken?: boolean }> = ({ broken }) => (
  <AbsoluteFill style={{ ...GLOW_BG, justifyContent: 'center', alignItems: 'center', padding: 80 }}>
    <FadeIn>
      <Eyebrow color={broken ? RED : GOLD}>{broken ? 'Someone edits seq 2' : 'Every entry chains to the last'}</Eyebrow>
    </FadeIn>
    <FadeIn delay={6}><Block seq="seq 1" line="hash a91f3e" /></FadeIn>
    <FadeIn delay={broken ? 6 : 22} dy={0}><Connector label="prevHash a91f3e" /></FadeIn>
    <FadeIn delay={broken ? 10 : 34}><Block seq="seq 2" line={broken ? 'tool: TAMPERED' : 'hash 7c02d9'} broken={broken} /></FadeIn>
    <FadeIn delay={broken ? 14 : 50} dy={0}><Connector label={broken ? 'prevHash mismatch' : 'prevHash 7c02d9'} broken={broken} /></FadeIn>
    <FadeIn delay={broken ? 18 : 62}><Block seq="seq 3" line={broken ? 'chain broken' : 'hash 9d551b'} broken={broken} /></FadeIn>
    <FadeIn delay={broken ? 26 : 80}>
      <div style={{ fontSize: 34, color: broken ? WHITE : GOLD, fontFamily: MONO, marginTop: 46, textAlign: 'center', ...(broken ? {} : goldGlow(22, 0.4)) }}>
        {broken ? 'change one block — every hash after it breaks.' : 'hash = sha256(prevHash + entry)'}
      </div>
    </FadeIn>
  </AbsoluteFill>
);

const VerifyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const blink = Math.floor(frame / 15) % 2 === 0;
  const lines: [string, string, string][] = [
    ['$', 'codebot audit --verify', ''],
    ['→', 'valid: ', 'false'],
    ['→', 'firstInvalidAt: ', '2'],
    ['→', 'reason: ', 'hash mismatch'],
  ];
  return (
    <AbsoluteFill style={{ ...GLOW_BG, justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <FadeIn><Eyebrow>The verifier walks the chain</Eyebrow></FadeIn>
      <FadeIn delay={8}>
        <div style={{ width: 860, background: '#000', border: `1px solid ${STROKE}`, borderRadius: 10, padding: '44px 48px', fontFamily: MONO }}>
          {lines.map((l, i) => (
            <FadeIn key={i} delay={16 + i * 14} dy={10}>
              <div style={{ fontSize: 40, lineHeight: 2, color: WHITE }}>
                <span style={{ color: i === 0 ? GOLD : DIM }}>{l[0]}</span> {l[1]}
                <span style={{ color: i === 1 ? RED : WHITE }}>{l[2]}</span>
              </div>
            </FadeIn>
          ))}
          <FadeIn delay={80} dy={0}><div style={{ fontSize: 40, color: GOLD, marginTop: 6 }}>$ {blink ? '_' : ' '}</div></FadeIn>
        </div>
      </FadeIn>
      <FadeIn delay={92}>
        <div style={{ fontSize: 34, color: DIM, fontFamily: MONO, marginTop: 50, textAlign: 'center' }}>
          it catches the edit. <span style={{ color: GOLD }}>shipped in CodeBot v1.7.0</span>
        </div>
      </FadeIn>
    </AbsoluteFill>
  );
};

const HonestScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ ...GLOW_BG, justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <div style={{ textAlign: 'center', transform: `scale(${scale})` }}>
        <div style={{ fontSize: 92, fontWeight: 800, color: GOLD, fontFamily: SANS, letterSpacing: -2, ...goldGlow(38, 0.5) }}>Tamper-evident.</div>
        <FadeIn delay={16}>
          <div style={{ fontSize: 92, fontWeight: 800, color: DIM, fontFamily: SANS, letterSpacing: -2 }}>Not tamper-proof.</div>
        </FadeIn>
        <FadeIn delay={40}>
          <div style={{ fontSize: 34, color: DIM, fontFamily: MONO, marginTop: 44, lineHeight: 1.5 }}>
            rebuild the whole file and the chain is valid again.
            <br />
            that is the boundary. the next build seals it.
          </div>
        </FadeIn>
      </div>
    </AbsoluteFill>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ ...GLOW_BG, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', transform: `scale(${scale})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <LogoFull width={460} />
        <FadeIn delay={20}>
          <div style={{ fontSize: 30, color: DIM, fontFamily: MONO, letterSpacing: 4, marginTop: 8 }}>notes from the build</div>
        </FadeIn>
        <FadeIn delay={32}>
          <div style={{ fontSize: 34, color: GOLD_PALE, fontFamily: MONO, letterSpacing: 4 }}>@AscendralHQ</div>
        </FadeIn>
      </div>
    </AbsoluteFill>
  );
};

const Soundtrack: React.FC = () => {
  const frame = useCurrentFrame();
  const vol = interpolate(frame, [0, 20, 1110, 1170], [0, 0.55, 0.55, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <Audio src={staticFile('bgm.mp3')} volume={vol} />;
};

export const HashChainShort: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <Soundtrack />
    <Sequence from={0} durationInFrames={110}><HookScene /></Sequence>
    <Sequence from={110} durationInFrames={160}><LogScene /></Sequence>
    <Sequence from={270} durationInFrames={220}><ChainScene /></Sequence>
    <Sequence from={490} durationInFrames={220}><ChainScene broken /></Sequence>
    <Sequence from={710} durationInFrames={200}><VerifyScene /></Sequence>
    <Sequence from={910} durationInFrames={120}><HonestScene /></Sequence>
    <Sequence from={1030} durationInFrames={140}><OutroScene /></Sequence>
    <Vignette />
    <Grain />
  </AbsoluteFill>
);
