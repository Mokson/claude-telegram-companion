#!/usr/bin/env bun
/**
 * Telegram companion MCP server.
 *
 * Provides send and edit tools with HTML formatting support for Telegram.
 * Progress indicators and typing are handled by the PostToolUse hook + daemon.
 * Reads the same bot token and access.json as the main telegram plugin.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Bot } from "grammy";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const STATE_DIR = join(homedir(), ".claude", "channels", "telegram");
const ACCESS_FILE = join(STATE_DIR, "access.json");
const ENV_FILE = join(STATE_DIR, ".env");

// Load token from the same .env the plugin uses
try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  process.stderr.write(
    `telegram-progress: TELEGRAM_BOT_TOKEN required\n` +
      `  set in ${ENV_FILE}\n`
  );
  process.exit(1);
}

const bot = new Bot(TOKEN);

// --- Access control (mirrors the plugin's pattern) ---

type Access = {
  allowFrom: string[];
  groups: Record<string, unknown>;
};

function loadAccess(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      allowFrom: parsed.allowFrom ?? [],
      groups: parsed.groups ?? {},
    };
  } catch {
    return { allowFrom: [], groups: {} };
  }
}

function assertAllowedChat(chatId: string): void {
  const access = loadAccess();
  if (access.allowFrom.includes(chatId)) return;
  if (chatId in access.groups) return;
  throw new Error(
    `chat ${chatId} is not allowlisted — add via /telegram:access`
  );
}

// --- Validation ---

function validateChatId(chatId: unknown): string {
  if (typeof chatId !== "string" || !/^-?\d+$/.test(chatId)) {
    throw new Error("chat_id must be a numeric string");
  }
  return chatId;
}

function validateParseMode(format: unknown): "HTML" | undefined {
  if (format === "html") return "HTML";
  return undefined;
}

const MAX_CHUNK_LIMIT = 4096;

// Chunk long messages at paragraph boundaries
function chunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const para = rest.lastIndexOf("\n\n", limit);
    const line = rest.lastIndexOf("\n", limit);
    const space = rest.lastIndexOf(" ", limit);
    const cut =
      para > limit / 2
        ? para
        : line > limit / 2
          ? line
          : space > 0
            ? space
            : limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

// HTML parse error fallback: retry without parse_mode
async function sendWithHtmlFallback<T>(
  fn: (parseMode?: "HTML") => Promise<T>,
  parseMode?: "HTML"
): Promise<T> {
  try {
    return await fn(parseMode);
  } catch (err) {
    if (
      parseMode &&
      err instanceof Error &&
      (err.message.includes("parse") || err.message.includes("can't parse"))
    ) {
      return await fn(undefined);
    }
    throw err;
  }
}

// --- MCP Server ---

const mcp = new Server(
  { name: "telegram-progress", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "These tools are ONLY for Telegram channel communication. " +
      'Do NOT use them unless you are handling a message from the Telegram channel ' +
      '(indicated by <channel source="telegram"> tags in the conversation). ' +
      "For normal terminal interactions, ignore these tools entirely. " +
      "Do NOT call the plugin react tool directly. Reactions are managed by the official plugin's ackReaction setting.",
  }
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send",
      description:
        "Send a formatted message to a Telegram chat. Supports HTML parse_mode for bold, italic, code, pre, links, blockquotes, and spoilers. Use this instead of the plugin's reply tool when formatting is needed.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: {
            type: "string",
            description: "Telegram chat ID (numeric string)",
          },
          text: {
            type: "string",
            description:
              "Message text with HTML formatting (auto-chunked if >4096 chars)",
          },
          format: {
            type: "string",
            enum: ["html", "plain"],
            description: "Parse mode (default: html)",
          },
          reply_to: {
            type: "string",
            description: "Message ID to thread under (optional)",
          },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "edit",
      description:
        "Edit a previously sent message with formatted text. Supports HTML parse_mode.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: {
            type: "string",
            description: "Telegram chat ID (numeric string)",
          },
          message_id: {
            type: "string",
            description: "ID of the message to edit",
          },
          text: {
            type: "string",
            description: "New message text with HTML formatting",
          },
          format: {
            type: "string",
            enum: ["html", "plain"],
            description: "Parse mode (default: html)",
          },
        },
        required: ["chat_id", "message_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (req.params.name) {
      case "send": {
        const chatId = validateChatId(args.chat_id);
        const text = args.text as string;
        if (!text || text.length === 0) throw new Error("text is required");
        const parseMode = validateParseMode(args.format ?? "html");
        const replyTo =
          args.reply_to != null ? Number(args.reply_to) : undefined;

        assertAllowedChat(chatId);

        const chunks = chunk(text, MAX_CHUNK_LIMIT);
        const sentIds: number[] = [];

        for (let i = 0; i < chunks.length; i++) {
          const shouldReplyTo = replyTo != null && i === 0;
          const replyOpts = shouldReplyTo
            ? { reply_parameters: { message_id: replyTo } }
            : {};
          const sent = await sendWithHtmlFallback(
            (pm) =>
              bot.api.sendMessage(chatId, chunks[i], {
                ...(pm ? { parse_mode: pm } : {}),
                ...replyOpts,
              }),
            parseMode
          );
          sentIds.push(sent.message_id);
        }

        const result =
          sentIds.length === 1
            ? `sent (id: ${sentIds[0]})`
            : `sent ${sentIds.length} parts (ids: ${sentIds.join(", ")})`;
        return { content: [{ type: "text", text: result }] };
      }

      case "edit": {
        const chatId = validateChatId(args.chat_id);
        const messageId = Number(args.message_id);
        const text = args.text as string;
        if (!text || text.length === 0) throw new Error("text is required");
        if (!messageId) throw new Error("message_id is required");
        const parseMode = validateParseMode(args.format ?? "html");

        assertAllowedChat(chatId);

        await sendWithHtmlFallback(
          (pm) =>
            bot.api.editMessageText(chatId, messageId, text, {
              ...(pm ? { parse_mode: pm } : {}),
            }),
          parseMode
        );

        return {
          content: [{ type: "text", text: `edited (id: ${messageId})` }],
        };
      }

      default:
        return {
          content: [
            { type: "text", text: `unknown tool: ${req.params.name}` },
          ],
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `${req.params.name} failed: ${msg}` }],
      isError: true,
    };
  }
});

await mcp.connect(new StdioServerTransport());
