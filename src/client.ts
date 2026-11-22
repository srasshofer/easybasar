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

export class EasybasarError extends Error {
  constructor(public readonly body: EasybasarErrorBody) {
    const parts = [body.msg?.trim(), body.solution?.trim()].filter(Boolean);
    super(`easybasar-Fehler ${body.number ?? "?"}: ${parts.join(" – ")}`);
  }
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
  private password?: string;

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

  /** Login mit Zugangsdaten zur Laufzeit; bei Erfolg werden sie für Re-Logins gemerkt. */
  async login(user: string, password: string, forceLogout = false) {
    const postData: Data = {
      user,
      password,
      o: apiInstance,
      v: apiVersion,
      c: clientVersion,
      l: language,
    };
    if (forceLogout) postData.force_logout = "true";
    // Frische Session: alte Cookies verwerfen, sonst wird ggf. eine abgelaufene Session weitergereicht.
    this.cookies.clear();
    this.loginResponse = null;
    this.loginResponse = await this.request("app_login", "POST", postData, {
      Accept: "application/json",
    });
    if (!this.cookies.size) {
      this.loginResponse = null;
      throw new Error("Login-Antwort ohne Session-Cookie – weitere Aufrufe wären nicht angemeldet.");
    }
    this.user = user;
    this.password = password;
    return this.loginResponse;
  }

  /** Erneuter Login mit den zuletzt erfolgreichen Zugangsdaten. */
  async relogin() {
    if (!this.user || !this.password) throw new Error("Nicht eingeloggt.");
    return this.login(this.user, this.password);
  }

  logout() {
    this.cookies.clear();
    this.loginResponse = null;
    this.user = this.password = undefined;
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
