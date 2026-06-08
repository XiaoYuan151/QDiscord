import type { CqSegment, OneBotMessagePayload } from "./types.js";

const cqPattern = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^\]]*)?)\]/g;

export function parseCqMessage(message: string): CqSegment[] {
  const segments: CqSegment[] = [];
  let cursor = 0;

  for (const match of message.matchAll(cqPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      appendTextSegment(segments, unescapeCqText(message.slice(cursor, matchIndex)));
    }

    const type = match[1] ?? "unknown";
    const data = parseCqData(match[2] ?? "");
    segments.push({ type, data });
    cursor = matchIndex + match[0].length;
  }

  if (cursor < message.length) {
    appendTextSegment(segments, unescapeCqText(message.slice(cursor)));
  }

  return segments;
}

export function normalizeOneBotMessage(message: OneBotMessagePayload | undefined): CqSegment[] {
  if (message === undefined) {
    return [];
  }

  if (typeof message === "string") {
    return parseCqMessage(message);
  }

  return message.map((segment) => ({
    type: segment.type,
    data: normalizeData(segment.data ?? {})
  }));
}

export function stringifyCqSegments(segments: CqSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "text") {
        return escapeCqText(segment.data.text ?? "");
      }

      const entries = Object.entries(segment.data).filter(([, value]) => value !== undefined);
      if (entries.length === 0) {
        return `[CQ:${segment.type}]`;
      }

      const attrs = entries
        .map(([key, value]) => `${key}=${escapeCqDataValue(value)}`)
        .join(",");
      return `[CQ:${segment.type},${attrs}]`;
    })
    .join("");
}

export function appendTextSegment(segments: CqSegment[], text: string): void {
  if (!text) {
    return;
  }

  const previous = segments.at(-1);
  if (previous?.type === "text") {
    previous.data.text = `${previous.data.text ?? ""}${text}`;
    return;
  }

  segments.push({ type: "text", data: { text } });
}

export function escapeCqText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("[", "&#91;").replaceAll("]", "&#93;");
}

export function unescapeCqText(text: string): string {
  return text.replaceAll("&#91;", "[").replaceAll("&#93;", "]").replaceAll("&amp;", "&");
}

export function escapeCqDataValue(value: string): string {
  return escapeCqText(value).replaceAll(",", "&#44;");
}

export function unescapeCqDataValue(value: string): string {
  return unescapeCqText(value.replaceAll("&#44;", ","));
}

function parseCqData(rawParams: string): Record<string, string> {
  const data: Record<string, string> = {};
  const params = rawParams.startsWith(",") ? rawParams.slice(1) : rawParams;
  if (!params) {
    return data;
  }

  for (const part of params.split(",")) {
    if (!part) {
      continue;
    }

    const equalsIndex = part.indexOf("=");
    if (equalsIndex < 0) {
      data[part] = "";
      continue;
    }

    const key = part.slice(0, equalsIndex);
    const value = part.slice(equalsIndex + 1);
    data[key] = unescapeCqDataValue(value);
  }

  return data;
}

function normalizeData(data: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = value === undefined || value === null ? "" : String(value);
  }

  return normalized;
}
