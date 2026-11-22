import { EasybasarErrorBody, messageText } from "./client.js";

/**
 * Server-Antworten aufbereiten: Aus info/error werden nur msg und solution gezeigt
 * (keine Nummer, kein response/additional). Weitere Nutzdaten folgen als JSON.
 */
export function render(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return JSON.stringify(data, null, 2);
  }
  const { info, error, ...rest } = data as Record<string, unknown>;
  const parts: string[] = [];
  for (const m of [error, info]) {
    if (m && typeof m === "object") {
      const t = messageText(m as EasybasarErrorBody);
      if (t) parts.push(t);
    }
  }
  if (Object.keys(rest).length) parts.push(JSON.stringify(rest, null, 2));
  return parts.join("\n\n") || "OK";
}

