/**
 * Load UK cash-management reference CSVs from
 * `aggCenter/ORG_112 - UK/{inv,po,so,rem}` (override via CASH_ORG_ROOT /
 * REFERENCE_*_PREFIX).
 */
import { ingestReferenceDocuments } from "@/lib/reference/ingest";
import { getReferenceRepository } from "@/lib/reference/repository";

const result = await ingestReferenceDocuments();
console.log(JSON.stringify(result, null, 2));
console.log("counts", await getReferenceRepository().counts());
