import { SignJWT, jwtVerify } from "jose";
import type { Role } from "../db/schema/tables";

export interface Session {
  sub: string;
  email: string;
  role: Role;
  name: string;
}

function secret(): Uint8Array {
  const s =
    process.env.JWT_SECRET ?? "dev-secreto-peluqueria-cambiar-en-produccion-1234567890";
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export function getTokenFromHeaders(headers: Headers): string | null {
  const cookie = headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export function sessionCookie(token: string): string {
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export function clearSessionCookie(): string {
  return `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
