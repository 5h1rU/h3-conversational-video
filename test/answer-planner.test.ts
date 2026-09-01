import { describe, expect, it } from "vitest";
import {
  buildMoonshotGroundedAnswerRequest,
  buildMoonshotWebSearchRequest,
  decodeBoundedJsonResponse,
  decodeMoonshotGroundedAnswerResponse,
  decodeMoonshotWebSearchResponse,
} from "../src/answer-planner";

const input = {
  question: "What was the U.S. Open score?",
  episodeId: "sports-news-2026-08-31",
  currentAnchor: "anchor-001",
  requestedAt: "2026-08-31T20:00:00.000Z",
};

const content = {
  canAnswer: true,
  topic: "us-open",
  confidence: "high",
  subject: "the U.S. Open score",
  answer: "Sabalenka won 6-3, 6-2.",
  ingress: "On the U.S. Open score—",
  egress: "Back to her defense.",
  sources: [
    {
      title: "Official match report",
      url: "https://www.usopen.org/report.html",
      publishedAt: "2026-08-31T18:00:00Z",
    },
  ],
};

function searchResponse(
  name = "$web_search",
  argumentsJson = '{"query":"US Open Sabalenka score"}',
) {
  return {
    id: "chat-search",
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tool-search-1",
              type: "builtin_function",
              function: { name, arguments: argumentsJson },
            },
          ],
        },
      },
    ],
  };
}

function finalResponse(value: unknown = content) {
  return {
    id: "chat-answer",
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(value) },
      },
    ],
  };
}

describe("Moonshot Kimi grounded-answer boundary", () => {
  it("requests exactly one built-in search with thinking disabled", () => {
    const request = buildMoonshotWebSearchRequest(input, "kimi-k2.6");
    expect(request.model).toBe("kimi-k2.6");
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.tools).toEqual([
      {
        type: "builtin_function",
        function: { name: "$web_search" },
      },
    ]);
    expect(request.tool_choice).toBe("auto");
    expect(request.max_tokens).toBe(500);
    expect(request.messages[0]?.content).toContain(
      "this answer may play after the program has moved to an unrelated story",
    );
    expect(request.messages[0]?.content).toContain(
      '"subject":{"type":"string","maxLength":48}',
    );
    expect(JSON.stringify(request)).not.toContain("apiKey");
  });

  it("round-trips the provider tool call once before requesting JSON", () => {
    const search = decodeMoonshotWebSearchResponse(searchResponse());
    const request = buildMoonshotGroundedAnswerRequest(
      input,
      "kimi-k2.6",
      search,
    );
    expect(search.toolMessage).toEqual({
      role: "tool",
      tool_call_id: "tool-search-1",
      name: "$web_search",
      content: '{"query":"US Open Sabalenka score"}',
    });
    expect(request.messages.slice(-2)).toEqual([
      search.assistantMessage,
      search.toolMessage,
    ]);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.tools).toHaveLength(1);
  });

  it("rejects unknown, malformed, or repeated search tool calls", () => {
    expect(() =>
      decodeMoonshotWebSearchResponse(searchResponse("another_tool")),
    ).toThrow();
    expect(() =>
      decodeMoonshotWebSearchResponse(searchResponse("$web_search", "nope")),
    ).toThrow();
    const repeated = searchResponse();
    repeated.choices[0]!.message.tool_calls.push({
      id: "tool-search-2",
      type: "builtin_function",
      function: { name: "$web_search", arguments: '{"query":"again"}' },
    });
    expect(() => decodeMoonshotWebSearchResponse(repeated)).toThrow(
      "exactly once",
    );
  });

  it("decodes grounded dialogue and HTTPS sources from final JSON", () => {
    const plan = decodeMoonshotGroundedAnswerResponse(
      finalResponse(),
      input.requestedAt,
    );
    expect(plan.topic).toBe("us-open");
    expect(plan.subject).toBe("the U.S. Open score");
    expect(plan.sources[0]?.url.href).toContain("usopen.org");
    expect(plan.answer).toBe(content.answer);
  });

  it("rejects asserted answers without evidence and unsafe source URLs", () => {
    expect(() =>
      decodeMoonshotGroundedAnswerResponse(
        finalResponse({ ...content, sources: [] }),
        input.requestedAt,
      ),
    ).toThrow("sufficient evidence");
    expect(() =>
      decodeMoonshotGroundedAnswerResponse(
        finalResponse({
          ...content,
          sources: [
            { ...content.sources[0], url: "http://example.com/result" },
          ],
        }),
        input.requestedAt,
      ),
    ).toThrow();
  });

  it("rejects a delayed answer whose ingress does not name its subject", () => {
    expect(() =>
      decodeMoonshotGroundedAnswerResponse(
        finalResponse({ ...content, ingress: "On that earlier question—" }),
        input.requestedAt,
      ),
    ).toThrow("original question subject");
  });

  it("rejects dialogue that would force rushed seven-second speech", () => {
    expect(() =>
      decodeMoonshotGroundedAnswerResponse(
        finalResponse({
          ...content,
          ingress: "A viewer asks about the U.S. Open score.",
          answer:
            "Sabalenka won this match in straight sets by a score of 6-3, 6-2.",
          egress: "Now we return to the title-defense story.",
        }),
        input.requestedAt,
      ),
    ).toThrow("sixteen spoken words");
  });

  it("bounds external response bodies before JSON decoding", async () => {
    await expect(
      decodeBoundedJsonResponse(
        new Response(JSON.stringify(finalResponse())),
        10,
      ),
    ).rejects.toThrow("exceeded limit");
  });
});
