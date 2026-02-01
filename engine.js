import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // ---------- 配置与状态 ----------
    let SPEED = config.speed || 0.4;
    let targetFishCount = config.fishCount || 1350;
    const settings = { gain: config.gain || 1.0 };
    audio.setGain(settings.gain);

    let W, H, DPR;
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, lastT: performance.now() };
    const fish = [];
    const snow = [];
    const godRays = [];
    const currentLines = [];
    const cellSize = 100;
    let gridW, gridH, grid = [];

    const migration = {
        angle: Math.random() * Math.PI * 2,
        targetAngle: Math.random() * Math.PI * 2,
        strength: 0.16,
        flashIntensity: 0,
        centerX: 0,
        centerY: 0
    };

    // ---------- 核心工具 (原汁原味) ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);

    function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }

    function valueNoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
        const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
        return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
    }

    function fbm(x, y) {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) { f += amp * valueNoise(x * freq, y * freq); amp *= 0.5; freq *= 2; }
        return f;
    }

    // ---------- 初始化组件 ----------
    function initEnvironment() {
        snow.length = 0;
        for (let i = 0; i < 150; i++) {
            snow.push({ x: rand(0, W), y: rand(0, H), z: rand(0.3, 1), vx: rand(-0.1, 0.1), vy: rand(0.2, 0.5), r: rand(0.8, 2), a: rand(0.1, 0.2) });
        }
        godRays.length = 0;
        for (let i = 0; i < 5; i++) {
            godRays.push({ x: rand(W * 0.1, W * 0.9), width: rand(150, 300), alpha: rand(0.02, 0.05), phase: rand(0, 100), speed: rand(0.005, 0.01) });
        }
        currentLines.length = 0;
        for (let i = 0; i < 12; i++) {
            currentLines.push({ y: rand(H * 0.1, H * 0.9), phase: rand(0, 10), speed: rand(0.0001, 0.0002) });
        }
    }

    function resize() {
        DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        gridW = Math.ceil(W / cellSize); gridH = Math.ceil(H / cellSize);
        grid = new Array(gridW * gridH).fill(0).map(() => []);
        initEnvironment();
    }

    function spawnFish(count) {
        const silvers = [{ h: 204, s: [6, 18] }, { h: 212, s: [8, 22] }, { h: 196, s: [4, 16] }];
        for (let i = 0; i < count; i++) {
            const roll = Math.random(), isCol = roll < 0.04, isLarge = roll >= 0.04 && roll < 0.11;
            const type = isCol ? { h: 35, s: [40, 60] } : silvers[Math.floor(Math.random() * silvers.length)];
            const f = {
                x: rand(0, W), y: rand(0, H), vx: rand(-1, 1), vy: rand(-1, 1),
                sz: isLarge ? rand(5, 8) : rand(3.4, 5.2), isLarge, isCol,
                h: type.h + rand(-6, 6), sMin: type.s[0], sMax: type.s[1],
                ph: rand(0, 1000), tone: rand(-6, 6), ang: 0, bodyPh: Math.random() * 10,
                shm: rand(0.85, 1.15), lA: rand(0.6, 1)
            };
            const r = Math.random();
            if (r < 0.15) { f.ly = 'fg'; f.lS = 1.25; } else if (r < 0.85) { f.ly = 'mg'; f.lS = 1.0; } else { f.ly = 'bg'; f.lS = 0.75; }
            fish.push(f);
        }
    }

    // ---------- 核心渲染 (100% 还原) ----------
    function drawFish(f, t) {
        const dx = f.x - pointer.x, dy = f.y - pointer.y, d = Math.max(1, Math.hypot(dx, dy));
        const near = 1 - Math.min(1, d / (Math.min(W, H) * 0.65)), nearP = Math.pow(near, 0.6);
        const spd = Math.hypot(f.vx, f.vy), hue = f.h + f.tone + Math.sin(t * 0.0008 + f.ph) * 3;
        const sat = lerp(f.sMin, f.sMax + (f.isCol ? 25 : 10), nearP) + spd * 2.2;
        const lit = lerp(36, 64, nearP) + (migration.flashIntensity * 20) + f.tone * 0.5;
        const alpha = lerp(0.3, 0.95, Math.pow(near, 0.5)) * f.lA;

        let targetA = Math.atan2(f.vy, f.vx), aDiff = targetA - f.ang;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2; while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.ang += aDiff * 0.06; f.bodyPh += 0.012 * (1 + spd * 0.45);

        const bW = Math.sin(f.bodyPh), s = f.sz * f.lS;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);

        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, `hsla(${hue + 4},${sat + 4}%,${lit - 22}%,${alpha})`);
        grad.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 4}%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue - 2},${sat}%,${lit + 12}%,${alpha})`);
        grad.addColorStop(1, `hsla(${hue - 6},${sat - 6}%,${lit + 6}%,${alpha * 0.9})`);

        ctx.fillStyle = grad;
        const w1 = bW * s * 0.05, w2 = bW * s * 0.082;
        ctx.beginPath();
        ctx.moveTo(s * 2.3, 0);
        ctx.quadraticCurveTo(s * 1.25, -s * 0.78 + w1, -s * 0.85, -s * 0.62 + w2);
        ctx.quadraticCurveTo(-s * 2.1, -s * 0.12 + w2 * 0.4, -s * 2.35, w2 * 0.25);
        ctx.quadraticCurveTo(-s * 2.1, s * 0.12 + w2 * 0.4, -s * 0.85, s * 0.62 + w2);
        ctx.quadraticCurveTo(s * 1.25, s * 0.78 + w1, s * 2.3, 0);
        ctx.fill();

        // Tail
        ctx.fillStyle = `hsla(${hue},${sat}%,${lit - 10}%,${alpha * 0.85})`;
        ctx.beginPath();
        const tBase = w2 * 0.3;
        ctx.moveTo(-s * 2.2, tBase);
        ctx.quadraticCurveTo(-s * 2.6, -s * 0.35 + Math.sin(f.bodyPh - 0.8) * s + tBase, -s * 3.1, -s * 0.75 + Math.sin(f.bodyPh - 0.8) * s + tBase);
        ctx.quadraticCurveTo(-s * 2.7, Math.sin(f.bodyPh - 0.8) * s * 0.2 + tBase, -s * 3.1, s * 0.75 + Math.sin(f.bodyPh - 0.8) * s + tBase);
        ctx.quadraticCurveTo(-s * 2.6, s * 0.35 + Math.sin(f.bodyPh - 0.8) * s + tBase, -s * 2.2, tBase);
        ctx.fill();

        // Shimmer
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha * (0.15 + nearP * 0.35) * f.shm;
        const shmG = ctx.createLinearGradient(-s * 1.6, 0, s * 1.9, 0);
        shmG.addColorStop(0, 'rgba(255,255,255,0)'); shmG.addColorStop(0.5, 'rgba(255,255,255,0.7)'); shmG.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = shmG; ctx.lineWidth = s * 0.12; ctx.beginPath();
        ctx.moveTo(s * 1.85, -s * 0.05); ctx.quadraticCurveTo(s * 0.5, -s * 0.18, -s * 1.6, -s * 0.08); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';

        if (s > 3) {
            ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.08, s * 0.12, 0, 7); ctx.fill();
            ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(s * 1.64, -s * 0.08, s * 0.06, 0, 7); ctx.fill();
        }
        ctx.restore();
    }

    function drawBackground() {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#061a28'); g.addColorStop(0.5, '#04121d'); g.addColorStop(1, '#02070e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        ctx.save(); ctx.globalCompositeOperation = 'multiply';
        const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.4, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    function drawGodRays(t) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) {
            const pulse = 0.7 + 0.3 * Math.sin(t * r.speed + r.phase);
            ctx.globalAlpha = r.alpha * pulse;
            const g = ctx.createLinearGradient(r.x, 0, r.x + r.width * 0.5, H);
            g.addColorStop(0, 'rgba(215,245,255,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(r.x - r.width * 0.2, 0); ctx.lineTo(r.x + r.width * 0.2, 0);
            ctx.lineTo(r.x + r.width * 0.8, H); ctx.lineTo(r.x - r.width * 0.8, H);
            ctx.fill();
        }
        ctx.restore();
    }

    // ---------- 核心循环 ----------
    function step(dt, t) {
        if (Math.random() < 0.001) migration.targetAngle = Math.random() * Math.PI * 2;
        let diff = migration.targetAngle - migration.angle;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        migration.angle += diff * 0.03; migration.flashIntensity = Math.abs(diff) > 0.4 ? 1 : migration.flashIntensity * 0.95;

        for (let i = 0; i < grid.length; i++) grid[i].length = 0;
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; const gx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), gy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            grid[gy * gridW + gx].push(i);
        }

        for (let i = 0; i < fish.length; i++) {
            const f = fish[i]; let ax = 0, ay = 0;
            const gx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), gy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                const yy = gy + oy, xx = gx + ox;
                if (yy >= 0 && yy < gridH && xx >= 0 && xx < gridW) {
                    for (const idx of grid[yy * gridW + xx]) {
                        if (idx === i) continue;
                        const o = fish[idx], dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
                        if (d2 < 3600) {
                            ax += (o.vx - f.vx) * 0.35; ay += (o.vy - f.vy) * 0.35;
                            if (d2 < 625) { const d = Math.sqrt(d2); ax -= dx / d * 0.6; ay -= dy / d * 0.6; }
                        }
                    }
                }
            }
            const dxP = pointer.x - f.x, dyP = pointer.y - f.y, distP = Math.max(1, Math.hypot(dxP, dyP));
            const heat = Math.exp(-distP / 600);
            ax += (dxP / distP) * heat * 5; ay += (dyP / distP) * heat * 5;
            ax += Math.cos(migration.angle) * 0.2; ay += Math.sin(migration.angle) * 0.2;

            f.vx = (f.vx + ax * 0.12 * SPEED) * 0.94; f.vy = (f.vy + ay * 0.12 * SPEED) * 0.94;
            f.x += f.vx; f.y += f.vy;
            if (f.x < -100) f.x = W + 100; if (f.x > W + 100) f.x = -100;
            if (f.y < -100) f.y = H + 100; if (f.y > H + 100) f.y = -100;
        }
        if (fish.length < targetFishCount) spawnFish(Math.min(25, targetFishCount - fish.length));
        else if (fish.length > targetFishCount) fish.splice(0, Math.min(25, fish.length - targetFishCount));
    }

    // ---------- 事件绑定 ----------
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('spdMinus', () => SPEED = clamp(SPEED / 1.2, 0.1, 4));
    bind('spdPlus', () => SPEED = clamp(SPEED * 1.2, 0.1, 4));
    bind('cntMinus', () => targetFishCount = clamp(targetFishCount - 200, 200, 2500));
    bind('cntPlus', () => targetFishCount = clamp(targetFishCount + 200, 200, 2500));
    bind('snd', () => {
        audio.enabled = !audio.enabled;
        const b = document.getElementById('snd'); if (b) b.textContent = audio.enabled ? '🔊' : '🔇';
        audio.playClick();
    });

    window.addEventListener('pointermove', (e) => {
        const now = performance.now(), dt = Math.max(1, now - pointer.lastT);
        pointer.vx = (e.clientX - pointer.x) / dt; pointer.vy = (e.clientY - pointer.y) / dt;
        pointer.x = e.clientX; pointer.y = e.clientY; pointer.lastT = now;
        const hint = document.getElementById('hint'); if (hint) hint.classList.add('off');
    });

    // ---------- 正式运行 ----------
    resize(); spawnFish(targetFishCount);
    window.addEventListener('resize', resize);

    function frame() {
        const t = performance.now();
        drawBackground();
        drawGodRays(t);

        ctx.save(); ctx.globalAlpha = 0.05; ctx.strokeStyle = 'white';
        for (const l of currentLines) {
            ctx.beginPath(); for (let x = 0; x < W; x += 50) ctx.lineTo(x, l.y + Math.sin(x * 0.01 + t * l.speed + l.phase) * 15);
            ctx.stroke();
        }
        ctx.restore();

        step(16, t);

        for (const s of snow) {
            s.y += s.vy; if (s.y > H) s.y = -10;
            ctx.globalAlpha = s.a; ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, 7); ctx.fill();
        }

        const lys = ['bg', 'mg', 'fg'];
        for (const ly of lys) for (const f of fish) if (f.ly === ly) drawFish(f, t);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
