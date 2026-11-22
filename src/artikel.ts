import { ApiGeneralRequest, EasybasarError } from "./client.js";

/** Ein Beschreibungsfeld aus form.item_description_fields (pro Basar unterschiedlich). */
export interface DescriptionField {
  name: string;
  type: string;
  required: number | boolean;
  size?: number;
  maxlength?: number;
  comment?: string;
  value?: string;
  options?: unknown[];
}

export interface ItemForm {
  basar_id: string;
  price: {
    currency: string;
    value?: string;
    item_price_min: number;
    item_price_max: number;
    item_price_div: number;
  };
  item_description_length?: number;
  item_register_description_extended?: number;
  item_description_fields: DescriptionField[];
  item_register_ean?: boolean;
  discount?: {
    discount_enabled: boolean;
    discount_begin?: string;
    discount_steps?: number[];
  };
}

export interface ItemCount {
  item_actual_count: number;
  item_max_count: number;
}

export interface FormInfo {
  form: ItemForm;
  item: ItemCount;
}

/** Lädt das Erfassungsformular des aktuellen Basars (basar_visible.php). */
export async function loadForm(api: ApiGeneralRequest): Promise<FormInfo> {
  const res = (await api.request("basar_visible", "POST", {
    update: "reset_form",
    privileg: "seller",
  })) as { info?: Partial<FormInfo> };
  const info = res?.info;
  if (!info?.form || !Array.isArray(info.form.item_description_fields)) {
    throw new Error("basar_visible.php lieferte kein Erfassungsformular.");
  }
  return info as FormInfo;
}

export const limitReached = (c: ItemCount) => c.item_actual_count >= c.item_max_count;

export const LIMIT_TEXT =
  "Das Artikel-Limit für diesen Basar ist erreicht. Um einen neuen Artikel zu erfassen, " +
  "muss zuerst ein Artikel gelöscht werden – oder du bittest die Basarleitung, die Anzahl zu erhöhen.";

const optionValue = (o: unknown): string =>
  o && typeof o === "object"
    ? String((o as Record<string, unknown>).value ?? (o as Record<string, unknown>).name ?? "")
    : String(o);

/** Kompakte Beschreibung des Formulars für Claude/den Nutzer. */
export function describeForm(f: FormInfo) {
  const { form, item } = f;
  const d = form.discount;
  return {
    basar_id: form.basar_id,
    artikel: {
      erfasst: item.item_actual_count,
      maximal: item.item_max_count,
      frei: Math.max(0, item.item_max_count - item.item_actual_count),
      limitErreicht: limitReached(item),
    },
    preis: {
      waehrung: form.price.currency,
      min: form.price.item_price_min,
      max: form.price.item_price_max,
      schritt: form.price.item_price_div,
    },
    felder: form.item_description_fields.map((x) => ({
      name: x.name,
      pflicht: Boolean(Number(x.required)),
      maxLaenge: x.maxlength,
      hinweis: x.comment || undefined,
      auswahl: x.options?.length ? x.options.map(optionValue) : undefined,
    })),
    beschreibungGesamtMax: form.item_description_length,
    ean: Boolean(form.item_register_ean),
    rabatt: d?.discount_enabled
      ? {
          moeglich: true,
          ab: d.discount_begin || undefined,
          stufen: (d.discount_steps ?? [])
            .map(Number)
            .filter((x) => x > 0)
            .map((x) => ({ wert: x, anzeige: pct(x) })),
          hinweis: "Nutzer wählt selbst: kein Rabatt (0) oder eine Stufe.",
        }
      : { moeglich: false },
  };
}

