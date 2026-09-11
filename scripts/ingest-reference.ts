import { ingestReferenceDocuments } from "@/lib/reference/ingest";
import { getReferenceRepository } from "@/lib/reference/repository";

const result = await ingestReferenceDocuments();
console.log(JSON.stringify(result, null, 2));
console.log("counts", await getReferenceRepository().counts());
