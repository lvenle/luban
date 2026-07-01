export class AppError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

export function notFound(message) {
  return new AppError(404, message);
}

export function badRequest(message) {
  return new AppError(400, message);
}

export function conflict(message, details = undefined) {
  return new AppError(409, message, details);
}

export function configurationError(message) {
  return new AppError(422, message);
}
