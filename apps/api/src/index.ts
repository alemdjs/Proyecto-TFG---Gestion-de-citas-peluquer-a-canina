import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysia/openapi";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { catalogRoutes } from "./routes/catalog";
import { petRoutes } from "./routes/pets";
import { appointmentRoutes } from "./routes/appointments";

const PORT = Number(process.env.PORT ?? 3000);
const origins = (process.env.CORS_DOMAINS ?? "http://localhost:4321")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = new Elysia()
  .use(cors({ origin: origins, credentials: true }))
  .use(openapi({ path: "/openapi" }))
  .get("/healthz", () => ({ ok: true, service: "peluqueria-api" }))
  .get("/", () => ({
    service: "peluqueria-api",
    docs: "/openapi",
    health: "/healthz",
  }))
  .use(authRoutes)
  .use(adminRoutes)
  .use(catalogRoutes)
  .use(petRoutes)
  .use(appointmentRoutes)
  // Cacharro final: cualquier ruta desconocida responde JSON (no texto "NOT_FOUND"),
  // para que los clientes que hacen res.json() no exploten.
  .get("/*", ({ set }) => {
    set.status = 404;
    return { success: false, error: "Ruta no encontrada" };
  })
  .onError(({ error, set, code }) => {
    const status = set.status ?? 500;
    // Los 4xx (validación, 401, 404...) son tráfico normal: sin stack en consola.
    if (typeof status === "number" && status >= 500) console.error(error);
    else if (process.env.NODE_ENV !== "production")
      console.warn(`[${code ?? "?"}]`, (error as Error)?.message ?? error);
    set.status ??= 500;
    return { success: false, error: "Error interno" };
  });

app.listen(PORT, () => {
  console.log(`API peluquería escuchando en http://localhost:${PORT}`);
});

export type App = typeof app;
