// Erreurs applicatives centralisées (CDC A.4) : 400, 401, 403, 404, 409, 429 et 500.
// Les messages sont destinés à l'utilisateur ; les détails techniques restent dans les journaux.

export type AppErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export const errors = {
  validation: (message = "Les données saisies sont invalides.", details?: unknown) =>
    new AppError("VALIDATION", message, details),
  unauthenticated: (message = "Authentification requise.") => new AppError("UNAUTHENTICATED", message),
  forbidden: (message = "Vous n'avez pas accès à cette ressource.") => new AppError("FORBIDDEN", message),
  notFound: (message = "Ressource introuvable.") => new AppError("NOT_FOUND", message),
  conflict: (message = "Cette ressource a été modifiée entre-temps.") => new AppError("CONFLICT", message),
  rateLimited: (message = "Trop de tentatives. Réessayez plus tard.") => new AppError("RATE_LIMITED", message),
};

/** Réponse JSON homogène pour les Route Handlers. Toute erreur inconnue devient une 500 sans détail. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  return Response.json(
    { error: { code: "INTERNAL", message: "Une erreur interne est survenue." } },
    { status: 500 },
  );
}
