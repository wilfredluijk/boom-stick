"use strict";

/* ====================================================================
 * BOOM STICK — Apex Strike
 * Vanilla JS, no canvas. DOM elements positioned with CSS transforms.
 * Coordinate system: world space, origin top-left of #game, +x right, +y down.
 * ==================================================================== */

const W = 1500;
const H = 800;
const GROUND_Y = H - 70;            // top of ground strip
const CANNON_PIVOT_X = 85;
const CANNON_PIVOT_Y = H - 44;
const BARREL_LENGTH = 110;
const TARGET_DT = 1000 / 60;        // physics base step

const STORAGE_KEY = "boomstick.best.v1";

const ENEMY_TYPES = {
    scout:  { hp: 40,  width: 160, height: 80,  baseSpeed: 2.4, score: 100, dropChance: 0.10, bombChance: 0,    altitudeRange: [120, 320] },
    heli:   { hp: 100, width: 220, height: 110, baseSpeed: 1.6, score: 250, dropChance: 0.14, bombChance: 0.004,altitudeRange: [180, 360] },
    heavy:  { hp: 260, width: 280, height: 140, baseSpeed: 1.0, score: 500, dropChance: 0.30, bombChance: 0.012,altitudeRange: [140, 300] },
    jet:    { hp: 60,  width: 90,  height: 36,  baseSpeed: 7.5, score: 350, dropChance: 0.12, bombChance: 0,    altitudeRange: [80,  260] },
    boss:   { hp: 2200,width: 420, height: 210, baseSpeed: 0.6, score: 5000,dropChance: 1.0,  bombChance: 0.020,altitudeRange: [120, 240] },
};

const POWERUPS = ["rapid", "multi", "shield", "nuke", "heal"];

/* ====================================================================
 * Game state
 * ==================================================================== */
const state = {
    started: false,
    paused: false,
    gameOver: false,
    muted: false,
    time: 0,
    lastFrameMs: 0,

    score: 0,
    best: 0,
    wave: 0,
    waveActive: false,
    spawnQueue: [],
    nextSpawnAt: 0,
    waveCleanupTimer: 0,

    hp: 100,
    maxHp: 100,

    combo: 0,
    comboTimer: 0,

    shotsFired: 0,
    shotsHit: 0,

    aimX: 800,
    aimY: 200,
    cannonAngle: -Math.PI / 4,

    fireCooldown: 0,
    baseFireDelay: 200,                 // ms between shots
    rapidUntil: 0,
    multiUntil: 0,
    shieldUntil: 0,

    shakeUntil: 0,
    shakeMag: 0,

    bossActive: false,
};

/* Entity arrays. Each entity stores its own DOM node and position. */
const bullets = [];
const trails = [];
const enemies = [];
const explosions = [];
const shockwaves = [];
const smokes = [];
const particles = [];
const dmgNumbers = [];
const bombs = [];
const powerups = [];
const cloudEntities = [];

/* DOM refs */
let root, game, msgLayer, scoreEl, waveEl, comboEl, hpFill, accEl, bestEl;
let cannonPivot, muzzle, crosshair, cannonBase, powerupBar;
let pauseBtn, muteBtn, startScreen, gameOverScreen, pauseScreen, finalStats;
let cloudsLayer, sky, sun, moon, stars;

/* ====================================================================
 * Audio (synthesized via WebAudio, no asset downloads)
 * ==================================================================== */
const audio = {
    ctx: null,
    master: null,
    enabled: true,
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.5;
            this.master.connect(this.ctx.destination);
        } catch (e) { this.enabled = false; }
    },
    setMuted(m) {
        if (!this.master) return;
        this.master.gain.value = m ? 0 : 0.5;
    },
    blip({ freq = 440, dur = 0.1, type = "square", attack = 0.005, decay = 0.08, vol = 0.2, slide = 0 }) {
        if (!this.ctx || !this.enabled) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
        osc.connect(gain).connect(this.master);
        osc.start(t);
        osc.stop(t + dur + 0.05);
    },
    noise({ dur = 0.25, vol = 0.4, hp = 200 }) {
        if (!this.ctx || !this.enabled) return;
        const t = this.ctx.currentTime;
        const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = hp;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(filt).connect(gain).connect(this.master);
        src.start(t);
        src.stop(t + dur);
    },
    shoot()    { this.blip({ freq: 720, dur: 0.08, type: "square", vol: 0.12, slide: -400 }); },
    explosion(){ this.noise({ dur: 0.45, vol: 0.5, hp: 600 }); this.blip({ freq: 110, dur: 0.25, type: "sawtooth", vol: 0.18, slide: -80 }); },
    hit()      { this.blip({ freq: 1100, dur: 0.05, type: "triangle", vol: 0.1, slide: 200 }); },
    powerup()  { this.blip({ freq: 660, dur: 0.08, vol: 0.18 }); setTimeout(() => this.blip({ freq: 990, dur: 0.12, vol: 0.18 }), 70); },
    damage()   { this.noise({ dur: 0.18, vol: 0.4, hp: 300 }); },
    waveStart(){ this.blip({ freq: 200, dur: 0.12, type: "sine", vol: 0.2 }); setTimeout(() => this.blip({ freq: 400, dur: 0.18, type: "sine", vol: 0.2 }), 120); },
    bossAlarm(){ for (let i = 0; i < 3; i++) setTimeout(() => this.blip({ freq: 220, dur: 0.18, type: "sawtooth", vol: 0.25, slide: 120 }), i * 220); },
};

