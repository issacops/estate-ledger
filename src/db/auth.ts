import type { User } from "../domain/types";
import { select } from "./client";

const ITERATIONS = 100_000;

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return bufToHex(a.buffer);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

export async function verifyPassword(
  password: string,
  salt: string,
  expected: string
): Promise<boolean> {
  const h = await hashPassword(password, salt);
  return h === expected;
}

export async function login(
  email: string,
  password: string
): Promise<User | null> {
  const rows = await select<
    User & { password_hash: string; password_salt: string }
  >("SELECT * FROM users WHERE lower(email) = lower($1) AND active = 1", [
    email.trim(),
  ]);
  const u = rows[0];
  if (!u) return null;
  const ok = await verifyPassword(password, u.password_salt, u.password_hash);
  if (!ok) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
  };
}
