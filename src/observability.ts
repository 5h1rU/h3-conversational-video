export function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  console.log(
    JSON.stringify({
      level,
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );
}
