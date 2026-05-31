// ╔══════════════════════════════════════════════════════════════════╗
// ║  REZONA SERVER · Multijugador 2v2 autoritativo · UN SOLO ARCHIVO   ║
// ║  Node + Colyseus. Subí ESTE archivo + package.json al repo y listo. ║
// ╚══════════════════════════════════════════════════════════════════╝
import http from "http";
import express from "express";
import cors from "cors";
import { Server, Room } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

// ─────────────────────────────────────────────────────────────────────
// 1) ESTADO SINCRONIZADO (lo que ven todos los clientes)
// ─────────────────────────────────────────────────────────────────────
class PlayerState extends Schema {
  constructor() {
    super();
    this.id = ""; this.name = ""; this.team = "us"; this.bot = false;
    this.x = 0; this.z = 0; this.rot = 0; this.anim = "idle"; this.hasBall = false;
  }
}
defineTypes(PlayerState, {
  id: "string", name: "string", team: "string", bot: "boolean",
  x: "number", z: "number", rot: "number", anim: "string", hasBall: "boolean",
});

class BallState extends Schema {
  constructor() { super(); this.x = 0; this.y = 0; this.z = 0; }
}
defineTypes(BallState, { x: "number", y: "number", z: "number" });

class MatchState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.ball = new BallState();
    this.ballOwner = ""; this.scoreUs = 0; this.scoreThem = 0;
    this.matchTime = 0; this.phase = "waiting";
  }
}
defineTypes(MatchState, {
  players: { map: PlayerState }, ball: BallState, ballOwner: "string",
  scoreUs: "number", scoreThem: "number", matchTime: "number", phase: "string",
});

// ─────────────────────────────────────────────────────────────────────
// 2) FÍSICA Y REGLAS (corre solo en el server = anti-trampa)
//    Cancha en plano XZ. Arcos en los extremos del eje X.
//    "us" ataca hacia +X, "them" hacia -X.
// ─────────────────────────────────────────────────────────────────────
const FIELD = { minX: -30, maxX: 30, minZ: -18, maxZ: 18, goalHalfWidth: 4.5, groundY: 0.11 };
const PLAYER_SPEED = 6.5, SPRINT_MULT = 1.5, BALL_FRICTION = 1.4;
const POSSESS_DIST = 1.1, KICK_POWER = 22, PASS_POWER_BASE = 9, MATCH_DURATION = 180;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

function setupKickoff(state) {
  let idx = 0;
  state.players.forEach((p) => {
    const sign = p.team === "us" ? -1 : 1;
    p.x = sign * (6 + (idx % 2) * 5);
    p.z = (idx % 2 === 0 ? -4 : 4);
    p.rot = p.team === "us" ? 0 : Math.PI;
    p.anim = "idle"; p.hasBall = false; idx++;
  });
  state.ball.x = 0; state.ball.y = FIELD.groundY; state.ball.z = 0; state.ballOwner = "";
}

function stepMatch(state, inputs, ball, dt) {
  if (state.phase !== "playing") return;
  state.matchTime += dt;
  if (state.matchTime >= MATCH_DURATION) { state.phase = "ended"; return; }

  // mover jugadores
  state.players.forEach((p) => {
    const inp = inputs[p.id] || { mx: 0, mz: 0, kick: false, pass: false, sprint: false };
    const len = Math.hypot(inp.mx, inp.mz);
    if (len > 0.05) {
      const spd = PLAYER_SPEED * (inp.sprint ? SPRINT_MULT : 1);
      p.x = clamp(p.x + (inp.mx / len) * spd * dt, FIELD.minX, FIELD.maxX);
      p.z = clamp(p.z + (inp.mz / len) * spd * dt, FIELD.minZ, FIELD.maxZ);
      p.rot = Math.atan2(inp.mx, inp.mz); p.anim = "run";
    } else p.anim = "idle";

    if (state.ballOwner === p.id) {
      ball.x = p.x + Math.sin(p.rot) * 0.6;
      ball.z = p.z + Math.cos(p.rot) * 0.6;
      ball.vx = ball.vz = ball.vy = 0; ball.y = FIELD.groundY;
      if (inp.kick) doKick(state, p, ball);
      else if (inp.pass) doPass(state, p, ball);
    }
  });

  // pelota suelta
  if (!state.ballOwner) {
    ball.x += ball.vx * dt; ball.z += ball.vz * dt; ball.y += ball.vy * dt;
    ball.vy -= 18 * dt;
    if (ball.y <= FIELD.groundY) { ball.y = FIELD.groundY; ball.vy = Math.abs(ball.vy) * 0.35; if (ball.vy < 0.5) ball.vy = 0; }
    const sp = Math.hypot(ball.vx, ball.vz);
    if (sp > 0.01) { const nf = Math.max(0, sp - BALL_FRICTION * dt) / sp; ball.vx *= nf; ball.vz *= nf; }

    let owner = null, od = POSSESS_DIST * POSSESS_DIST;
    state.players.forEach((p) => { const d = dist2(p.x, p.z, ball.x, ball.z); if (d < od && ball.y < 1.2) { od = d; owner = p; } });
    if (owner) state.ballOwner = owner.id;

    handleBounds(state, ball);
  }

  state.ball.x = ball.x; state.ball.y = ball.y; state.ball.z = ball.z;
  state.players.forEach((p) => { p.hasBall = (state.ballOwner === p.id); });
}

