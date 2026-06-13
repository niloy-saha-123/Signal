// Express application bootstrap with HTTP routes, Socket.io, and middleware wiring.
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { competitorsRouter } from "./competitors.js";
import { chatRouter } from "./chat.js";
import { alertsRouter } from "./alerts.js";
import { logger } from "../lib/logger.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/competitors", competitorsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/alerts", alertsRouter);

io.on("connection", (socket) => {
  socket.on("join_competitor", (competitorId: string) => {
    socket.join(`competitor_${competitorId}`);
  });
});

const port = Number(process.env.PORT) || 3000;
httpServer.listen(port, () => logger.info(`API server listening on port ${port}`));

export { app, io };
