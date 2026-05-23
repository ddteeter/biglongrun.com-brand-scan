export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  url: string;
  publishedAt: string;
}

export class RedditRssClient {
  constructor(private readonly fetchFn = globalThis.fetch) {}

  async fetchSubreddit(subreddit: string): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}/.rss`;
    const r = await this.fetchFn(url, {
      headers: { "user-agent": "brand-scan/1.0 (contact: drew@drewteeter.com)" },
    });
    if (!r.ok) throw new Error(`Reddit RSS ${subreddit} returned ${String(r.status)}`);
    const xml = await r.text();
    return parseAtomEntries(xml, subreddit);
  }
}

function extractTag(chunk: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const start = chunk.indexOf(open);
  if (start === -1) return "";
  const contentStart = chunk.indexOf(">", start);
  if (contentStart === -1) return "";
  const end = chunk.indexOf(close, contentStart);
  if (end === -1) return "";
  return chunk.slice(contentStart + 1, end);
}

function extractAttr(chunk: string, tag: string, attr: string): string {
  const open = `<${tag}`;
  const start = chunk.indexOf(open);
  if (start === -1) return "";
  const tagEnd = chunk.indexOf(">", start);
  if (tagEnd === -1) return "";
  const tagSlice = chunk.slice(start, tagEnd + 1);
  const attrKey = `${attr}="`;
  const attrStart = tagSlice.indexOf(attrKey);
  if (attrStart === -1) return "";
  const valStart = attrStart + attrKey.length;
  const valEnd = tagSlice.indexOf('"', valStart);
  if (valEnd === -1) return "";
  return tagSlice.slice(valStart, valEnd);
}

/**
 * Decode common HTML entities in a string.
 * Note: &amp; must be decoded last so prior substitutions are not double-decoded.
 */
function decodeEntities(s: string): string {
  let r = s;
  r = r.split("&lt;").join("<");
  r = r.split("&gt;").join(">");
  r = r.split("&quot;").join('"');
  r = r.split("&#39;").join("'");
  r = r.split("&apos;").join("'");
  r = r.split("&nbsp;").join(" ");
  r = r.split("&amp;").join("&");
  return r;
}

/**
 * Strip HTML tags from a string and decode common HTML entities.
 * The Atom <content type="html"> payload is entity-encoded HTML, so we
 * first decode outer entities (getting raw HTML), then strip the HTML tags,
 * then decode any remaining entities in the resulting plain text.
 * Uses indexOf-based scanning per the sonarjs/slow-regex convention.
 */
function stripHtml(s: string): string {
  // Step 1: decode the outer entity encoding to get raw HTML
  const rawHtml = decodeEntities(s);

  // Step 2: strip HTML tags using indexOf-based scan
  let stripped = "";
  let i = 0;
  while (i < rawHtml.length) {
    const lt = rawHtml.indexOf("<", i);
    if (lt === -1) {
      stripped += rawHtml.slice(i);
      break;
    }
    stripped += rawHtml.slice(i, lt);
    const gt = rawHtml.indexOf(">", lt);
    if (gt === -1) {
      // Unclosed tag — preserve the '<' and continue
      stripped += "<";
      i = lt + 1;
    } else {
      i = gt + 1;
    }
  }

  // Step 3: decode any remaining entities in the plain text
  return decodeEntities(stripped).trim();
}

function parseAtomEntries(xml: string, subreddit: string): RedditPost[] {
  const posts: RedditPost[] = [];
  let cursor = 0;
  let entryStart = xml.indexOf("<entry>", cursor);

  while (entryStart !== -1) {
    const entryEnd = xml.indexOf("</entry>", entryStart);
    if (entryEnd === -1) break;

    const chunk = xml.slice(entryStart, entryEnd + "</entry>".length);
    cursor = entryEnd + "</entry>".length;

    const id = extractTag(chunk, "id").trim();
    const title = extractTag(chunk, "title").trim();
    const published = extractTag(chunk, "published").trim();
    const permalink = extractAttr(chunk, "link", "href").trim();
    const contentHtml = extractTag(chunk, "content").trim();

    if (title && permalink) {
      const selftext = contentHtml ? stripHtml(contentHtml) : "";
      posts.push({
        id,
        subreddit,
        title,
        selftext,
        url: permalink,
        publishedAt: published,
      });
    }

    entryStart = xml.indexOf("<entry>", cursor);
  }

  return posts;
}
