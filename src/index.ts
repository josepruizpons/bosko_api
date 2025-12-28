import https from "https";
import fs from "fs";
import app from "./routes/app";

const PORT = 3000;

https.createServer(
  {
    key: fs.readFileSync("localhost-key.pem"),
    cert: fs.readFileSync("localhost.pem"),
  },
  app
).listen(PORT, () => {
  console.log(`🔐 HTTPS activo en https://localhost:${PORT}`);
});
