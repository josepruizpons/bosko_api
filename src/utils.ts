import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response as ExpressResponse } from "express";
import { api_error500, ApiError } from "./errors";
import { BeatStarsLoginResponse, GraphQLResponse } from "./types";

export async function get_beatstars_token() {
  const urlencoded = new URLSearchParams();
  urlencoded.append("refresh_token", process.env.BS_REFRESH_TOKEN ?? '');
  urlencoded.append("client_id", process.env.BS_CLIENT_ID ?? '');
  urlencoded.append("client_secret", process.env.BS_CLIENT_SECRET ?? '');
  urlencoded.append("grant_type", "refresh_token");
  const response = await fetch("https://core.prod.beatstars.net/auth/oauth/token", {
    method: 'POST',
    body: urlencoded,
  })

  if (response.status !== 200) api_error500()

  const payload: BeatStarsLoginResponse = await response.json()

  return payload.access_token
}

export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
    (req: Request, res: ExpressResponse, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

export const errorHandler: ErrorRequestHandler = (
  err,
  _,
  res,
  __
) => {
  if (err instanceof ApiError) {
    res.status(err.status_code).json({
      error: err.code,
      message: err.message
    });
    return;
  }

  console.log(err)

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Error inesperado'
  });
};

export async function extra_data_from_response(response: Response) {
  const raw = await response.text();

  let body: any;

  try {
    body = JSON.parse(raw)
  } catch {
    body = raw
  }

  return JSON.stringify(
    {
      status: response.status,
      url: response.url,
      body,
    },
    null,
    2
  );
}
export function checkGraphQLErrors(response: GraphQLResponse): { hasErrors: boolean; messages: string[] } {
  const result = {
    hasErrors: false,
    messages: [] as string[],
  };

  if (response.errors && response.errors.length > 0) {
    result.hasErrors = true;
    result.messages = response.errors.map(err => {
      const path = err.path ? ` at path ${err.path.join(" > ")}` : "";
      return `${err.message}${path}`;
    });
  }

  return result;
}