/* ====================================================================
 * Bootstrap
 * ==================================================================== */
window.addEventListener("DOMContentLoaded", init);

function init() {
    root = document.getElementById("game-root");
    game = document.getElementById("game");
    msgLayer = document.getElementById("message-layer");
    scoreEl = document.getElementById("score");
    waveEl = document.getElementById("wave");
    comboEl = document.getElementById("combo");
    hpFill = document.getElementById("hp-fill");
    accEl = document.getElementById("accuracy");
    bestEl = document.getElementById("best");
    cannonPivot = document.getElementById("cannon-pivot");
    muzzle = document.getElementById("muzzle");
    crosshair = document.getElementById("crosshair");
    cannonBase = document.getElementById("cannon-base");
    powerupBar = document.getElementById("powerup-bar");
    pauseBtn = document.getElementById("pause");
    muteBtn = document.getElementById("mute");
    startScreen = document.getElementById("start-screen");
    gameOverScreen = document.getElementById("gameover-screen");
    pauseScreen = document.getElementById("pause-screen");
    finalStats = document.getElementById("final-stats");
    cloudsLayer = document.getElementById("clouds");
    sky = document.getElementById("sky");
    sun = document.getElementById("sun");
    moon = document.getElementById("moon");
    stars = document.getElementById("stars");

    state.best = Number(localStorage.getItem(STORAGE_KEY) || 0);
    bestEl.textContent = state.best;

    seedClouds();

    /* Input */
    document.addEventListener("mousemove", onMouseMove);
    game.addEventListener("mousedown", onMouseDown);
    game.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKey);

    pauseBtn.addEventListener("click", () => togglePause());
    muteBtn.addEventListener("click", () => toggleMute());
    document.getElementById("start-btn").addEventListener("click", startGame);
    document.getElementById("restart-btn").addEventListener("click", startGame);
    document.getElementById("resume-btn").addEventListener("click", () => togglePause(false));

    requestAnimationFrame(loop);
}

/* ====================================================================
 * Input
 * ==================================================================== */
let mouseDown = false;

function onMouseMove(e) {
    const rect = game.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    state.aimX = (e.clientX - rect.left) * scaleX;
    state.aimY = (e.clientY - rect.top) * scaleY;
    crosshair.style.transform = `translate3d(${state.aimX}px, ${state.aimY}px, 0)`;
}

function onMouseDown(e) {
    if (!state.started || state.paused || state.gameOver) return;
    mouseDown = true;
    audio.init();
    fireFromCannon();
}
function onMouseUp() { mouseDown = false; }

function onKey(e) {
    if (e.code === "Space") { e.preventDefault(); if (state.started && !state.gameOver) togglePause(); }
    else if (e.code === "KeyM") toggleMute();
    else if (e.code === "KeyR") startGame();
    else if (e.code === "Enter" && !state.started) startGame();
}

function togglePause(force) {
    state.paused = (force === undefined) ? !state.paused : force;
    pauseScreen.classList.toggle("hidden", !state.paused);
}

function toggleMute() {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    muteBtn.classList.toggle("muted", state.muted);
    muteBtn.textContent = state.muted ? "✕" : "♪";
}

/* ====================================================================
 * Lifecycle
 * ==================================================================== */
function startGame() {
    /* nuke any leftovers */
    [...bullets, ...trails, ...enemies, ...explosions, ...shockwaves, ...smokes,
     ...particles, ...dmgNumbers, ...bombs, ...powerups].forEach(e => e.el && e.el.remove());
    bullets.length = trails.length = enemies.length = explosions.length = 0;
    shockwaves.length = smokes.length = particles.length = dmgNumbers.length = 0;
    bombs.length = powerups.length = 0;

    Object.assign(state, {
        started: true, paused: false, gameOver: false,
        score: 0, wave: 0, waveActive: false, spawnQueue: [], nextSpawnAt: 0, waveCleanupTimer: 0,
        hp: 100, maxHp: 100,
        combo: 0, comboTimer: 0,
        shotsFired: 0, shotsHit: 0,
        rapidUntil: 0, multiUntil: 0, shieldUntil: 0,
        fireCooldown: 0, shakeUntil: 0, shakeMag: 0,
        bossActive: false,
    });

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    root.classList.remove("low-hp");

    updateHUD();
    audio.init();
    setTimeout(() => startNextWave(), 600);
}

