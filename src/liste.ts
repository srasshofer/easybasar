import { ApiGeneralRequest } from "./client.js";

/** Module für item_all_get (wie in der App). Reihenfolge der Schlüssel ist wichtig (base64 des JSON). */
export const LISTEN = {
  erfasst: { id: "270", titel: "Erfasst" },
  abgegeben: { id: "271", titel: "Abgegeben (Check-in)" },
  verkauft: { id: "272", titel: "Verkauft" },
  zurueck: { id: "273", titel: "Zurücksortiert (Check-out)" },
} as const;

export type ListName = keyof typeof LISTEN;

export function modulParam(id: string) {
  return { id, type: "register_items", discount: false, utf8: "€", showBasarSelect: "0" };
}

/** POST-Daten für item_all_get: modul = IDs kommagetrennt, modullist_param = base64(JSON) kommagetrennt. */
export function itemAllGetData(lists: ListName[]): Record<string, string> {
  const ids = lists.map((l) => LISTEN[l].id);
  return {
    privileg: "seller",
    modul: ids.join(","),
    modullist_param: ids
      .map((id) => Buffer.from(JSON.stringify(modulParam(id)), "utf8").toString("base64"))
      .join(","),
  };
}

export interface RawItem {
  id: string;
  number: string;
  desc: string;
  price: number;
  discount?: number;
  sold_price?: number;
  sold_discount?: number;
  print?: number;
  status?: number;
  edit?: number;
  chiffre?: string;
  time?: number;
}

export interface Item {
  liste: string;
  id: string;
  artikelnummer: string;
  beschreibung: string;
  preis: number;
  rabatt?: number;
  verkaufspreis?: number;
  gedruckt: boolean;
  bearbeitbar: boolean;
  verkaeufernummer?: string;
}

/** Lädt die Artikel der gewünschten Listen (nichts wird lokal gespeichert). */
export async function loadItems(api: ApiGeneralRequest, lists: ListName[]): Promise<Item[]> {
  const res = (await api.request("item_all_get", "POST", itemAllGetData(lists))) as {
    itemlist?: Record<string, { add?: RawItem[] }>;
  };
  const byId = new Map<string, string>(lists.map((l) => [LISTEN[l].id, LISTEN[l].titel]));
  const entries = Object.entries(res?.itemlist ?? {});
  const items: Item[] = [];
  for (const [key, mod] of entries) {
    // Antwort-Schlüssel = Modul-ID; bei nur einer angefragten Liste eindeutig zuordenbar.
    const liste = byId.get(key) ?? (lists.length === 1 ? LISTEN[lists[0]].titel : `Liste ${key}`);
    for (const r of mod?.add ?? []) {
      items.push({
        liste,
        id: String(r.id),
        artikelnummer: String(r.number),
        beschreibung: r.desc,
        preis: Number(r.price),
        rabatt: r.discount ? Number(r.discount) : undefined,
        verkaufspreis:
          r.sold_price !== undefined && Number(r.sold_price) !== Number(r.price)
            ? Number(r.sold_price)
            : undefined,
        gedruckt: Boolean(Number(r.print)),
        bearbeitbar: Boolean(Number(r.edit)),
        verkaeufernummer: r.chiffre,
      });
    }
  }
  return items;
}

/** Sucht Artikel per Artikelnummer (oder ID) in einer Liste. */
export function findItems(items: Item[], keys: string[]) {
  const found: Item[] = [];
  const missing: string[] = [];
  for (const k of keys.map((x) => x.trim())) {
    const it = items.find((i) => i.artikelnummer === k) ?? items.find((i) => i.id === k);
    if (it) found.push(it);
    else missing.push(k);
  }
  return { found, missing };
}
