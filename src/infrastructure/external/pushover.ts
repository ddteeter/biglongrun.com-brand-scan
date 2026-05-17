export interface PushoverOptions {
  userKey: string;
  appToken: string;
  fetch?: typeof globalThis.fetch;
}

export interface NotifyInput {
  title: string;
  message: string;
  url?: string;
  priority?: -1 | 0 | 1;
}

export class PushoverClient {
  private readonly fetchFn: typeof globalThis.fetch;
  constructor(private readonly opts: PushoverOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  async notify(input: NotifyInput): Promise<void> {
    const optional: Record<string, string> = {};
    if (input.url !== undefined) optional.url = input.url;
    if (input.priority !== undefined) optional.priority = String(input.priority);
    const body = new URLSearchParams({
      token: this.opts.appToken,
      user: this.opts.userKey,
      title: input.title,
      message: input.message,
      ...optional,
    });
    const r = await this.fetchFn("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) throw new Error(`Pushover failed: ${String(r.status)} ${await r.text()}`);
  }
}