function endGame() {
    state.gameOver = true;
    if (state.score > state.best) {
        state.best = state.score;
        try { localStorage.setItem(STORAGE_KEY, String(state.best)); } catch {}
    }
    const acc = state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
    finalStats.innerHTML = `
        <div class="stat-line"><span class="label">SCORE</span><span class="val">${state.score}</span></div>
        <div class="stat-line"><span class="label">WAVE</span><span class="val">${state.wave}</span></div>
        <div class="stat-line"><span class="label">ACCURACY</span><span class="val">${acc}%</span></div>
        <div class="stat-line"><span class="label">BEST</span><span class="val">${state.best}</span></div>
    `;
    gameOverScreen.classList.remove("hidden");
    bestEl.textContent = state.best;
}

/* ====================================================================
 * Waves
 * ==================================================================== */
function buildWaveQueue(wave) {
    const q = [];
    if (wave % 10 === 0) {
        q.push("boss");
        return q;
    }
    const baseScouts = 3 + Math.floor(wave * 0.7);
    const heliCount  = Math.max(0, Math.floor((wave - 1) * 0.6));
    const heavyCount = Math.max(0, Math.floor((wave - 2) * 0.35));
    const jetCount   = Math.max(0, Math.floor((wave - 3) * 0.4));
    for (let i = 0; i < baseScouts; i++) q.push("scout");
    for (let i = 0; i < heliCount; i++)  q.push("heli");
    for (let i = 0; i < heavyCount; i++) q.push("heavy");
    for (let i = 0; i < jetCount; i++)   q.push("jet");
    /* shuffle */
    for (let i = q.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [q[i], q[j]] = [q[j], q[i]];
    }
    return q;
}

function startNextWave() {
    state.wave += 1;
    state.spawnQueue = buildWaveQueue(state.wave);
    state.waveActive = true;
    state.nextSpawnAt = state.time + 600;
    waveEl.textContent = state.wave;
    if (state.wave % 10 === 0) {
        showBanner(`BOSS — WAVE ${state.wave}`, "boss", 2200);
        audio.bossAlarm();
        state.bossActive = true;
    } else {
        showBanner(`WAVE ${state.wave}`, "", 1600);
        audio.waveStart();
    }
}

/* ====================================================================
 * Spawning
 * ==================================================================== */
function spawnEnemy(type) {
    const def = ENEMY_TYPES[type];
    const fromLeft = type === "jet" ? Math.random() < 0.5 : false; /* helis come from right */
    const altitude = randRange(def.altitudeRange[0], def.altitudeRange[1]);
    const speedScale = 1 + state.wave * 0.04;
    const speed = def.baseSpeed * speedScale * (fromLeft ? 1 : -1);
    const x = fromLeft ? -def.width - 10 : W + 10;

    let el;
    if (type === "jet") {
        el = document.createElement("div");
        el.className = "jet" + (fromLeft ? " flipped" : "");
    } else {
        el = document.createElement("div");
        el.className = "helicopter " + (type === "heli" ? "" : type);
        const hb = document.createElement("div");
        hb.className = "health-bar";
        const hbFill = document.createElement("div");
        hbFill.style.width = "100%";
        hb.appendChild(hbFill);
        el.appendChild(hb);
    }
    game.appendChild(el);

    const enemy = {
        el,
        type,
        x, y: altitude,
        w: def.width, h: def.height,
        vx: speed,
        vy: 0,
        bobPhase: Math.random() * Math.PI * 2,
        baseY: altitude,
        hp: type === "boss" ? def.hp + state.wave * 50 : def.hp + Math.floor(state.wave * 1.5),
        maxHp: 0,
        score: def.score,
        dropChance: def.dropChance,
        bombChance: def.bombChance,
        crashing: false,
        crashRot: 0,
        crashSpin: (Math.random() - 0.5) * 0.04,
        smokeTimer: 0,
        flipped: fromLeft,
    };
    enemy.maxHp = enemy.hp;
    enemies.push(enemy);
    renderEnemy(enemy);
}

function renderEnemy(e) {
    const tx = e.x;
    const ty = e.y + Math.sin(e.bobPhase) * 4;
    if (e.crashing) {
        e.el.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${e.crashRot}rad)`;
    } else if (e.type === "jet") {
        e.el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    } else {
        const flip = e.flipped ? " scaleX(-1)" : "";
        e.el.style.transform = `translate3d(${tx}px, ${ty}px, 0)${flip}`;
    }
}

/* ====================================================================
 * Firing
 * ==================================================================== */
function fireFromCannon() {
    const fireDelay = state.time < state.rapidUntil ? state.baseFireDelay / 3 : state.baseFireDelay;
    if (state.fireCooldown > state.time) return;
    state.fireCooldown = state.time + fireDelay;

    const dx = state.aimX - CANNON_PIVOT_X;
    const dy = state.aimY - CANNON_PIVOT_Y;
    const ang = Math.atan2(dy, dx);
    if (dy > 0) return;                  /* don't fire downward */

    const muzzleX = CANNON_PIVOT_X + Math.cos(ang) * BARREL_LENGTH;
    const muzzleY = CANNON_PIVOT_Y + Math.sin(ang) * BARREL_LENGTH;

    const multi = state.time < state.multiUntil;
    const spreadAngles = multi ? [-0.10, 0, 0.10] : [0];
    spreadAngles.forEach(off => spawnBullet(muzzleX, muzzleY, ang + off, multi));
    state.shotsFired += spreadAngles.length;

    /* muzzle flash */
    muzzle.classList.add("flash");
    setTimeout(() => muzzle.classList.remove("flash"), 60);

    /* recoil */
    cannonPivot.style.transition = "transform 0.05s linear";
    const recoil = -8;
    cannonPivot.dataset.recoil = "1";
    setTimeout(() => { cannonPivot.dataset.recoil = "0"; }, 60);

    audio.shoot();
}

function spawnBullet(x, y, ang, missile) {
    const speed = 16;
    const el = document.createElement("div");
    el.className = "bullet" + (missile ? " missile" : "");
    game.appendChild(el);
    bullets.push({
        el, x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        ttl: 1500,
        damage: missile ? 35 : 25,
        missile,
        ang,
    });
    el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${ang}rad)`;
}

