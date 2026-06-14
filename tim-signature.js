/* ====================================================================
   tim-signature.js
   --------------------------------------------------------------------
   Drop-in CRT power-outage reveal.
   Clicking any element marked with [data-tim-signature] triggers:
     1. Flicker  — body flickers like a failing power supply
     2. Flash    — single bright frame
     3. Implode  — content collapses to a bright horizontal line, then
                   that line collapses to a single white-hot dot
     4. Hold     — dot lingers and pulses
     5. Reveal   — dot expands into a screen showing the signature +
                   email + return prompt
     6. Restore  — clicking returns the page (power back on, with a
                   final settling flicker)

   USAGE
     <a data-tim-signature
        data-email="you@example.com"
        data-name="Tim"
        data-signature="/path/to/signature.png"
        href="mailto:you@example.com">
       <img src="/path/to/signature.png" alt="Web design by Tim">
     </a>

     <script src="tim-signature.js"></script>

   OR imperatively:
     TimSignature.play({ email, signature, name, sound });

   Configurable per-trigger via:
     data-email     ........... email address (required for the reveal)
     data-signature ........... path to signature image (optional)
     data-name      ........... text fallback if no signature image
     data-sound     ........... "false" to mute
     data-intensity ........... "subtle" | "standard" | "brutal"

   The script:
     · is dependency-free (vanilla JS, ~10kb minified)
     · respects prefers-reduced-motion
     · binds late (and re-binds on TimSignature.attachAll())
     · doesn't leak DOM or style state — full restore on close
   ==================================================================== */
