import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { pets } from "../db/schema";
import { requireSession } from "./auth";

export const petRoutes = new Elysia()
  .get("/api/v1/pets", async ({ request, set }) => {
    const me = await requireSession(request);
    if (!me) {
      set.status = 401;
      return { success: false, error: "No autenticado" };
    }
    const rows =
      me.role === "client"
        ? await db.query.pets.findMany({ where: (p, { eq }) => eq(p.ownerId, me.id) })
        : await db.query.pets.findMany();
    return { success: true, data: rows };
  })
  .post(
    "/api/v1/pets",
    async ({ body, request, set }) => {
      const me = await requireSession(request);
      if (!me) {
        set.status = 401;
        return { success: false, error: "No autenticado" };
      }
      // Admin/groomer pueden crear para otro dueño; cliente solo para sí
      const ownerId =
        me.role !== "client" && body.ownerId ? body.ownerId : me.id;
      const [row] = await db
        .insert(pets)
        .values({
          ownerId,
          name: body.name,
          breed: body.breed ?? "Mestizo",
          size: body.size ?? "M",
          weightKg: body.weightKg ?? null,
          notes: body.notes ?? null,
          birthDate: body.birthDate ?? null,
        })
        .returning();
      return { success: true, data: row };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        breed: t.Optional(t.String()),
        size: t.Optional(t.Union([t.Literal("S"), t.Literal("M"), t.Literal("L"), t.Literal("XL")])),
        weightKg: t.Optional(t.Number()),
        notes: t.Optional(t.String()),
        birthDate: t.Optional(t.String()),
        ownerId: t.Optional(t.String()),
      }),
    },
  )
  .delete("/api/v1/pets/:id", async ({ params, request, set }) => {
    const me = await requireSession(request);
    if (!me) {
      set.status = 401;
      return { success: false, error: "No autenticado" };
    }
    const where =
      me.role === "client"
        ? and(eq(pets.id, params.id), eq(pets.ownerId, me.id))
        : eq(pets.id, params.id);
    const deleted = await db.delete(pets).where(where).returning();
    if (!deleted.length) {
      set.status = 404;
      return { success: false, error: "No encontrado" };
    }
    return { success: true };
  });