/* ====================================================================
 * Main loop
 * ==================================================================== */
function loop(ts) {
    if (!state.lastFrameMs) state.lastFrameMs = ts;
    const dtMs = Math.min(64, ts - state.lastFrameMs);
    state.lastFrameMs = ts;
    if (state.started && !state.paused && !state.gameOver) {
        state.time += dtMs;
        update(dtMs);
    }
    renderAmbient(ts);
    requestAnimationFrame(loop);
}

function update(dtMs) {
    const dt = dtMs / TARGET_DT;        /* normalized step (1.0 = 60fps frame) */

    if (mouseDown && state.time < state.rapidUntil) fireFromCannon();

    /* aim cannon */
    const dx = state.aimX - CANNON_PIVOT_X;
    const dy = state.aimY - CANNON_PIVOT_Y;
    let target = Math.atan2(dy, dx);
    if (target > 0) target = 0;        /* clamp horizontal */
    state.cannonAngle = target;
    const recoilOff = cannonPivot.dataset.recoil === "1" ? -8 : 0;
    cannonPivot.style.transform = `translate(${recoilOff * Math.cos(target)}px, ${recoilOff * Math.sin(target)}px) rotate(${target}rad)`;

    /* combo decay */
    if (state.combo > 0) {
        state.comboTimer -= dtMs;
        if (state.comboTimer <= 0) {
            state.combo = 0;
            updateHUD();
        }
    }

    /* spawn queue */
    if (state.waveActive && state.spawnQueue.length && state.time >= state.nextSpawnAt) {
        spawnEnemy(state.spawnQueue.shift());
        state.nextSpawnAt = state.time + (state.bossActive ? 0 : randRange(450, 900));
    }
    /* wave clear detection */
    if (state.waveActive && state.spawnQueue.length === 0 && enemies.length === 0) {
        state.waveCleanupTimer += dtMs;
        if (state.waveCleanupTimer >= 1500) {
            state.waveActive = false;
            state.bossActive = false;
            state.waveCleanupTimer = 0;
            const bonus = state.wave * 50;
            state.score += bonus;
            showBanner(`WAVE CLEAR  +${bonus}`, "", 1500);
            updateHUD();
            setTimeout(() => { if (state.started && !state.gameOver) startNextWave(); }, 1800);
        }
    } else {
        state.waveCleanupTimer = 0;
    }

    updateBullets(dt, dtMs);
    updateEnemies(dt, dtMs);
    updateBombs(dt, dtMs);
    updateExplosions(dtMs);
    updateShockwaves(dtMs);
    updateSmoke(dtMs);
    updateParticles(dt, dtMs);
    updateDmgNumbers(dtMs);
    updatePowerups(dt, dtMs);
    updatePowerupBar();

    /* shield aura toggle */
    cannonBase.classList.toggle("shielded", state.time < state.shieldUntil);

    /* low hp visual */
    root.classList.toggle("low-hp", state.hp <= 30);

    /* shake */
    if (state.shakeUntil > state.time) {
        const cls = state.shakeMag >= 3 ? "shake-3" : state.shakeMag >= 2 ? "shake-2" : "shake-1";
        if (!root.classList.contains(cls)) {
            root.classList.remove("shake-1", "shake-2", "shake-3");
            root.classList.add(cls);
        }
    } else if (root.classList.contains("shake-1") || root.classList.contains("shake-2") || root.classList.contains("shake-3")) {
        root.classList.remove("shake-1", "shake-2", "shake-3");
    }
}

/* ====================================================================
 * Bullets
 * ==================================================================== */
