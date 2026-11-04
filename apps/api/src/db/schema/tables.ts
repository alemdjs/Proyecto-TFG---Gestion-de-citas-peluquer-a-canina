import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type Role = "admin" | "groomer" | "client";
export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "done";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("client").$type<Role>(),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pets = pgTable("pets", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  breed: text("breed").notNull().default("Mestizo"),
  size: text("size").notNull().default("M").$type<"S" | "M" | "L" | "XL">(),
  weightKg: real("weight_kg"),
  notes: text("notes"),
  birthDate: date("birth_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const services = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  durationMin: integer("duration_min").notNull(),
  active: boolean("active").notNull().default(true),
});

export const staff = pgTable("staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

// Qué servicios ofrece cada peluquero (modelo Setmore: el catálogo es global,
// pero cada miembro del equipo ofrece un subconjunto).
export const staffServices = pgTable(
  "staff_services",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] })],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    petId: uuid("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    staffId: uuid("staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<AppointmentStatus>(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("appointments_staff_start_idx").on(t.staffId, t.startAt)],
);
