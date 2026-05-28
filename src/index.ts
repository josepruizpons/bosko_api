import http from "http";
import https from "https";
import fs from "fs";
import app, { session_middleware } from "./routes/app";
import { init_sockets } from "./sockets";

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production") {
  // En producción usamos HTTP normal (Render ya maneja HTTPS)
  const server = http.createServer(app);
  init_sockets(server, session_middleware);
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
} else {
  // En local usamos HTTPS con certificados auto-firmados
  const key = fs.readFileSync("localhost-key.pem");
  const cert = fs.readFileSync("localhost.pem");

  const server = https.createServer({ key, cert }, app);
  init_sockets(server, session_middleware);
  server.listen(PORT, () => {
    console.log(`Server running on https://localhost:${PORT}`);
  });
}
