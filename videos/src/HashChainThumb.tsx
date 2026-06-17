import React from 'react';
import { AbsoluteFill } from 'remotion';

const GOLD = '#f4a93d';
const GOLD_PALE = '#ffe38a';
const WHITE = '#ffffff';
const DIM = '#8a8170';
const RED = '#e2564a';
const PANEL = '#0c0a06';
const STROKE = '#2a2418';
const FAINT = '#3a342a';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const SANS = 'system-ui, "Avenir Next", Helvetica, Arial, sans-serif';

const GLOW_BG: React.CSSProperties = {
  background: 'radial-gradient(46% 60% at 38% 50%, rgba(74,50,21,0.40), rgba(33,20,7,0.13) 52%, #000000 100%)',
  backgroundColor: '#000000',
};

const Grain: React.FC = () => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='4'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return <AbsoluteFill style={{ backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`, backgroundSize: '640px 360px', opacity: 0.09, mixBlendMode: 'overlay' }} />;
};
const Vignette: React.FC = () => (
  <AbsoluteFill style={{ background: 'radial-gradient(70% 64% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.66) 100%)' }} />
);

const Mark: React.FC<{ w?: number }> = ({ w = 64 }) => (
  <svg width={w} height={w} viewBox="0 0 460 460">
    <defs>
      <linearGradient id="tg" x1="160" y1="145" x2="305" y2="305" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fff2a8" /><stop offset="25%" stopColor="#ffd05d" /><stop offset="58%" stopColor="#f4a93d" /><stop offset="100%" stopColor="#fff1a0" />
      </linearGradient>
    </defs>
    <g stroke="url(#tg)" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M177 235 L229 146 L282 235 L248 218 L229 181 L210 218 Z" />
      <path d="M219 216 L250 201" /><path d="M211 231 L257 209" /><path d="M203 247 L264 218" />
    </g>
  </svg>
);

const MiniBlock: React.FC<{ seq: string; line: string; broken?: boolean }> = ({ seq, line, broken }) => (
  <div style={{ width: 420, background: PANEL, border: `2px solid ${broken ? RED : STROKE}`, borderRadius: 8, padding: '20px 26px', fontFamily: MONO, boxShadow: broken ? '0 0 46px rgba(226,86,74,0.22)' : '0 0 46px rgba(244,169,61,0.08)' }}>
    <div style={{ fontSize: 22, color: DIM, marginBottom: 6 }}>{seq}</div>
    <div style={{ fontSize: 38, fontWeight: 700, color: broken ? RED : GOLD, textShadow: broken ? '0 0 22px rgba(226,86,74,0.5)' : '0 0 22px rgba(244,169,61,0.45)' }}>{line}</div>
  </div>
);

const Conn: React.FC<{ broken?: boolean }> = ({ broken }) => (
  <div style={{ width: 420, display: 'flex', height: 46, alignItems: 'center' }}>
    <div style={{ width: 0, height: 46, marginLeft: 34, borderLeft: `2px ${broken ? 'dashed' : 'solid'} ${broken ? RED : FAINT}` }} />
  </div>
);

export const HashChainThumb: React.FC = () => (
  <AbsoluteFill style={{ ...GLOW_BG, fontFamily: SANS }}>
    <div style={{ position: 'absolute', top: 44, left: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
      <Mark w={58} />
      <span style={{ fontFamily: MONO, fontSize: 24, letterSpacing: 6, color: GOLD_PALE }}>ASCENDRAL</span>
    </div>

    <div style={{ position: 'absolute', left: 60, top: 0, bottom: 0, width: 660, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 26, letterSpacing: 6, color: GOLD, textTransform: 'uppercase', marginBottom: 26, textShadow: '0 0 18px rgba(244,169,61,0.4)' }}>
        Codebot · audit
      </div>
      <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, color: WHITE }}>Your AI's</div>
      <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, color: WHITE }}>logs can be</div>
      <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2, color: RED, textShadow: '0 0 40px rgba(226,86,74,0.5)' }}>edited.</div>
      <div style={{ fontFamily: MONO, fontSize: 32, color: GOLD, marginTop: 30, textShadow: '0 0 20px rgba(244,169,61,0.4)' }}>the hash-chain fix →</div>
    </div>

    <div style={{ position: 'absolute', right: 70, top: 0, bottom: 0, width: 440, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
      <MiniBlock seq="seq 1" line="hash a91f3e" />
      <Conn />
      <MiniBlock seq="seq 2" line="tool: TAMPERED" broken />
      <Conn broken />
      <MiniBlock seq="seq 3" line="chain broken" broken />
    </div>

    <Vignette />
    <Grain />
  </AbsoluteFill>
);