function updateBullets(dt, dtMs) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.ttl -= dtMs;
        b.el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0) rotate(${b.ang}rad)`;

        /* spawn trail particle */
        spawnTrail(b.x, b.y, b.missile);

        /* off-screen or expired */
        if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H || b.ttl <= 0) {
            killBullet(i);
            continue;
        }

        /* enemy collisions (AABB on enemy bbox) */
        let hit = null;
        for (let j = 0; j < enemies.length; j++) {
            const e = enemies[j];
            if (e.crashing) continue;
            if (b.x >= e.x && b.x <= e.x + e.w && b.y >= e.y && b.y <= e.y + e.h) {
                hit = e; break;
            }
        }
        if (hit) {
            applyDamage(hit, b.damage, b.x, b.y, b.missile);
            spawnSparks(b.x, b.y, 6, "#ffd070");
            killBullet(i);
        }
    }

    /* bullet trails */
    for (let i = trails.length - 1; i >= 0; i--) {
        const t = trails[i];
        t.life -= dtMs;
        if (t.life <= 0) {
            t.el.remove();
            trails.splice(i, 1);
        } else {
            const a = t.life / t.maxLife;
            t.el.style.opacity = a;
        }
    }
}

function spawnTrail(x, y, missile) {
    const el = document.createElement("div");
    el.className = "bullet-trail";
    if (missile) el.style.background = "rgba(120, 220, 255, 0.85)";
    game.appendChild(el);
    el.style.transform = `translate3d(${x - 2}px, ${y - 2}px, 0)`;
    trails.push({ el, life: 220, maxLife: 220 });
}

function killBullet(i) {
    bullets[i].el.remove();
    bullets.splice(i, 1);
}

/* ====================================================================
 * Enemies
 * ==================================================================== */
function updateEnemies(dt, dtMs) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.bobPhase += 0.04 * dt;

        if (e.crashing) {
            e.vy += 0.18 * dt;
            e.vx *= Math.pow(0.985, dt);
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.crashRot += e.crashSpin * dt;
            e.smokeTimer -= dtMs;
            if (e.smokeTimer <= 0) {
                spawnSmoke(e.x + e.w / 2, e.y + e.h / 2);
                e.smokeTimer = 80;
            }
            renderEnemy(e);
            if (e.y >= GROUND_Y - e.h * 0.4) {
                spawnExplosion(e.x + e.w / 2, GROUND_Y - 10, 1.5 + (e.type === "heavy" || e.type === "boss" ? 1.2 : 0));
                if (Math.random() < e.dropChance) spawnPowerup(e.x + e.w / 2, GROUND_Y - 30);
                e.el.remove();
                enemies.splice(i, 1);
                shake(e.type === "boss" ? 3 : e.type === "heavy" ? 2 : 1);
            }
            continue;
        }

        /* boss hovers + sweeps */
        if (e.type === "boss") {
            e.vx = Math.cos(state.time * 0.0008) * 1.2;
            e.y = e.baseY + Math.sin(state.time * 0.0014) * 30;
        }

        e.x += e.vx * dt;

        /* random bomb drop */
        if (e.bombChance > 0 && Math.random() < e.bombChance * dt) {
            spawnBomb(e.x + e.w / 2, e.y + e.h);
        }

        /* off-screen wraparound -> just despawn */
        if ((e.vx < 0 && e.x < -e.w - 20) || (e.vx > 0 && e.x > W + 20)) {
            /* enemy escaped — small player penalty: lose combo */
            state.combo = 0;
            e.el.remove();
            enemies.splice(i, 1);
            continue;
        }

        renderEnemy(e);
    }
}

function applyDamage(enemy, dmg, x, y, crit) {
    if (enemy.crashing) return;
    enemy.hp -= dmg;
    spawnDmgNumber(x, y, dmg, crit);
    audio.hit();
    const bar = enemy.el.querySelector(".health-bar > div");
    if (bar) {
        const pct = Math.max(0, enemy.hp / enemy.maxHp) * 100;
        bar.style.width = pct + "%";
    }
    if (enemy.hp <= 0) destroyEnemy(enemy);
}

function destroyEnemy(e) {
    e.crashing = true;
    e.vy = 0.5;
    e.crashSpin = (Math.random() - 0.5) * 0.06;
    /* award score with combo multiplier */
    state.combo += 1;
    state.comboTimer = 2200;
    state.shotsHit += 1;
    const mult = 1 + state.combo * 0.1;
    const award = Math.round(e.score * mult);
    state.score += award;
    spawnComboPop(e.x + e.w / 2, e.y, `+${award}` + (state.combo > 1 ? `  x${state.combo}` : ""));
    if (Math.random() < e.dropChance && e.type !== "boss") spawnPowerup(e.x + e.w / 2, e.y + 20);
    if (e.type === "jet") {
        spawnExplosion(e.x + e.w / 2, e.y + e.h / 2, 1.2);
        e.el.remove();
        const idx = enemies.indexOf(e);
        if (idx !== -1) enemies.splice(idx, 1);
        if (Math.random() < e.dropChance) spawnPowerup(e.x + e.w / 2, e.y + 30);
    }
    updateHUD();
}

/* ====================================================================
 * Bombs
 * ==================================================================== */
function spawnBomb(x, y) {
    const el = document.createElement("div");
    el.className = "bomb";
    game.appendChild(el);
    bombs.push({ el, x, y, vx: 0, vy: 1 });
}

function updateBombs(dt, dtMs) {
    const cannonRect = { x: 30, y: H - 80, w: 110, h: 80 };
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.vy += 0.07 * dt;
        b.y += b.vy * dt;
        b.el.style.transform = `translate3d(${b.x - 8}px, ${b.y - 12}px, 0) rotate(${b.vy * 0.2}rad)`;

        /* bullet intercept */
        let intercepted = false;
        for (let j = bullets.length - 1; j >= 0; j--) {
            const bu = bullets[j];
            if (Math.abs(bu.x - b.x) < 14 && Math.abs(bu.y - b.y) < 18) {
                spawnExplosion(b.x, b.y, 0.7);
                killBullet(j);
                state.shotsHit += 1;
                state.score += 25;
                intercepted = true;
                break;
            }
        }
        if (intercepted) {
            b.el.remove();
            bombs.splice(i, 1);
            continue;
        }

        /* hit ground or cannon */
        const hitCannon = b.x >= cannonRect.x && b.x <= cannonRect.x + cannonRect.w &&
                          b.y >= cannonRect.y && b.y <= cannonRect.y + cannonRect.h;
        if (b.y >= GROUND_Y || hitCannon) {
            spawnExplosion(b.x, Math.min(b.y, GROUND_Y - 8), 1.0);
            shake(2);
            if (hitCannon) damagePlayer(20);
            else damagePlayer(8);
            b.el.remove();
            bombs.splice(i, 1);
        }
    }
}

function damagePlayer(amount) {
    if (state.time < state.shieldUntil) return;
    state.hp -= amount;
    state.combo = 0;
    audio.damage();
    flashHud();
    if (state.hp <= 0) {
        state.hp = 0;
        updateHUD();
        spawnExplosion(CANNON_PIVOT_X, CANNON_PIVOT_Y - 10, 2.5);
        shake(3);
        endGame();
        return;
    }
    updateHUD();
}

/* ====================================================================
 * Explosions, smoke, shockwaves, sparks
 * ==================================================================== */
function spawnExplosion(x, y, scale = 1) {
    const el = document.createElement("div");
    el.className = "explosion";
    game.appendChild(el);
    explosions.push({ el, x, y, scale, life: 0, maxLife: 360, hitDone: false, radius: 50 * scale });

    const sw = document.createElement("div");
    sw.className = "shockwave";
    game.appendChild(sw);
    shockwaves.push({ el: sw, x, y, life: 0, maxLife: 380, scale });

    /* sparks */
    spawnSparks(x, y, 14 + Math.floor(scale * 8), "#ffb050");

    audio.explosion();
}

function updateExplosions(dtMs) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        e.life += dtMs;
        const t = e.life / e.maxLife;
        const s = (0.4 + t * 1.2) * e.scale;
        const alpha = 1 - t;
        e.el.style.transform = `translate3d(${e.x - 40 * s}px, ${e.y - 40 * s}px, 0) scale(${s})`;
        e.el.style.opacity = alpha;

        /* one-time AOE damage */
        if (!e.hitDone && e.life > 60) {
            e.hitDone = true;
            for (let k = 0; k < enemies.length; k++) {
                const en = enemies[k];
                if (en.crashing) continue;
                const cx = en.x + en.w / 2;
                const cy = en.y + en.h / 2;
                const d = Math.hypot(cx - e.x, cy - e.y);
                if (d <= e.radius + Math.max(en.w, en.h) * 0.3) {
                    applyDamage(en, 15 * e.scale, cx, cy, false);
                }
            }
        }

        if (e.life >= e.maxLife) {
            spawnSmoke(e.x, e.y);
            e.el.remove();
            explosions.splice(i, 1);
        }
    }
}

function updateShockwaves(dtMs) {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        s.life += dtMs;
        const t = s.life / s.maxLife;
        const sc = (0.5 + t * 6) * s.scale;
        s.el.style.transform = `translate3d(${s.x - 15 * sc}px, ${s.y - 15 * sc}px, 0) scale(${sc})`;
        s.el.style.opacity = (1 - t) * 0.9;
        if (s.life >= s.maxLife) {
            s.el.remove();
            shockwaves.splice(i, 1);
        }
    }
}

function spawnSmoke(x, y) {
    const el = document.createElement("div");
    el.className = "smoke-cloud";
    game.appendChild(el);
    smokes.push({
        el, x, y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -0.4 - Math.random() * 0.3,
        scale: 0.6 + Math.random() * 0.6,
        life: 0, maxLife: 1800,
    });
}

function updateSmoke(dtMs) {
    const dt = dtMs / TARGET_DT;
    for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life += dtMs;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.scale += 0.005 * dt;
        const t = s.life / s.maxLife;
        s.el.style.transform = `translate3d(${s.x - 35 * s.scale}px, ${s.y - 35 * s.scale}px, 0) scale(${s.scale})`;
        s.el.style.opacity = (1 - t) * 0.8;
        if (s.life >= s.maxLife) {
            s.el.remove();
            smokes.splice(i, 1);
        }
    }
}

function spawnSparks(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 5;
        const el = document.createElement("div");
        el.className = "particle";
        el.style.background = color || "#ffd070";
        el.style.boxShadow = `0 0 6px ${color || "#ffd070"}`;
        game.appendChild(el);
        particles.push({
            el, x, y,
            vx: Math.cos(ang) * sp,
            vy: Math.sin(ang) * sp - 1,
            gravity: 0.18,
            life: 0,
            maxLife: 400 + Math.random() * 400,
            size: 2 + Math.random() * 3,
        });
    }
}

function updateParticles(dt, dtMs) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dtMs;
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const t = p.life / p.maxLife;
        p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${(1 - t) * 1.2 + 0.4})`;
        p.el.style.opacity = 1 - t;
        if (p.life >= p.maxLife || p.y > GROUND_Y + 10) {
            p.el.remove();
            particles.splice(i, 1);
        }
    }
}

