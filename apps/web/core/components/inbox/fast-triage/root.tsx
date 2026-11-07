/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { EInboxIssueCurrentTab, EInboxIssueStatus } from "@plane/types";
import { cn } from "@plane/utils";
import { RichTextEditor } from "@/components/editor/rich-text";
import { FiltersRoot } from "@/components/inbox/inbox-filter";
import { InboxIssueAppliedFilters } from "@/components/inbox/inbox-filter/applied-filters/root";
import { SelectDuplicateInboxIssueModal } from "@/components/inbox/modals/select-duplicate";
import { isTypingInInput } from "@/components/power-k/core/shortcut-handler";
import { useLabel } from "@/hooks/store/use-label";
import { useProject } from "@/hooks/store/use-project";
import { useProjectInbox } from "@/hooks/store/use-project-inbox";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { InboxIssueService } from "@/services/inbox";

const DISCIPLINES = ["Tech", "Level Design", "Art", "Game Design", "Audio", "Animation", "UI"];

const KEY_LEGEND: [string, string][] = [
  ["J / K", "Move"],
  ["Enter", "Accept"],
  ["Delete", "Decline"],
  ["D", "Duplicate"],
  ["1-7", "Discipline"],
];

const KBD_CLASS =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-strong bg-surface-1 px-1.5 font-code text-12 font-medium text-primary";

// Tighter table than the editor default (7px 10px cells), so a full report fits without scrolling.
// Scoped to this screen's container, so the normal work-item view is unchanged.
const DESCRIPTION_CLASS =
  "p-0 !pl-0 border-none [&_.table-wrapper]:!pb-2 [&_table]:!mt-0 [&_td]:!px-2 [&_td]:!py-0.5 [&_th]:!px-2 [&_th]:!py-0.5 [&_td_p]:!my-0 [&_td_p]:!py-0 [&_td_p]:!text-13 [&_td_p]:!leading-snug";

