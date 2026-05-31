import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { MatchRoom } from "./room.js";

const PORT = process.env.PORT || 2567;

const app = express();
app.use(cors());
app.use(express.static("public"));   // sirve public/test-client.html
app.get("/", (_req, res) => res.send("Rezona server OK · cliente de prueba en /test-client.html"));
app.use("/monitor", monitor());   // panel de salas en /monitor

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("match", MatchRoom);

server.listen(PORT, () => {
  console.log(`[rezona-server] escuchando en :${PORT}`);
});
