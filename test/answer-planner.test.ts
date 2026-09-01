import { describe, expect, it } from "vitest";
import {
  buildSonarAnswerRequest,
  decodeSonarAnswerResponse,
} from "../src/answer-planner";

const content = {
  canAnswer: true,
  topic: "us-open",
  confidence: "high",
  answer: "Sabalenka won the match in straight sets.",
  ingress: "On that U.S. Open question, here is the verified result.",
  egress: "That brings us naturally back to her title defense.",
};

describe("Sonar grounded-answer boundary", () => {
  it("uses one low-context search request with a strict structured output", () => {
    const request = buildSonarAnswerRequest({
      question: "What was the U.S. Open score?",
      episodeId: "sports-news-2026-08-31",
      currentAnchor: "anchor-001",
      requestedAt: "2026-08-31T20:00:00.000Z",
    });
    expect(request.web_search_options).toEqual({ search_context_size: "low" });
    expect(request.search_mode).toBe("web");
    expect(request.response_format.type).toBe("json_schema");
    expect(request.max_tokens).toBe(320);
    expect(JSON.stringify(request)).not.toContain("max_turns");
  });

  it("decodes dialogue separately from provider-owned HTTPS evidence", () => {
    const plan = decodeSonarAnswerResponse(
      {
        choices: [{ message: { content: JSON.stringify(content) } }],
        search_results: [
          {
            title: "Official match report",
            url: "https://www.usopen.org/en_US/news/articles/report.html",
            date: "2026-08-31",
          },
        ],
      },
      "2026-08-31T20:00:00.000Z",
    );
    expect(plan.topic).toBe("us-open");
    expect(plan.sources[0]?.url.href).toContain("usopen.org");
    expect(plan.answer).toBe(content.answer);
  });

  it("rejects an asserted answer without evidence or with an unsafe URL", () => {
    expect(() =>
      decodeSonarAnswerResponse(
        { choices: [{ message: { content: JSON.stringify(content) } }] },
        "2026-08-31T20:00:00.000Z",
      ),
    ).toThrow("sufficient evidence");
    expect(() =>
      decodeSonarAnswerResponse(
        {
          choices: [{ message: { content: JSON.stringify(content) } }],
          search_results: [
            {
              title: "Unsafe result",
              url: "http://example.com/result",
              date: null,
            },
          ],
        },
        "2026-08-31T20:00:00.000Z",
      ),
    ).toThrow();
  });
});
