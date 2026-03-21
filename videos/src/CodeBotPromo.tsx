import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";

const CYAN = "#00d4ff";
const BG = "#0a0a0f";
const WHITE = "#ffffff";
const DIM = "#666677";
const GREEN = "#22c55e";

const FadeIn: React.FC<{ children: React.ReactNode; delay?: number }> = ({
  children,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame - delay, [0, 15], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `translateY(${y}px)` }}>{children}</div>
  );
};

// Scene 1: Logo + Title
const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12 } });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${scale})` }}>
        <div
          style={{
            fontSize: 120,
            fontWeight: 900,
            fontFamily: "system-ui",
            color: WHITE,
            letterSpacing: -3,
          }}
        >
          Code<span style={{ color: CYAN }}>Bot</span> AI
        </div>
        <FadeIn delay={20}>
          <div
            style={{
              fontSize: 36,
              color: DIM,
              fontFamily: "system-ui",
              marginTop: 20,
            }}
          >
            The Governed Autonomous Coding Agent
          </div>
        </FadeIn>
        <FadeIn delay={40}>
          <div
            style={{
              fontSize: 22,
              color: CYAN,
              fontFamily: "system-ui",
              marginTop: 30,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            by Ascendral
          </div>
        </FadeIn>
      </div>
    </AbsoluteFill>
  );
};

// Scene 2: The Problem
const ProblemScene: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: BG,
        justifyContent: "center",
        alignItems: "center",
        padding: 120,
      }}
    >
      <FadeIn>
        <div
          style={{
            fontSize: 28,
            color: CYAN,
            fontFamily: "system-ui",
            textTransform: "uppercase",
            letterSpacing: 6,
            marginBottom: 40,
          }}
        >
          The Problem
        </div>
      </FadeIn>
      <FadeIn delay={15}>
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            color: WHITE,
            fontFamily: "system-ui",
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          AI coding tools are either{" "}
          <span style={{ color: "#ff4444" }}>autonomous but ungoverned</span>
          <br />
          or{" "}
          <span style={{ color: "#ffaa00" }}>governed but not autonomous</span>
        </div>
      </FadeIn>
      <FadeIn delay={40}>
        <div
          style={{
            display: "flex",
            gap: 60,
            marginTop: 60,
          }}
        >
          <div
            style={{
              padding: "30px 50px",
              border: "2px solid #ff4444",
              borderRadius: 16,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, color: "#ff4444", fontWeight: 700, fontFamily: "system-ui" }}>
              Devin
            </div>
            <div style={{ fontSize: 18, color: DIM, marginTop: 8, fontFamily: "system-ui" }}>
              Black box · $500/mo · Code leaves your machine
            </div>
          </div>
          <div
            style={{
              padding: "30px 50px",
              border: "2px solid #ffaa00",
              borderRadius: 16,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, color: "#ffaa00", fontWeight: 700, fontFamily: "system-ui" }}>
              Cursor / Copilot
            </div>
            <div style={{ fontSize: 18, color: DIM, marginTop: 8, fontFamily: "system-ui" }}>
              You still drive · Just autocomplete · No audit trail
            </div>
          </div>
        </div>
      </FadeIn>
    </AbsoluteFill>
  );
};

// Scene 3: The Solution (terminal)
const SolutionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = "codebot --solve github.com/acme/api/issues/42";
  const charsVisible = Math.min(frame - 10, cmd.length);

  return (
    <AbsoluteFill
      style={{
        background: BG,
        justifyContent: "center",
        alignItems: "center",
        padding: 120,
      }}
    >
      <FadeIn>
        <div
          style={{
            fontSize: 28,
            color: CYAN,
            fontFamily: "system-ui",
            textTransform: "uppercase",
            letterSpacing: 6,
            marginBottom: 40,
          }}
        >
          The Solution
        </div>
      </FadeIn>
      <div
        style={{
          background: "#111118",
          borderRadius: 16,
          padding: 50,
          width: 1200,
          border: `1px solid #222233`,
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#ffbd2e" }} />
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 28 }}>
          <span style={{ color: GREEN }}>$</span>{" "}
          <span style={{ color: WHITE }}>
            {charsVisible > 0 ? cmd.slice(0, charsVisible) : ""}
          </span>
          {frame % 30 < 15 && (
            <span style={{ color: CYAN, fontWeight: 700 }}>▋</span>
          )}
        </div>

        {frame > 70 && (
          <FadeIn delay={70}>
            <div style={{ marginTop: 30, fontFamily: "monospace", fontSize: 22 }}>
              {[
                { label: "Parsing issue...", color: CYAN, delay: 0 },
                { label: "Cloning repo...", color: CYAN, delay: 8 },
                { label: "Analyzing codebase...", color: CYAN, delay: 16 },
                { label: "Generating fix...", color: CYAN, delay: 24 },
                { label: "Running tests... PASSED", color: GREEN, delay: 32 },
                { label: "Self-review: APPROVE", color: GREEN, delay: 40 },
                { label: "PR #42 opened ✓", color: GREEN, delay: 48 },
              ].map((line, i) =>
                frame > 70 + line.delay ? (
                  <div key={i} style={{ color: line.color, marginBottom: 6, opacity: interpolate(frame - 70 - line.delay, [0, 8], [0, 1], { extrapolateRight: "clamp" }) }}>
                    {"  >"} {line.label}
                  </div>
                ) : null
              )}
            </div>
          </FadeIn>
        )}
      </div>
    </AbsoluteFill>
  );
};

