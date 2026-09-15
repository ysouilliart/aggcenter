/**
 * Reset cash tables and load one UK baseline from
 * `aggCenter/ORG_112 - UK/{INV_112,PO_112,SO_112,REM_112,BANK_112}`.
 */
import { loadCashBaseline } from "@/lib/cash/baseline";
import { getReferenceRepository } from "@/lib/reference/repository";
import { getStatementRepository } from "@/lib/statements";

const result = await loadCashBaseline();
console.log(JSON.stringify(result, null, 2));
console.log("reference counts", await getReferenceRepository().counts());
console.log("statements", (await getStatementRepository().listStatements()).length);
