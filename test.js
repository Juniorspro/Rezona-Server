import { Client } from "colyseus.js";

const URL = "ws://localhost:2567";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const c1 = new Client(URL);
  const c2 = new Client(URL);

  const r1 = await c1.joinOrCreate("match", { name: "Ana" });
  const r2 = await c2.joinById(r1.roomId, { name: "Beto" });
  console.log("[test] dos clientes unidos a sala", r1.roomId);

  await sleep(300);

  // Verificar que hay 2 jugadores y la fase es playing
  let p1, p2;
  r1.state.players.forEach((p) => { if (p.id === r1.sessionId) p1 = p; });
  console.log("[test] phase:", r1.state.phase, "players:", r1.state.players.size);
  if (r1.state.players.size !== 2) throw new Error("FALLO: no hay 2 jugadores");
  if (r1.state.phase !== "playing") throw new Error("FALLO: no arrancó el partido");

  // Anotar posiciones iniciales
  r1.state.players.forEach((p) => { if (p.id === r1.sessionId) p1 = p; });
  const x0 = p1.x, z0 = p1.z;
  console.log("[test] pos inicial jugador 1:", x0.toFixed(2), z0.toFixed(2), "team", p1.team);

  // Cliente 1 se mueve hacia +X durante 1s
  for (let i = 0; i < 20; i++) { r1.send("input", { mx: 0.2, mz: 1, sprint: true }); await sleep(50); }
  await sleep(200);
  r1.state.players.forEach((p) => { if (p.id === r1.sessionId) p1 = p; });
  console.log("[test] pos tras moverse:", p1.x.toFixed(2), p1.z.toFixed(2), "anim", p1.anim);
  const moved = Math.hypot(p1.x - x0, p1.z - z0);
  if (moved < 1) throw new Error("FALLO: el jugador no se movió (movió " + moved.toFixed(2) + ")");
  console.log("[test] ✓ jugador se mueve por input (" + moved.toFixed(2) + " unidades)");

  // Verificar que la pelota existe y la fase sigue ok
  console.log("[test] pelota en:", r1.state.ball.x.toFixed(2), r1.state.ball.z.toFixed(2));

  // Test de posesión: teletransportamos lógicamente moviendo al jugador hacia la pelota (0,0)
  // El jugador 1 (team us) arranca en x negativo; lo mandamos al centro
  for (let i = 0; i < 60; i++) {
    r1.state.players.forEach((p) => { if (p.id === r1.sessionId) p1 = p; });
    const dx = 0 - p1.x, dz = 0 - p1.z;
    const d = Math.hypot(dx, dz) || 1;
    r1.send("input", { mx: dx / d, mz: dz / d, sprint: true });
    await sleep(50);
    if (p1.hasBall) break;
  }
  await sleep(200);
  r1.state.players.forEach((p) => { if (p.id === r1.sessionId) p1 = p; });
  console.log("[test] ¿jugador 1 tiene la pelota?", p1.hasBall, "ballOwner==self:", r1.state.ballOwner === r1.sessionId);
  if (!p1.hasBall) throw new Error("FALLO: el jugador no tomó posesión de la pelota");
  console.log("[test] ✓ posesión funciona");

  // Test patear: mira hacia +X (arco them) y patea
  // (team us ataca hacia +X según sim)
  for (let i = 0; i < 5; i++) { r1.send("input", { mx: 0, mz: 1, kick: true }); await sleep(50); }
  await sleep(300);
  console.log("[test] tras patear, ballOwner:", r1.state.ballOwner || "(suelta)", "ball.x:", r1.state.ball.x.toFixed(2));
  console.log("[test] ✓ patada ejecutada");

  // Verificar que el cliente 2 ve el MISMO estado (sincronización)
  let p1from2 = null;
  r2.state.players.forEach((p) => { if (p.id === r1.sessionId) p1from2 = p; });
  console.log("[test] cliente 2 ve a jugador 1 en:", p1from2.x.toFixed(2), p1from2.z.toFixed(2));
  if (Math.abs(p1from2.x - p1.x) > 0.5) throw new Error("FALLO: clientes desincronizados");
  console.log("[test] ✓ ambos clientes ven el mismo estado");

  console.log("\n[test] ✅ TODOS LOS TESTS PASARON");
  r1.leave(); r2.leave();
  process.exit(0);
}

run().catch((e) => { console.error("[test] ❌", e.message); process.exit(1); });