// Scene 4: Features
const FeaturesScene: React.FC = () => {
  const features = [
    { icon: "🛡️", title: "Constitutional Safety", desc: "Every action risk-scored by CORD" },
    { icon: "📋", title: "Full Audit Trail", desc: "Every decision logged to JSON" },
    { icon: "💻", title: "Runs Locally", desc: "Code never leaves your machine" },
    { icon: "🔍", title: "Self-Review", desc: "Agent reviews its own diff" },
    { icon: "🔧", title: "32 Tools", desc: "Git, web, Docker, SSH, and more" },
    { icon: "🤖", title: "Multi-LLM", desc: "Claude, GPT, or local models" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: BG,
        justifyContent: "center",
        alignItems: "center",
        padding: 100,
      }}
    >
      <FadeIn>
        <div
          style={{
            fontSize: 28,
            color: CYAN,
            fontFamily: "system-ui",
            textTransform: "uppercase",
            letterSpacing: 6,
            marginBottom: 50,
            textAlign: "center",
          }}
        >
          Built Different
        </div>
      </FadeIn>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 30,
          justifyContent: "center",
          maxWidth: 1400,
        }}
      >
        {features.map((f, i) => (
          <FadeIn key={i} delay={10 + i * 10}>
            <div
              style={{
                background: "#111118",
                border: "1px solid #222233",
                borderRadius: 16,
                padding: "35px 40px",
                width: 380,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 42, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: WHITE, fontFamily: "system-ui" }}>
                {f.title}
              </div>
              <div style={{ fontSize: 18, color: DIM, marginTop: 8, fontFamily: "system-ui" }}>
                {f.desc}
              </div>
            </div>
          </FadeIn>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// Scene 5: CTA
const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const glowOpacity = interpolate(Math.sin(frame / 15), [-1, 1], [0.3, 0.8]);

  return (
    <AbsoluteFill
      style={{
        background: BG,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${scale})` }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: WHITE,
            fontFamily: "system-ui",
            letterSpacing: -2,
          }}
        >
          Code<span style={{ color: CYAN }}>Bot</span> AI
        </div>
        <FadeIn delay={15}>
          <div
            style={{
              fontSize: 32,
              color: WHITE,
              fontFamily: "system-ui",
              marginTop: 30,
            }}
          >
            Autonomous coding. Governed execution.
          </div>
        </FadeIn>
        <FadeIn delay={30}>
          <div
            style={{
              marginTop: 40,
              padding: "18px 50px",
              background: CYAN,
              color: BG,
              fontSize: 28,
              fontWeight: 800,
              borderRadius: 12,
              fontFamily: "system-ui",
              display: "inline-block",
              boxShadow: `0 0 40px ${CYAN}${Math.round(glowOpacity * 255).toString(16).padStart(2, "0")}`,
            }}
          >
            ascendral.github.io/codebot-ai
          </div>
        </FadeIn>
        <FadeIn delay={45}>
          <div
            style={{
              fontSize: 22,
              color: DIM,
              fontFamily: "system-ui",
              marginTop: 30,
            }}
          >
            Open Source · @alexpinkone · github.com/Ascendral/codebot-ai
          </div>
        </FadeIn>
      </div>
    </AbsoluteFill>
  );
};

// Main composition
export const CodeBotPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Sequence from={0} durationInFrames={150}>
        <TitleScene />
      </Sequence>
      <Sequence from={150} durationInFrames={210}>
        <ProblemScene />
      </Sequence>
      <Sequence from={360} durationInFrames={270}>
        <SolutionScene />
      </Sequence>
      <Sequence from={630} durationInFrames={210}>
        <FeaturesScene />
      </Sequence>
      <Sequence from={840} durationInFrames={510}>
        <CTAScene />
      </Sequence>
    </AbsoluteFill>
  );
};