/* ====================================================================
 * Damage numbers / combo pops
 * ==================================================================== */
function spawnDmgNumber(x, y, dmg, crit) {
    const el = document.createElement("div");
    el.className = "dmg-num" + (crit ? " crit" : "");
    el.textContent = Math.round(dmg);
    game.appendChild(el);
    dmgNumbers.push({
        el, x, y,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -2.2,
        life: 0,
        maxLife: 800,
    });
}

function spawnComboPop(x, y, text) {
    const el = document.createElement("div");
    el.className = "combo-pop";
    el.textContent = text;
    game.appendChild(el);
    dmgNumbers.push({
        el, x, y,
        vx: 0, vy: -1.4,
        life: 0,
        maxLife: 1100,
    });
}

function updateDmgNumbers(dtMs) {
    const dt = dtMs / TARGET_DT;
    for (let i = dmgNumbers.length - 1; i >= 0; i--) {
        const d = dmgNumbers[i];
        d.life += dtMs;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vy += 0.04 * dt;
        const t = d.life / d.maxLife;
        d.el.style.transform = `translate3d(${d.x}px, ${d.y}px, 0)`;
        d.el.style.opacity = 1 - t;
        if (d.life >= d.maxLife) {
            d.el.remove();
            dmgNumbers.splice(i, 1);
        }
    }
}