/** Preis in Cent (akzeptiert 2.5, "2,50", "2.50 €"). */
export function parsePriceCents(p: number | string): number | null {
  const n = typeof p === "number" ? p : Number(String(p).replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const fmt = (cents: number, cur: string) =>
  `${(cents / 100).toFixed(2).replace(".", ",")} ${cur === "EUR" ? "€" : cur}`;

export interface ItemInput {
  felder: Record<string, string>;
  preis: number | string;
  rabatt?: number;
}

export interface CheckResult {
  ok: boolean;
  fehler: string[];
  warnungen: string[];
  normalisiert?: { felder: Record<string, string>; preis: string; rabatt?: number };
}

/** Prüft einen Artikel gegen das Formular des Basars (Felder, Preis-Range/-Raster, Rabatt, Limit). */
/**
 * partial = Bearbeiten: nur angegebene Felder werden geprüft und gesendet (leere bleiben unverändert),
 * Pflichtfelder und Rabatt werden nicht erzwungen.
 */
export function checkItem(f: FormInfo, input: ItemInput, isNew = true, partial = false): CheckResult {
  const { form, item } = f;
  const fehler: string[] = [];
  const warnungen: string[] = [];

  if (isNew && limitReached(item)) fehler.push(LIMIT_TEXT);

  // Felder
  const known = new Map(form.item_description_fields.map((x) => [x.name.toLowerCase(), x]));
  for (const key of Object.keys(input.felder)) {
    if (!known.has(key.toLowerCase())) {
      fehler.push(
        `Unbekanntes Feld „${key}“. Erlaubt: ${form.item_description_fields.map((x) => x.name).join(", ")}.`,
      );
    }
  }
  const felder: Record<string, string> = {};
  for (const fd of form.item_description_fields) {
    const entry = Object.entries(input.felder).find(([k]) => k.toLowerCase() === fd.name.toLowerCase());
    const v = (entry?.[1] ?? "").toString().trim();
    if (!v && partial) continue;
    if (!v) {
      if (Number(fd.required)) fehler.push(`„${fd.name}“ ist ein Pflichtfeld.`);
      else warnungen.push(`„${fd.name}“ ist leer${fd.comment ? ` (${fd.comment})` : ""}.`);
    }
    if (fd.maxlength && v.length > fd.maxlength) {
      fehler.push(`„${fd.name}“ darf höchstens ${fd.maxlength} Zeichen haben (aktuell ${v.length}).`);
    }
    if (v && fd.options?.length) {
      const opts = fd.options.map(optionValue);
      if (!opts.includes(v)) fehler.push(`„${fd.name}“ muss einer dieser Werte sein: ${opts.join(", ")}.`);
    }
    felder[fd.name] = v;
  }
  const total = Object.values(felder).filter(Boolean).join(" ").length;
  if (form.item_description_length && total > form.item_description_length) {
    warnungen.push(
      `Die Beschreibung ist zusammen ${total} Zeichen lang; der Basar sieht ${form.item_description_length} vor – auf dem Etikett wird sie evtl. gekürzt.`,
    );
  }

  // Preis: min ≤ preis ≤ max und teilbar durch item_price_div (in Cent gerechnet).
  const { item_price_min: min, item_price_max: max, item_price_div: div, currency } = form.price;
  const cents = parsePriceCents(input.preis);
  const minC = Math.round(min * 100);
  const maxC = Math.round(max * 100);
  const divC = Math.round(div * 100);
  let preis: string | undefined;
  if (cents === null) {
    fehler.push(`Ungültiger Preis „${input.preis}“.`);
  } else {
    if (cents < minC || cents > maxC) {
      fehler.push(`Der Preis muss zwischen ${fmt(minC, currency)} und ${fmt(maxC, currency)} liegen.`);
    }
    if (divC > 0 && cents % divC !== 0) {
      const down = Math.max(minC, Math.floor(cents / divC) * divC);
      const up = Math.min(maxC, Math.ceil(cents / divC) * divC);
      fehler.push(
        `Der Preis muss in Schritten von ${fmt(divC, currency)} angegeben werden – z. B. ${fmt(down, currency)} oder ${fmt(up, currency)}.`,
      );
    }
    preis = (cents / 100).toFixed(2);
  }

  // Rabatt: nur wenn der Basar ihn anbietet; der Nutzer wählt selbst – „kein Rabatt“ (0) oder eine Stufe.
  // Stufen sind Anteile (0.1 = 10 %); Eingabe als Anteil oder Prozent (10) möglich.
  const d = form.discount;
  let rabatt: number | undefined;
  const given = input.rabatt === undefined ? undefined : normalizeDiscount(Number(input.rabatt));
  if (d?.discount_enabled) {
    const steps = (d.discount_steps ?? []).map(Number).filter((x) => x > 0);
    const choices = `kein Rabatt, ${steps.map(pct).join(", ")}`;
    if (given === undefined) {
      if (!partial) {
        fehler.push(
          `Dieser Basar bietet Rabatt an${d.discount_begin ? ` (ab ${d.discount_begin})` : ""}. ` +
            `Bitte den Nutzer wählen lassen: ${choices}.`,
        );
      }
    } else if (given === 0) {
      rabatt = 0;
    } else if (!steps.some((x) => Math.abs(x - given) < 1e-9)) {
      fehler.push(`Rabatt ${pct(given)} ist nicht erlaubt. Möglich: ${choices}.`);
    } else rabatt = given;
  } else if (given) {
    fehler.push("Dieser Basar bietet keinen Rabatt an.");
  }

  return {
    ok: fehler.length === 0,
    fehler,
    warnungen,
    normalisiert: fehler.length ? undefined : { felder, preis: preis!, rabatt },
  };
}

/** Erkennt eine ungültige/abgelaufene Session (z. B. Nr. 110 bei basar_visible, response "login"). */
export function isSessionError(e: unknown): boolean {
  return e instanceof EasybasarError && (e.body.response === "login" || e.body.number === 110);
}

/** 10 → 0.1, 0.1 → 0.1 */
export function normalizeDiscount(x: number): number {
  return x > 1 ? x / 100 : x;
}

/** 0.1 → "10 %" */
export const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;

/** Preis wie die App: "2,00" */
export const priceParam = (preis: string) => preis.replace(".", ",");

/** POST-Daten für item_tool.php aus einem geprüften Artikel. Feldnamen = Namen aus item_description_fields. */
export function itemToolData(normalized: NonNullable<CheckResult["normalisiert"]>): Record<string, string> {
  // Wie die App: Preis mit Komma, leere Felder weglassen, discount nur bei gewähltem Rabatt.
  const d: Record<string, string> = {
    price: priceParam(normalized.preis),
    right: "seller",
    big_item: "false",
    item_count: "1",
  };
  for (const [k, v] of Object.entries(normalized.felder)) if (v) d[k] = v;
  if (normalized.rabatt) d.discount = String(normalized.rabatt);
  return d;
}

/** POST-Daten zum Bearbeiten (item_tool.php, action=edit, NumberEdit). Nur nicht-leere Felder. */
export function itemEditData(
  normalized: NonNullable<CheckResult["normalisiert"]>,
  itemNumber: string,
): Record<string, string> {
  const d: Record<string, string> = {
    price: priceParam(normalized.preis),
    right: "seller",
    big_item: "false",
    action: "edit",
    NumberEdit: itemNumber,
  };
  for (const [k, v] of Object.entries(normalized.felder)) if (v) d[k] = v;
  if (normalized.rabatt) d.discount = String(normalized.rabatt);
  return d;
}

/** Artikelnummer aus der Antwort von item_tool.php (info.additional). */
export function itemNumber(res: unknown): string | undefined {
  const a = (res as { info?: { additional?: unknown } })?.info?.additional;
  return a === undefined || a === null || a === "" ? undefined : String(a);
}
