import {
  BASES,
  BaseName,
  apiInstance,
  apiVersion,
  clientVersion,
  language,
} from "./config.js";

export interface EasybasarErrorBody {
  response?: string;
  number?: number;
  msg?: string;
  solution?: string;
  additional?: string;
  message?: unknown;
}

/** Nutzertext einer Server-Meldung (error/info): nur msg und solution, ohne Nummer. */
export function messageText(m: EasybasarErrorBody | undefined): string {
  return [m?.msg, m?.solution]
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

export class EasybasarError extends Error {
  constructor(public readonly body: EasybasarErrorBody) {
    super(messageText(body) || "Unbekannter Fehler von easybasar.");
  }
}

/** Session abgelaufen und JWT ungültig/abgelaufen → neuer Login mit E-Mail/Passwort nötig. */
export class SessionExpired extends Error {
  constructor() {
    super("Die Anmeldung ist abgelaufen. Bitte neu einloggen.");
  }
}

/** Payload eines JWT dekodieren (ohne Signaturprüfung – nur für exp/data). */
export function jwtPayload(jwt: string): { exp?: number; data?: Record<string, unknown> } | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** true, wenn exp vorbei ist (oder der JWT nicht lesbar ist). */
export function jwtExpired(jwt: string, now = Date.now()): boolean {
  const p = jwtPayload(jwt);
  if (!p) return true;
  return typeof p.exp === "number" ? p.exp * 1000 <= now : false;
}

export type Method = "GET" | "POST";
export type Data = Record<string, string | number | boolean>;

/**
 * Nachbau von ApiGeneralRequest().request(endpoint, method, data, headers)
 * aus der easybasar-App. Hält die Session-Cookies über alle Aufrufe hinweg.
 */
export class ApiGeneralRequest {
  private cookies = new Map<string, string>();
  private loginResponse: unknown = null;

  private user?: string;

  get isLoggedIn(): boolean {
    return this.loginResponse !== null;
  }

  get lastLogin(): unknown {
    return this.loginResponse;
  }

  /** Baut die URL: <base>/<endpoint>.php (Endung nur, wenn keine angegeben ist). */
  static url(endpoint: string, base: BaseName = "includes"): string {
    const clean = endpoint.replace(/^\/+/, "");
    const withExt = /\.[a-z0-9]+$/i.test(clean.split("?")[0]) ? clean : `${clean}.php`;
    return `${BASES[base]}/${withExt}`;
  }

  async request(
    endpoint: string,
    method: Method = "POST",
    data: Data = {},
    headers: Record<string, string> = { Accept: "application/json" },
    base: BaseName = "includes",
  ): Promise<unknown> {
    const res = await this.raw(endpoint, method, data, headers, base);
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `Keine JSON-Antwort von ${endpoint} (HTTP ${res.status}): ${text.slice(0, 300)}`,
      );
    }
    if (json && typeof json === "object" && "error" in json) {
      throw new EasybasarError((json as { error: EasybasarErrorBody }).error);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${endpoint}`);
    return json;
  }

  /** Roher Aufruf, z. B. für PDF-Downloads. */
  async raw(
    endpoint: string,
    method: Method,
    data: Data,
    headers: Record<string, string>,
    base: BaseName,
  ): Promise<Response> {
    let url = ApiGeneralRequest.url(endpoint, base);
    const params = new URLSearchParams(
      Object.entries(data).map(([k, v]) => [k, String(v)]),
    );
    const init: RequestInit = {
      method,
      headers: { ...headers, ...this.cookieHeader() },
      redirect: "manual",
    };
    if (method === "GET") {
      if ([...params].length) url += (url.includes("?") ? "&" : "?") + params;
    } else {
      init.body = params;
      (init.headers as Record<string, string>)["Content-Type"] =
        "application/x-www-form-urlencoded; charset=UTF-8";
    }
    // Redirects selbst folgen, damit Set-Cookie aus 30x-Antworten nicht verloren geht.
    for (let hop = 0; hop < 10; hop++) {
      const res = await fetch(url, init);
      this.storeCookies(res);
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) return res;
      url = new URL(location, url).toString();
      if (res.status !== 307 && res.status !== 308) {
        init.method = "GET";
        delete init.body;
        delete (init.headers as Record<string, string>)["Content-Type"];
      }
      init.headers = { ...(init.headers as Record<string, string>), ...this.cookieHeader() };
    }
    throw new Error(`Zu viele Weiterleitungen bei ${endpoint}`);
  }

  /** Namen der aktuell gehaltenen Session-Cookies (ohne Werte). */
  get cookieNames(): string[] {
    return [...this.cookies.keys()];
  }

  get currentUser(): string | undefined {
    return this.isLoggedIn ? this.user : undefined;
  }

  /** Aktueller JWT (zum Erneuern der Session); undefined, wenn keiner vorliegt. */
  get jwt(): string | undefined {
    return this.token;
  }

  /** Wird aufgerufen, wenn der Server einen (neuen) JWT liefert – z. B. zum Speichern. */
  onJwt?: (user: string, jwt: string) => Promise<void> | void;

  private token?: string;

  private baseLoginData(): Data {
    return { o: apiInstance, v: apiVersion, c: clientVersion, l: language };
  }

  /** JWT und Session-Instanz aus info.message übernehmen. */
  private async takeLoginInfo(res: unknown) {
    const msg = (res as { info?: { message?: Record<string, unknown> } })?.info?.message;
    const jwt = typeof msg?.jwt === "string" && msg.jwt ? msg.jwt : undefined;
    if (jwt) {
      this.token = jwt;
      const u = jwtPayload(jwt)?.data?.email;
      if (typeof u === "string" && u) this.user = u;
      if (this.user) await this.onJwt?.(this.user, jwt);
    }
  }

  /** Login mit E-Mail/Passwort. Das Passwort wird nur für diesen Aufruf verwendet, nicht behalten. */
  async login(user: string, password: string, forceLogout = false) {
    const postData: Data = { user, password, ...this.baseLoginData() };
    if (forceLogout) postData.force_logout = "true";
    // Frische Session: alte Cookies/JWT verwerfen.
    this.reset();
    this.user = user;
    const res = await this.request("app_login", "POST", postData, {
      Accept: "application/json",
    });
    if (!this.cookies.size) {
      this.reset();
      throw new Error("Login-Antwort ohne Session-Cookie – weitere Aufrufe wären nicht angemeldet.");
    }
    this.loginResponse = res;
    await this.takeLoginInfo(res);
    return res;
  }

  /**
   * Neue Session mit dem JWT holen (wie checkSession der App): app_login nur mit o/v/c/l und
   * Header Authorization: Bearer <jwt>. Erfolg = info.number 2205 (oder response.data.instance).
   * Liefert false, wenn kein gültiger JWT vorliegt oder der Server ihn ablehnt.
   */
  async renew(jwt = this.token, user = this.user): Promise<boolean> {
    if (!jwt || jwtExpired(jwt)) return false;
    let res: unknown;
    try {
      res = await this.request("app_login", "POST", this.baseLoginData(), {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
      });
    } catch (e) {
      if (e instanceof EasybasarError) return false;
      throw e;
    }
    const r = res as {
      info?: { number?: unknown };
      response?: { data?: { instance?: unknown } };
    };
    const ok = String(r?.info?.number) === "2205" || r?.response?.data?.instance !== undefined;
    if (!ok) return false;
    this.token = jwt;
    this.user = user ?? (jwtPayload(jwt)?.data?.email as string | undefined);
    this.loginResponse = res;
    await this.takeLoginInfo(res);
    return true;
  }

  /** Session erneuern (nach Fehler 110): nur per JWT, nie mit Passwort. */
  async relogin() {
    if (!(await this.renew())) {
      this.reset();
      throw new SessionExpired();
    }
  }

  logout() {
    this.reset();
  }

  private reset() {
    this.cookies.clear();
    this.loginResponse = null;
    this.token = undefined;
    this.user = undefined;
  }

  private cookieHeader(): Record<string, string> {
    if (!this.cookies.size) return {};
    return {
      Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    };
  }

  private storeCookies(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const attr = (k: string) =>
        attrs.map((a) => a.trim()).find((a) => a.toLowerCase().startsWith(k + "="))?.slice(k.length + 1);
      const maxAge = attr("max-age");
      const expires = attr("expires");
      const expired =
        (maxAge !== undefined && Number(maxAge) <= 0) ||
        (expires !== undefined && Date.parse(expires) <= Date.now()) ||
        value === "" ||
        value === "deleted";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
