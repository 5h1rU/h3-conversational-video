import { describe, expect, it } from "vitest";
import {
  buildCloudflareWebSearchAnswerRequest,
  decodeCloudflareWebSearchAnswerResponse,
} from "../src/answer-planner";

const content = {
  canAnswer: true,
  topic: "us-open",
  confidence: "high",
  answer: "Sabalenka won the match in straight sets.",
  ingress: "On that U.S. Open question, here is the verified result.",
  egress: "That brings us naturally back to her title defense.",
};

function responseWithCitation(
  url = "https://www.usopen.org/report.html",
  includeCitation = true,
  searchStatus = "completed",
) {
  return {
    status: "completed",
    output: [
      { type: "web_search_call", status: searchStatus, id: "search-1" },
      {
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(content),
            annotations: includeCitation
              ? [
                  {
                    type: "url_citation",
                    start_index: 0,
                    end_index: 42,
                    title: "Official match report",
                    url,
                  },
                ]
              : [],
          },
        ],
      },
    ],
  };
}

describe("Cloudflare Unified AI grounded-answer boundary", () => {
  it("uses one low-context OpenAI Responses web-search request", () => {
    const request = buildCloudflareWebSearchAnswerRequest({
      question: "What was the U.S. Open score?",
      episodeId: "sports-news-2026-08-31",
      currentAnchor: "anchor-001",
      requestedAt: "2026-08-31T20:00:00.000Z",
    });
    expect(request.tools).toEqual([
      { type: "web_search_preview", search_context_size: "low" },
    ]);
    expect(request.tool_choice).toBe("required");
    expect(request.text.format.type).toBe("json_schema");
    expect(request.text.format.strict).toBe(true);
    expect(request.max_output_tokens).toBe(500);
    expect(request.store).toBe(false);
    expect(JSON.stringify(request)).not.toContain("messages");
    expect(JSON.stringify(request)).not.toContain("max_turns");
  });

  it("decodes structured dialogue separately from provider citation annotations", () => {
    const plan = decodeCloudflareWebSearchAnswerResponse(
      responseWithCitation(),
      "2026-08-31T20:00:00.000Z",
    );
    expect(plan.topic).toBe("us-open");
    expect(plan.sources[0]?.url.href).toContain("usopen.org");
    expect(plan.answer).toBe(content.answer);
  });

  it("rejects an asserted answer without evidence or with an unsafe URL", () => {
    expect(() =>
      decodeCloudflareWebSearchAnswerResponse(
        responseWithCitation("https://www.usopen.org/report.html", false),
        "2026-08-31T20:00:00.000Z",
      ),
    ).toThrow("sufficient evidence");
    expect(() =>
      decodeCloudflareWebSearchAnswerResponse(
        responseWithCitation("http://example.com/result"),
        "2026-08-31T20:00:00.000Z",
      ),
    ).toThrow();
  });

  it("rejects a response that did not complete a web-search call", () => {
    expect(() =>
      decodeCloudflareWebSearchAnswerResponse(
        responseWithCitation(
          "https://www.usopen.org/report.html",
          true,
          "in_progress",
        ),
        "2026-08-31T20:00:00.000Z",
      ),
    ).toThrow();
  });
});
