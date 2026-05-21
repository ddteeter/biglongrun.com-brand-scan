import { describe, test, expect } from "bun:test";
import { RedditRssClient } from "../../../src/domain/suggestions/reddit-client";

// A minimal Atom feed with 3 entries for testing
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>running</title>
  <entry>
    <id>t3_abc123</id>
    <title>Best running apparel for 2024?</title>
    <link href="https://www.reddit.com/r/running/comments/abc123/best_running_apparel/" />
    <published>2024-01-15T10:00:00+00:00</published>
    <content type="html">&lt;p&gt;Looking for recommendations on &lt;strong&gt;running gear&lt;/strong&gt;. I love Tracksmith &amp;amp; Path Projects.&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>t3_def456</id>
    <title>Janji review</title>
    <link href="https://www.reddit.com/r/running/comments/def456/janji_review/" />
    <published>2024-01-14T08:00:00+00:00</published>
    <content type="html">&lt;p&gt;Janji makes great stuff.&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>t3_ghi789</id>
    <title>RunningFashion monthly picks</title>
    <link href="https://www.reddit.com/r/running/comments/ghi789/monthly_picks/" />
    <published>2024-01-13T06:00:00+00:00</published>
    <content type="html">&lt;p&gt;Check out these brands: Oiselle, Soar Running, On.&lt;/p&gt;</content>
  </entry>
</feed>`;

// Feed with HTML content that needs stripping
const HTML_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>t3_html1</id>
    <title>HTML rich post</title>
    <link href="https://www.reddit.com/r/running/comments/html1/post/" />
    <published>2024-01-15T10:00:00+00:00</published>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;Hello &lt;b&gt;World&lt;/b&gt;. Price: &lt;em&gt;$99&lt;/em&gt;&lt;/p&gt;&lt;/div&gt;</content>
  </entry>
</feed>`;

// Feed where an entry is missing its content tag
const NO_CONTENT_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>t3_nocon</id>
    <title>Post with no body</title>
    <link href="https://www.reddit.com/r/running/comments/nocon/post/" />
    <published>2024-01-15T10:00:00+00:00</published>
  </entry>
</feed>`;

// Feed with entries that are missing title or link (should be skipped)
const PARTIAL_ENTRIES_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>t3_notitle</id>
    <link href="https://www.reddit.com/r/running/comments/notitle/post/" />
    <published>2024-01-15T10:00:00+00:00</published>
    <content type="html">no title here</content>
  </entry>
  <entry>
    <id>t3_nolink</id>
    <title>Post with no link</title>
    <published>2024-01-15T10:00:00+00:00</published>
    <content type="html">no link here</content>
  </entry>
  <entry>
    <id>t3_valid</id>
    <title>Valid post</title>
    <link href="https://www.reddit.com/r/running/comments/valid/post/" />
    <published>2024-01-15T10:00:00+00:00</published>
    <content type="html">valid content</content>
  </entry>
</feed>`;

// Feed with entity-encoded content
const ENTITIES_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>t3_ent1</id>
    <title>Entity test</title>
    <link href="https://www.reddit.com/r/running/comments/ent1/post/" />
    <published>2024-01-15T10:00:00+00:00</published>
    <content type="html">&lt;p&gt;Price: &amp;lt;$99&amp;gt; and it&#39;s &amp;quot;great&amp;quot; &amp;amp; fast&lt;/p&gt;</content>
  </entry>
</feed>`;

function makeFetch(body: string, status = 200): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "content-type": "application/atom+xml" },
      })
    )) as unknown as typeof globalThis.fetch;
}

function makeCapturingFetch(body: string): {
  fetch: typeof globalThis.fetch;
  capturedHeaders: Record<string, string>;
} {
  const capturedHeaders: Record<string, string> = {};
  const fetch = ((_url: string, init?: RequestInit) => {
    const hdrs = init?.headers as Record<string, string> | undefined;
    if (hdrs) Object.assign(capturedHeaders, hdrs);
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      })
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, capturedHeaders };
}

describe("RedditRssClient", () => {
  test("parses a 3-entry Atom feed into RedditPost records", async () => {
    const client = new RedditRssClient(makeFetch(SAMPLE_FEED));
    const posts = await client.fetchSubreddit("running");

    expect(posts.length).toBe(3);

    const first = posts[0];
    expect(first?.id).toBe("t3_abc123");
    expect(first?.subreddit).toBe("running");
    expect(first?.title).toBe("Best running apparel for 2024?");
    expect(first?.url).toBe(
      "https://www.reddit.com/r/running/comments/abc123/best_running_apparel/"
    );
    expect(first?.publishedAt).toBe("2024-01-15T10:00:00+00:00");
    // Content should be stripped of HTML
    expect(first?.selftext).toContain("Tracksmith");
    expect(first?.selftext).not.toContain("<");

    const second = posts[1];
    expect(second?.id).toBe("t3_def456");
    expect(second?.title).toBe("Janji review");
  });

  test("strips HTML tags from selftext", async () => {
    const client = new RedditRssClient(makeFetch(HTML_FEED));
    const [post] = await client.fetchSubreddit("running");

    expect(post?.selftext).not.toContain("<div");
    expect(post?.selftext).not.toContain("<p>");
    expect(post?.selftext).not.toContain("<b>");
    expect(post?.selftext).toContain("Hello World");
    expect(post?.selftext).toContain("$99");
  });

  test("decodes common HTML entities in selftext", async () => {
    const client = new RedditRssClient(makeFetch(ENTITIES_FEED));
    const [post] = await client.fetchSubreddit("running");

    expect(post?.selftext).toContain("<$99>");
    expect(post?.selftext).toContain('"great"');
    expect(post?.selftext).toContain("& fast");
    expect(post?.selftext).toContain("it's");
  });

  test("returns empty selftext when entry has no content tag", async () => {
    const client = new RedditRssClient(makeFetch(NO_CONTENT_FEED));
    const [post] = await client.fetchSubreddit("running");

    expect(post).toBeDefined();
    expect(post?.selftext).toBe("");
    expect(post?.title).toBe("Post with no body");
  });

  test("skips entries missing title or link without throwing", async () => {
    const client = new RedditRssClient(makeFetch(PARTIAL_ENTRIES_FEED));
    const posts = await client.fetchSubreddit("running");

    // Only the valid entry should be returned (the no-title and no-link entries skipped)
    expect(posts.length).toBe(1);
    expect(posts[0]?.id).toBe("t3_valid");
  });

  test("returns empty array on empty feed", async () => {
    const emptyFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>empty</title></feed>`;
    const client = new RedditRssClient(makeFetch(emptyFeed));
    const posts = await client.fetchSubreddit("running");
    expect(posts).toEqual([]);
  });

  test("throws a clear error on non-2xx HTTP response", async () => {
    const client = new RedditRssClient(makeFetch("Not Found", 404));

    let threw = false;
    let errorMessage = "";
    try {
      await client.fetchSubreddit("running");
    } catch (error) {
      threw = true;
      errorMessage = (error as Error).message;
    }

    expect(threw).toBe(true);
    expect(errorMessage).toContain("running");
    expect(errorMessage).toContain("404");
  });

  test("sends the expected User-Agent header", async () => {
    const { fetch, capturedHeaders } = makeCapturingFetch(SAMPLE_FEED);
    const client = new RedditRssClient(fetch);
    await client.fetchSubreddit("running");

    expect(capturedHeaders["user-agent"]).toBe("brand-scan/1.0 (contact: drew@drewteeter.com)");
  });
});