/* ====================================================================
 * Power-ups
 * ==================================================================== */
function spawnPowerup(x, y) {
    const types = ["rapid", "multi", "shield", "nuke", "heal"];
    const weights = [3, 3, 2, 1, state.hp < 60 ? 3 : 1];
    const type = weightedPick(types, weights);
    const el = document.createElement("div");
    el.className = "powerup " + type;
    el.textContent = puIcon(type);
    game.appendChild(el);
    powerups.push({
        el, x, y,
        vy: 0,
        bob: Math.random() * Math.PI * 2,
        type,
        life: 0, maxLife: 9000,
    });
}

function puIcon(t) {
    return ({ rapid: "R", multi: "M", shield: "S", nuke: "N", heal: "+" })[t];
}

function updatePowerups(dt, dtMs) {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        p.life += dtMs;
        p.vy += 0.05 * dt;
        if (p.y < GROUND_Y - 40) p.y += p.vy * dt;
        p.bob += 0.08 * dt;
        const pulse = 1 + Math.sin(p.bob) * 0.08;
        p.el.style.transform = `translate3d(${p.x - 18}px, ${p.y - 18}px, 0) scale(${pulse})`;

        /* bullet/aim collect — easier: bullet hit */
        let collected = false;
        for (let j = bullets.length - 1; j >= 0; j--) {
            const b = bullets[j];
            if (Math.abs(b.x - p.x) < 24 && Math.abs(b.y - p.y) < 24) {
                collected = true;
                killBullet(j);
                break;
            }
        }
        /* auto-collect when near ground (forgiving) */
        if (!collected && p.y >= GROUND_Y - 40) collected = true;

        if (collected) {
            applyPowerup(p.type);
            p.el.remove();
            powerups.splice(i, 1);
            continue;
        }

        if (p.life >= p.maxLife) {
            p.el.remove();
            powerups.splice(i, 1);
        }
    }
}

function applyPowerup(type) {
    audio.powerup();
    if (type === "rapid")  { state.rapidUntil = state.time + 8000;  showBanner("RAPID FIRE", "", 900); }
    if (type === "multi")  { state.multiUntil = state.time + 7000;  showBanner("MULTI-SHOT", "", 900); }
    if (type === "shield") { state.shieldUntil = state.time + 6000; showBanner("SHIELD UP", "", 900); }
    if (type === "heal")   { state.hp = Math.min(state.maxHp, state.hp + 35); showBanner("HULL REPAIR", "", 900); updateHUD(); }
    if (type === "nuke")   { nukeAllEnemies(); showBanner("NUKE!", "warn", 1100); }
}

