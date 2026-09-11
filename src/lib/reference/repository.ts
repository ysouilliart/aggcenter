import { promises as fs } from "fs";
import path from "path";

import type { PurchaseOrder, Remittance, SalesOrder } from "../domain/types";
import { isDatabaseConfigured } from "../db/client";
import { REFERENCE_SOURCE } from "./fromExtracts";

export interface ReferenceSnapshot {
  salesOrders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
  remittances: Remittance[];
}

export interface ReferenceRepository {
  readonly name: string;
  replaceAll(snapshot: ReferenceSnapshot, source?: string): Promise<void>;
  listSalesOrders(): Promise<SalesOrder[]>;
  listPurchaseOrders(): Promise<PurchaseOrder[]>;
  listRemittances(): Promise<Remittance[]>;
  counts(): Promise<{ salesOrders: number; purchaseOrders: number; remittances: number }>;
}

function splitList(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split("|").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

export class LocalJsonReferenceRepository implements ReferenceRepository {
  readonly name = "local-json";
  constructor(private readonly file = path.join(process.cwd(), ".data", "reference.json")) {}

  private async read(): Promise<ReferenceSnapshot> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as ReferenceSnapshot;
    } catch {
      return { salesOrders: [], purchaseOrders: [], remittances: [] };
    }
  }

  async replaceAll(snapshot: ReferenceSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async listSalesOrders(): Promise<SalesOrder[]> {
    return (await this.read()).salesOrders;
  }
  async listPurchaseOrders(): Promise<PurchaseOrder[]> {
    return (await this.read()).purchaseOrders;
  }
  async listRemittances(): Promise<Remittance[]> {
    return (await this.read()).remittances;
  }
  async counts() {
    const snap = await this.read();
    return {
      salesOrders: snap.salesOrders.length,
      purchaseOrders: snap.purchaseOrders.length,
      remittances: snap.remittances.length,
    };
  }
}

const BATCH = 500;

export class PostgresReferenceRepository implements ReferenceRepository {
  readonly name = "postgres";

  async replaceAll(snapshot: ReferenceSnapshot, source = REFERENCE_SOURCE): Promise<void> {
    const { getDb } = await import("../db/client");
    const { salesOrders, purchaseOrders, remittances } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    await db.transaction(async (tx) => {
      await tx.delete(salesOrders).where(eq(salesOrders.source, source));
      await tx.delete(purchaseOrders).where(eq(purchaseOrders.source, source));
      await tx.delete(remittances).where(eq(remittances.source, source));

      for (let i = 0; i < snapshot.salesOrders.length; i += BATCH) {
        const chunk = snapshot.salesOrders.slice(i, i + BATCH).map((o) => ({
          id: o.id,
          customer: o.customer,
          amount: o.amount,
          currency: o.currency,
          orderDate: o.orderDate,
          dueDate: o.dueDate,
          status: o.status,
          customerPo: o.customerPo ?? null,
          operatingUnit: o.operatingUnit ?? null,
          source,
        }));
        if (chunk.length) await tx.insert(salesOrders).values(chunk);
      }
      for (let i = 0; i < snapshot.purchaseOrders.length; i += BATCH) {
        const chunk = snapshot.purchaseOrders.slice(i, i + BATCH).map((o) => ({
          id: o.id,
          vendor: o.vendor,
          amount: o.amount,
          currency: o.currency,
          orderDate: o.orderDate,
          dueDate: o.dueDate,
          status: o.status,
          invoiceNumber: o.invoiceNumber ?? null,
          poNumbers: o.poNumbers?.length ? o.poNumbers.join("|") : null,
          operatingUnit: o.operatingUnit ?? null,
          country: o.country ?? null,
          source,
        }));
        if (chunk.length) await tx.insert(purchaseOrders).values(chunk);
      }
      for (let i = 0; i < snapshot.remittances.length; i += BATCH) {
        const chunk = snapshot.remittances.slice(i, i + BATCH).map((r) => ({
          id: r.id,
          party: r.party,
          name: r.name,
          reference: r.reference ?? "",
          amount: r.amount,
          currency: r.currency,
          date: r.date,
          remittanceNumber: r.remittanceNumber ?? null,
          invoiceNumbers: r.invoiceNumbers?.length ? r.invoiceNumbers.join("|") : null,
          operatingUnit: r.operatingUnit ?? null,
          status: r.status ?? null,
          source,
        }));
        if (chunk.length) await tx.insert(remittances).values(chunk);
      }
    });
  }

  async listSalesOrders(): Promise<SalesOrder[]> {
    const { getDb } = await import("../db/client");
    const { salesOrders } = await import("../db/schema");
    const rows = await getDb().select().from(salesOrders);
    return rows.map((r) => ({
      id: r.id,
      customer: r.customer,
      amount: r.amount,
      currency: r.currency,
      orderDate: r.orderDate,
      dueDate: r.dueDate,
      status: r.status as SalesOrder["status"],
      customerPo: r.customerPo ?? undefined,
      operatingUnit: r.operatingUnit ?? undefined,
    }));
  }

  async listPurchaseOrders(): Promise<PurchaseOrder[]> {
    const { getDb } = await import("../db/client");
    const { purchaseOrders } = await import("../db/schema");
    const rows = await getDb().select().from(purchaseOrders);
    return rows.map((r) => ({
      id: r.id,
      vendor: r.vendor,
      amount: r.amount,
      currency: r.currency,
      orderDate: r.orderDate,
      dueDate: r.dueDate,
      status: r.status as PurchaseOrder["status"],
      invoiceNumber: r.invoiceNumber ?? undefined,
      poNumbers: splitList(r.poNumbers),
      operatingUnit: r.operatingUnit ?? undefined,
      country: r.country ?? undefined,
    }));
  }

  async listRemittances(): Promise<Remittance[]> {
    const { getDb } = await import("../db/client");
    const { remittances } = await import("../db/schema");
    const rows = await getDb().select().from(remittances);
    return rows.map((r) => ({
      id: r.id,
      party: r.party as Remittance["party"],
      name: r.name,
      reference: r.reference,
      amount: r.amount,
      currency: r.currency,
      date: r.date,
      remittanceNumber: r.remittanceNumber ?? undefined,
      invoiceNumbers: splitList(r.invoiceNumbers),
      operatingUnit: r.operatingUnit ?? undefined,
      status: r.status ?? undefined,
    }));
  }

  async counts() {
    const { getDb } = await import("../db/client");
    const { salesOrders, purchaseOrders, remittances } = await import("../db/schema");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    const [so] = await db.select({ n: sql<number>`count(*)` }).from(salesOrders);
    const [po] = await db.select({ n: sql<number>`count(*)` }).from(purchaseOrders);
    const [rem] = await db.select({ n: sql<number>`count(*)` }).from(remittances);
    return {
      salesOrders: Number(so?.n ?? 0),
      purchaseOrders: Number(po?.n ?? 0),
      remittances: Number(rem?.n ?? 0),
    };
  }
}

let cached: ReferenceRepository | null = null;

export function getReferenceRepository(): ReferenceRepository {
  if (cached) return cached;
  cached = isDatabaseConfigured()
    ? new PostgresReferenceRepository()
    : new LocalJsonReferenceRepository();
  return cached;
}
