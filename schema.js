import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

// ── Jugador (humano o bot) ───────────────────────────────────────────
export class PlayerState extends Schema {
  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.team = "us";
    this.bot = false;
    this.x = 0;
    this.z = 0;
    this.rot = 0;
    this.anim = "idle";
    this.hasBall = false;
  }
}
defineTypes(PlayerState, {
  id: "string",
  name: "string",
  team: "string",
  bot: "boolean",
  x: "number",
  z: "number",
  rot: "number",
  anim: "string",
  hasBall: "boolean",
});

// ── Pelota ───────────────────────────────────────────────────────────
export class BallState extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }
}
defineTypes(BallState, { x: "number", y: "number", z: "number" });

// ── Estado raíz de la sala ───────────────────────────────────────────
export class MatchState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.ball = new BallState();
    this.ballOwner = "";
    this.scoreUs = 0;
    this.scoreThem = 0;
    this.matchTime = 0;
    this.phase = "waiting";
  }
}
defineTypes(MatchState, {
  players: { map: PlayerState },
  ball: BallState,
  ballOwner: "string",
  scoreUs: "number",
  scoreThem: "number",
  matchTime: "number",
  phase: "string",
});