function nukeAllEnemies() {
    shake(3);
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        spawnExplosion(e.x + e.w / 2, e.y + e.h / 2, 1.4);
        applyDamage(e, 9999, e.x + e.w / 2, e.y + e.h / 2, true);
    }
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        spawnExplosion(b.x, b.y, 0.7);
        b.el.remove();
        bombs.splice(i, 1);
    }
}

function updatePowerupBar() {
    const items = [];
    if (state.time < state.rapidUntil)  items.push({ name: "RAPID",  t: state.rapidUntil  - state.time, color: "#ffd23f" });
    if (state.time < state.multiUntil)  items.push({ name: "MULTI",  t: state.multiUntil  - state.time, color: "#41e0a4" });
    if (state.time < state.shieldUntil) items.push({ name: "SHIELD", t: state.shieldUntil - state.time, color: "#50b8ff" });
    powerupBar.innerHTML = "";
    items.forEach(it => {
        const d = document.createElement("div");
        d.className = "powerup-icon";
        d.style.color = it.color;
        d.innerHTML = `<div class="pu-time">${(it.t / 1000).toFixed(1)}</div><div class="pu-name">${it.name}</div>`;
        powerupBar.appendChild(d);
    });
}

/* ====================================================================
 * HUD / banners / shake
 * ==================================================================== */
function updateHUD() {
    scoreEl.textContent = state.score;
    waveEl.textContent = state.wave;
    comboEl.textContent = "x" + state.combo;
    comboEl.classList.toggle("combo-hot", state.combo >= 5);
    const acc = state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 100;
    accEl.textContent = acc + "%";
    const pct = Math.max(0, state.hp / state.maxHp) * 100;
    hpFill.style.width = pct + "%";
    hpFill.classList.toggle("low", state.hp <= 30);
    bestEl.textContent = Math.max(state.best, state.score);
}

function showBanner(text, cls, dur) {
    const el = document.createElement("div");
    el.className = "banner " + (cls || "");
    el.textContent = text;
    msgLayer.appendChild(el);
    setTimeout(() => el.remove(), dur);
}

function flashHud() {
    hpFill.style.background = "#ff3030";
    setTimeout(() => { hpFill.style.background = ""; }, 120);
}

function shake(mag) {
    state.shakeUntil = state.time + (mag === 3 ? 500 : mag === 2 ? 320 : 180);
    state.shakeMag = mag;
}

/* ====================================================================
 * Ambient: clouds, day/night cycle
 * ==================================================================== */
function seedClouds() {
    for (let i = 0; i < 7; i++) {
        const el = document.createElement("div");
        el.className = "cloud";
        const w = 180 + Math.random() * 240;
        const h = 50 + Math.random() * 30;
        el.style.width = w + "px";
        el.style.height = h + "px";
        cloudsLayer.appendChild(el);
        cloudEntities.push({
            el,
            x: Math.random() * W,
            y: 30 + Math.random() * 260,
            speed: 0.15 + Math.random() * 0.4,
        });
    }
}

function renderAmbient(ts) {
    /* clouds drift */
    cloudEntities.forEach(c => {
        c.x -= c.speed;
        if (c.x < -300) c.x = W + 60;
        c.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
    });

    /* day/night cycle: full cycle per 3 minutes */
    const T = (ts / 180000) % 1;          /* 0..1 */
    const sunAng = T * Math.PI * 2 - Math.PI / 2;
    const cx = W * 0.5;
    const radius = H * 0.6;
    const sunX = cx + Math.cos(sunAng) * radius;
    const sunY = H * 0.55 + Math.sin(sunAng) * radius;
    const moonX = cx + Math.cos(sunAng + Math.PI) * radius;
    const moonY = H * 0.55 + Math.sin(sunAng + Math.PI) * radius;
    sun.style.transform = `translate3d(${sunX - 55}px, ${sunY - 55}px, 0)`;
    moon.style.transform = `translate3d(${moonX - 40}px, ${moonY - 40}px, 0)`;

    const dayness = Math.max(0, Math.sin(sunAng + Math.PI / 2));   /* 1 noon, 0 night */
    sun.style.opacity = clamp01(dayness * 1.5);
    moon.style.opacity = clamp01((1 - dayness) * 1.3);
    stars.style.opacity = clamp01((1 - dayness) * 1.2 - 0.1);

    /* sky color shift */
    const top = mixColor([10, 18, 38], [122, 168, 220], dayness);
    const mid = mixColor([24, 38, 70], [180, 210, 235], dayness);
    const bot = mixColor([40, 58, 92], [210, 230, 245], dayness);
    sky.style.setProperty("--sky-top", `rgb(${top.join(",")})`);
    sky.style.setProperty("--sky-mid", `rgb(${mid.join(",")})`);
    sky.style.setProperty("--sky-bot", `rgb(${bot.join(",")})`);
}

/* ====================================================================
 * Utilities
 * ==================================================================== */
function randRange(a, b) { return a + Math.random() * (b - a); }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function mixColor(a, b, t) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}
function weightedPick(items, weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
    }
    return items[items.length - 1];
}
