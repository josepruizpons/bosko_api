import express from "express";
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { errorHandler } from "../utils";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});



app.use(google_router)
app.use(errorHandler);

export default app;
