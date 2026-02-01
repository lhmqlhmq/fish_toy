import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // ---------- Settings ----------
    const settings = {
        fishCount: config.fishCount || 1300,
        speed: config.speed || 0.4,
        gain: config.gain || 1.0,
        ...config
    };

    audio.setGain(settings.gain);

    // ---------- Utilities ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const clamp01 = v => clamp(v, 0, 1);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    function valueNoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const a = hash2(xi, yi), b = hash2(xi + 1, yi);
        const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
        const u = smoothstep(xf), v = smoothstep(yf);
        return lerp(lerp(a, b, u), lerp(c, d, u), v);
    }
    function fbm(x, y) {
        let f = 0, amp = 0.5, freq = 1;
        for (let i = 0; i < 4; i++) {
            f += amp * valueNoise(x * freq, y * freq);
            amp *= 0.5; freq *= 2;
        }
        return f;
    }

    // ---------- State ----------
    let W = innerWidth, H = innerHeight, DPR = 1;
    const pointer = { x: W * 0.5, y: H * 0.5, vx: 0, vy: 0, lastT: performance.now(), idle: 0 };
    const fish = [];
    const bubbles = [];
    let bubbleAcc = 0;
    const flowParticles = [];
    const godRays = [];
    const snow = [];
    const trail = [];

    // ---------- Grid ----------
    const cellSize = 100;
    let gridW, gridH, grid;
    function initSpatial() {
        gridW = Math.ceil(W / cellSize);
        gridH = Math.ceil(H / cellSize);
        grid = new Array(gridW * gridH).fill(0).map(() => []);
    }
    function rebuildGrid(fishArray) {
        for (let i = 0; i < grid.length; i++) grid[i].length = 0;
        for (let i = 0; i < fishArray.length; i++) {
            const f = fishArray[i];
            const cx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1);
            const cy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            grid[cy * gridW + cx].push(i);
        }
    }

    // ---------- Resize ----------
    function resize() {
        DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        W = innerWidth; H = innerHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        initSpatial();
        initSnow();
        initGodRays();
        initSubSchools();
    }
    addEventListener('resize', resize, { passive: true });

    // ---------- Pointer ----------
    const hint = document.getElementById('hint');
    let lastPointerMove = performance.now();
    addEventListener('pointermove', (e) => {
        const now = performance.now();
        const dt = Math.max(1, now - pointer.lastT);
        const nx = e.clientX, ny = e.clientY;
        pointer.vx = (nx - pointer.x) / dt;
        pointer.vy = (ny - pointer.y) / dt;
        pointer.x = nx; pointer.y = ny; pointer.lastT = now;
        pointer.idle = 0;
        if (hint) hint.classList.add('off'); // Use the class from original style
    }, { passive: true });

    // ---------- Fish System ----------
    function spawnFish(count) {
        const silverTypes = [
            { baseHue: 200, satRange: [5, 18] }, { baseHue: 210, satRange: [8, 22] }, { baseHue: 190, satRange: [6, 16] }
        ];
        const colorfulTypes = [
            { baseHue: 35, satRange: [40, 65] }, { baseHue: 15, satRange: [45, 70] }
        ];
        for (let i = 0; i < count; i++) {
            const roll = Math.random();
            const isColorful = roll < 0.05;
            const isLarge = roll >= 0.05 && roll < 0.12;
            const colorType = isColorful ? colorfulTypes[randInt(0, colorfulTypes.length - 1)] : silverTypes[randInt(0, silverTypes.length - 1)];
            const f = {
                x: Math.random() * W, y: Math.random() * H,
                vx: rand(-1, 1), vy: rand(-1, 1),
                size: isLarge ? rand(5.2, 8.2) : rand(3.5, 5.5),
                isLarge, isColorful,
                baseHue: colorType.baseHue + rand(-8, 8),
                baseSatMin: colorType.satRange[0], baseSatMax: colorType.satRange[1],
                phase: rand(0, 1000), hueSeed: Math.random(),
                wander: rand(0.7, 1.3), breakout: 0,
                bodyPhase: rand(0, Math.PI * 2), bodyWaveSpeed: rand(0.008, 0.015),
                currentAngle: 0, angleSmoothing: rand(0.03, 0.08),
                scaleShimmer: rand(0.8, 1.2), bodyTone: rand(-5, 5)
            };
            assignDepthLayer(f);
            fish.push(f);
        }
    }

    function assignDepthLayer(f) {
        const r = Math.random();
        if (r < 0.15) { f.depthLayer = 'foreground'; f.depthScale = rand(1.15, 1.35); f.depthAlpha = 1.0; }
        else if (r < 0.85) { f.depthLayer = 'midground'; f.depthScale = rand(0.9, 1.1); f.depthAlpha = rand(0.85, 1.0); }
        else { f.depthLayer = 'background'; f.depthScale = rand(0.6, 0.8); f.depthAlpha = rand(0.4, 0.65); }
    }

    function drawFish(f, t) {
        const dX = f.x - pointer.x, dY = f.y - pointer.y, dist = Math.hypot(dX, dY);
        const maxDist = Math.min(W, H) * 0.65;
        const near = 1 - Math.min(1, dist / maxDist);
        const nearP = Math.pow(near, 0.6);
        const spd = Math.hypot(f.vx, f.vy);
        const hue = f.baseHue + f.bodyTone + Math.sin(t * 0.0008 + f.phase) * 3;
        let sat = lerp(f.baseSatMin, f.baseSatMax + (f.isColorful ? 20 : 8), nearP) + spd * 2.5;
        const flash = migration.flashIntensity * 20 * (0.5 + Math.random() * 0.5);
        const lit = lerp(38, 62, nearP) + flash + f.bodyTone * 0.5 + (f.isColorful ? 5 : 0);
        const alpha = lerp(0.25, 0.95, Math.pow(near, 0.45)) * f.depthAlpha;

        const targetA = Math.atan2(f.vy, f.vx);
        let aDiff = targetA - f.currentAngle;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2;
        while (aDiff < -Math.PI) aDiff += Math.PI * 2;
        f.currentAngle += aDiff * f.angleSmoothing;
        const ang = f.currentAngle, s = f.size * f.depthScale;

        f.bodyPhase += f.bodyWaveSpeed * (1 + spd * 0.5);
        const bodyW = Math.sin(f.bodyPhase) * 0.08 * (1 + spd * 0.3);
        const tailS = Math.sin(f.bodyPhase - 0.8) * (0.18 + spd * 0.12);

        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(ang);
        const bg = ctx.createLinearGradient(0, -s, 0, s);
        bg.addColorStop(0, `hsla(${hue + 5},${sat + 5}%,${lit - 22}%,${alpha})`);
        bg.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 5}%,${alpha})`);
        bg.addColorStop(0.5, `hsla(${hue - 3},${Math.max(0, sat - 2)}%,${lit + 12}%,${alpha})`);
        bg.addColorStop(1, `hsla(${hue - 8},${Math.max(0, sat - 8)}%,${lit + 8}%,${alpha * 0.9})`);
        ctx.fillStyle = bg; ctx.beginPath();
        const w1 = bodyW * s * 0.5, w2 = bodyW * s * 0.8;
        ctx.moveTo(s * 2.3, 0);
        ctx.quadraticCurveTo(s * 1.2, -s * 0.75 + w1, -s * 0.8, -s * 0.6 + w2);
        ctx.quadraticCurveTo(-s * 2, -s * 0.12 + w2 * 0.5, -s * 2.3, w2 * 0.3);
        ctx.quadraticCurveTo(-s * 2, s * 0.12 + w2 * 0.5, -s * 0.8, s * 0.6 + w2);
        ctx.quadraticCurveTo(s * 1.2, s * 0.75 + w1, s * 2.3, 0);
        ctx.fill();

        ctx.fillStyle = `hsla(${hue + 3},${sat}%,${lit - 8}%,${alpha * 0.88})`;
        ctx.beginPath();
        const tB = w2 * 0.3;
        ctx.moveTo(-s * 2.2, tB);
        ctx.quadraticCurveTo(-s * 2.6, -s * 0.3 + tailS * s * 0.5 + tB, -s * 3, -s * 0.7 + tailS * s + tB);
        ctx.quadraticCurveTo(-s * 2.7, tailS * s * 0.2 + tB, -s * 2.6, tailS * s * 0.15 + tB);
        ctx.quadraticCurveTo(-s * 2.7, tailS * s * 0.2 + tB, -s * 3, s * 0.7 + tailS * s + tB);
        ctx.quadraticCurveTo(-s * 2.6, s * 0.3 + tailS * s * 0.5 + tB, -s * 2.2, tB);
        ctx.fill();

        // Shimmer
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha * (0.12 + nearP * 0.25) * f.scaleShimmer;
        const hl = ctx.createLinearGradient(-s * 1.5, 0, s * 1.8, 0);
        hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.8)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = hl; ctx.lineWidth = s * 0.15; ctx.beginPath(); ctx.moveTo(s * 1.8, -s * 0.05 + w1 * 0.2); ctx.quadraticCurveTo(s * 0.5, -s * 0.18 + w1 * 0.3, -s * 1.5, -s * 0.08 + w2 * 0.3); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';

        if (s > 3.2) {
            ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = 'rgba(220,235,245,0.8)';
            const eS = f.isLarge ? s * 0.09 : Math.max(0.9, s * 0.12);
            ctx.beginPath(); ctx.arc(s * 1.65, -s * 0.08, eS, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(15,25,35,0.9)'; ctx.beginPath(); ctx.arc(s * 1.68, -s * 0.08, eS * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // ---------- Migration ----------
    const migration = {
        angle: Math.random() * Math.PI * 2, targetAngle: Math.random() * Math.PI * 2,
        strength: 0.15, breathPhase: 0, breathSpeed: 0.0008, waveOrigin: { x: W * 0.5, y: H * 0.5 }, waveTime: 0, speedPhase: 0, speedMod: 1.0, centerX: W * 0.5, centerY: H * 0.5, flashIntensity: 0
    };
    const subSchools = [];
    function initSubSchools() {
        subSchools.length = 0;
        for (let i = 0; i < 4; i++) subSchools.push({ x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.8), vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), radius: rand(150, 300), strength: rand(0.3, 0.6), phase: rand(0, Math.PI * 2) });
    }
    function updateMigration(dt, t) {
        if (Math.random() < 0.001) migration.targetAngle = Math.random() * Math.PI * 2;
        let diff = migration.targetAngle - migration.angle;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        migration.angle += diff * 0.002 * dt * 0.06;
        migration.flashIntensity = Math.abs(diff) > 0.3 ? Math.min(1, migration.flashIntensity + dt * 0.002) : migration.flashIntensity * 0.98;
        migration.breathPhase += migration.breathSpeed * dt;
        migration.speedPhase += dt * 0.0003;
        migration.speedMod = 0.7 + 0.3 * Math.sin(migration.speedPhase);
        migration.waveTime += dt * 0.002;
        if (fish.length > 0) {
            let cx = 0, cy = 0; for (const f of fish) { cx += f.x; cy += f.y; }
            migration.centerX = lerp(migration.centerX, cx / fish.length, 0.02);
            migration.centerY = lerp(migration.centerY, cy / fish.length, 0.02);
            migration.waveOrigin.x = migration.centerX; migration.waveOrigin.y = migration.centerY;
        }
        for (const sub of subSchools) {
            sub.phase += dt * 0.001; sub.vx = (sub.vx + (Math.random() - 0.5) * 0.02 + Math.cos(migration.angle) * 0.01) * 0.99; sub.vy = (sub.vy + (Math.random() - 0.5) * 0.02 + Math.sin(migration.angle) * 0.01) * 0.99;
            sub.x += sub.vx * dt * 0.05; sub.y += sub.vy * dt * 0.05;
            sub.radius = (180 + 80 * Math.sin(sub.phase)) * (0.8 + 0.4 * Math.sin(migration.breathPhase + sub.phase));
        }
    }

    function getMigrationForce(f, t) {
        let fx = Math.cos(migration.angle) * migration.strength * 0.3;
        let fy = Math.sin(migration.angle) * migration.strength * 0.3;
        const dO = Math.hypot(f.x - migration.waveOrigin.x, f.y - migration.waveOrigin.y);
        const wE = Math.sin(dO * 0.008 - migration.waveTime) * 0.06;
        fx += Math.cos(migration.angle + Math.PI * 0.5) * wE; fy += Math.sin(migration.angle + Math.PI * 0.5) * wE;
        const toCX = migration.centerX - f.x, toCY = migration.centerY - f.y, dC = Math.hypot(toCX, toCY) + 1;
        const bE = Math.sin(migration.breathPhase) * 0.04; fx -= (toCX / dC) * bE; fy -= (toCY / dC) * bE;
        for (const sub of subSchools) {
            const d = Math.hypot(f.x - sub.x, f.y - sub.y);
            if (d < sub.radius) { const p = (1 - d / sub.radius) * sub.strength * 0.1; fx += (sub.x - f.x) / (d + 1) * p; fy += (sub.y - f.y) / (d + 1) * p; break; }
        }
        return { fx, fy };
    }

    // ---------- Events ----------
    const events = { active: [], cooldown: 0, lastEventTime: 0 };
    function createEvent(type) {
        const base = { type, life: 0, maxLife: rand(4000, 7000), intensity: 0 };
        if (type === 'vortex') return { ...base, x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.8), radius: rand(200, 300), strength: 1.0, direction: Math.random() < 0.5 ? 1 : -1 };
        return { ...base, x: W * 0.5, y: H * 0.5, radius: 250, strength: 0.5 };
    }
    function updateEvents(dt, t) {
        events.cooldown -= dt;
        if (events.cooldown <= 0 && events.active.length < 1 && t - events.lastEventTime > 20000) {
            events.active.push(createEvent('vortex')); events.lastEventTime = t; events.cooldown = 15000;
        }
        for (let i = events.active.length - 1; i >= 0; i--) {
            const ev = events.active[i]; ev.life += dt;
            if (ev.life < 1000) ev.intensity = ev.life / 1000; else if (ev.life > ev.maxLife - 1000) ev.intensity = (ev.maxLife - ev.life) / 1000; else ev.intensity = 1;
            if (ev.life >= ev.maxLife) events.active.splice(i, 1);
        }
    }
    function getEventForce(f) {
        let fx = 0, fy = 0;
        for (const ev of events.active) {
            const dx = f.x - ev.x, dy = f.y - ev.y, d = Math.hypot(dx, dy);
            if (d < ev.radius && d > 10) {
                const inner = 1 - d / ev.radius;
                const pull = inner * 0.3 * ev.intensity;
                const swirl = inner * 0.6 * ev.intensity * ev.direction;
                fx += (-dx / d) * pull + (-dy / d) * swirl; fy += (-dy / d) * pull + (dx / d) * swirl;
            }
        }
        return { fx, fy };
    }

    // ---------- Particles ----------
    function initSnow() {
        snow.length = 0;
        for (let i = 0; i < 150; i++) snow.push({ x: Math.random() * W, y: Math.random() * H, z: rand(0.3, 1), vx: rand(-0.1, 0.1), vy: rand(0.2, 0.5), r: rand(0.5, 2), a: rand(0.1, 0.3) });
    }
    function drawSnow(t) {
        for (const s of snow) {
            s.x += s.vx * s.z; s.y += s.vy * s.z;
            if (s.x < 0) s.x = W; if (s.x > W) s.x = 0; if (s.y > H) s.y = 0;
            ctx.globalAlpha = s.a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    function initGodRays() {
        godRays.length = 0;
        for (let i = 0; i < 4; i++) godRays.push({ x: rand(W * 0.1, W * 0.9), width: rand(100, 250), alpha: rand(0.02, 0.05), phase: rand(0, Math.PI * 2) });
    }
    function drawGodRays(t) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) {
            const pulse = 0.7 + 0.3 * Math.sin(t * 0.001 + r.phase);
            ctx.globalAlpha = r.alpha * pulse;
            const g = ctx.createLinearGradient(r.x, 0, r.x + 50, H);
            g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(r.x, 0); ctx.lineTo(r.x + r.width, 0); ctx.lineTo(r.x + r.width * 1.5, H); ctx.lineTo(r.x - r.width * 0.5, H); ctx.fill();
        }
        ctx.restore();
    }

    // ---------- Simulation Core ----------
    function step(dt, t) {
        updateMigration(dt, t);
        updateEvents(dt, t);
        rebuildGrid(fish);
        const speedFactor = settings.speed;
        for (let i = 0; i < fish.length; i++) {
            const f = fish[i];
            if (f.breakout > 0) f.breakout -= dt; else if (Math.random() < 0.0005) f.breakout = rand(300, 800);
            let ax = 0, ay = 0, avx = 0, avy = 0, cox = 0, coy = 0, sepX = 0, sepY = 0, count = 0;
            const cx = clamp(Math.floor(f.x / cellSize), 0, gridW - 1), cy = clamp(Math.floor(f.y / cellSize), 0, gridH - 1);
            for (let oy = -1; oy <= 1; oy++) {
                const yy = cy + oy; if (yy < 0 || yy >= gridH) continue;
                for (let ox = -1; ox <= 1; ox++) {
                    const xx = cx + ox; if (xx < 0 || xx >= gridW) continue;
                    const cell = grid[yy * gridW + xx];
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k]; if (j === i) continue;
                        const o = fish[j]; const dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
                        if (d2 > 60 * 60) continue;
                        const d = Math.sqrt(d2) + 1e-6; avx += o.vx; avy += o.vy; cox += o.x; coy += o.y;
                        const sR = f.isLarge ? 45 : 25; if (d < sR) { const p = (sR - d) / sR; sepX -= (dx / d) * p; sepY -= (dy / d) * p; }
                        count++; if (count >= 18) break;
                    }
                    if (count >= 18) break;
                }
                if (count >= 18) break;
            }
            if (count > 0) {
                const inv = 1 / count;
                ax += (avx * inv - f.vx) * 0.35 + (cox * inv - f.x) * 0.000135 + sepX * 0.95;
                ay += (avy * inv - f.vy) * 0.35 + (coy * inv - f.y) * 0.000135 + sepY * 0.95;
            }
            // Thermal Plume
            const pdx = pointer.x - f.x, pdy = pointer.y - f.y, dist = Math.hypot(pdx, pdy) + 1;
            const heat = Math.exp(-dist / 600) * 0.7 + 0.35 * Math.max(0, 1 - dist / Math.max(W, H));
            const pB = dist < 250 ? (1 + (250 - dist) / 80) : 1;
            ax += (pdx / dist) * heat * 4.5 * pB; ay += (pdy / dist) * heat * 4.5 * pB;
            // Noise & Wander
            const n = fbm(f.x * 0.004 + t * 0.00007, f.y * 0.004 + t * 0.00005);
            f.phase += dt * 0.002; const wig = (Math.sin(f.phase + f.hueSeed * 6.28) + (n - 0.5)) * 0.18 * f.wander;
            ax += wig; ay -= wig * 0.6;
            // Combined Forces
            const mF = getMigrationForce(f, t), eF = getEventForce(f);
            ax += mF.fx + eF.fx; ay += mF.fy + eF.fy;
            const drag = 0.94 + (f.isLarge ? -0.005 : 0.01);
            f.vx = (f.vx + ax * dt * 0.14 * speedFactor) * drag; f.vy = (f.vy + ay * dt * 0.14 * speedFactor) * drag;
            const v = Math.hypot(f.vx, f.vy), vM = (f.isLarge ? 16 : 18) * speedFactor * (dist < 350 ? 2 : 1);
            if (v > vM) { f.vx = (f.vx / v) * vM; f.vy = (f.vy / v) * vM; }
            f.x += f.vx * dt * 0.1; f.y += f.vy * dt * 0.1;
            if (f.x < -60) f.x = W + 60; else if (f.x > W + 60) f.x = -60;
            if (f.y < -60) f.y = H + 60; else if (f.y > H + 60) f.y = -60;
        }
    }

    function drawBackground(t) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#061a28'); g.addColorStop(1, '#02070e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // ---------- Main Loop ----------
    resize(); spawnFish(settings.fishCount);
    let lastT = performance.now();
    function frame() {
        const t = performance.now(); const dt = Math.min(50, t - lastT); lastT = t;
        drawBackground(t); drawGodRays(t); drawSnow(t);
        step(dt, t);
        const depthOrder = ['background', 'midground', 'foreground'];
        for (const layer of depthOrder) {
            for (let pass = 0; pass < 2; pass++) {
                for (const f of fish) {
                    if (f.depthLayer === layer && f.isLarge === (pass === 1)) drawFish(f, t);
                }
            }
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
