// ─────────────────────────────────────────────────────────────────────
// Simulación autoritativa de fútbol (corre SOLO en el server)
// Coordenadas: cancha en el plano XZ. Arcos en los extremos del eje X.
// Equipo "us" ataca hacia +X, "them" ataca hacia -X.
// ─────────────────────────────────────────────────────────────────────

export const FIELD = {
  minX: -30, maxX: 30,   // largo
  minZ: -18, maxZ: 18,   // ancho
  goalHalfWidth: 4.5,    // media boca del arco (en Z)
  groundY: 0.11,
};

const PLAYER_SPEED = 6.5;
const SPRINT_MULT = 1.5;
const BALL_FRICTION = 1.4;     // desaceleración por seg (rasante)
const POSSESS_DIST = 1.1;      // distancia para tomar la pelota
const KICK_POWER = 22;
const PASS_POWER_BASE = 9;
const MATCH_DURATION = 180;    // segundos

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// ── Inicializa posiciones de un partido 2v2 (+ bots de relleno opcional) ──
export function setupKickoff(state) {
  let idx = 0;
  state.players.forEach((p) => {
    const sign = p.team === "us" ? -1 : 1;            // arrancan en su mitad
    const row = idx % 2;
    p.x = sign * (6 + row * 5);
    p.z = (idx % 2 === 0 ? -4 : 4);
    p.rot = p.team === "us" ? 0 : Math.PI;
    p.anim = "idle";
    p.hasBall = false;
    idx++;
  });
  state.ball.x = 0; state.ball.y = FIELD.groundY; state.ball.z = 0;
  state.ballOwner = "";
}

// ── Tick principal ────────────────────────────────────────────────────
// inputs: { [playerId]: { mx, mz, kick, pass, sprint } }
export function stepMatch(state, inputs, ball, dt) {
  if (state.phase !== "playing") {
    // en gol/espera solo congelamos
    return;
  }

  state.matchTime += dt;
  if (state.matchTime >= MATCH_DURATION) {
    state.phase = "ended";
    return;
  }

  // 1) Mover jugadores según sus inputs
  state.players.forEach((p) => {
    const inp = inputs[p.id] || { mx: 0, mz: 0, kick: false, pass: false, sprint: false };
    const len = Math.hypot(inp.mx, inp.mz);
    if (len > 0.05) {
      const spd = PLAYER_SPEED * (inp.sprint ? SPRINT_MULT : 1);
      const nx = clamp(p.x + (inp.mx / len) * spd * dt, FIELD.minX, FIELD.maxX);
      const nz = clamp(p.z + (inp.mz / len) * spd * dt, FIELD.minZ, FIELD.maxZ);
      p.x = nx; p.z = nz;
      p.rot = Math.atan2(inp.mx, inp.mz);
      p.anim = "run";
    } else {
      p.anim = "idle";
    }

    // Si tiene la pelota, la pelota lo sigue pegada al pie
    if (state.ballOwner === p.id) {
      const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
      ball.x = p.x + fx * 0.6;
      ball.z = p.z + fz * 0.6;
      ball.vx = 0; ball.vz = 0; ball.vy = 0;
      ball.y = FIELD.groundY;

      // Acciones
      if (inp.kick) doKick(state, p, ball, KICK_POWER);
      else if (inp.pass) doPass(state, p, ball);
    }
  });

  // 2) Física de la pelota (si está suelta)
  if (!state.ballOwner) {
    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;
    ball.y += ball.vy * dt;
    ball.vy -= 18 * dt;                       // gravedad
    if (ball.y <= FIELD.groundY) { ball.y = FIELD.groundY; ball.vy = Math.abs(ball.vy) * 0.35; if (ball.vy < 0.5) ball.vy = 0; }

    // fricción rasante
    const sp = Math.hypot(ball.vx, ball.vz);
    if (sp > 0.01) {
      const nf = Math.max(0, sp - BALL_FRICTION * dt) / sp;
      ball.vx *= nf; ball.vz *= nf;
    }

    // 3) ¿Alguien la toma? (el más cercano dentro de POSSESS_DIST)
    let owner = null, od = POSSESS_DIST * POSSESS_DIST;
    state.players.forEach((p) => {
      const d = dist2(p.x, p.z, ball.x, ball.z);
      if (d < od && ball.y < 1.2) { od = d; owner = p; }
    });
    if (owner) { state.ballOwner = owner.id; }

    // 4) Límites / goles / fuera
    handleBounds(state, ball);
  }

  // sincronizar pos visible de la pelota
  state.ball.x = ball.x; state.ball.y = ball.y; state.ball.z = ball.z;

  // marcar quién tiene la pelota (para el render)
  state.players.forEach((p) => { p.hasBall = (state.ballOwner === p.id); });
}

function doKick(state, p, ball, power) {
  const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
  state.ballOwner = "";
  ball.vx = fx * power; ball.vz = fz * power; ball.vy = 5;
  p.anim = "kick";
}

function doPass(state, p, ball) {
  // pasar al compañero más alineado con la mira
  const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
  let best = null, bestScore = -Infinity;
  state.players.forEach((tm) => {
    if (tm.id === p.id || tm.team !== p.team) return;
    const dx = tm.x - p.x, dz = tm.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const dot = (dx * fx + dz * fz) / d;
    const score = dot * 2 - d * 0.04;
    if (score > bestScore) { bestScore = score; best = tm; }
  });
  state.ballOwner = "";
  if (best) {
    const dx = best.x - p.x, dz = best.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const power = Math.min(16, PASS_POWER_BASE + d * 0.7);
    ball.vx = (dx / d) * power; ball.vz = (dz / d) * power; ball.vy = 1.5;
  } else {
    ball.vx = fx * PASS_POWER_BASE; ball.vz = fz * PASS_POWER_BASE; ball.vy = 1.5;
  }
  p.anim = "kick";
}

function handleBounds(state, ball) {
  const inMouth = Math.abs(ball.z) <= FIELD.goalHalfWidth && ball.y <= 2.2;

  // GOL: pasó la línea de fondo dentro de la boca
  if (inMouth && ball.x > FIELD.maxX) { scoreGoal(state, ball, "us"); return; }
  if (inMouth && ball.x < FIELD.minX) { scoreGoal(state, ball, "them"); return; }

  // Fuera por el fondo (no gol) → reinicio al centro (saque)
  if (ball.x > FIELD.maxX + 1.5 || ball.x < FIELD.minX - 1.5) { resetBall(state, ball); return; }

  // Fuera por los costados → reinicio al centro (simplificado)
  if (ball.z > FIELD.maxZ + 1.5 || ball.z < FIELD.minZ - 1.5) { resetBall(state, ball); return; }
}

function scoreGoal(state, ball, team) {
  if (team === "us") state.scoreUs++; else state.scoreThem++;
  state.phase = "goal";
  resetBall(state, ball);
}

function resetBall(state, ball) {
  ball.x = 0; ball.y = FIELD.groundY; ball.z = 0;
  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  state.ballOwner = "";
  state.ball.x = 0; state.ball.y = FIELD.groundY; state.ball.z = 0;
}

export { MATCH_DURATION };
