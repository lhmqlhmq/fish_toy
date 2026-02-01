import { audio } from './audio.js';

export function initSimulation(canvasId, config = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // ---------- Settings ----------
    let SPEED = config.speed || 0.4;
    let targetFishCount = config.fishCount || 1350;
    const settings = { gain: config.gain || 1.0 };

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
        const u = smoothstep(xf);
        const v = smoothstep(yf);
        return lerp(lerp(a, hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
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
    const currentLines = [];
    let densityGlow = 0;

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
        initCurrentLines();
    }
    window.addEventListener('resize', resize, { passive: true });

    // ---------- Pointer ----------
    const hint = document.getElementById('hint');
    window.addEventListener('pointermove', (e) => {
        const now = performance.now();
        const dt = Math.max(1, now - pointer.lastT);
        const nx = e.clientX, ny = e.clientY;
        pointer.vx = (nx - pointer.x) / dt;
        pointer.vy = (ny - pointer.y) / dt;
        pointer.x = nx; pointer.y = ny; pointer.lastT = now;
        pointer.idle = 0;
        if (hint) hint.classList.add('off');
    }, { passive: true });

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

    // ---------- Visual Systems ----------
    function initSnow() {
        snow.length = 0;
        for (let i = 0; i < 180; i++) {
            snow.push({
                x: Math.random() * W, y: Math.random() * H,
                z: rand(0.35, 1.0),
                vx: rand(-0.15, 0.15), vy: rand(0.15, 0.45),
                r: rand(0.6, 2.2), a: rand(0.08, 0.18)
            });
        }
    }

    function initGodRays() {
        godRays.length = 0;
        for (let i = 0; i < 5; i++) {
            godRays.push({
                x: rand(W * 0.1, W * 0.9), width: rand(120, 240),
                speed: rand(0.008, 0.015), phase: rand(0, Math.PI * 2),
                alpha: rand(0.03, 0.06), drift: rand(-0.02, 0.02)
            });
        }
    }

    function initCurrentLines() {
        currentLines.length = 0;
        for (let i = 0; i < 12; i++) {
            currentLines.push({
                y: rand(H * 0.1, H * 0.9), phase: rand(0, Math.PI * 2),
                speed: rand(0.0001, 0.0003), width: rand(1, 2)
            });
        }
    }

    // ---------- Fish Core ----------
    function spawnFish(count) {
        const silverTypes = [
            { baseHue: 204, satRange: [6, 18] }, { baseHue: 212, satRange: [8, 22] }, { baseHue: 196, satRange: [4, 16] }
        ];
        for (let i = 0; i < count; i++) {
            const roll = Math.random();
            const isColorful = roll < 0.04;
            const isLarge = roll >= 0.04 && roll < 0.11;
            const colorType = roll < 0.04 ? { baseHue: 35, satRange: [40, 60] } : silverTypes[randInt(0, 2)];
            const f = {
                x: Math.random() * W, y: Math.random() * H,
                vx: rand(-1, 1), vy: rand(-1, 1),
                size: isLarge ? rand(5.0, 8.0) : rand(3.4, 5.2),
                isLarge, isColorful,
                baseHue: colorType.baseHue + rand(-6, 6),
                baseSatMin: colorType.satRange[0], baseSatMax: colorType.satRange[1],
                phase: rand(0, 1000), bodyTone: rand(-6, 6),
                currentAngle: 0, angleSmoothing: rand(0.04, 0.07),
                bodyPhase: Math.random() * Math.PI * 2,
                bodyWaveSpeed: rand(0.009, 0.014),
                scaleShimmer: rand(0.85, 1.15),
                breakout: 0, wander: rand(0.8, 1.2), hueSeed: Math.random()
            };
            assignDepthLayer(f);
            fish.push(f);
        }
    }

    function assignDepthLayer(f) {
        const r = Math.random();
        if (r < 0.15) { f.depthLayer = 'foreground'; f.depthScale = rand(1.18, 1.35); f.depthAlpha = 1.0; }
        else if (r < 0.85) { f.depthLayer = 'midground'; f.depthScale = rand(0.92, 1.08); f.depthAlpha = rand(0.8, 1.0); }
        else { f.depthLayer = 'background'; f.depthScale = rand(0.65, 0.82); f.depthAlpha = rand(0.4, 0.62); }
    }

    function drawFish(f, t) {
        const dx = f.x - pointer.x, dy = f.y - pointer.y, d = Math.max(1, Math.hypot(dx, dy));
        const near = 1 - Math.min(1, d / (Math.min(W, H) * 0.65));
        const nearPow = Math.pow(near, 0.6);
        const spd = Math.hypot(f.vx, f.vy);

        const hue = f.baseHue + f.bodyTone + Math.sin(t * 0.0008 + f.phase) * 3;
        const sat = lerp(f.baseSatMin, f.baseSatMax + (f.isColorful ? 25 : 10), nearPow) + spd * 2.2;
        const flash = migration.flashIntensity * 22 * (0.5 + Math.random() * 0.5);
        const lit = lerp(36, 64, nearPow) + flash + f.bodyTone * 0.5 + (f.isColorful ? 6 : 0);
        const alpha = lerp(0.25, 0.96, Math.pow(near, 0.5)) * f.depthAlpha;

        const targetAngle = Math.atan2(f.vy, f.vx);
        let angleDiff = targetAngle - f.currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        f.currentAngle += angleDiff * f.angleSmoothing;
        const ang = f.currentAngle, s = f.size * f.depthScale;

        f.bodyPhase += f.bodyWaveSpeed * (1 + spd * 0.45);
        const bW = Math.sin(f.bodyPhase) * 0.09 * (1 + spd * 0.25);
        const tailS = Math.sin(f.bodyPhase - 0.75) * (0.2 + spd * 0.15);

        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(ang);

        // Body
        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, `hsla(${hue + 4},${sat + 4}%,${lit - 22}%,${alpha})`);
        grad.addColorStop(0.35, `hsla(${hue},${sat}%,${lit - 4}%,${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue - 2},${sat}%,${lit + 12}%,${alpha})`);
        grad.addColorStop(1, `hsla(${hue - 6},${sat - 6}%,${lit + 6}%,${alpha * 0.9})`);
        ctx.fillStyle = grad;

        const w1 = bW * s * 0.5, w2 = bW * s * 0.82;
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
        ctx.quadraticCurveTo(-s * 2.6, -s * 0.35 + tailS * s + tBase, -s * 3.1, -s * 0.75 + tailS * s + tBase);
        ctx.quadraticCurveTo(-s * 2.7, tailS * s * 0.2 + tBase, -s * 3.1, s * 0.75 + tailS * s + tBase);
        ctx.quadraticCurveTo(-s * 2.6, s * 0.35 + tailS * s + tBase, -s * 2.2, tBase);
        ctx.fill();

        // Shimmer (Metallic highlight)
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha * (0.15 + nearPow * 0.4) * f.scaleShimmer;
        const shm = ctx.createLinearGradient(-s * 1.6, 0, s * 1.9, 0);
        shm.addColorStop(0, 'rgba(255,255,255,0)');
        shm.addColorStop(0.4, 'rgba(230,245,255,0.7)');
        shm.addColorStop(0.6, 'rgba(255,255,255,1.0)');
        shm.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = shm; ctx.lineWidth = s * 0.15;
        ctx.beginPath(); ctx.moveTo(s * 1.85, -s * 0.05 + w1 * 0.25);
        ctx.quadraticCurveTo(s * 0.5, -s * 0.2 + w1 * 0.3, -s * 1.6, -s * 0.08 + w2 * 0.3);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';

        // Eye
        if (s > 3.0) {
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = 'rgba(235,245,255,0.85)';
            const eS = s * 0.12;
            ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.08, eS, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(10,20,30,0.95)';
            ctx.beginPath(); ctx.arc(s * 1.64, -s * 0.08, eS * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // ---------- Rendering Extras ----------
    function drawBackground(t) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#061a28'); g.addColorStop(0.48, '#04121d'); g.addColorStop(1, '#02070e');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        ctx.save(); ctx.globalCompositeOperation = 'multiply';
        const vg = ctx.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.4, W * 0.5, H * 0.48, Math.max(W, H) * 0.82);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    function drawGodRays(t) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (const r of godRays) {
            r.x += r.drift; if (r.x < -r.width) r.x = W + r.width; if (r.x > W + r.width) r.x = -r.width;
            const pulse = 0.75 + 0.25 * Math.sin(t * r.speed + r.phase);
            ctx.globalAlpha = r.alpha * pulse;
            const g = ctx.createLinearGradient(r.x, 0, r.x, H);
            g.addColorStop(0, 'rgba(215,240,255,0.4)'); g.addColorStop(1, 'rgba(160,200,240,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); const tw = r.width * 0.65, bw = r.width * 1.9;
            ctx.moveTo(r.x - tw * 0.5, 0); ctx.lineTo(r.x + tw * 0.5, 0);
            ctx.lineTo(r.x + bw * 0.5, H); ctx.lineTo(r.x - bw * 0.5, H); ctx.fill();
        }
        ctx.restore();
    }

    function drawCurrentLines(t) {
        ctx.save(); ctx.globalAlpha = 0.04; ctx.strokeStyle = '#fff';
        for (const l of currentLines) {
            const shift = t * l.speed;
            ctx.lineWidth = l.width; ctx.beginPath();
            for (let x = -50; x < W + 50; x += 100) {
                const y = l.y + Math.sin(x * 0.003 + l.phase + shift) * 20;
                if (x === -50) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawThermalCore(t) {
        const dX = pointer.x, dY = pointer.y;
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(dX, dY, 0, dX, dY, 280);
        g.addColorStop(0, 'rgba(100,200,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(dX, dY, 280, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    function drawDensityGlow() {
        if (fish.length < 1) return;
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(migration.centerX, migration.centerY, 0, migration.centerX, migration.centerY, 450);
        g.addColorStop(0, `rgba(140,220,255,${0.08 * densityGlow})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(migration.centerX, migration.centerY, 450, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // ---------- Migration ----------
    const migration = {
        angle: Math.random() * Math.PI * 2, targetAngle: Math.random() * Math.PI * 2,
        strength: 0.16, breathPhase: 0, breathSpeed: 0.0008, waveOrigin: { x: W * 0.5, y: H * 0.5 },
        waveTime: 0, speedPhase: 0, speedMod: 1.0, centerX: W * 0.5, centerY: H * 0.5, flashIntensity: 0
    };
    const subSchools = [];
    function initSubSchools() {
        subSchools.length = 0;
        for (let i = 0; i < 4; i++) {
            subSchools.push({
                x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.8),
                vx: rand(-0.25, 0.25), vy: rand(-0.25, 0.25), radius: rand(180, 320), strength: rand(0.35, 0.65), phase: rand(0, Math.PI * 2)
            });
        }
    }
    function updateMigration(dt, t) {
        if (Math.random() < 0.0012) migration.targetAngle = Math.random() * Math.PI * 2;
        let diff = migration.targetAngle - migration.angle;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        migration.angle += diff * 0.0025 * dt * 0.06;
        migration.flashIntensity = Math.abs(diff) > 0.32 ? Math.min(1, migration.flashIntensity + dt * 0.0022) : migration.flashIntensity * 0.985;
        migration.breathPhase += migration.breathSpeed * dt;
        migration.speedPhase += dt * 0.00035;
        migration.speedMod = 0.72 + 0.32 * Math.sin(migration.speedPhase);
        migration.waveTime += dt * 0.0022;
        if (fish.length > 0) {
            let cx = 0, cy = 0; for (const f of fish) { cx += f.x; cy += f.y; }
            migration.centerX = lerp(migration.centerX, cx / fish.length, 0.025);
            migration.centerY = lerp(migration.centerY, cy / fish.length, 0.025);
        }
    }

    // ---------- Main Simulation Step ----------
    function step(dt, t) {
        updateMigration(dt, t);
        rebuildGrid(fish);
        const speedFactor = SPEED;
        const baseDrag = 0.945, accel = 0.145, stepK = 0.105;

        for (let i = 0; i < fish.length; i++) {
            const f = fish[i];
            if (f.breakout > 0) f.breakout -= dt; else if (Math.random() < 0.0006) f.breakout = rand(300, 900);

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
                        if (d2 > 65 * 65) continue;
                        const d = Math.sqrt(d2) + 0.001;
                        avx += o.vx; avy += o.vy; cox += o.x; coy += o.y;
                        const sRad = f.isLarge ? 48 : 28; if (d < sRad) { const p = (sRad - d) / sRad; sepX -= (dx / d) * p; sepY -= (dy / d) * p; }
                        count++; if (count >= 18) break;
                    }
                    if (count >= 18) break;
                }
                if (count >= 18) break;
            }

            if (count > 0) {
                const inv = 1 / count;
                ax += (avx * inv - f.vx) * 0.38 + (cox * inv - f.x) * 0.00015 + sepX * 0.98;
                ay += (avy * inv - f.vy) * 0.38 + (coy * inv - f.y) * 0.00015 + sepY * 0.98;
            }

            // Plume Attraction
            const pdx = pointer.x - f.x, pdy = pointer.y - f.y, dist = Math.max(1, Math.hypot(pdx, pdy));
            const heat = Math.exp(-dist / 620) * 0.75 + 0.38 * Math.max(0, 1 - dist / Math.max(W, H));
            const pB = dist < 260 ? (1 + (260 - dist) / 85) : 1;
            ax += (pdx / dist) * heat * 4.6 * pB; ay += (pdy / dist) * heat * 4.6 * pB;

            // Global Direction
            ax += Math.cos(migration.angle) * migration.strength * 0.35;
            ay += Math.sin(migration.angle) * migration.strength * 0.35;

            // Wander
            const n = fbm(f.x * 0.004 + t * 0.00008, f.y * 0.004 + t * 0.00006);
            f.phase += dt * 0.0022; const wig = (Math.sin(f.phase + f.hueSeed * 6.28) + (n - 0.5)) * 0.2 * f.wander;
            ax += wig; ay -= wig * 0.65;

            const drag = baseDrag + (f.isLarge ? -0.006 : 0.012);
            f.vx = (f.vx + ax * dt * accel * speedFactor * migration.speedMod) * drag;
            f.vy = (f.vy + ay * dt * accel * speedFactor * migration.speedMod) * drag;

            const v = Math.hypot(f.vx, f.vy), vLim = (f.isLarge ? 17 : 19) * speedFactor * (dist < 380 ? 2 : 1);
            if (v > vLim) { f.vx = (f.vx / v) * vLim; f.vy = (f.vy / v) * vLim; }

            f.x += f.vx * dt * stepK; f.y += f.vy * dt * stepK;
            if (f.x < -70) f.x = W + 70; else if (f.x > W + 70) f.x = -70;
            if (f.y < -70) f.y = H + 70; else if (f.y > H + 70) f.y = -70;
        }
        densityGlow = lerp(densityGlow, count > 12 ? 1 : 0, 0.05);
    }

    // ---------- Main Loop ----------
    resize(); spawnFish(targetFishCount);
    let lastT = performance.now();
    function frame() {
        const t = performance.now(); const dt = Math.min(60, t - lastT); lastT = t;
        drawBackground(t);
        drawGodRays(t);
        drawCurrentLines(t);
        drawThermalCore(t);
        drawDensityGlow();

        // Environment particles back
        for (const s of snow) {
            s.x += s.vx * s.z + Math.sin(t * 0.001 + s.y) * 0.1; s.y += s.vy * s.z;
            if (s.x < -20) s.x = W + 20; if (s.x > W + 20) s.x = -20; if (s.y > H + 20) s.y = -20;
            ctx.globalAlpha = s.a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2); ctx.fill();
        }

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
