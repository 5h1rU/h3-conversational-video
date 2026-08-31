export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        requestId,
      },
      { status: error.status },
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      event: "request.failed",
      requestId,
      error: String(error),
    }),
  );
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected prototype failure",
      },
      requestId,
    },
    { status: 500 },
  );
}