const inboxIssueService = new InboxIssueService();

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export const FastTriageRoot = observer(function FastTriageRoot(props: Props) {
  const { workspaceSlug, projectId } = props;
  // store hooks
  const {
    filteredInboxIssueIds,
    inboxIssuePaginationInfo,
    getIssueInboxByIssueId,
    handleCurrentTab,
    fetchInboxIssues,
    fetchInboxPaginationIssues,
  } = useProjectInbox();
  const { getProjectLabels } = useLabel();
  const { getWorkspaceBySlug } = useWorkspace();
  const { currentProjectDetails } = useProject();
  // local state
  const [index, setIndex] = useState(0);
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"accept" | "decline" | undefined>(undefined);
  const [description, setDescription] = useState<{ id: string; html: string } | undefined>(undefined);
  // ids already triaged on this screen: hidden at once, before the server answers
  const [doneIds, setDoneIds] = useState<string[]>([]);
  // set by any triage action; tells the loader that page offsets are stale
  const hasActedRef = useRef(false);
  // derived values
  const ids = filteredInboxIssueIds.filter((id) => !doneIds.includes(id));
  const currentIndex = Math.max(0, Math.min(index, ids.length - 1));
  const totalPending = inboxIssuePaginationInfo?.total_results ?? 0;
  const currentId = ids.length > 0 ? ids[currentIndex] : undefined;
  const inboxIssue = currentId ? getIssueInboxByIssueId(currentId) : undefined;
  const projectLabels = getProjectLabels(projectId) ?? [];
  const disciplineLabels = DISCIPLINES.map((name) => projectLabels.find((label) => label.name === name));
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id;
  const issueLabelIds = inboxIssue?.issue.label_ids ?? [];

  // load the pending list once
  useEffect(() => {
    handleCurrentTab(workspaceSlug, projectId, EInboxIssueCurrentTab.OPEN);
  }, [workspaceSlug, projectId, handleCurrentTab]);

  // the list endpoint has no description, so fetch it for the current item
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    const loadDescription = async () => {
      const response = await inboxIssueService.retrieve(workspaceSlug, projectId, currentId);
      if (!cancelled) setDescription({ id: currentId, html: response.issue?.description_html ?? "" });
    };
    void loadDescription();
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, currentId]);

  // Load more before the list runs out. The store pages by offset, and every accept/decline shifts the
  // server's pending list, so after any action the offsets are wrong (items get skipped, and the store's
  // "all loaded" check undercounts). After an action, reload the first page instead: triaged items are no
  // longer pending, so page one is exactly the next untriaged batch. With no actions, plain paging is fine.
  useEffect(() => {
    if (ids.length - currentIndex > 2) return;
    if (hasActedRef.current) {
      hasActedRef.current = false;
      setIndex(0);
      void fetchInboxIssues(workspaceSlug, projectId, "mutation-loading");
    } else if (totalPending > ids.length) void fetchInboxPaginationIssues(workspaceSlug, projectId);
  }, [currentIndex, ids.length, totalPending, workspaceSlug, projectId, fetchInboxIssues, fetchInboxPaginationIssues]);

  // Hide the item at once and run the action. The store's actions swallow errors and put the status back,
  // so if the item is still pending afterwards the request failed: show it again.
  const triage = (run: (issue: NonNullable<typeof inboxIssue>) => Promise<void>) => {
    if (!inboxIssue || !currentId) return;
    const issue = inboxIssue;
    const id = currentId;
    hasActedRef.current = true;
    setDoneIds((prev) => [...prev, id]);
    const execute = async () => {
      await run(issue);
      if (issue.status === EInboxIssueStatus.PENDING) setDoneIds((prev) => prev.filter((x) => x !== id));
    };
    void execute();
  };

  const toggleLabel = (labelId: string | undefined) => {
    if (!inboxIssue || !labelId) return;
    const next = issueLabelIds.includes(labelId)
      ? issueLabelIds.filter((id) => id !== labelId)
      : [...issueLabelIds, labelId];
    inboxIssue.updateIssue({ label_ids: next });
  };

  const handleDuplicate = (issueId: string) => {
    triage((issue) => issue.updateInboxIssueDuplicateTo(issueId));
  };

  // keyboard: capture phase on window, so Plane's global shortcuts never see these keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDuplicateOpen || isTypingInInput(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      // while a confirm prompt is open, only Enter (confirm) and Escape (cancel) do anything
      if (pendingAction) {
        if (e.key === "Enter" && !e.repeat) {
          const status = pendingAction === "accept" ? EInboxIssueStatus.ACCEPTED : EInboxIssueStatus.DECLINED;
          triage((issue) => issue.updateInboxIssueStatus(status));
          setPendingAction(undefined);
        } else if (e.key === "Escape") setPendingAction(undefined);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "j") setIndex(Math.max(0, Math.min(currentIndex + 1, ids.length - 1)));
      else if (key === "k") setIndex(Math.max(currentIndex - 1, 0));
      else if (e.key === "Enter" && !e.repeat && inboxIssue) setPendingAction("accept");
      else if (e.key === "Delete" && !e.repeat && inboxIssue) setPendingAction("decline");
      else if (key === "d" && inboxIssue) setIsDuplicateOpen(true);
      else if (/^[1-7]$/.test(key)) toggleLabel(disciplineLabels[Number(key) - 1]?.id);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  });

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-subtle bg-layer-1 px-5 py-2">
        <span className="text-13 text-tertiary">
          {ids.length > 0
            ? `${currentIndex + 1} / ${Math.max(totalPending, ids.length)} pending`
            : totalPending > 0
              ? "Loading more…"
              : "Nothing pending"}
        </span>
        {KEY_LEGEND.map(([keys, action]) => (
          <span key={action} className="flex items-center gap-1.5 text-13 text-secondary">
            <kbd className={KBD_CLASS}>{keys}</kbd>
            {action}
          </span>
        ))}
        <div className="ml-auto">
          <FiltersRoot />
        </div>
      </div>
      <InboxIssueAppliedFilters />

      {inboxIssue && (
        <div className="vertical-scrollbar grid scrollbar-md flex-1 grid-cols-1 gap-x-8 overflow-y-auto px-5 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <div className="text-13 text-tertiary">
              {currentProjectDetails?.identifier}-{inboxIssue.issue.sequence_id}
            </div>
            <h2 className="mb-3 text-18 font-semibold text-primary">{inboxIssue.issue.name}</h2>

            <div className="mb-3 flex flex-wrap gap-2">
              {DISCIPLINES.map((name, i) => {
                const labelId = disciplineLabels[i]?.id;
                const isOn = !!labelId && issueLabelIds.includes(labelId);
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={!labelId}
                    onClick={() => toggleLabel(labelId)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2 py-1 text-13",
                      isOn ? "border-accent-strong bg-accent-primary/20 text-primary" : "border-subtle text-tertiary",
                      !labelId && "opacity-40"
                    )}
                  >
                    <kbd className={KBD_CLASS}>{i + 1}</kbd>
                    {name}
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex flex-wrap gap-1">
              {projectLabels
                .filter((label) => issueLabelIds.includes(label.id) && !DISCIPLINES.includes(label.name))
                .map((label) => (
                  <span key={label.id} className="rounded-sm border border-subtle px-1.5 py-0.5 text-11 text-secondary">
                    {label.name}
                  </span>
                ))}
            </div>
          </div>

          {workspaceId && currentId && description && description.id === currentId && (
            <RichTextEditor
              key={currentId}
              id={currentId}
              editable={false}
              initialValue={description.html}
              containerClassName={DESCRIPTION_CLASS}
              editorClassName="pl-0"
              projectId={projectId}
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
            />
          )}
        </div>
      )}

      {pendingAction && inboxIssue && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-backdrop">
          <div className="shadow-lg flex max-w-lg flex-col gap-4 rounded-lg border border-subtle bg-surface-1 p-5">
            <div className="text-15 font-semibold text-primary">
              {pendingAction === "accept" ? "Accept" : "Decline"} {currentProjectDetails?.identifier}-
              {inboxIssue.issue.sequence_id}?
            </div>
            <div className="line-clamp-2 text-13 text-secondary">{inboxIssue.issue.name}</div>
            <div className="flex items-center gap-5 text-13 text-secondary">
              <span className="flex items-center gap-1.5">
                <kbd className={KBD_CLASS}>Enter</kbd>
                {pendingAction === "accept" ? "Accept" : "Decline"}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className={KBD_CLASS}>Esc</kbd>
                Cancel
              </span>
            </div>
          </div>
        </div>
      )}

      <SelectDuplicateInboxIssueModal
        isOpen={isDuplicateOpen}
        onClose={() => setIsDuplicateOpen(false)}
        onSubmit={handleDuplicate}
      />
    </div>
  );
});
