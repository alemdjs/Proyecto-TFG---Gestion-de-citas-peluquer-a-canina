import { Elysia, t } from "elysia";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "../db";
import { appointments, pets, services, staff } from "../db/schema";
import { requireSession } from "./auth";
import { serviceIdsOf } from "./catalog";
import { SLOT_STEP_MIN, dayBounds, isBusinessDay, overlaps } from "../utils/slots";

/** Enriquece citas con nombres para pintar calendarios sin N+1 en el cliente. */
export async function withNames(rows: typeof appointments.$inferSelect[]) {
  const petIds = [...new Set(rows.map((r) => r.petId))];
  const svcIds = [...new Set(rows.map((r) => r.serviceId))];
  const staffIds = [...new Set(rows.map((r) => r.staffId).filter(Boolean))] as string[];
  const [petRows, svcRows, staffRows] = await Promise.all([
    petIds.length
      ? db.query.pets.findMany({ where: (p, { inArray }) => inArray(p.id, petIds) })
      : [],
    svcIds.length
      ? db.query.services.findMany({ where: (s, { inArray }) => inArray(s.id, svcIds) })
      : [],
    staffIds.length
      ? db.query.staff.findMany({ where: (s, { inArray }) => inArray(s.id, staffIds) })
      : [],
  ]);
  const petName = new Map(petRows.map((p) => [p.id, p.name]));
  const svcName = new Map(svcRows.map((s) => [s.id, s.name]));
  const staffName = new Map(staffRows.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    ...r,
    petName: petName.get(r.petId) ?? "?",
    serviceName: svcName.get(r.serviceId) ?? "?",
    staffName: r.staffId ? (staffName.get(r.staffId) ?? "?") : null,
  }));
}

/** Peluqueros activos que ofrecen un servicio. */
async function qualifiedStaff(serviceId: string) {
  const links = await db.query.staffServices.findMany({
    where: (ss, { eq }) => eq(ss.serviceId, serviceId),
  });
  const ids = links.map((l) => l.staffId);
  if (!ids.length) return [];
  const rows = await db.query.staff.findMany({
    where: (s, { inArray }) => inArray(s.id, ids),
  });
  return rows.filter((s) => s.active);
}

async function busyForDay(dateStr: string, staffId?: string) {
  const { open, close } = dayBounds(dateStr);
  const conds = [gte(appointments.startAt, open), lte(appointments.startAt, close), ne(appointments.status, "cancelled")];
  if (staffId) conds.push(eq(appointments.staffId, staffId));
  return db.query.appointments.findMany({ where: and(...conds) });
}

