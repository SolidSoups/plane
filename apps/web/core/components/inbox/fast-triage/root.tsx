/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
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
    fetchInboxPaginationIssues,
  } = useProjectInbox();
  const { getProjectLabels } = useLabel();
  const { getWorkspaceBySlug } = useWorkspace();
  const { currentProjectDetails } = useProject();
  // local state
  const [index, setIndex] = useState(0);
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [description, setDescription] = useState<{ id: string; html: string } | undefined>(undefined);
  // derived values
  const ids = filteredInboxIssueIds;
  const currentIndex = Math.min(index, ids.length - 1);
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

  // load the next page before J runs off the end of what's loaded
  useEffect(() => {
    if (ids.length > 0 && index >= ids.length - 2) fetchInboxPaginationIssues(workspaceSlug, projectId);
  }, [index, ids.length, workspaceSlug, projectId, fetchInboxPaginationIssues]);

  const toggleLabel = (labelId: string | undefined) => {
    if (!inboxIssue || !labelId) return;
    const next = issueLabelIds.includes(labelId)
      ? issueLabelIds.filter((id) => id !== labelId)
      : [...issueLabelIds, labelId];
    inboxIssue.updateIssue({ label_ids: next });
  };

  const handleDuplicate = async (issueId: string) => {
    await inboxIssue?.updateInboxIssueDuplicateTo(issueId);
  };

  // keyboard: capture phase on window, so Plane's global shortcuts never see these keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDuplicateOpen || isTypingInInput(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "j") setIndex(Math.min(currentIndex + 1, ids.length - 1));
      else if (key === "k") setIndex(Math.max(currentIndex - 1, 0));
      else if (key === "a") inboxIssue?.updateInboxIssueStatus(EInboxIssueStatus.ACCEPTED);
      else if (key === "x") inboxIssue?.updateInboxIssueStatus(EInboxIssueStatus.DECLINED);
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
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-subtle px-5 py-2">
        <span className="text-13 text-tertiary">
          {ids.length > 0
            ? `${currentIndex + 1} / ${inboxIssuePaginationInfo?.total_results ?? ids.length} pending`
            : "Nothing pending"}
        </span>
        <span className="text-11 text-tertiary">J/K move · A accept · X decline · D duplicate · 1-7 discipline</span>
        <FiltersRoot />
      </div>
      <InboxIssueAppliedFilters />

      {inboxIssue && (
        <div className="vertical-scrollbar scrollbar-md flex-1 overflow-y-auto px-5 py-4">
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
                    "rounded-md border px-2 py-1 text-12",
                    isOn ? "border-accent-strong bg-accent-primary/20 text-primary" : "border-subtle text-tertiary",
                    !labelId && "opacity-40"
                  )}
                >
                  {i + 1} {name}
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

          {workspaceId && currentId && description && description.id === currentId && (
            <RichTextEditor
              key={currentId}
              id={currentId}
              editable={false}
              initialValue={description.html}
              containerClassName="p-0 !pl-0 border-none"
              editorClassName="pl-0"
              projectId={projectId}
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
            />
          )}
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
