import { Room } from "@colyseus/core";
import { MatchState, PlayerState } from "./schema.js";
import { setupKickoff, stepMatch, FIELD } from "./sim.js";

const TICK_HZ = 20;
const MAX_HUMANS = 4;   // 2v2

export class MatchRoom extends Room {
  onCreate() {
    this.maxClients = MAX_HUMANS;
    this.setState(new MatchState());
    this.state.phase = "waiting";
    this.state.scoreUs = 0;
    this.state.scoreThem = 0;
    this.state.matchTime = 0;
    this.state.ballOwner = "";

    // física interna (no se sincroniza toda, solo posición)
    this.ball = { x: 0, y: FIELD.groundY, z: 0, vx: 0, vy: 0, vz: 0 };
    this.inputs = {};   // { sessionId: {mx,mz,kick,pass,sprint} }

    // Recibir inputs del cliente
    this.onMessage("input", (client, data) => {
      this.inputs[client.sessionId] = {
        mx: clampNum(data.mx), mz: clampNum(data.mz),
        kick: !!data.kick, pass: !!data.pass, sprint: !!data.sprint,
      };
    });

    // Loop autoritativo
    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
  }

  onJoin(client, options) {
    // Asignar al equipo con menos jugadores
    let us = 0, them = 0;
    this.state.players.forEach((p) => { if (p.team === "us") us++; else them++; });
    const team = us <= them ? "us" : "them";

    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = (options && options.name) ? String(options.name).slice(0, 16) : "Jugador";
    p.team = team;
    p.bot = false;
    p.x = 0; p.z = 0; p.rot = 0; p.anim = "idle"; p.hasBall = false;
    this.state.players.set(client.sessionId, p);

    // Arrancar cuando hay al menos 1 por lado (o 4). Acá: arranca con 2+.
    const total = this.state.players.size;
    if (total >= 2 && this.state.phase === "waiting") {
      setupKickoff(this.state);
      this.state.phase = "playing";
    }
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    delete this.inputs[client.sessionId];
    if (this.state.players.size < 2 && this.state.phase === "playing") {
      this.state.phase = "waiting";   // pausa si queda gente sola
    }
  }

  tick(dt) {
    if (this.state.phase === "goal") {
      // breve pausa de festejo, luego reanuda
      this._goalTimer = (this._goalTimer || 0) + dt;
      if (this._goalTimer > 2.5) { this._goalTimer = 0; setupKickoff(this.state); this.state.phase = "playing"; }
      return;
    }
    if (this.state.phase !== "playing") return;
    stepMatch(this.state, this.inputs, this.ball, dt);
  }
}

function clampNum(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}
