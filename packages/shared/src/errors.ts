export type ClientErrorStatus = 400 | 404 | 409;

export class ClientError extends Error {
  readonly status: ClientErrorStatus;

  constructor(status: ClientErrorStatus, message: string) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError;
}
