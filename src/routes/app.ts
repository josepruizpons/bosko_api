import express from "express";
import cors from "cors"
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { errorHandler } from "../utils";

const app = express();


app.use(cors({
  origin: "http://localhost:5173", // Vite
  credentials: true
}))
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});



app.use('/bs', bs_router)
app.use('/google', google_router)
app.use(errorHandler);

export default app;
