import { db } from "./index";
import { appointments, pets, services, staff, staffServices, users } from "./schema";

async function main() {
  const adminEmail = "admin@peluditos.local";
  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, adminEmail),
  });

  let adminId: string;
  let groomerId: string;

  if (!existing) {
    const hash = await Bun.password.hash("admin123");
    const [admin] = await db
      .insert(users)
      .values({
        name: "Admin Peluditos",
        email: adminEmail,
        passwordHash: hash,
        role: "admin",
        phone: "600000000",
      })
      .returning();
    adminId = admin.id;

    const gHash = await Bun.password.hash("groomer123");
    const [groomer] = await db
      .insert(users)
      .values({
        name: "Lucía Peluquera",
        email: "lucia@peluditos.local",
        passwordHash: gHash,
        role: "groomer",
      })
      .returning();
    groomerId = groomer.id;

    const [lucia, marco] = await db
      .insert(staff)
      .values([
        { name: "Lucía Peluquera", userId: groomer.id, active: true },
        { name: "Marco Estilista", userId: null, active: true },
      ])
      .returning();

    const insertedServices = await db
      .insert(services)
      .values([
        { name: "Baño completo", description: "Baño con champú natural, secado y perfume.", priceCents: 2500, durationMin: 45, active: true },
        { name: "Corte de pelo", description: "Corte a tijera o máquina según raza.", priceCents: 3000, durationMin: 60, active: true },
        { name: "Baño + Corte", description: "Servicio completo: baño, corte, uñas y oídos.", priceCents: 4500, durationMin: 90, active: true },
        { name: "Corte de uñas", description: "Corte y limado de uñas.", priceCents: 1000, durationMin: 20, active: true },
        { name: "Deslanado", description: "Eliminación de pelo muerto y subpelo.", priceCents: 3500, durationMin: 60, active: true },
      ])
      .returning();

    // Lucía lo ofrece todo; Marco (estilista) no hace deslanado.
    await db.insert(staffServices).values(
      insertedServices.map((s) => ({ staffId: lucia.id, serviceId: s.id })),
    );
    await db.insert(staffServices).values(
      insertedServices
        .filter((s) => s.name !== "Deslanado")
        .map((s) => ({ staffId: marco.id, serviceId: s.id })),
    );

    // Mascota demo del admin para probar el flujo
    await db.insert(pets).values({
      ownerId: adminId,
      name: "Rocky",
      breed: "Labrador",
      size: "L",
      weightKg: 28,
      notes: "Mascota de demostración",
    });

    console.log("Seed OK: admin@peluditos.local / admin123");
    console.log("Seed OK: lucia@peluditos.local / groomer123");
  } else {
    console.log("Seed omitido: ya existen datos");
  }

  // Backfill: peluqueros sin servicios asignados (bases creadas antes de staff_services) ofrecen todo el catálogo activo.
  const allStaff = await db.query.staff.findMany();
  const allServices = await db.query.services.findMany({
    where: (s, { eq }) => eq(s.active, true),
  });
  for (const st of allStaff) {
    const assigned = await db.query.staffServices.findMany({
      where: (ss, { eq }) => eq(ss.staffId, st.id),
    });
    if (assigned.length === 0 && allServices.length > 0) {
      await db
        .insert(staffServices)
        .values(allServices.map((s) => ({ staffId: st.id, serviceId: s.id })))
        .onConflictDoNothing();
    }
  }

  void groomerId;
  void appointments;
}

await main();
process.exit(0);
