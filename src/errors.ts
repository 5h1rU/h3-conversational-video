import { log } from "./observability";
import { ProviderPayloadError, WebhookAuthorizationError } from "./services";

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
  if (error instanceof WebhookAuthorizationError) {
    log("warn", "webhook.authorization_rejected", { requestId });
    return Response.json(
      {
        error: {
          code: "FAL_WEBHOOK_UNAUTHORIZED",
          message: "Webhook signature verification failed",
        },
        requestId,
      },
      { status: 401 },
    );
  }
  if (error instanceof ProviderPayloadError) {
    log("warn", "webhook.payload_rejected", {
      requestId,
      code: error.code,
    });
    return Response.json(
      { error: { code: error.code, message: error.message }, requestId },
      { status: 422 },
    );
  }
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
