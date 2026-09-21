import { extractInvoiceDocument } from "../invoice/extract";
import { classifyExtractedPeopleDoc, type PeopleDocClassifyOptions } from "./strategy";
import type { PeopleDocParseResult } from "./types";

export {
  PEOPLE_DOC_PARSER_ID,
  PEOPLE_DOC_PARSER_VERSION,
  PEOPLE_DOC_LLM_PARSER_ID,
  PEOPLE_DOC_LLM_PARSER_VERSION,
  PEOPLE_DOC_FIELD_DEFS,
  type PeopleDocClassifyMode,
  type PeopleDocField,
  type PeopleDocFieldKey,
  type PeopleDocFolder,
  type PeopleDocHeader,
  type PeopleDocParseResult,
  type PeopleDocParseStatus,
  type PeopleDocParseTraceEvent,
} from "./types";
export { classifyPeopleDoc, fieldsFromHeader, parseYesNo, scorePeopleDoc, statusForPeopleDoc } from "./classify";
export { classifyExtractedPeopleDoc, getPeopleDocClassifyStatus } from "./strategy";
export { validatePeopleDocLlm, coerceSynopsis, PEOPLE_DOC_LLM_OUTPUT_SCHEMA } from "./schema";
export {
  PeopleDocModelError,
  peopleDocModelChoices,
  resetPeopleDocModelSelection,
  resolvePeopleDocParseModel,
  selectPeopleDocModelForParse,
  setPeopleDocModelSelection,
} from "./models";
export { createOpenAiPeopleDocLlmClient, buildPeopleDocLlmMessages } from "./llm";
export type { PeopleDocLlmClient } from "./llm";
export { mergeStaticAndLlmPeopleDoc } from "./merge";

export async function parsePeopleDocument(
  buf: Buffer,
  options: { fileName: string } & PeopleDocClassifyOptions,
): Promise<PeopleDocParseResult> {
  const extracted = await extractInvoiceDocument(buf, options.fileName);
  return classifyExtractedPeopleDoc(extracted, {
    config: options.config,
    llmClient: options.llmClient,
  });
}