export const appointmentRoutes = new Elysia()
  // Disponibilidad pública: ?serviceId=&date=YYYY-MM-DD&staffId=
  .get(
    "/api/v1/availability",
    async ({ query, set }) => {
      const { serviceId, date, staffId } = query as {
        serviceId?: string;
        date?: string;
        staffId?: string;
      };
      if (!serviceId || !date) {
        set.status = 400;
        return { success: false, error: "serviceId y date son obligatorios" };
      }
      const service = await db.query.services.findFirst({
        where: (s, { eq }) => eq(s.id, serviceId),
      });
      if (!service) {
        set.status = 404;
        return { success: false, error: "Servicio no existe" };
      }
      const probe = new Date(`${date}T12:00:00`);
      if (!isBusinessDay(probe)) return { success: true, data: [] };

      const qualified = await qualifiedStaff(serviceId);
      const staffList = staffId
        ? qualified.filter((s) => s.id === staffId)
        : qualified;
      if (staffId && staffList.length === 0) {
        set.status = 400;
        return { success: false, error: "Ese peluquero no ofrece este servicio" };
      }

      const busy = await busyForDay(date, staffId);
      const { open, close } = dayBounds(date);
      const slots: { start: string; end: string; staffId: string; staffName: string }[] = [];

      for (
        let cursor = new Date(open);
        new Date(cursor.getTime() + service.durationMin * 60000) <= close;
        cursor = new Date(cursor.getTime() + SLOT_STEP_MIN * 60000)
      ) {
        const end = new Date(cursor.getTime() + service.durationMin * 60000);
        if (cursor < new Date()) continue; // no pasado
        for (const st of staffList) {
          const clashes = busy.some(
            (b) =>
              b.staffId === st.id &&
              overlaps(cursor, end, new Date(b.startAt), new Date(b.endAt)),
          );
          if (!clashes) {
            slots.push({ start: cursor.toISOString(), end: end.toISOString(), staffId: st.id, staffName: st.name });
            break; // un peluquero libre basta si no se pidió uno concreto
          }
          if (staffId) break;
        }
      }
      return { success: true, data: slots };
    },
  )
  .get("/api/v1/appointments", async ({ request, query, set }) => {
    const me = await requireSession(request);
    if (!me) {
      set.status = 401;
      return { success: false, error: "No autenticado" };
    }
    const q = query as { date?: string; staffId?: string; from?: string; to?: string };
    let rows = await db.query.appointments.findMany({
      orderBy: (a, { asc }) => asc(a.startAt),
    });
    if (me.role === "client") rows = rows.filter((r) => r.clientId === me.id);
    if (q.date) rows = rows.filter((r) => new Date(r.startAt).toISOString().slice(0, 10) === q.date);
    if (q.from) rows = rows.filter((r) => new Date(r.startAt) >= new Date(q.from!));
    if (q.to) rows = rows.filter((r) => new Date(r.startAt) <= new Date(q.to!));
    if (q.staffId) rows = rows.filter((r) => r.staffId === q.staffId);
    rows = rows.slice(0, 500);
    return { success: true, data: await withNames(rows) };
  })
  .post(
    "/api/v1/appointments",
    async ({ body, request, set }) => {
      const me = await requireSession(request);
      if (!me) {
        set.status = 401;
        return { success: false, error: "No autenticado" };
      }
      const service = await db.query.services.findFirst({
        where: (s, { eq }) => eq(s.id, body.serviceId),
      });
      if (!service?.active) {
        set.status = 400;
        return { success: false, error: "Servicio no disponible" };
      }
      const pet = await db.query.pets.findFirst({
        where: (p, { eq }) => eq(p.id, body.petId),
      });
      if (!pet) {
        set.status = 404;
        return { success: false, error: "Mascota no existe" };
      }
      if (me.role === "client" && pet.ownerId !== me.id) {
        set.status = 403;
        return { success: false, error: "Esa mascota no es tuya" };
      }
      const startAt = new Date(body.startAt);
      if (Number.isNaN(+startAt) || startAt < new Date()) {
        set.status = 400;
        return { success: false, error: "Fecha/hora inválida o en el pasado" };
      }
      if (!isBusinessDay(startAt)) {
        set.status = 400;
        return { success: false, error: "Cerramos los domingos" };
      }
      const endAt = new Date(startAt.getTime() + service.durationMin * 60000);

      let staffId = body.staffId ?? null;
      if (staffId) {
        const st = await db.query.staff.findFirst({ where: (s, { eq }) => eq(s.id, staffId!) });
        const offers = staffId ? await serviceIdsOf(staffId) : [];
        if (!st?.active || !offers.includes(service.id)) {
          set.status = 400;
          return { success: false, error: "Peluquero no disponible para este servicio" };
        }
      } else {
        // auto-asignar primer peluquero libre entre los que ofrecen el servicio
        const all = await qualifiedStaff(service.id);
        const dateStr = startAt.toISOString().slice(0, 10);
        // OJO: startAt es UTC; dayBounds usa fecha local. Para v1 exigimos mismo día.
        const busy = await busyForDay(
          `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, "0")}-${String(startAt.getDate()).padStart(2, "0")}`,
          undefined,
        );
        void dateStr;
        for (const st of all) {
          const clash = busy.some(
            (b) => b.staffId === st.id && overlaps(startAt, endAt, new Date(b.startAt), new Date(b.endAt)),
          );
          if (!clash) {
            staffId = st.id;
            break;
          }
        }
        if (!staffId) {
          set.status = 409;
          return { success: false, error: "Sin hueco con ningún peluquero a esa hora" };
        }
      }

      // Chequeo solape final
      const dateKey = `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, "0")}-${String(startAt.getDate()).padStart(2, "0")}`;
      const busy = await busyForDay(dateKey, staffId);
      if (busy.some((b) => overlaps(startAt, endAt, new Date(b.startAt), new Date(b.endAt)))) {
        set.status = 409;
        return { success: false, error: "Ese hueco ya está ocupado" };
      }

      const clientId = me.role === "client" ? me.id : (body.clientId ?? pet.ownerId);
      const [row] = await db
        .insert(appointments)
        .values({ petId: pet.id, serviceId: service.id, staffId, clientId, startAt, endAt, notes: body.notes ?? null })
        .returning();
      set.status = 201;
      return { success: true, data: row };
    },
    {
      body: t.Object({
        petId: t.String(),
        serviceId: t.String(),
        staffId: t.Optional(t.String()),
        clientId: t.Optional(t.String()),
        startAt: t.String(),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .patch(
    "/api/v1/appointments/:id/status",
    async ({ params, body, request, set }) => {
      const me = await requireSession(request);
      if (!me) {
        set.status = 401;
        return { success: false, error: "No autenticado" };
      }
      const current = await db.query.appointments.findFirst({
        where: (a, { eq }) => eq(a.id, params.id),
      });
      if (!current) {
        set.status = 404;
        return { success: false, error: "No encontrada" };
      }
      const isOwner = current.clientId === me.id;
      const allowed =
        me.role !== "client"
          ? ["pending", "confirmed", "cancelled", "done"]
          : current.status !== "done" && body.status === "cancelled" && isOwner
            ? ["cancelled"]
            : [];
      if (!allowed.includes(body.status)) {
        set.status = 403;
        return { success: false, error: "Transición no permitida" };
      }
      const [row] = await db
        .update(appointments)
        .set({ status: body.status })
        .where(eq(appointments.id, params.id))
        .returning();
      return { success: true, data: row };
    },
    { body: t.Object({ status: t.Union([t.Literal("pending"), t.Literal("confirmed"), t.Literal("cancelled"), t.Literal("done")]) }) },
  );

void pets;
void services;
void staff;
