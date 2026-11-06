import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Config, JsonDB } from "node-json-db";
import type { Order, Product, User } from "./types";

type Database = {
  users: User[];
  products: Product[];
  orders: Order[];
};

const dataDirectory = path.join(__dirname, "../data");
const db = new JsonDB(new Config(path.join(dataDirectory, "db.json"), true, true, "/"));

export async function initializeDb(): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  // Une base existante n'est jamais réinitialisée.
  if (await db.exists("/users")) return;

  const initialData: Database = {
    users: [
      { id: 1, name: "Alice Martin", username: "alice", email: "alice@example.com" },
      { id: 2, name: "Bob Dupont", username: "bob", email: "bob@example.com" },
    ],
    products: [
      { id: 1, name: "Clavier", stock: 10 },
      { id: 2, name: "Souris", stock: 15 },
      { id: 3, name: "Écran", stock: 5 },
    ],
    orders: [],
  };
  await db.push("/", initialData);
}

// Chaque modification attend la précédente pour éviter les doubles ID et le surstock vendu.
let pendingWrite: Promise<void> = Promise.resolve();

export async function readData(): Promise<Database> {
  await pendingWrite;
  return structuredClone(await db.getObject<Database>("/"));
}

export function updateData<T>(update: (data: Database) => T): Promise<T> {
  const operation = pendingWrite.then(async () => {
    const data = structuredClone(await db.getObject<Database>("/"));
    const result = update(data);
    await db.push("/", data);
    return result;
  });
  // Un refus métier ne doit pas bloquer les requêtes suivantes.
  pendingWrite = operation.then(() => undefined, () => undefined);
  return operation;
}
