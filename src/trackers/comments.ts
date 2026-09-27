/**
 * The ticket's comments in the ticket file (specs/trackers.md criteria 10–13). Comment text is
 * quoted line by line, so a comment can't add a heading or pose as another comment.
 */
import { appendFileSync, readFileSync } from "node:fs";
import type { CommentPage, TicketComment, Tracker } from "./types.ts";

export interface CommentLimits {
  maxComments: number;
  maxCommentChars: number;
}

export interface CommentsSection {
  text: string;
  added: number;
  leftOut: number;
}

/** Keeps the newest comments that fit in `maxChars`; one comment longer than that never fits. */
function fitting(comments: TicketComment[], maxChars: number): TicketComment[] {
  const kept: TicketComment[] = [];
  let chars = 0;
  for (const c of [...comments].reverse()) {
    if (c.body.length > maxChars) continue;
    if (chars + c.body.length > maxChars) break;
    chars += c.body.length;
    kept.unshift(c);
  }
  return kept;
}

/** "2026-09-27 12:05 UTC", or "unknown time". Jira's "+0000" offsets get a colon first. */
function when(created: string): string {
  const d = new Date(created.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? "unknown time" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** One line, so a name can't start a new heading. */
function who(c: TicketComment): string {
  if (c.fromSeula) return "seula";
  return c.author.replace(/\s+/g, " ").trim().slice(0, 100) || "unknown";
}

function quote(body: string): string[] {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) return ["> (empty)"];
  return text.split("\n").map((line) => (line ? `> ${line}` : ">"));
}

export function commentsMarkdown(page: CommentPage, maxCommentChars: number): CommentsSection {
  const kept = fitting(page.comments, maxCommentChars);
  const leftOut = Math.max(0, page.total - kept.length);
  const lines = ["## Comments", ""];
  if (page.total === 0) lines.push("No comments.", "");
  if (leftOut > 0) lines.push(`${leftOut} ${leftOut === 1 ? "comment is" : "comments are"} left out.`, "");
  for (const c of kept) lines.push(`### ${when(c.created)} · ${who(c)}`, "", ...quote(c.body), "");
  return { text: lines.join("\n"), added: kept.length, leftOut };
}

/** Reads the comments first, so an API error leaves the ticket file as it was. */
export async function appendComments(file: string, tracker: Tracker, key: string, limits: CommentLimits): Promise<{ added: number; leftOut: number }> {
  const page = await tracker.comments(key, limits.maxComments);
  const section = commentsMarkdown(page, limits.maxCommentChars);
  const current = readFileSync(file, "utf8");
  appendFileSync(file, `${current.endsWith("\n") ? "" : "\n"}\n${section.text}`);
  return { added: section.added, leftOut: section.leftOut };
}
