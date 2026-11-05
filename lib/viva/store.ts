// Where vivas are kept on the server: the session the server issued (its plan and
// mode, locked in with the one-time pass) and, once finished, the saved record.
//
// This first version writes JSON files under VIVA_DATA_DIR (default .data/vivas).
// That's fine on a laptop. On Cloud Run the disk is wiped on every restart, so
// swap this for Firestore (Person 1's storage) before relying on it there; the
// rest of the app only uses the functions below.
//
// Until then, on Cloud Run: run one instance (--max-instances=1) so the save lands
// where the session was written, and set VIVA_DATA_DIR=/tmp/vivas (always writable).
// TODO: nothing is ever deleted yet; old sessions and records pile up.
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VivaMode, VivaPlan } from "./plan";
import type { VivaRecord } from "./record";

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

function dataDir() {
  return path.resolve(process.env.VIVA_DATA_DIR || ".data/vivas");
}

function fileFor(vivaId: string, kind: "session" | "record") {
  // parseRecord already checks ids, but never build a path from an unchecked one.
  if (!SAFE_ID.test(vivaId)) throw new Error("Unsafe viva id");
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

export async function saveSession(session: VivaSession): Promise<void> {
  await writeJson(fileFor(session.vivaId, "session"), session);
}

export async function getSession(vivaId: string): Promise<VivaSession | null> {
  if (!SAFE_ID.test(vivaId)) return null;
  return readJson<VivaSession>(fileFor(vivaId, "session"));
}

export async function getRecord(vivaId: string): Promise<StoredRecord | null> {
  if (!SAFE_ID.test(vivaId)) return null;
  return readJson<StoredRecord>(fileFor(vivaId, "record"));
}

/** Saves a finished viva once. Returns false if one was already saved for this id. */
export async function saveRecordOnce(record: StoredRecord): Promise<boolean> {
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
