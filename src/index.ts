import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { initializeDb, readData, updateData } from "./db";
import { broadcast, registerClient } from "./sse";
import type { Order } from "./types";

const app = express();
const port = 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/users", async (_req, res) => {
  res.json((await readData()).users);
});

app.get("/api/products", async (_req, res) => {
  res.json((await readData()).products);
});

app.get("/api/orders", async (_req, res) => {
  res.json((await readData()).orders);
});

app.get("/api/events", (_req, res) => {
  registerClient(res);
});

app.get("/api/orders/:id/events", async (req, res) => {
  const id = orderId(req.params.id);
  if (!(await readData()).orders.some((order) => order.id === id)) {
    throw { status: 404, message: "Commande introuvable." };
  }
  registerClient(res, id);
});

async function deliverOrder(id: number): Promise<void> {
  const order = await updateData((data) => {
    const found = data.orders.find((entry) => entry.id === id);
    if (!found || found.status !== "shipped") return;
    found.status = "delivered";
    return found;
  });
  if (order) broadcast("order-updated", order);
}

function scheduleDelivery(id: number): void {
  setTimeout(() => {
    deliverOrder(id).catch((error: unknown) => {
      console.error(`Impossible de livrer la commande ${id} :`, error);
    });
  }, 20_000);
}

function orderId(value: string): number {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) {
    throw { status: 400, message: "L'identifiant de commande doit être un entier positif." };
  }
  return id;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

app.get("/api/orders/:id", async (req, res) => {
  const id = orderId(req.params.id);
  const order = (await readData()).orders.find((entry) => entry.id === id);
  if (!order) {
    throw { status: 404, message: "Commande introuvable." };
  }
  res.json(order);
});

app.post("/api/orders", async (req: Request<Record<string, string>, unknown, unknown>, res) => {
  const body = req.body;
  if (typeof body !== "object" || body === null) {
    throw { status: 400, message: "userId, productId et quantity sont obligatoires et doivent être des entiers positifs." };
  }
  if (!("userId" in body) || !("productId" in body) || !("quantity" in body)) {
    throw { status: 400, message: "userId, productId et quantity sont obligatoires et doivent être des entiers positifs." };
  }
  const { userId, productId, quantity } = body;
  if (!isPositiveInteger(userId) || !isPositiveInteger(productId) || !isPositiveInteger(quantity)) {
    throw { status: 400, message: "userId, productId et quantity sont obligatoires et doivent être des entiers positifs." };
  }
  const { order, product } = await updateData((data) => {
    if (!data.users.some((user) => user.id === userId)) {
      throw { status: 404, message: "Utilisateur introuvable." };
    }
    const product = data.products.find((entry) => entry.id === productId);
    if (!product) {
      throw { status: 404, message: "Produit introuvable." };
    }
    if (product.stock < quantity) {
      throw { status: 409, message: "Stock insuffisant." };
    }
    const id = data.orders.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    const created: Order = {
      id, userId, productId, quantity,
      status: "preparing",
      createdAt: new Date().toISOString(),
    };
    product.stock -= quantity;
    data.orders.push(created);
    return { order: created, product };
  });
  broadcast("order-created", order);
  broadcast("stock-updated", product);
  res.status(201).json(order);
});

app.patch("/api/orders/:id/ship", async (req, res) => {
  const id = orderId(req.params.id);
  const order = await updateData((data) => {
    const found = data.orders.find((entry) => entry.id === id);
    if (!found) {
      throw { status: 404, message: "Commande introuvable." };
    }
    if (found.status !== "preparing") {
      throw { status: 409, message: "Seule une commande en préparation peut être expédiée." };
    }
    found.status = "shipped";
    return found;
  });
  broadcast("order-updated", order);
  scheduleDelivery(order.id);
  res.json(order);
});

app.patch("/api/orders/:id/cancel", async (req, res) => {
  const id = orderId(req.params.id);
  const { order, product } = await updateData((data) => {
    const found = data.orders.find((entry) => entry.id === id);
    if (!found) {
      throw { status: 404, message: "Commande introuvable." };
    }
    if (found.status !== "preparing") {
      throw { status: 409, message: "Seule une commande en préparation peut être annulée." };
    }
    const product = data.products.find((entry) => entry.id === found.productId);
    if (!product) {
      throw { status: 404, message: "Produit introuvable." };
    }
    found.status = "cancelled";
    product.stock += found.quantity;
    return { order: found, product };
  });
  broadcast("order-updated", order);
  broadcast("stock-updated", product);
  res.json(order);
});

app.use(express.static(path.join(__dirname, "../public")));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (typeof error === "object" && error !== null &&
      "status" in error && typeof error.status === "number" &&
      error.status >= 400 && error.status < 500 &&
      "message" in error && typeof error.message === "string") {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

initializeDb().then(() => {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Serveur disponible sur http://localhost:${port}`);
  });
}).catch((error: unknown) => {
  console.error("Impossible d'initialiser la base de données :", error);
  process.exitCode = 1;
});
