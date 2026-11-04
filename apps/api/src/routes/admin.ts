import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { staff, users } from "../db/schema";
import { requireSession } from "./auth";

async function requireAdmin(request: Request) {
  const me = await requireSession(request);
  if (!me || me.role !== "admin") return null;
  return me;
}

export const adminRoutes = new Elysia()
  // Lista peluqueros: usuarios con rol groomer + su ficha de staff (si existe)
  .get("/api/v1/admin/groomers", async ({ request, set }) => {
    const me = await requireAdmin(request);
    if (!me) {
      set.status = 403;
      return { success: false, error: "Solo admin" };
    }
    const groomers = await db.query.users.findMany({
      where: (u, { eq }) => eq(u.role, "groomer"),
      orderBy: (u, { asc }) => asc(u.createdAt),
    });
    const staffRows = await db.query.staff.findMany();
    const data = groomers.map((g) => {
      const ficha = staffRows.find((s) => s.userId === g.id) ?? null;
      return {
        id: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        createdAt: g.createdAt,
        staffId: ficha?.id ?? null,
        active: ficha?.active ?? true,
      };
    });
    return { success: true, data };
  })
  // Crea cuenta de peluquero (usuario rol groomer) + ficha en staff
  .post(
    "/api/v1/admin/groomers",
    async ({ body, request, set }) => {
      const me = await requireAdmin(request);
      if (!me) {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const email = body.email.trim().toLowerCase();
      const already = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.email, email),
      });
      if (already) {
        set.status = 409;
        return { success: false, error: "Email ya registrado" };
      }
      const passwordHash = await Bun.password.hash(body.password);
      const [user] = await db
        .insert(users)
        .values({
          name: body.name.trim(),
          email,
          passwordHash,
          role: "groomer",
          phone: body.phone?.trim() || null,
        })
        .returning();
      const [ficha] = await db
        .insert(staff)
        .values({ name: user.name, userId: user.id, active: true })
        .returning();
      set.status = 201;
      return {
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          staffId: ficha.id,
          active: ficha.active,
        },
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
  // Activa/desactiva la ficha de peluquero (para que deje de salir en reservas)
  .patch(
    "/api/v1/admin/groomers/:id",
    async ({ params, body, request, set }) => {
      const me = await requireAdmin(request);
      if (!me) {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, params.id),
      });
      if (!user || user.role !== "groomer") {
        set.status = 404;
        return { success: false, error: "Peluquero no encontrado" };
      }
      let ficha = await db.query.staff.findFirst({
        where: (s, { eq }) => eq(s.userId, user.id),
      });
      if (!ficha) {
        const [created] = await db
          .insert(staff)
          .values({ name: user.name, userId: user.id, active: body.active ?? true })
          .returning();
        ficha = created;
      } else {
        const [updated] = await db
          .update(staff)
          .set({
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          })
          .where(eq(staff.id, ficha.id))
          .returning();
        ficha = updated;
      }
      if (body.name !== undefined && body.name.trim() !== user.name) {
        await db.update(users).set({ name: body.name.trim() }).where(eq(users.id, user.id));
      }
      return {
        success: true,
        data: {
          id: user.id,
          name: body.name?.trim() ?? user.name,
          email: user.email,
          staffId: ficha.id,
          active: ficha.active,
        },
      };
    },
    {
      body: t.Object({
        active: t.Optional(t.Boolean()),
        name: t.Optional(t.String({ minLength: 2 })),
      }),
    },
  );
