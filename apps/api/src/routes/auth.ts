import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import {
  clearSessionCookie,
  getTokenFromHeaders,
  sessionCookie,
  signSession,
  verifySession,
} from "../utils/auth";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const authRoutes = new Elysia({ prefix: "/api/v1/auth" })
  .post(
    "/register",
    async ({ body, set }) => {
      const email = body.email.trim().toLowerCase();
      const already = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.email, email),
      });
      if (already) {
        set.status = 409;
        return { success: false, error: "Email ya registrado" };
      }
      const role = adminEmails.includes(email) ? "admin" : "client";
      const passwordHash = await Bun.password.hash(body.password);
      const [user] = await db
        .insert(users)
        .values({ name: body.name.trim(), email, passwordHash, role, phone: body.phone ?? null })
        .returning();
      const token = await signSession({
        sub: user.id,
        email: user.email,
        role: user.role as "admin" | "groomer" | "client",
        name: user.name,
      });
      set.headers["set-cookie"] = sessionCookie(token);
      return {
        success: true,
        data: { id: user.id, name: user.name, email: user.email, role: user.role },
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2 }),
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 6 }),
        phone: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/login",
    async ({ body, set }) => {
      const email = body.email.trim().toLowerCase();
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.email, email),
      });
      if (!user || !(await Bun.password.verify(body.password, user.passwordHash))) {
        set.status = 401;
        return { success: false, error: "Credenciales inválidas" };
      }
      const token = await signSession({
        sub: user.id,
        email: user.email,
        role: user.role as "admin" | "groomer" | "client",
        name: user.name,
      });
      set.headers["set-cookie"] = sessionCookie(token);
      return {
        success: true,
        data: { id: user.id, name: user.name, email: user.email, role: user.role },
      };
    },
    { body: t.Object({ email: t.String(), password: t.String() }) },
  )
  .post("/logout", ({ set }) => {
    set.headers["set-cookie"] = clearSessionCookie();
    return { success: true };
  })
  .get("/me", async ({ request, set }) => {
    const token = getTokenFromHeaders(request.headers);
    if (!token) {
      set.status = 401;
      return { success: false, error: "No autenticado" };
    }
    const session = await verifySession(token);
    if (!session) {
      set.status = 401;
      return { success: false, error: "Sesión inválida" };
    }
    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, session.sub),
    });
    if (!user) {
      set.status = 401;
      return { success: false, error: "Usuario no existe" };
    }
    return {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone },
    };
  });

export async function requireSession(request: Request) {
  const token = getTokenFromHeaders(request.headers);
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, session.sub),
  });
  void eq;
  return user;
}
