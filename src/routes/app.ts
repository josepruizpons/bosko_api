import express from "express";
import cors from "cors"
import "dotenv/config"; // carga automáticamente process.env
import { google_router } from "./google.routes";
import { bs_router } from "./beatstars.routes";
import { errorHandler } from "../utils";

const app = express();


const allowedOrigins = process.env.NODE_ENV === "production"
  ? ["https://bosko-9p6c.onrender.com"]
  : ["http://localhost:5173", 'http://localhost:5176'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});



app.use('/bs', bs_router)
app.use('/google', google_router)
app.use(errorHandler);

export default app;
