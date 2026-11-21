/* Agent Hub Theme Mini-Widget: Riemann Critical-Line Zero Explorer (lazy-loaded on demand, 0 idle FPS). */
(() => {
  const ZEROS = [
    { label: 'γ₁', t: 14.1347251 },
    { label: 'γ₂', t: 21.0220396 },
    { label: 'γ₃', t: 25.0108576 },
    { label: 'γ₄', t: 30.4248761 },
    { label: 'γ₅', t: 32.9350616 },
  ];

  // Borwein's Chebyshev-accelerated Dirichlet eta weights (N = 32 via overflow-free recurrence).
  const N = 32;
  const D = [1];
  let term = 1;
  for (let i = 1; i <= N; i++) {
    term = (term * (N + i - 1) * (N - i + 1) * 4) / (2 * i * (2 * i - 1));
    D[i] = D[i - 1] + term;
  }
  const DN = D[N];
  const WEIGHTS = Array.from({ length: N }, (_, k) => ((k % 2 === 0 ? 1 : -1) * (DN - D[k])) / DN);
  const LOGN = Array.from({ length: N }, (_, k) => Math.log(k + 1));
  const INV_SQRT = Array.from({ length: N }, (_, k) => 1 / Math.sqrt(k + 1));
  const LOG2 = Math.log(2);
  const SQRT2 = Math.SQRT2;

  // Evaluate Riemann zeta(1/2 + i*t) -> { re, im, abs }
  function zetaHalf(t) {
    let etaRe = 0;
    let etaIm = 0;
    for (let k = 0; k < N; k++) {
      const mag = WEIGHTS[k] * INV_SQRT[k];
      const angle = -t * LOGN[k];
      etaRe += mag * Math.cos(angle);
      etaIm += mag * Math.sin(angle);
    }
    // Divide by (1 - 2^(1 - s)) = (1 - sqrt(2) * e^(-i * t * ln 2))
    const a = -t * LOG2;
    const denRe = 1 - SQRT2 * Math.cos(a);
    const denIm = -SQRT2 * Math.sin(a);
    const den2 = denRe * denRe + denIm * denIm;
    const re = (etaRe * denRe + etaIm * denIm) / den2;
    const im = (etaIm * denRe - etaRe * denIm) / den2;
    return { re, im, abs: Math.hypot(re, im) };
  }

  // Precompute dense lookup trail once when the user opens the dialog (~500 points, < 2ms).
  const T_MIN = 0.5;
  const T_MAX = 36.0;
  const STEP = 0.06;
  const TRAIL = [];
  for (let t = T_MIN; t <= T_MAX + 1e-6; t += STEP) {
    TRAIL.push({ t, ...zetaHalf(t) });
  }

  function mount(container, { reducedMotion = false } = {}) {
    container.innerHTML =
      '<div class="rh-widget">' +
        '<div class="rh-head">' +
          '<div class="rh-title"><strong>临界线零点探索器</strong><span>复平面轨迹 ζ(½ + it)</span></div>' +
          '<div class="rh-readout" aria-live="polite"><span data-rh-t>t = 14.1347</span><span data-rh-abs>|ζ| = 0.0000</span></div>' +
        '</div>' +
        '<canvas class="rh-canvas" width="420" height="190" aria-label="黎曼 zeta 函数在临界线 Re(s)=1/2 上的复平面轨迹"></canvas>' +
        '<div class="rh-controls">' +
          `<input type="range" class="rh-slider" min="${T_MIN}" max="${T_MAX}" step="0.01" value="14.13" aria-label="调节虚部 t">` +
          '<button type="button" class="rh-play" aria-pressed="false">扫描</button>' +
        '</div>' +
        '<div class="rh-zeros" role="group" aria-label="跳转至前五个非平凡零点">' +
          '<span class="rh-zeros-label">非平凡零点</span>' +
          ZEROS.map((z, i) => `<button type="button" class="rh-zero-btn" data-zero="${z.t}" title="跳至第 ${i + 1} 个零点 t ≈ ${z.t}">${z.label} · ${z.t.toFixed(2)}</button>`).join('') +
        '</div>' +
      '</div>';

    const canvas = container.querySelector('.rh-canvas');
    const ctx = canvas.getContext('2d');
    const slider = container.querySelector('.rh-slider');
    const playBtn = container.querySelector('.rh-play');
    const tOut = container.querySelector('[data-rh-t]');
    const absOut = container.querySelector('[data-rh-abs]');
    const zeroButtons = [...container.querySelectorAll('.rh-zero-btn')];

    let currentT = ZEROS[0].t;
    let rafId = 0;
    let lastTs = 0;

    function draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 420;
      const cssH = canvas.clientHeight || 190;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Observatory background
      ctx.fillStyle = '#0c152b';
      ctx.fillRect(0, 0, cssW, cssH);

      const cx = cssW * 0.42;
      const cy = cssH * 0.52;
      const scale = Math.min(cssW, cssH) * 0.145;
      const toX = re => cx + re * scale;
      const toY = im => cy - im * scale;

      // Subtle grid and real/imaginary axes
      ctx.strokeStyle = 'rgba(139, 184, 255, 0.12)';
      ctx.lineWidth = 1;
      for (let k = -3; k <= 5; k++) {
        const gx = toX(k);
        if (gx > 0 && gx < cssW) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, cssH); ctx.stroke(); }
      }
      for (let k = -3; k <= 3; k++) {
        const gy = toY(k);
        if (gy > 0 && gy < cssH) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cssW, gy); ctx.stroke(); }
      }
      ctx.strokeStyle = 'rgba(139, 184, 255, 0.32)';
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(cssW, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, cssH); ctx.stroke();

      const live = zetaHalf(currentT);
      const isZeroHit = live.abs < 0.08;

      // Origin (0,0) target ring
      ctx.beginPath();
      ctx.arc(cx, cy, isZeroHit ? 9 : 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = isZeroHit ? '#f5cf7a' : 'rgba(245, 207, 122, 0.55)';
      ctx.lineWidth = isZeroHit ? 1.8 : 1;
      ctx.stroke();

      // Draw spiral trail up to currentT
      ctx.beginPath();
      let started = false;
      for (const pt of TRAIL) {
        if (pt.t > currentT) break;
        const x = toX(pt.re);
        const y = toY(pt.im);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(toX(live.re), toY(live.im));
      const grad = ctx.createLinearGradient(0, 0, cssW, cssH);
      grad.addColorStop(0, 'rgba(139, 184, 255, 0.45)');
      grad.addColorStop(0.65, 'rgba(139, 184, 255, 0.92)');
      grad.addColorStop(1, '#f5cf7a');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Current ζ(1/2 + it) point
      const px = toX(live.re);
      const py = toY(live.im);
      ctx.beginPath();
      ctx.arc(px, py, isZeroHit ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isZeroHit ? '#fff3c4' : '#f5cf7a';
      ctx.fill();

      // Axis & status labels
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(196, 209, 234, 0.72)';
      ctx.fillText('Re(ζ)', cssW - 36, cy - 6);
      ctx.fillText('Im(ζ)', cx + 6, 14);
      ctx.fillStyle = isZeroHit ? '#f5cf7a' : 'rgba(196, 209, 234, 0.65)';
      ctx.fillText(isZeroHit ? '✓ 命中零点 (0, 0)' : '(0, 0)', cx + 10, cy + 14);

      tOut.textContent = `t = ${currentT.toFixed(4)}`;
      absOut.textContent = isZeroHit ? '|ζ| ≈ 0 · 零点' : `|ζ| = ${live.abs.toFixed(3)}`;
      absOut.classList.toggle('is-hit', isZeroHit);
      for (const btn of zeroButtons) {
        const z = Number(btn.dataset.zero);
        btn.setAttribute('aria-pressed', String(Math.abs(currentT - z) < 0.06));
      }
    }

    function stopPlay() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      lastTs = 0;
      playBtn.setAttribute('aria-pressed', 'false');
      playBtn.textContent = '扫描';
    }

    function step(ts) {
      if (!lastTs) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, 0.08);
      lastTs = ts;
      currentT += dt * 1.6;
      if (currentT > T_MAX) currentT = T_MIN;
      slider.value = currentT.toFixed(2);
      draw();
      rafId = requestAnimationFrame(step);
    }

    const onInput = () => {
      stopPlay();
      currentT = Number(slider.value);
      draw();
    };
    const onPlay = () => {
      if (rafId) { stopPlay(); return; }
      if (reducedMotion) {
        // Under reduced motion, step straight to the next zero instead of continuous animation.
        const next = ZEROS.find(z => z.t > currentT + 0.1) || ZEROS[0];
        currentT = next.t;
        slider.value = currentT.toFixed(2);
        draw();
        return;
      }
      playBtn.setAttribute('aria-pressed', 'true');
      playBtn.textContent = '暂停';
      rafId = requestAnimationFrame(step);
    };
    const onZeroClick = event => {
      stopPlay();
      currentT = Number(event.currentTarget.dataset.zero);
      slider.value = currentT.toFixed(2);
      draw();
    };

    slider.addEventListener('input', onInput);
    playBtn.addEventListener('click', onPlay);
    for (const btn of zeroButtons) btn.addEventListener('click', onZeroClick);
    const onResize = () => draw();
    window.addEventListener('resize', onResize);

    draw();

    return () => {
      stopPlay();
      slider.removeEventListener('input', onInput);
      playBtn.removeEventListener('click', onPlay);
      for (const btn of zeroButtons) btn.removeEventListener('click', onZeroClick);
      window.removeEventListener('resize', onResize);
      container.innerHTML = '';
    };
  }

  (window.AgentHubThemeWidgets = window.AgentHubThemeWidgets || {})['riemann-proof'] = { mount, zetaHalf };
})();
