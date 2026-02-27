
export class ApiError extends Error {
  status_code: number;
  code: string;
  constructor(status_code: number,  code = 'API_ERROR', message: string = '' ) {
    super(message);
    this.status_code = status_code;
    this.code = code;
  }
}

export function api_error500(message: string = ''): never {
  throw new ApiError(500, 'Internal Server Error', message)
}

export function api_error400(message: string = ''): never {
  throw new ApiError(400, 'Bad Request', message)
}

export function api_error404(message: string = ''): never {
  throw new ApiError(404, 'Not Found', message)
}
export function api_error403(message: string = ''): never {
  throw new ApiError(403, 'Forbidden', message)
}

