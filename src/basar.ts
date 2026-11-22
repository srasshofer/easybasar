import { ApiGeneralRequest } from "./client.js";

/** Ein Eintrag aus basar_list.php → data[]. */
export interface Basar {
  ID: string;
  Basar: string;
  VKNr?: string;
  Logo?: string;
  CKIB?: string;
  CKIE?: string;
  SALB?: string;
  SALE?: string;
  PAYB?: string;
  PAYE?: string;
  ORG_OWNER?: string;
  LOC_PLZ?: string;
  LOC_CITY?: string;
  RIGHT?: number;
  HOMEPAGE?: string;
  Button?: number;
  [k: string]: unknown;
}

/** Kurzform für Claude/den Nutzer. */
export function summarize(b: Basar) {
  const range = (a?: string, e?: string) => (a || e ? `${a ?? "?"} – ${e ?? "?"}` : undefined);
  const ort = [b.LOC_PLZ, b.LOC_CITY].filter(Boolean).join(" ");
  return {
    id: b.ID,
    name: b.Basar,
    verkaeufernummer: b.VKNr || undefined,
    veranstalter: b.ORG_OWNER || undefined,
    ort: ort || undefined,
    abgabe: range(b.CKIB, b.CKIE),
    verkauf: range(b.SALB, b.SALE),
    auszahlung: range(b.PAYB, b.PAYE),
  };
}

export class NeedsBasarChoice extends Error {
  constructor(public readonly basare: Basar[]) {
    super(
      basare.length
        ? "Bitte zuerst einen Basar auswählen (easybasar_basar_waehlen mit der id):\n" +
            JSON.stringify(basare.map(summarize), null, 2)
        : "Für dieses Konto ist kein Basar vorhanden. Eine Verkäufernummer kann auf " +
            "https://www.easybasar.de/basar-anmeldung angefordert werden.",
    );
  }
}

/** Merkt sich die Basare des Kontos und den ausgewählten Basar (data.ID). */
export class BasarState {
  private list: Basar[] | null = null;
  private selectedId: string | null = null;

  /** onEmpty: wird bei leerer Liste einmal aufgerufen (z. B. Re-Login), danach erneut geladen –
   *  basar_list.php liefert ohne gültige Session kein Fehler, sondern eine leere Liste. */
  constructor(
    private readonly api: ApiGeneralRequest,
    private readonly onEmpty?: () => Promise<unknown>,
  ) {}

  get selected(): Basar | null {
    return this.list?.find((b) => b.ID === this.selectedId) ?? null;
  }

  reset() {
    this.list = null;
    this.selectedId = null;
  }

  /** Lädt basar_list.php (action=app). Bei genau einem Basar wird dieser sofort ausgewählt. */
  async load(): Promise<Basar[]> {
    const fetchList = async () => {
      const res = (await this.api.request("basar_list", "POST", { action: "app" })) as {
        data?: Basar[];
      };
      return Array.isArray(res?.data) ? res.data : [];
    };
    this.list = await fetchList();
    if (!this.list.length && this.onEmpty) {
      await this.onEmpty();
      this.list = await fetchList();
    }
    if (this.selectedId && !this.list.some((b) => b.ID === this.selectedId)) {
      this.selectedId = null;
    }
    if (this.list.length === 1) this.selectedId = this.list[0].ID;
    return this.list;
  }

  async select(id: string): Promise<Basar> {
    if (!this.list) await this.load();
    const b = this.list!.find((x) => x.ID === id);
    if (!b) throw new NeedsBasarChoice(this.list!);
    this.selectedId = b.ID;
    return b;
  }

  /**
   * Teilt dem Server den Basar mit (select_basar_seller_chiffre). Der Server merkt sich die Auswahl
   * in der Session; basar_visible/item_tool beziehen sich danach auf diesen Basar.
   */
  async activate(b: Basar): Promise<unknown> {
    return this.api.request("select_basar_seller_chiffre", "POST", {
      basar_id: b.ID,
      privileg: "seller",
      mod_seller: "true",
    });
  }

  /** Für Artikel-Aktionen: liefert den gewählten Basar oder verlangt eine Auswahl. */
  async require(): Promise<Basar> {
    if (!this.selected) await this.load();
    if (this.selected) return this.selected;
    throw new NeedsBasarChoice(this.list ?? []);
  }
}
