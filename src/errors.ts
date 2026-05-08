
export class ApiError extends Error {
  status_code: number;
  code: string;
  constructor(status_code: number, code = 'API_ERROR', message: string = '') {
    super(message);
    this.status_code = status_code;
    this.code = code;
  }
}

export function api_error500(message: string = ''): never {
  throw new ApiError(500, 'INTERNAL_SERVER_ERROR', message)
}

export function api_error400(message: string = ''): never {
  throw new ApiError(400, 'BAD_REQUEST', message)
}

export function api_error404(message: string = ''): never {
  throw new ApiError(404, 'NOT_FOUND', message)
}

export function api_error403(message: string = ''): never {
  throw new ApiError(403, 'FORBIDDEN', message)
}

export function api_error401(message: string = ''): never {
  throw new ApiError(401, 'UNAUTHORIZED', message)
}

export function api_error429(message: string = ''): never {
  throw new ApiError(429, 'TOO_MANY_REQUESTS', message)
}