function doKick(state, p, ball) {
  state.ballOwner = "";
  ball.vx = Math.sin(p.rot) * KICK_POWER; ball.vz = Math.cos(p.rot) * KICK_POWER; ball.vy = 5;
  p.anim = "kick";
}
function doPass(state, p, ball) {
  const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
  let best = null, bestScore = -Infinity;
  state.players.forEach((tm) => {
    if (tm.id === p.id || tm.team !== p.team) return;
    const dx = tm.x - p.x, dz = tm.z - p.z, d = Math.hypot(dx, dz) || 1;
    const score = ((dx * fx + dz * fz) / d) * 2 - d * 0.04;
    if (score > bestScore) { bestScore = score; best = tm; }
  });
  state.ballOwner = "";
  if (best) {
    const dx = best.x - p.x, dz = best.z - p.z, d = Math.hypot(dx, dz) || 1;
    const power = Math.min(16, PASS_POWER_BASE + d * 0.7);
    ball.vx = (dx / d) * power; ball.vz = (dz / d) * power; ball.vy = 1.5;
  } else { ball.vx = fx * PASS_POWER_BASE; ball.vz = fz * PASS_POWER_BASE; ball.vy = 1.5; }
  p.anim = "kick";
}
function handleBounds(state, ball) {
  const inMouth = Math.abs(ball.z) <= FIELD.goalHalfWidth && ball.y <= 2.2;
  if (inMouth && ball.x > FIELD.maxX) return scoreGoal(state, ball, "us");
  if (inMouth && ball.x < FIELD.minX) return scoreGoal(state, ball, "them");
  if (ball.x > FIELD.maxX + 1.5 || ball.x < FIELD.minX - 1.5) return resetBall(state, ball);
  if (ball.z > FIELD.maxZ + 1.5 || ball.z < FIELD.minZ - 1.5) return resetBall(state, ball);
}
function scoreGoal(state, ball, team) {
  if (team === "us") state.scoreUs++; else state.scoreThem++;
  state.phase = "goal"; resetBall(state, ball);
}
function resetBall(state, ball) {
  ball.x = 0; ball.y = FIELD.groundY; ball.z = 0; ball.vx = ball.vy = ball.vz = 0;
  state.ballOwner = ""; state.ball.x = 0; state.ball.y = FIELD.groundY; state.ball.z = 0;
}

// ─────────────────────────────────────────────────────────────────────
// 3) SALA (matchmaking 2v2, inputs, loop a 20Hz)
// ─────────────────────────────────────────────────────────────────────
const TICK_HZ = 20, MAX_HUMANS = 4;

class MatchRoom extends Room {
  onCreate() {
    this.maxClients = MAX_HUMANS;
    this.setState(new MatchState());
    this.ball = { x: 0, y: FIELD.groundY, z: 0, vx: 0, vy: 0, vz: 0 };
    this.inputs = {};

    this.onMessage("input", (client, data) => {
      this.inputs[client.sessionId] = {
        mx: clampNum(data.mx), mz: clampNum(data.mz),
        kick: !!data.kick, pass: !!data.pass, sprint: !!data.sprint,
      };
    });

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
  }

  onJoin(client, options) {
    let us = 0, them = 0;
    this.state.players.forEach((p) => { if (p.team === "us") us++; else them++; });
    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = (options && options.name) ? String(options.name).slice(0, 16) : "Jugador";
    p.team = us <= them ? "us" : "them";
    this.state.players.set(client.sessionId, p);

    if (this.state.players.size >= 2 && this.state.phase === "waiting") {
      setupKickoff(this.state); this.state.phase = "playing";
    }
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    delete this.inputs[client.sessionId];
    if (this.state.players.size < 2 && this.state.phase === "playing") this.state.phase = "waiting";
  }

  tick(dt) {
    if (this.state.phase === "goal") {
      this._g = (this._g || 0) + dt;
      if (this._g > 2.5) { this._g = 0; setupKickoff(this.state); this.state.phase = "playing"; }
      return;
    }
    if (this.state.phase !== "playing") return;
    stepMatch(this.state, this.inputs, this.ball, dt);
  }
}
function clampNum(v) { v = Number(v); return isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

// ─────────────────────────────────────────────────────────────────────
// 4) ARRANQUE
// ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 2567;
const app = express();
app.use(cors());
app.get("/", (_req, res) => res.send("Rezona server OK"));

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define("match", MatchRoom);
server.listen(PORT, () => console.log(`[rezona-server] escuchando en :${PORT}`));
