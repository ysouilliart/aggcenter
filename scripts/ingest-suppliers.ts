import { ingestSuppliers } from "@/lib/suppliers/ingest";
import { getSupplierRepository } from "@/lib/suppliers/repository";

const result = await ingestSuppliers();
console.log(JSON.stringify(result, null, 2));
const [suppliers, sites] = await Promise.all([
  getSupplierRepository().listSuppliers(),
  getSupplierRepository().listSites(),
]);
console.log("working copy", { suppliers: suppliers.length, sites: sites.length });
