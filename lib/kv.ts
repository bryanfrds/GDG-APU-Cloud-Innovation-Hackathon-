// A small key-value store shared by submissions and reports: Upstash Redis when it's
// configured (see lib/viva/redis.ts), otherwise JSON files under VIVA_DATA_DIR.
// Keys are made of safe parts only; callers check ids before building one.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redisCommand, redisConfig } from "./viva/redis";

const SAFE_KEY = /^[a-z0-9_:-]{1,120}$/i;

function check(key: string) {
  if (!SAFE_KEY.test(key)) throw new Error("Unsafe storage key");
}

function fileFor(key: string, ext: string) {
  check(key);
  return path.join(path.resolve(process.env.VIVA_DATA_DIR || ".data/vivas"), `${key.replace(/:/g, "__")}${ext}`);
}

export async function kvSetJson(key: string, value: unknown): Promise<void> {
  const redis = redisConfig();
  if (redis) {
    check(key);
    await redisCommand(redis, ["SET", key, JSON.stringify(value)]);
    return;
  }
  const file = fileFor(key, ".json");
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value), "utf8");
  await rename(tmp, file);
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const redis = redisConfig();
  if (redis) {
    check(key);
    const value = await redisCommand(redis, ["GET", key]);
    return typeof value === "string" ? (JSON.parse(value) as T) : null;
  }
  try {
    return JSON.parse(await readFile(fileFor(key, ".json"), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Adds an id to the front of a list (newest first). */
export async function kvListAdd(listKey: string, id: string): Promise<void> {
  check(id);
  const redis = redisConfig();
  if (redis) {
    check(listKey);
    await redisCommand(redis, ["LPUSH", listKey, id]);
    return;
  }
  const file = fileFor(listKey, ".list");
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${id}\n`, "utf8");
}

/** The newest `limit` ids in a list, newest first, without duplicates. */
export async function kvList(listKey: string, limit = 200): Promise<string[]> {
  const redis = redisConfig();
  let ids: string[];
  if (redis) {
    check(listKey);
    const value = await redisCommand(redis, ["LRANGE", listKey, "0", String(limit - 1)]);
    ids = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } else {
    try {
      ids = (await readFile(fileFor(listKey, ".list"), "utf8")).split("\n").filter(Boolean).reverse().slice(0, limit);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
  return [...new Set(ids)];
}
