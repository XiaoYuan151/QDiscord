import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface StoredMessageLink {
  discordMessageId: string;
  discordChannelId: string;
  qqGroupId: string;
  qqMessageId: string;
  createdAt: number;
}

interface StoreFile {
  version: 1;
  links: StoredMessageLink[];
}

export class MessageLinkStore {
  constructor(private readonly path: string) {}

  load(): StoredMessageLink[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.links)) {
      throw new Error(`Invalid message link store format: ${this.path}`);
    }

    return parsed.links.filter(isStoredMessageLink);
  }

  save(links: StoredMessageLink[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    const payload: StoreFile = {
      version: 1,
      links
    };
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    renameSync(tmpPath, this.path);
  }
}

function isStoredMessageLink(value: unknown): value is StoredMessageLink {
  if (!value || typeof value !== "object") {
    return false;
  }

  const link = value as Record<string, unknown>;
  return (
    typeof link.discordMessageId === "string" &&
    typeof link.discordChannelId === "string" &&
    typeof link.qqGroupId === "string" &&
    typeof link.qqMessageId === "string" &&
    typeof link.createdAt === "number"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
