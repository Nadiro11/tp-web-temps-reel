import type { Response } from "express";

const clients = new Set<Response>();
const orderClients = new Map<number, Set<Response>>();
let id = 0;

function removeClient(res: Response, orderId?: number): void {
  if (orderId === undefined) {
    clients.delete(res);
    return;
  }
  const subscribers = orderClients.get(orderId);
  subscribers?.delete(res);
  if (subscribers?.size === 0) orderClients.delete(orderId);
}

export function registerClient(res: Response, orderId?: number): void {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();

  if (orderId === undefined) {
    clients.add(res);
  } else {
    let subscribers = orderClients.get(orderId);
    if (!subscribers) {
      subscribers = new Set<Response>();
      orderClients.set(orderId, subscribers);
    }
    subscribers.add(res);
  }
  res.on("close", () => removeClient(res, orderId));
}

export function broadcast(event: string, data: unknown): void {
  const msg = `id: ${++id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);

 
  if ((event === "order-created" || event === "order-updated") &&
      typeof data === "object" && data !== null && "id" in data &&
      typeof data.id === "number") {
    const subscribers = orderClients.get(data.id);
    if (subscribers) {
      for (const res of subscribers) res.write(msg);
    }
  }
}
