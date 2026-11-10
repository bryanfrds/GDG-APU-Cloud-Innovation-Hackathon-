// Where vivas are kept on the server: the session the server issued (its plan and
// mode, locked in with the one-time pass) and, once finished, the saved record.
//
// Two places, picked by environment:
// - Upstash Redis, when its REST URL and token are set (see redis.ts). Every server
//   copy shares it and it survives restarts, so use it on any real deployment.
// - Otherwise JSON files under VIVA_DATA_DIR (default .data/vivas). Fine on a laptop,
//   but a hosted server's disk belongs to one copy and gets wiped.
//
// The rest of the app only uses the functions below.
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VivaMode, VivaPlan } from "./plan";
import type { VivaRecord } from "./record";
import { redisCommand, redisConfig } from "./redis";

export type VivaSession = {
  vivaId: string;
  plan: VivaPlan;
  mode: VivaMode;
  issuedAt: string;
};

export type StoredRecord = VivaRecord & { receivedAt: string };

/** Same shape parseRecord() accepts: "viva_" plus 24 hex characters. */
export function newVivaId(): string {
  return `viva_${randomBytes(12).toString("hex")}`;
}

const SAFE_ID = /^[a-z0-9_-]{8,64}$/i;

function checkId(vivaId: string) {
  // parseRecord already checks ids, but never build a path or key from an unchecked one.
  if (!SAFE_ID.test(vivaId)) throw new Error("Unsafe viva id");
}

// A session is only needed until its record is saved, which is at most about 20 minutes
// after it was issued. Keep it a day, then let Redis drop it. Records are kept.
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function redisKey(vivaId: string, kind: "session" | "record") {
  checkId(vivaId);
  return `proveit:viva:${vivaId}:${kind}`;
}

function parseStored<T>(value: unknown): T | null {
  return typeof value === "string" ? (JSON.parse(value) as T) : null;
}

// ---- files ----

function dataDir() {
  return path.resolve(process.env.VIVA_DATA_DIR || ".data/vivas");
}

function fileFor(vivaId: string, kind: "session" | "record") {
  checkId(vivaId);
  return path.join(dataDir(), `${vivaId}.${kind}.json`);
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file); // all at once, so a crash never leaves half a file
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function saveRecordFileOnce(record: StoredRecord): Promise<boolean> {
  const file = fileFor(record.vivaId, "record");
  await mkdir(path.dirname(file), { recursive: true });
  // Write the whole file under a temporary name first, so a crash never leaves half a
  // record. Then link it into place: like "create", that fails if the record already
  // exists, so two saves at once can't both win.
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  try {
    await link(tmp, file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// ---- the functions the app uses ----

export async function saveSession(session: VivaSession): Promise<void> {
  const redis = redisConfig();
  if (redis) {
    const key = redisKey(session.vivaId, "session");
    await redisCommand(redis, ["SET", key, JSON.stringify(session), "EX", String(SESSION_TTL_SECONDS)]);
    return;
  }
  await writeJson(fileFor(session.vivaId, "session"), session);
}

export async function getSession(vivaId: string): Promise<VivaSession | null> {
  if (!SAFE_ID.test(vivaId)) return null;
  const redis = redisConfig();
  if (redis) return parseStored<VivaSession>(await redisCommand(redis, ["GET", redisKey(vivaId, "session")]));
  return readJson<VivaSession>(fileFor(vivaId, "session"));
}

export async function getRecord(vivaId: string): Promise<StoredRecord | null> {
  if (!SAFE_ID.test(vivaId)) return null;
  const redis = redisConfig();
  if (redis) return parseStored<StoredRecord>(await redisCommand(redis, ["GET", redisKey(vivaId, "record")]));
  return readJson<StoredRecord>(fileFor(vivaId, "record"));
}

/** Saves a finished viva once. Returns false if one was already saved for this id. */
export async function saveRecordOnce(record: StoredRecord): Promise<boolean> {
  const redis = redisConfig();
  if (redis) {
    // NX: only set if the key doesn't exist yet, in one step, so two saves at once
    // can't both win. Redis answers "OK" when it wrote, nothing when the key existed.
    const key = redisKey(record.vivaId, "record");
    return (await redisCommand(redis, ["SET", key, JSON.stringify(record), "NX"])) === "OK";
  }
  return saveRecordFileOnce(record);
}
