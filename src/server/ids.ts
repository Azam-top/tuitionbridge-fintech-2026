import { randomUUID, createHash, randomBytes } from "node:crypto";
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const randomToken = (): string => randomBytes(32).toString("base64url");
