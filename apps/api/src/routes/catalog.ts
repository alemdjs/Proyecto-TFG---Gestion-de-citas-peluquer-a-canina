import { Elysia, t } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { appointments, services, staff, staffServices } from "../db/schema";
import { requireSession } from "./auth";

async function requireAdmin(request: Request) {
  const me = await requireSession(request);
  return me && me.role === "admin" ? me : null;
}

/** Ids de servicios que ofrece un peluquero. */
export async function serviceIdsOf(staffId: string): Promise<string[]> {
  const rows = await db.query.staffServices.findMany({
    where: (ss, { eq }) => eq(ss.staffId, staffId),
  });
  return rows.map((r) => r.serviceId);
}

export const catalogRoutes = new Elysia()
  // Servicios — GET público, resto solo admin
  .get("/api/v1/services", async () => {
    const rows = await db.query.services.findMany();
    return { success: true, data: rows.filter((s) => s.active) };
  })
  .get("/api/v1/services/all", async ({ request, set }) => {
    const me = await requireSession(request);
    if (!me || me.role !== "admin") {
      set.status = 403;
      return { success: false, error: "Solo admin" };
    }
    const rows = await db.query.services.findMany();
    return { success: true, data: rows };
  })
  .post(
    "/api/v1/services",
    async ({ body, request, set }) => {
      const me = await requireSession(request);
      if (!me || me.role !== "admin") {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const [row] = await db.insert(services).values(body).returning();
      return { success: true, data: row };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2 }),
        description: t.Optional(t.String()),
        priceCents: t.Integer({ minimum: 0 }),
        durationMin: t.Integer({ minimum: 10, maximum: 480 }),
        active: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/api/v1/services/:id",
    async ({ params, body, request, set }) => {
      const me = await requireSession(request);
      if (!me || me.role !== "admin") {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const [row] = await db
        .update(services)
        .set(body)
        .where(eq(services.id, params.id))
        .returning();
      if (!row) {
        set.status = 404;
        return { success: false, error: "No encontrado" };
      }
      return { success: true, data: row };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        priceCents: t.Optional(t.Integer({ minimum: 0 })),
        durationMin: t.Optional(t.Integer({ minimum: 10, maximum: 480 })),
        active: t.Optional(t.Boolean()),
      }),
    },
  )
  // Servicios que ofrece cada peluquero (público: para filtrar en la reserva)
  .get("/api/v1/staff/:id/services", async ({ params }) => {
    const ids = await serviceIdsOf(params.id);
    const rows =
      ids.length === 0
        ? []
        : await db.query.services.findMany({
            where: (s, { inArray }) => inArray(s.id, ids),
          });
    return { success: true, data: rows.filter((s) => s.active) };
  })
  // Peluqueros que ofrecen un servicio (público: ?serviceId=)
  .get("/api/v1/services/:id/staff", async ({ params }) => {
    const links = await db.query.staffServices.findMany({
      where: (ss, { eq }) => eq(ss.serviceId, params.id),
    });
    const ids = links.map((l) => l.staffId);
    const rows =
      ids.length === 0
        ? []
        : await db.query.staff.findMany({
            where: (s, { inArray }) => inArray(s.id, ids),
          });
    return { success: true, data: rows.filter((s) => s.active) };
  })
  .delete("/api/v1/services/:id", async ({ params, request, set }) => {
    if (!(await requireAdmin(request))) {
      set.status = 403;
      return { success: false, error: "Solo admin" };
    }
    const used = await db.query.appointments.findFirst({
      where: (a, { eq }) => eq(a.serviceId, params.id),
    });
    if (used) {
      set.status = 409;
      return {
        success: false,
        error: "Tiene citas asociadas: desactívalo en lugar de eliminarlo",
      };
    }
    const deleted = await db
      .delete(services)
      .where(eq(services.id, params.id))
      .returning();
    if (!deleted.length) {
      set.status = 404;
      return { success: false, error: "No encontrado" };
    }
    return { success: true };
  })
  // Peluqueros con sus servicios (admin)
  .get("/api/v1/staff/all", async ({ request, set }) => {
    if (!(await requireAdmin(request))) {
      set.status = 403;
      return { success: false, error: "Solo admin" };
    }
    const rows = await db.query.staff.findMany();
    const withServices = await Promise.all(
      rows.map(async (s) => ({ ...s, serviceIds: await serviceIdsOf(s.id) })),
    );
    return { success: true, data: withServices };
  })
  // Peluqueros — GET público (para reservar), gestión admin
  .get("/api/v1/staff", async ({ query }) => {
    const { serviceId } = query as { serviceId?: string };
    let rows = await db.query.staff.findMany();
    rows = rows.filter((s) => s.active);
    if (serviceId) {
      const links = await db.query.staffServices.findMany({
        where: (ss, { eq }) => eq(ss.serviceId, serviceId),
      });
      const ids = new Set(links.map((l) => l.staffId));
      rows = rows.filter((s) => ids.has(s.id));
    }
    return { success: true, data: rows };
  })
  .post(
    "/api/v1/staff",
    async ({ body, request, set }) => {
      const me = await requireSession(request);
      if (!me || me.role !== "admin") {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const [row] = await db.insert(staff).values(body).returning();
      // Por defecto el nuevo peluquero ofrece todo el catálogo activo.
      const actives = await db.query.services.findMany({
        where: (s, { eq }) => eq(s.active, true),
      });
      if (actives.length) {
        await db
          .insert(staffServices)
          .values(actives.map((s) => ({ staffId: row.id, serviceId: s.id })))
          .onConflictDoNothing();
      }
      return { success: true, data: { ...row, serviceIds: actives.map((s) => s.id) } };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2 }),
        userId: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/api/v1/staff/:id",
    async ({ params, body, request, set }) => {
      if (!(await requireAdmin(request))) {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const [row] = await db
        .update(staff)
        .set(body)
        .where(eq(staff.id, params.id))
        .returning();
      if (!row) {
        set.status = 404;
        return { success: false, error: "No encontrado" };
      }
      return { success: true, data: { ...row, serviceIds: await serviceIdsOf(row.id) } };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 2 })),
        userId: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete("/api/v1/staff/:id", async ({ params, request, set }) => {
    if (!(await requireAdmin(request))) {
      set.status = 403;
      return { success: false, error: "Solo admin" };
    }
    const used = await db.query.appointments.findFirst({
      where: (a, { eq }) => eq(a.staffId, params.id),
    });
    if (used) {
      set.status = 409;
      return {
        success: false,
        error: "Tiene citas asociadas: desactívalo en lugar de eliminarlo",
      };
    }
    const deleted = await db
      .delete(staff)
      .where(eq(staff.id, params.id))
      .returning();
    if (!deleted.length) {
      set.status = 404;
      return { success: false, error: "No encontrado" };
    }
    return { success: true };
  })
  // Asignación de servicios a un peluquero (reemplazo completo)
  .put(
    "/api/v1/staff/:id/services",
    async ({ params, body, request, set }) => {
      if (!(await requireAdmin(request))) {
        set.status = 403;
        return { success: false, error: "Solo admin" };
      }
      const exists = await db.query.staff.findFirst({
        where: (s, { eq }) => eq(s.id, params.id),
      });
      if (!exists) {
        set.status = 404;
        return { success: false, error: "Peluquero no existe" };
      }
      const valid =
        body.serviceIds.length === 0
          ? []
          : await db.query.services.findMany({
              where: (s, { inArray }) => inArray(s.id, body.serviceIds),
            });
      if (valid.length !== body.serviceIds.length) {
        set.status = 400;
        return { success: false, error: "Algún servicio no existe" };
      }
      await db
        .delete(staffServices)
        .where(eq(staffServices.staffId, params.id));
      if (body.serviceIds.length) {
        await db.insert(staffServices).values(
          body.serviceIds.map((serviceId: string) => ({
            staffId: params.id,
            serviceId,
          })),
        );
      }
      return { success: true, data: { staffId: params.id, serviceIds: body.serviceIds } };
    },
    { body: t.Object({ serviceIds: t.Array(t.String()) }) },
  );