(function (global) {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────
     Styles — injected once on first play
     ────────────────────────────────────────────────────────────────── */
  const STYLE_ID = 'tim-signature-styles';
  const CSS = `
@keyframes tim-sig-flicker-subtle {
  0%,100% { filter:none; opacity:1; transform:none }
  6%   { filter:brightness(.3); }
  10%  { filter:brightness(1.1); }
  22%  { filter:brightness(.15); }
  25%  { filter:brightness(1); }
  48%  { filter:brightness(.05); }
  51%  { filter:brightness(1); }
  78%  { filter:brightness(0); opacity:.4 }
  82%  { filter:brightness(1.2); opacity:1 }
}
@keyframes tim-sig-flicker-standard {
  0%,100% { filter:none; opacity:1; transform:none }
  4%   { filter:brightness(.08); }
  6%   { filter:brightness(1.2); transform:translateX(-2px) }
  10%  { filter:brightness(.04); }
  12%  { filter:brightness(.9); transform:none }
  18%  { filter:brightness(.05) contrast(.6); }
  21%  { filter:brightness(1); }
  35%  { filter:brightness(0); opacity:.5 }
  37%  { filter:brightness(1.6); opacity:1; transform:translateY(1px) }
  42%  { filter:brightness(.9); transform:none }
  60%  { filter:brightness(.02); }
  64%  { filter:brightness(1); }
  72%  { filter:brightness(0); opacity:0 }
  76%  { filter:brightness(1.7); opacity:1 }
  86%  { filter:brightness(.4); }
  92%  { filter:brightness(0); opacity:0 }
  95%  { filter:brightness(2.2); opacity:1 }
}
@keyframes tim-sig-flicker-brutal {
  0%,100% { filter:none; opacity:1; transform:none }
  3%   { filter:brightness(0); opacity:0 }
  5%   { filter:brightness(2); opacity:1; transform:translateX(-3px) translateY(1px) }
  8%   { filter:brightness(0); opacity:0 }
  11%  { filter:brightness(.05) hue-rotate(20deg); opacity:1 }
  18%  { filter:brightness(1.4); transform:none }
  22%  { filter:brightness(0); opacity:0 }
  25%  { filter:brightness(1); opacity:1 }
  36%  { filter:brightness(.02) saturate(.2); }
  40%  { filter:brightness(2); transform:translateX(2px) }
  46%  { filter:brightness(0); opacity:0 }
  50%  { filter:brightness(.7); opacity:1; transform:none }
  62%  { filter:brightness(0); opacity:0 }
  66%  { filter:brightness(1.8); opacity:1 }
  72%  { filter:brightness(.05) contrast(2); transform:translateY(-1px) }
  78%  { filter:brightness(0); opacity:0 }
  82%  { filter:brightness(2.4); opacity:1; transform:none }
  90%  { filter:brightness(.3); }
  94%  { filter:brightness(0); opacity:0 }
  97%  { filter:brightness(2.6); opacity:1 }
}
.tim-sig-flick-subtle   { animation: tim-sig-flicker-subtle 800ms steps(34,end) forwards;
  will-change: filter, opacity, transform; }
.tim-sig-flick-standard { animation: tim-sig-flicker-standard 800ms steps(34,end) forwards;
  will-change: filter, opacity, transform; }
.tim-sig-flick-brutal   { animation: tim-sig-flicker-brutal 1000ms steps(40,end) forwards;
  will-change: filter, opacity, transform; }

/* The wrapper that collapses CRT-style. Whatever is inside (body content
   or a snapshot) gets the scale animation. */
.tim-sig-vcollapse {
  animation: tim-sig-vcollapse 140ms cubic-bezier(.6,0,.85,.15) forwards;
}
@keyframes tim-sig-vcollapse {
  0%   { transform: scaleY(1); filter:brightness(1.4); }
  60%  { filter:brightness(2); }
  100% { transform: scaleY(.0028); filter:brightness(3); }
}
.tim-sig-hcollapse {
  animation: tim-sig-hcollapse 80ms cubic-bezier(.7,0,.95,.1) forwards;
}
@keyframes tim-sig-hcollapse {
  0%   { transform: scaleY(.0028) scaleX(1); filter:brightness(3); opacity:1 }
  100% { transform: scaleY(.0028) scaleX(0); filter:brightness(4); opacity:0 }
}

/* Pure black bg behind everything */
.tim-sig-overlay {
  position: fixed; inset: 0;
  background: #000;
  z-index: 2147483640;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 50ms ease;
}
.tim-sig-overlay.show { opacity: 1; }

/* The brief white "discharge" flash between flicker and implosion */
.tim-sig-flash {
  position: fixed; inset: 0;
  background: #fff;
  z-index: 2147483641;
  pointer-events: none;
  opacity: 0;
}

/* Bright horizontal scanline that appears at the moment of vertical collapse */
.tim-sig-line {
  position: fixed; left: 0; right: 0; top: 50%;
  height: 2px;
  transform: translateY(-50%) scaleX(1);
  transform-origin: 50% 50%;
  background: #fff;
  box-shadow:
    0 0 8px 1px rgba(255,255,255,.95),
    0 0 22px 4px rgba(255,255,255,.7),
    0 0 60px 10px rgba(255,255,255,.35);
  z-index: 2147483645;
  pointer-events: none;
  opacity: 0;
  transition: transform 80ms cubic-bezier(.7,0,.95,.1), opacity 80ms ease;
}

/* The hot dot at center — what remains after the line implodes */
.tim-sig-dot {
  position: fixed; left: 50%; top: 50%;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #52d4cc;
  box-shadow:
    0 0 16px 4px rgba(82,212,204,1),
    0 0 56px 12px rgba(82,212,204,.85),
    0 0 160px 44px rgba(82,212,204,.35),
    0 0 440px 120px rgba(82,212,204,.12);
  transform: translate(-50%,-50%) scale(1);
  z-index: 2147483646;
  pointer-events: none;
  opacity: 0;
}
@keyframes tim-sig-dot-pulse {
  0%,100% { transform: translate(-50%,-50%) scale(1) }
  50%     { transform: translate(-50%,-50%) scale(.7) }
}
.tim-sig-dot.pulse { animation: tim-sig-dot-pulse 1.2s ease-in-out infinite; }

/* The reveal card */
.tim-sig-card {
  position: fixed; left: 50%; top: 50%;
  transform: translate(-50%,-50%);
  z-index: 2147483647;
  text-align: center;
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  color: #fff;
  padding: 24px 32px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 600ms ease;
  max-width: min(92vw, 720px);
  width: max-content;
}
.tim-sig-card.show { opacity: 1; pointer-events: auto; }

.tim-sig-eyebrow {
  font-size: 11px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: rgba(255,255,255,.45);
  margin-bottom: 12px;
}
.tim-sig-eyebrow span { color: #fff; }

.tim-sig-signature-img {
  display: block;
  margin: 0 auto 8px;
  width: clamp(180px, 28vw, 280px);
  height: auto;
  filter: drop-shadow(0 0 18px rgba(82,212,204,.5));
}
.tim-sig-signature-text {
  font-family: "Caveat", "Permanent Marker", cursive;
  font-size: clamp(52px, 9vw, 96px);
  line-height: 1;
  color: #52d4cc;
  text-shadow: 0 0 20px rgba(82,212,204,.6);
  margin-bottom: 4px;
}

.tim-sig-rule {
  width: 84px; height: 1px;
  background: rgba(255,255,255,.18);
  margin: 22px auto 22px;
}

.tim-sig-prelabel {
  font-size: 10px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: rgba(255,255,255,.4);
  margin-bottom: 10px;
}

.tim-sig-email {
  display: inline-block;
  font-size: clamp(26px, 5.5vw, 46px);
  font-weight: 400;
  color: #fff;
  text-decoration: none;
  padding: 10px 0;
  position: relative;
  letter-spacing: 0.01em;
  border-bottom: 1px solid rgba(255,255,255,.25);
  transition: color .2s, border-color .2s, font-size .18s cubic-bezier(.4,0,.2,1);
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
}
/* CTA / copied states — smaller font, same locked width */
.tim-sig-email.is-cta {
  font-size: clamp(15px, 3vw, 22px);
  letter-spacing: 0.04em;
  font-weight: 500;
  white-space: normal;
  line-height: 1.35;
}
.tim-sig-email::before {
  content: "❯ ";
  color: #52d4cc;
  margin-right: 6px;
  display: inline-block;
  animation: tim-sig-blink 1.05s steps(1) infinite;
}
@keyframes tim-sig-blink {
  0%,49% { opacity: 1 }
  50%,100% { opacity: 0 }
}
.tim-sig-email:hover { color: #fff; border-color: #52d4cc; }
.tim-sig-email.is-copied { color: #fff; border-color: #52d4cc; }

/* The momentary digital shimmer that fires on every state transition */
@keyframes tim-sig-glitch {
  0%   { text-shadow: 0 0 0 transparent; transform: translateX(0) skewX(0); filter: none; }
  10%  { text-shadow: -1.5px 0 #ff3b6b, 1.5px 0 #52d4cc; transform: translateX(-1px) skewX(-1deg); filter: brightness(1.5); }
  22%  { text-shadow:  2.5px 0 #ff3b6b, -2.5px 0 #52d4cc; transform: translateX(1px) skewX(1.2deg); }
  34%  { text-shadow: -1px 1px #ff3b6b, 1px -1px #52d4cc; transform: translateX(-1px); }
  48%  { text-shadow:  1.5px 0 #ff3b6b, -1.5px 0 #52d4cc; transform: translateX(.5px) skewX(-.5deg); }
  64%  { text-shadow: -.5px 0 #ff3b6b, .5px 0 #52d4cc; transform: none; filter: brightness(1.15); }
  100% { text-shadow: 0 0 0 transparent; transform: none; filter: none; }
}
.tim-sig-glitch { animation: tim-sig-glitch 450ms ease-out forwards; }

.tim-sig-foot {
  margin-top: 36px;
  display: flex;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255,255,255,.32);
}
.tim-sig-foot kbd {
  font-family: inherit;
  background: rgba(82,212,204,.08);
  border: 1px solid rgba(82,212,204,.45);
  padding: 2px 6px;
  border-radius: 2px;
  margin: 0 4px;
  color: #52d4cc;
  box-shadow:
    0 0 6px rgba(82,212,204,.35),
    0 0 18px rgba(82,212,204,.25),
    inset 0 0 6px rgba(82,212,204,.12);
  text-shadow: 0 0 4px rgba(82,212,204,.6);
}

/* CRT scanline that drifts over the reveal screen */
.tim-sig-scan {
  position: fixed; left: 0; right: 0; top: -120px;
  height: 120px;
  pointer-events: none;
  z-index: 2147483646;
  background: linear-gradient(180deg,
    rgba(255,255,255,0) 0%,
    rgba(255,255,255,.04) 45%,
    rgba(255,255,255,.08) 50%,
    rgba(255,255,255,.04) 55%,
    rgba(255,255,255,0) 100%);
  mix-blend-mode: screen;
  opacity: 0;
  animation: tim-sig-scan-down 4.5s linear infinite;
  transition: opacity .4s ease;
}
.tim-sig-scan.show { opacity: 1; }
@keyframes tim-sig-scan-down {
  0%   { transform: translateY(0) }
  100% { transform: translateY(calc(100vh + 120px)) }
}
/* The static fuzz layer behind the card */
.tim-sig-vignette {
  position: fixed; inset: 0;
  background: radial-gradient(ellipse at center,
              rgba(0,0,0,0) 30%,
              rgba(0,0,0,.65) 80%,
              rgba(0,0,0,.92) 100%);
  pointer-events: none;
  z-index: 2147483643;
  opacity: 0;
  transition: opacity .8s ease;
}
.tim-sig-vignette.show { opacity: 1; }
.tim-sig-grain {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 2147483644;
  opacity: 0;
  transition: opacity .6s ease;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.5'/></svg>");
  background-size: 220px 220px;
  mix-blend-mode: overlay;
}
.tim-sig-grain.show { opacity: .35; }

/* Body lock during effect — prevent scroll, ensure transform-origin centred */
html.tim-sig-active {
  overflow: hidden !important;
  cursor: none !important;
}
html.tim-sig-active body {
  transform-origin: 50% 50%;
}

/* Custom cursor follower */
.tim-sig-cursor {
  position: fixed;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #52d4cc;
  box-shadow:
    0 0 6px 2px rgba(82,212,204,.9),
    0 0 18px 5px rgba(82,212,204,.5),
    0 0 50px 12px rgba(82,212,204,.18);
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 2147483648;
  opacity: 0;
  transition: opacity 300ms ease;
}
.tim-sig-cursor.show { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .tim-sig-flick-subtle, .tim-sig-flick-standard, .tim-sig-flick-brutal,
  .tim-sig-vcollapse, .tim-sig-hcollapse { animation: none !important; }
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ──────────────────────────────────────────────────────────────────
     Audio — small synthesised CRT power-off sound (no asset deps)
     ────────────────────────────────────────────────────────────────── */
  let _ctx;
  function audio() {
    if (_ctx === undefined) {
      try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { _ctx = null; }
    }
    return _ctx;
  }

  async function offSound(ctx) {
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(e) {} }
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.85;
    out.connect(ctx.destination);

    // ── Saturation shaper used to dirty up everything tonal ──
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i / 256) - 1;
      curve[i] = Math.tanh(x * 3.5);   // aggressive saturation
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    // ── 1. STUTTERED MAINS BUZZ — the fuse failing under load ──
    // A 50 Hz sawtooth pushed through saturation + bandpass, then
    // amplitude-gated by tightly spaced random pulses so it sounds
    // like the buzz is being repeatedly cut and re-fired.
    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 50;
    // slight detune-jitter throughout makes it feel unstable
    buzz.frequency.setValueAtTime(50, now);
    buzz.frequency.linearRampToValueAtTime(48, now + 0.4);
    buzz.frequency.linearRampToValueAtTime(52, now + 0.7);

    const buzzFilt = ctx.createBiquadFilter();
    buzzFilt.type = 'bandpass';
    buzzFilt.frequency.value = 900;
    buzzFilt.Q.value = 1.6;

    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0;

    buzz.connect(shaper).connect(buzzFilt).connect(buzzGain).connect(out);

    // Schedule stutter envelope
    let t = now;
    while (t < now + 0.82) {
      const onLen  = 0.012 + Math.random() * 0.045;
      const offLen = 0.008 + Math.random() * 0.07;
      const lvl    = 0.06 + Math.random() * 0.10;
      buzzGain.gain.setValueAtTime(0, t);
      buzzGain.gain.linearRampToValueAtTime(lvl, t + 0.003);
      buzzGain.gain.setValueAtTime(lvl, t + onLen);
      buzzGain.gain.linearRampToValueAtTime(0, t + onLen + 0.003);
      t += onLen + offLen;
    }
    buzz.start(now);
    buzz.stop(now + 1.15);

    // ── 2. RANDOM CRACKLE POPS — random sparking arc-like clicks during flicker ──
    const popBuf = ctx.createBuffer(1, ctx.sampleRate * 0.045, ctx.sampleRate);
    const popData = popBuf.getChannelData(0);
    for (let i = 0; i < popData.length; i++) {
      const env = Math.exp(-i / (popData.length * 0.15));
      popData[i] = (Math.random() * 2 - 1) * env;
    }
    const popCount = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < popCount; i++) {
      const pop = ctx.createBufferSource();
      pop.buffer = popBuf;
      pop.playbackRate.value = 0.7 + Math.random() * 0.6;
      const pf = ctx.createBiquadFilter();
      pf.type = 'highpass';
      pf.frequency.value = 1800 + Math.random() * 3500;
      const pg = ctx.createGain();
      pg.gain.value = 0.10 + Math.random() * 0.12;
      pop.connect(pf).connect(pg).connect(out);
      pop.start(now + 0.04 + Math.random() * 0.74);
    }

    // ── 3. BITCRUSHED GLITCH STUTTER — a quick pitched gargle mid-flicker ──
    const glitch = ctx.createOscillator();
    glitch.type = 'square';
    const glitchG = ctx.createGain();
    glitchG.gain.value = 0;
    glitch.frequency.setValueAtTime(620, now + 0.30);
    glitch.frequency.linearRampToValueAtTime(180, now + 0.40);
    glitch.frequency.linearRampToValueAtTime(740, now + 0.46);
    glitch.frequency.linearRampToValueAtTime(220, now + 0.55);
    // pulse the gain rapidly to bit-crush feel
    for (let i = 0; i < 14; i++) {
      const ts = now + 0.30 + i * 0.019;
      glitchG.gain.setValueAtTime(i % 2 === 0 ? 0.10 : 0, ts);
    }
    glitchG.gain.linearRampToValueAtTime(0, now + 0.60);
    glitch.connect(glitchG).connect(out);
    glitch.start(now + 0.30);
    glitch.stop(now + 0.62);

    // ── 4. THE FUSE-BLOW ARC CRACK — hits at the white flash (~820ms) ──
    const arcBuf = ctx.createBuffer(1, ctx.sampleRate * 0.16, ctx.sampleRate);
    const arcData = arcBuf.getChannelData(0);
    for (let i = 0; i < arcData.length; i++) {
      const x = i / arcData.length;
      const env = Math.exp(-x * 6.5);
      // mix of white noise and a fast modulated component for an arcing feel
      arcData[i] = ((Math.random() * 2 - 1) + Math.sin(x * 280)) * 0.45 * env;
    }
    const arc = ctx.createBufferSource();
    arc.buffer = arcBuf;
    const arcFilt = ctx.createBiquadFilter();
    arcFilt.type = 'bandpass';
    arcFilt.frequency.value = 2200;
    arcFilt.Q.value = 0.6;
    const arcG = ctx.createGain();
    arcG.gain.value = 0.38;
    arc.connect(arcFilt).connect(arcG).connect(out);
    arc.start(now + 0.82);

    // ── 5. DESCENDING ZAP — the dying power supply (~860ms) ──
    const zap = ctx.createOscillator();
    zap.type = 'square';
    zap.frequency.setValueAtTime(1400, now + 0.86);
    zap.frequency.exponentialRampToValueAtTime(35, now + 1.04);
    const zapG = ctx.createGain();
    zapG.gain.setValueAtTime(0, now + 0.86);
    zapG.gain.linearRampToValueAtTime(0.14, now + 0.87);
    zapG.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
    zap.connect(shaper).connect(zapG).connect(out);
    zap.start(now + 0.86);
    zap.stop(now + 1.10);

    // ── 6. THE PIXEL CLICK — sharp transient as the dot snaps in (~1.05s) ──
    const click = ctx.createOscillator();
    click.type = 'sine';
    click.frequency.setValueAtTime(4400, now + 1.05);
    click.frequency.exponentialRampToValueAtTime(1600, now + 1.09);
    const clickG = ctx.createGain();
    clickG.gain.setValueAtTime(0, now + 1.05);
    clickG.gain.linearRampToValueAtTime(0.18, now + 1.052);
    clickG.gain.exponentialRampToValueAtTime(0.001, now + 1.10);
    click.connect(clickG).connect(out);
    click.start(now + 1.05);
    click.stop(now + 1.12);

    // ── 7. TAIL HISS — the dot lingering, leaking static ──
    const hissBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const hd = hissBuf.getChannelData(0);
    for (let i = 0; i < hd.length; i++) {
      const env = Math.exp(-i / (hd.length * 0.4));
      hd[i] = (Math.random() * 2 - 1) * env;
    }
    const hiss = ctx.createBufferSource();
    hiss.buffer = hissBuf;
    const hissF = ctx.createBiquadFilter();
    hissF.type = 'highpass';
    hissF.frequency.value = 5000;
    const hissG = ctx.createGain();
    hissG.gain.value = 0.07;
    hiss.connect(hissF).connect(hissG).connect(out);
    hiss.start(now + 1.06);
  }

  async function onSound(ctx) {
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(e) {} }
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Ascending warm-up hum
    const hum = ctx.createOscillator();
    const g = ctx.createGain();
    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(40, now);
    hum.frequency.exponentialRampToValueAtTime(360, now + 0.35);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.09, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    hum.connect(f).connect(g).connect(ctx.destination);
    hum.start(now); hum.stop(now + 0.45);
  }

  /* ──────────────────────────────────────────────────────────────────
     The effect sequence
     ────────────────────────────────────────────────────────────────── */
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  let _busy = false;
  let _state = null;
  let _liveNodes = null;

  // Build the card's inner HTML — shared by measureIDotPrerender and revealCard
  // so both have identical structure and layout.
  function buildCardHTML(opts) {
    const sigBlock = opts.signature
      ? `<img class="tim-sig-signature-img" src="${escapeAttr(opts.signature)}" alt="${escapeAttr(opts.name || 'signature')}">`
      : `<div class="tim-sig-signature-text">${escapeHTML(opts.name || 'Tim')}</div>`;
    return (
      '<div class="tim-sig-eyebrow">/// <span>Web</span> design by</div>' +
      sigBlock +
      '<div class="tim-sig-rule"></div>' +
      '<div class="tim-sig-prelabel">// say hi /</div>' +
      '<div><a class="tim-sig-email" href="mailto:' + escapeAttr(opts.email) + '">' + escapeHTML(opts.email) + '</a></div>' +
      '<div class="tim-sig-foot"><span>click anywhere · power on</span><span><kbd>ESC</kbd> close</span></div>'
    );
  }

  // Pre-render an invisible card to measure where the i-dot will be on screen.
  // The card is centred via its CSS, so the measurement matches the real reveal.
  function measureIDotPrerender(opts) {
    return new Promise(function (resolve) {
      if (!opts.signature) { resolve(null); return; }
      const html = document.documentElement;
      const probe = el('div', 'tim-sig-card');
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      probe.innerHTML = buildCardHTML(opts);
      html.appendChild(probe);
      const img = probe.querySelector('.tim-sig-signature-img');
      function measure() {
        const r = img.getBoundingClientRect();
        probe.remove();
        if (!r || r.width === 0) { resolve(null); return; }
        resolve({ x: r.left + r.width * I_DOT_X, y: r.top + r.height * I_DOT_Y });
      }
      if (img && img.complete && img.naturalWidth > 0) {
        requestAnimationFrame(measure);
      } else if (img) {
        img.addEventListener('load',  function () { requestAnimationFrame(measure); }, { once: true });
        img.addEventListener('error', function () { probe.remove(); resolve(null); }, { once: true });
      } else {
        probe.remove(); resolve(null);
      }
    });
  }

  async function play(opts) {
    if (_busy) return;
    _busy = true;
    injectStyles();

    opts = Object.assign({
      email: 'hello@example.com',
      name: 'Tim',
      signature: null,
      sound: true,
      intensity: 'standard'
    }, opts || {});

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const html = document.documentElement;
    const body = document.body;

    // Unlock AudioContext synchronously within the user gesture before any await.
    // iOS Safari requires this — it won't allow audio after an async gap.
    if (opts.sound) { const c = audio(); if (c && c.state === 'suspended') c.resume(); }

    // Measure i-dot position before any animation so we can target the implosion.
    // 600ms timeout in case the image somehow isn't cached.
    const iDot = await Promise.race([
      measureIDotPrerender(opts),
      wait(600).then(function () { return null; }),
    ]);
    const implodeX = iDot ? iDot.x : window.innerWidth  / 2;
    const implodeY = iDot ? iDot.y : window.innerHeight / 2;

    _state = {
      htmlOverflow: html.style.overflow,
      bodyTransform: body.style.transform,
      bodyTransformOrigin: body.style.transformOrigin,
      bodyTransition: body.style.transition,
      bodyVisibility: body.style.visibility,
      bodyWillChange: body.style.willChange,
      bodyFilter: body.style.filter,
      bodyOpacity: body.style.opacity,
    };
    const TARGET_Y = Math.round(window.innerHeight * IMPLODE_Y_RATIO);
    html.classList.add('tim-sig-active');
    body.style.willChange = 'transform, filter, opacity';
    body.style.transformOrigin = '50% ' + TARGET_Y + 'px';

    const overlay = el('div', 'tim-sig-overlay');
    const flash = el('div', 'tim-sig-flash');
    const line = el('div', 'tim-sig-line');
    const vignette = el('div', 'tim-sig-vignette');
    const grain = el('div', 'tim-sig-grain');
    line.style.top = TARGET_Y + 'px';
    html.appendChild(overlay);
    html.appendChild(flash);
    html.appendChild(line);
    html.appendChild(vignette);
    html.appendChild(grain);

    _liveNodes = { overlay, flash, line, vignette, grain, _implodeX: implodeX, _implodeY: implodeY, _targetY: TARGET_Y };

    if (reduced) {
      overlay.classList.add('show');
      vignette.classList.add('show');
      body.style.visibility = 'hidden';
      revealCard(opts, false);
      _busy = false;
      return;
    }

    if (opts.sound) await offSound(audio());

    // 1. FLICKER
    const flickClass = 'tim-sig-flick-' + (opts.intensity || 'standard');
    body.classList.add(flickClass);
    await wait(opts.intensity === 'brutal' ? 1000 : 800);
    body.classList.remove(flickClass);

    // 2. White flash (capacitor discharge feel)
    flash.style.opacity = '1';
    await wait(45);
    flash.style.transition = 'opacity 110ms ease';
    flash.style.opacity = '0';

    // 3. Reveal black overlay (behind body) so the implode shows on black
    overlay.classList.add('show');

    // 4. VERTICAL COLLAPSE — squashes to a horizontal line at screen centre
    line.style.opacity = '1';
    body.classList.add('tim-sig-vcollapse');
    await wait(140);

    // 5. HORIZONTAL COLLAPSE — line + (already-thin) body collapse to point
    body.classList.add('tim-sig-hcollapse');
    line.style.transform = 'translateY(-50%) scaleX(0)';
    await wait(85);

    body.style.visibility = 'hidden';
    line.style.opacity = '0';

    // 6. TEAL DOT — appears at TARGET_Y, horizontally centred
    const dot = el('div', 'tim-sig-dot');
    dot.style.top = TARGET_Y + 'px';
    html.appendChild(dot);
    _liveNodes.dot = dot;
    await raf(); await raf();
    dot.style.opacity = '1';
    dot.style.transition = 'opacity 60ms ease';
    await wait(280);

    dot.classList.add('pulse');

    // 7. REVEAL — vignette fades in, scanline begins, card appears
    vignette.classList.add('show');
    grain.classList.add('show');

    const scan = el('div', 'tim-sig-scan');
    html.appendChild(scan);
    _liveNodes.scan = scan;
    requestAnimationFrame(() => scan.classList.add('show'));

    await wait(180);

    revealCard(opts, false);
    startCursor();
    _busy = false;
  }

  function startCursor() {
    if (!window.matchMedia('(hover: hover)').matches) return;
    const html = document.documentElement;

    // Canvas sits behind the cursor dot, trails show through transparent card bg
    const canvas = document.createElement('canvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    html.appendChild(canvas);
    _liveNodes.trailCanvas = canvas;
    const ctx2d = canvas.getContext('2d');

    const curs = el('div', 'tim-sig-cursor');
    html.appendChild(curs);
    _liveNodes.cursor = curs;

    const TRAIL_LEN = 65;
    const trail = [];
    let mx = -999, my = -999, cx = -999, cy = -999, moved = false, rafId;

    function onMove(e) {
      mx = e.clientX; my = e.clientY;
      if (!moved) { cx = mx; cy = my; moved = true; curs.classList.add('show'); }
    }
    document.addEventListener('mousemove', onMove, true);

    (function tick() {
      if (moved) {
        cx += (mx - cx) * 0.18;
        cy += (my - cy) * 0.18;
        curs.style.left = cx + 'px';
        curs.style.top  = cy + 'px';

        trail.push({ x: cx, y: cy });
        if (trail.length > TRAIL_LEN) trail.shift();

        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < trail.length; i++) {
          const t = (i + 1) / trail.length;   // 0 = oldest tail, 1 = head
          const alpha = t * t * 0.7;
          const r = 0.4 + t * 2.8;
          ctx2d.beginPath();
          ctx2d.arc(trail[i].x, trail[i].y, r, 0, Math.PI * 2);
          ctx2d.shadowBlur  = t > 0.55 ? 6 + t * 16 : 0;
          ctx2d.shadowColor = 'rgba(82,212,204,0.7)';
          ctx2d.fillStyle   = `rgba(82,212,204,${alpha})`;
          ctx2d.fill();
        }
        ctx2d.shadowBlur = 0;
      }
      rafId = requestAnimationFrame(tick);
    })();

    _liveNodes._stopCursor = function () {
      document.removeEventListener('mousemove', onMove, true);
      cancelAnimationFrame(rafId);
    };
  }

  function revealCard(opts, skipAnim) {
    const html = document.documentElement;
    const card = el('div', 'tim-sig-card');
    card.innerHTML = buildCardHTML(opts);
    html.appendChild(card);
    _liveNodes.card = card;

    wireEmail(card.querySelector('.tim-sig-email'), opts.email);

    // Shift card vertically so i-dot Y aligns with TARGET_Y (the teal dot).
    // Shift signature image horizontally so i-dot X aligns with viewport centre.
    // Text stays horizontally centred; only the sig image moves sideways.
    var n = _liveNodes || {};
    var cx = window.innerWidth / 2;
    if (n._implodeY !== undefined && n._targetY !== undefined) {
      var cardDY = n._targetY - n._implodeY;
      card.style.transform = 'translate(-50%, calc(-50% + ' + cardDY + 'px))';
    }
    if (n._implodeX !== undefined) {
      var sigDX = cx - n._implodeX;
      var sigImg = card.querySelector('.tim-sig-signature-img');
      if (sigImg) sigImg.style.transform = 'translateX(' + sigDX + 'px)';
    }

    if (skipAnim) {
      card.classList.add('show');
      bindClose(opts);
    } else {
      card.style.filter = 'blur(8px) brightness(2)';
      requestAnimationFrame(() => {
        card.classList.add('show');
        card.style.transition = 'opacity 600ms ease, filter 500ms cubic-bezier(.2,.7,.3,1)';
        card.style.filter = 'blur(0) brightness(1)';
      });
      setTimeout(() => bindClose(opts), 700);
    }
  }

  function bindClose(opts) {
    const onClick = (e) => {
      // ignore clicks on the email link or copy button
      const t = e.target;
      if (t && (t.closest('.tim-sig-email') || t.closest('.tim-sig-copy'))) return;
      cleanup();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        cleanup();
      }
    };
    function cleanup() {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      restore(opts);
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  async function restore(opts) {
    if (_busy) return;
    _busy = true;

    // Snap to top while the overlay still covers the screen — invisible to the user.
    window.scrollTo(0, 0);

    const html = document.documentElement;
    const body = document.body;
    const n = _liveNodes || {};

    if (opts && opts.sound) await onSound(audio());

    // Card out
    if (n.card) {
      n.card.style.transition = 'opacity 220ms ease, filter 220ms ease';
      n.card.style.filter = 'blur(6px) brightness(2)';
      n.card.classList.remove('show');
    }
    if (n.scan) n.scan.classList.remove('show');
    if (n.vignette) n.vignette.classList.remove('show');
    if (n.grain) n.grain.classList.remove('show');
    await wait(220);
    if (n.card) n.card.remove();

    // Dot expands to horizontal line
    if (n.dot) {
      n.dot.classList.remove('pulse');
      n.dot.style.transition = 'width 90ms cubic-bezier(.2,.8,.4,1), height 90ms ease, border-radius 90ms';
      n.dot.style.width = '100vw';
      n.dot.style.height = '2px';
      n.dot.style.borderRadius = '0';
    }
    await wait(95);

    // Line expands to full content — un-collapse the body
    body.style.visibility = '';
    body.classList.remove('tim-sig-hcollapse');
    body.style.transform = 'scaleY(.0028)';
    body.style.transition = 'transform 180ms cubic-bezier(.3,.7,.4,1)';
    if (n.dot) { n.dot.style.opacity = '0'; }
    await raf(); await raf();

    body.style.transform = 'scaleY(1)';
    await wait(190);

    body.classList.remove('tim-sig-vcollapse');
    body.style.transform = '';

    // Settling flicker
    body.classList.add('tim-sig-flick-subtle');

    // Pull overlay back down
    if (n.overlay) {
      n.overlay.style.transition = 'opacity 600ms ease';
      n.overlay.classList.remove('show');
    }
    await wait(700);

    // FULL teardown
    body.classList.remove('tim-sig-flick-subtle');
    if (typeof n._stopCursor === 'function') n._stopCursor();
    Object.keys(n).forEach((k) => { var v = n[k]; if (v && typeof v.remove === 'function') v.remove(); });

    body.style.willChange = _state.bodyWillChange;
    body.style.transformOrigin = _state.bodyTransformOrigin;
    body.style.transform = _state.bodyTransform;
    body.style.transition = _state.bodyTransition;
    body.style.visibility = _state.bodyVisibility;
    body.style.filter = _state.bodyFilter;
    body.style.opacity = _state.bodyOpacity;
    html.style.overflow = _state.htmlOverflow;
    html.classList.remove('tim-sig-active');

    _state = null;
    _liveNodes = null;
    _busy = false;
  }

  /* ──────────────────────────────────────────────────────────────────
     Email button — three-state, glitch transitions between each state.
     ────────────────────────────────────────────────────────────────── */
  const EMAIL_HOVER_TEXT  = "Let's build something — click to copy";
  const EMAIL_COPIED_TEXT = 'copied — see you on the flip side';
  const SCRAMBLE_CHARS    = '!<>-_\\/[]{}=+*^?#@01><';

  // i-dot position within the signature image (left→right, top→bottom as fractions).
  const I_DOT_X = 0.68;
  const I_DOT_Y = 0.38;
  // Vertical position of the implosion dot as a fraction of viewport height.
  // 0.30 = 30% from top. Nudge this to raise/lower the whole effect.
  const IMPLODE_Y_RATIO = 0.30;

  function wireEmail(el, email) {
    let state = 'email';            // email | cta | copied
    let revertTimer = null;
    let scrambleAbort = null;

    // Lock the link's width to its initial rendered size so font-size transitions
    // to CTA state don't reflow the layout. Two RAFs ensures fonts have settled.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = el.getBoundingClientRect().width;
        if (w > 0) el.style.width = w + 'px';
      });
    });

    // tumble: ms between character advances
    // base/stagger/spread: control when each char locks (ms from animation start)
    function glitchTo(target, tumble, base, stagger, spread) {
      if (scrambleAbort) scrambleAbort();
      let aborted = false;
      scrambleAbort = () => { aborted = true; };

      el.classList.remove('tim-sig-glitch');
      void el.offsetWidth;
      el.classList.add('tim-sig-glitch');

      const chars = [];
      let total = 0;
      for (let i = 0; i < target.length; i++) {
        const endT = i * stagger + base + Math.floor(Math.random() * spread);
        if (endT > total) total = endT;
        chars.push({
          ch: target[i],
          endT,
          idx: Math.floor(Math.random() * SCRAMBLE_CHARS.length),
          next: Math.floor(Math.random() * tumble),
        });
      }
      const start = performance.now();

      function frame(now) {
        if (aborted) return;
        const t = now - start;
        let out = '';
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          if (c.ch === ' ') { out += ' '; continue; }
          if (t >= c.endT) { out += c.ch; continue; }
          if (t >= c.next) {
            c.idx = (c.idx + 1) % SCRAMBLE_CHARS.length;
            c.next = t + tumble;
          }
          out += SCRAMBLE_CHARS[c.idx];
        }
        el.textContent = out;
        if (t < total) requestAnimationFrame(frame);
        else {
          el.textContent = target;
          setTimeout(() => el.classList.remove('tim-sig-glitch'), 60);
        }
      }
      requestAnimationFrame(frame);
    }

    function settle(toState) {
      state = toState;
      el.classList.toggle('is-copied', toState === 'copied');
      el.classList.toggle('is-cta',    toState !== 'email');
      if (toState === 'email') {
        // Fast revert — snaps back in ~0.5s
        glitchTo(email, 100, 0, 12, 350);
      }
      if (toState === 'cta') {
        // Fast snap-in — legible in ~0.5s
        glitchTo(EMAIL_HOVER_TEXT, 80, 0, 10, 200);
      }
      if (toState === 'copied') {
        glitchTo(EMAIL_COPIED_TEXT, 80, 0, 10, 200);
      }
    }

    // Show CTA briefly then auto-revert. Total activity ~1.4s (10% of dwell).
    function showCTA() {
      if (state !== 'email') return;
      settle('cta');
      clearTimeout(revertTimer);
      revertTimer = setTimeout(function () {
        if (state === 'cta') settle('email');
      }, 3000); // match copied dwell
    }

    const canHover = window.matchMedia('(hover: hover)').matches;

    if (canHover) {
      el.addEventListener('mouseenter', function () { showCTA(); });
    }

    function copyEmail() {
      try {
        const p = navigator.clipboard && navigator.clipboard.writeText(email);
        if (p && typeof p.then === 'function') p.catch(function () {});
      } catch (_) {}
      settle('copied');
      clearTimeout(revertTimer);
      revertTimer = setTimeout(function () { settle('email'); }, 3000);
    }

    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      copyEmail();
    });

    // Glitch on every scanline pass; also trigger CTA on touch (18s cooldown).
    var scanEl = null, wasAbove = true, lastCTATrigger = 0;
    (function watchScan() {
      if (!el.isConnected) return;
      if (!scanEl) scanEl = document.querySelector('.tim-sig-scan');
      if (scanEl && scanEl.classList.contains('show')) {
        var sr = scanEl.getBoundingClientRect();
        var er = el.getBoundingClientRect();
        var isAbove = (sr.top + sr.height / 2) < (er.top + er.height / 2);
        if (wasAbove && !isAbove) {
          if (state === 'email') {
            el.classList.remove('tim-sig-glitch');
            void el.offsetWidth;
            el.classList.add('tim-sig-glitch');
            setTimeout(function () { el.classList.remove('tim-sig-glitch'); }, 460);
            if (!canHover && navigator.vibrate) navigator.vibrate(15);
          }
          if (!canHover) {
            var now = Date.now();
            if (now - lastCTATrigger >= 18000) { lastCTATrigger = now; showCTA(); }
          }
        }
        wasAbove = isAbove;
      }
      requestAnimationFrame(watchScan);
    })();
  }

  /* ──────────────────────────────────────────────────────────────────
     Helpers
     ────────────────────────────────────────────────────────────────── */
  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }
  function raf() { return new Promise(r => requestAnimationFrame(r)); }
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ──────────────────────────────────────────────────────────────────
     Binding
     ────────────────────────────────────────────────────────────────── */
  function attachAll(root) {
    (root || document).querySelectorAll('[data-tim-signature]').forEach((el) => {
      if (el.__timSigBound) return;
      el.__timSigBound = true;
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const ds = el.dataset || {};
        const opts = {
          email:     ds.email || el.getAttribute('data-tim-signature') || 'hello@example.com',
          name:      ds.name  || 'Tim',
          signature: ds.signature || (el.querySelector('img') && el.querySelector('img').src) || null,
          sound:     ds.sound !== 'false',
          intensity: ds.intensity || 'standard'
        };
        play(opts);
      });
    });
  }

  global.TimSignature = { play, attachAll, init: attachAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => attachAll());
  } else {
    attachAll();
  }
})(window);
