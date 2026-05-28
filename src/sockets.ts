import { Server as HttpServer } from "http";
import { Server as HttpsServer } from "https";
import { Server as IOServer, Socket } from "socket.io";
import session from "express-session";
import cookieParser from "cookie-parser";

let io: IOServer | null = null;

const allowedOrigins = process.env.NODE_ENV === "production"
  ? [
    "https://bosko-9p6c.onrender.com",
    'https://bosko-api-ppse.onrender.com',
    'https://boskofiles.com',
    'https://dev.boskofiles.com',
    'https://www.boskofiles.com',
  ]
  : [
    "http://localhost:5173",
    'http://localhost:5176',
    "https://localhost:5173",
    "https://localhost:5174",
    'https://localhost:5176',
  ];

export function init_sockets(
  server: HttpServer | HttpsServer,
  session_middleware: ReturnType<typeof session>,
) {
  io = new IOServer(server, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  const wrap = (mw: any) => (socket: Socket, next: (err?: Error) => void) =>
    mw(socket.request as any, {} as any, next);

  io.use(wrap(cookieParser()));
  io.use(wrap(session_middleware));

  io.use((socket, next) => {
    const req = socket.request as any;
    const id_user = req.session?.userId as number | undefined;
    if (!id_user) return next(new Error("UNAUTHORIZED"));
    socket.data.id_user = id_user;
    next();
  });

  io.on("connection", (socket) => {
    const id_user: number = socket.data.id_user;
    socket.join(`user:${id_user}`);
  });

  return io;
}

export function emit_to_user(id_user: number, event: string, payload: unknown) {
  if (!io) return;
  io.to(`user:${id_user}`).emit(event, payload);
}

export function get_io(): IOServer | null {
  return io;
}
