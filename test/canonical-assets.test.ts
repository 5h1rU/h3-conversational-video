import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const path =
  "canonical/sports-news-2026-08-31/continuity/sports-news-visual-bible-v1.png";
const url =
  "https://prototype.example/v1/canonical/assets/sports-news-visual-bible-v1.png";

describe("canonical continuity assets", () => {
  it("supports the provider's HEAD probe and subsequent GET", async () => {
    await env.MEDIA.put(path, new Uint8Array([137, 80, 78, 71]), {
      httpMetadata: { contentType: "image/png" },
    });

    const head = await SELF.fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/png");
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const get = await SELF.fetch(url);
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });
});
