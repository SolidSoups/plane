/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TBaseIssue, TIssue, TIssueAttachment, TIssueParams } from "@plane/types";
import { getFileURL } from "@plane/utils";
// services
import { IssueAttachmentService, IssueService } from "@/services/issue";
// local
import type { TZipEntry } from "./zip";
import { textEntry } from "./zip";

const issueService = new IssueService();
const attachmentService = new IssueAttachmentService();

const PER_PAGE = 100;
const MAX_PAGES = 100; // 10,000 work items
const PARALLEL = 6;

export type TExportContext = {
  workspaceSlug: string;
  projectId: string;
  identifier: string;
  origin: string;
  getFilterParams: (cursor: string) => Partial<Record<TIssueParams, string | boolean>>;
  stateName: (stateId: string | null) => string | undefined;
  labelName: (labelId: string) => string | undefined;
  userName: (userId: string) => string | undefined;
};

type TExportItem = {
  issue: TBaseIssue;
  description: string;
  attachments: TIssueAttachment[];
};

const csvField = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  // BOM so Excel reads the file as UTF-8
  String.fromCharCode(0xfeff) + rows.map((row) => row.map(csvField).join(",")).join("\r\n");

export const fileSafe = (value: string, fallback = "file") =>
  value
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;

/** Plain text from a work item description: paragraphs as lines, table rows as "Key: Value". */
const htmlToText = (html: string | undefined | null) => {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines: string[] = [];
  const walk = (parent: Element) => {
    for (const node of Array.from(parent.children)) {
      const tag = node.tagName.toLowerCase();
      if (tag === "table") {
        node.querySelectorAll("tr").forEach((row) => {
          const cells = Array.from(row.children)
            .map((cell) => (cell.textContent ?? "").trim())
            .filter(Boolean);
          if (cells.length) lines.push(cells.join(": "));
        });
      } else if (tag === "ul" || tag === "ol") {
        node.querySelectorAll("li").forEach((item) => lines.push(`- ${(item.textContent ?? "").trim()}`));
      } else if (tag === "div" || tag === "section") {
        walk(node);
      } else {
        const text = (node.textContent ?? "").trim();
        if (text) lines.push(text);
      }
    }
  };
  walk(doc.body);
  return lines.join("\n");
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** Every work item the view shows, as one flat list, whatever grouping the view displays. */
const fetchViewIssues = async (ctx: TExportContext) => {
  const issues: TBaseIssue[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { ...ctx.getFilterParams(`${PER_PAGE}:${page}:0`) };
    delete params.group_by;
    delete params.sub_group_by;
    const response = await issueService.getIssues(ctx.workspaceSlug, ctx.projectId, params);
    if (Array.isArray(response.results)) issues.push(...response.results);
    if (!response.next_page_results) break;
  }
  return issues;
};

/** The list endpoint has no descriptions or attachments, so fetch them per work item. */
export const fetchExportItems = async (ctx: TExportContext): Promise<TExportItem[]> => {
  const issues = await fetchViewIssues(ctx);
  return mapLimit(issues, PARALLEL, async (issue) => {
    const [detail, attachments] = await Promise.all([
      issueService.retrieve(ctx.workspaceSlug, ctx.projectId, issue.id) as Promise<TIssue>,
      attachmentService.getIssueAttachments(ctx.workspaceSlug, ctx.projectId, issue.id).catch(() => []),
    ]);
    return { issue, description: htmlToText(detail?.description_html), attachments: attachments ?? [] };
  });
};

const workItemKey = (ctx: TExportContext, issue: TBaseIssue) => `${ctx.identifier}-${issue.sequence_id}`;

const baseColumns = [
  "ID",
  "Title",
  "State",
  "Priority",
  "Labels",
  "Assignees",
  "Start date",
  "Due date",
  "Created",
  "Updated",
  "Completed",
  "Link",
  "Description",
];

const baseRow = (ctx: TExportContext, item: TExportItem) => {
  const { issue } = item;
  const key = workItemKey(ctx, issue);
  return [
    key,
    issue.name,
    ctx.stateName(issue.state_id),
    issue.priority,
    (issue.label_ids ?? []).map((id) => ctx.labelName(id) ?? id).join("; "),
    (issue.assignee_ids ?? []).map((id) => ctx.userName(id) ?? id).join("; "),
    issue.start_date,
    issue.target_date,
    issue.created_at,
    issue.updated_at,
    issue.completed_at,
    `${ctx.origin}/${ctx.workspaceSlug}/browse/${key}/`,
    item.description,
  ];
};

/** CSV where each attachment is a Plane API link. Downloading one needs an X-API-Key header. */
export const buildCsv = (ctx: TExportContext, items: TExportItem[]) => {
  const apiBase = `${ctx.origin}/api/v1/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectId}/work-items`;
  const header = [...baseColumns, "Attachments (Plane API, send header X-API-Key)"];
  const rows = items.map((item) => [
    ...baseRow(ctx, item),
    item.attachments.map((a) => `${apiBase}/${item.issue.id}/attachments/${a.id}/`).join("; "),
  ]);
  return toCsv([header, ...rows]);
};

/** ZIP with a CSV, a README, and one folder per work item holding its attachments. */
export const buildZipEntries = async (ctx: TExportContext, items: TExportItem[], folder: string) => {
  const files: TZipEntry[] = [];
  const paths = new Map<string, string[]>();
  let failed = 0;

  await mapLimit(items, PARALLEL, async (item) => {
    const key = workItemKey(ctx, item.issue);
    const used = new Set<string>();
    const itemPaths: string[] = [];
    for (const attachment of item.attachments) {
      const url = getFileURL(attachment.asset_url);
      if (!url) continue;
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let name = fileSafe(attachment.attributes?.name ?? attachment.id, attachment.id);
        while (used.has(name)) name = `${used.size}-${name}`;
        used.add(name);
        const path = `${key}/${name}`;
        files.push({ path: `${folder}/${path}`, data: new Uint8Array(await response.arrayBuffer()) });
        itemPaths.push(path);
      } catch {
        failed++;
      }
    }
    paths.set(item.issue.id, itemPaths);
  });

  const header = [...baseColumns, "Files"];
  const rows = items.map((item) => [...baseRow(ctx, item), (paths.get(item.issue.id) ?? []).join("; ")]);
  const readme = [
    `Export of ${items.length} work items from Plane, ${new Date().toISOString()}.`,
    "",
    "work-items.csv has one row per work item. The Files column lists that work item's",
    "attachments (screenshots, logs) as paths relative to this folder, separated by '; '.",
    "Each work item's attachments are in a folder named after its ID, for example",
    `${items[0] ? workItemKey(ctx, items[0].issue) : `${ctx.identifier}-1`}/.`,
    "The Description column holds the report text and its recorded fields as plain text.",
    "Files ending in .gz are gzip-compressed logs.",
  ].join("\r\n");

  return {
    entries: [textEntry(`${folder}/README.txt`, readme), textEntry(`${folder}/work-items.csv`, toCsv([header, ...rows])), ...files],
    failed,
  };
};
