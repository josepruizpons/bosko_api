import https from "https";
import fs from "fs";
import app from "./routes/app";

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production") {
  // En producción usamos HTTP normal (Render ya maneja HTTPS)
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
} else {
  // En local usamos HTTPS con certificados auto-firmados
  const key = fs.readFileSync("localhost-key.pem");
  const cert = fs.readFileSync("localhost.pem");

  https.createServer({ key, cert }, app).listen(PORT, () => {
    console.log(`Server running on https://localhost:${PORT}`);
  });
}
