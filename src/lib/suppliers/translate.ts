/**
 * Turn VIES registered name/address into English.
 *
 * Member states return native-script text (Greek for EL, Cyrillic for BG).
 * We ask a public translate endpoint first, then fall back to transliteration
 * so a VIES check still yields Latin/English when the network call fails.
 */

export interface TranslateResult {
  text: string;
  original: string;
  translated: boolean;
}

export interface TranslateOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const GTX_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

/** Letters outside Latin (and Latin extensions) — Greek, Cyrillic, etc. */
export function hasNonLatinScript(text: string): boolean {
  return /[\u0370-\u03FF\u1F00-\u1FFF\u0400-\u04FF\u0500-\u052F]/.test(text);
}

export function transliterateToLatin(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const two = text.slice(i, i + 2);
    const mappedTwo = GREEK_DIGRAPHS[two] ?? GREEK_DIGRAPHS[two.toLowerCase()];
    if (mappedTwo != null) {
      out += preserveCase(two, mappedTwo);
      i += 1;
      continue;
    }
    const ch = text[i];
    const mapped = LETTERS[ch] ?? LETTERS[ch.toLowerCase()];
    if (mapped == null) {
      out += ch;
      continue;
    }
    out += ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? titleCase(mapped) : mapped;
  }
  return out;
}

export async function translateToEnglish(
  value: string | undefined,
  options: TranslateOptions = {},
): Promise<TranslateResult> {
  const original = (value ?? "").trim();
  if (!original) return { text: "", original: "", translated: false };
  if (!hasNonLatinScript(original)) {
    return { text: original, original, translated: false };
  }

  const remote = await translateRemote(original, options).catch(() => null);
  if (remote && remote.trim() && remote.trim() !== original) {
    return { text: remote.trim(), original, translated: true };
  }

  const latin = transliterateToLatin(original).trim();
  if (latin && latin !== original) {
    return { text: latin, original, translated: true };
  }
  return { text: original, original, translated: false };
}

async function translateRemote(text: string, options: TranslateOptions): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      `${GTX_ENDPOINT}?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "aggcenter-vies" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return parseGtx(data);
  } finally {
    clearTimeout(timer);
  }
}

function parseGtx(data: unknown): string | null {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  const parts: string[] = [];
  for (const chunk of data[0] as unknown[]) {
    if (Array.isArray(chunk) && typeof chunk[0] === "string") parts.push(chunk[0]);
  }
  const joined = parts.join("").trim();
  return joined || null;
}

function preserveCase(source: string, mapped: string): string {
  if (source === source.toUpperCase()) return mapped.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return titleCase(mapped);
  return mapped;
}

function titleCase(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

const GREEK_DIGRAPHS: Record<string, string> = {
  αι: "ai",
  ει: "ei",
  οι: "oi",
  ου: "ou",
  αυ: "av",
  ευ: "ev",
  ηυ: "iv",
  μπ: "b",
  ντ: "d",
  γκ: "gk",
  γγ: "ng",
  γχ: "nch",
  γξ: "nx",
  τσ: "ts",
  τζ: "tz",
};

const LETTERS: Record<string, string> = {
  α: "a",
  ά: "a",
  β: "v",
  γ: "g",
  δ: "d",
  ε: "e",
  έ: "e",
  ζ: "z",
  η: "i",
  ή: "i",
  θ: "th",
  ι: "i",
  ί: "i",
  ϊ: "i",
  ΐ: "i",
  κ: "k",
  λ: "l",
  μ: "m",
  ν: "n",
  ξ: "x",
  ο: "o",
  ό: "o",
  π: "p",
  ρ: "r",
  σ: "s",
  ς: "s",
  τ: "t",
  υ: "y",
  ύ: "y",
  ϋ: "y",
  ΰ: "y",
  φ: "f",
  χ: "ch",
  ψ: "ps",
  ω: "o",
  ώ: "o",
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "",
  ю: "yu",
  я: "ya",
};
