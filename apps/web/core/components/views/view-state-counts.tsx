/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { StateGroupIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { IProjectView, TStateGroups } from "@plane/types";
// services
import { IssueService } from "@/services/issue";

const issueService = new IssueService();

const STATE_GROUPS: { key: TStateGroups; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "unstarted", label: "Todo" },
  { key: "started", label: "In progress" },
  { key: "completed", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

type Props = {
  workspaceSlug: string;
  projectId: string;
  view: IProjectView;
};

/**
 * How many work items the view matches, per state group. Uses the view's saved filters and
 * asks the server for one item per group, so only the group totals come back.
 */
export const ViewStateCounts = observer(function ViewStateCounts(props: Props) {
  const { workspaceSlug, projectId, view } = props;

  const { data: counts } = useSWR(
    `VIEW_STATE_COUNTS_${view.id}_${view.updated_at}`,
    async () => {
      const response = await issueService.getIssues(workspaceSlug, projectId, {
        filters: JSON.stringify(view.rich_filters ?? {}),
        group_by: "state__group",
        sub_issue: view.display_filters?.sub_issue ?? true,
        per_page: "1",
        cursor: "1:0:0",
      });
      const totals: Partial<Record<TStateGroups, number>> = {};
      if (response.results && !Array.isArray(response.results)) {
        for (const group of STATE_GROUPS) totals[group.key] = response.results[group.key]?.total_results ?? 0;
      }
      return totals;
    },
    { revalidateOnFocus: true, dedupingInterval: 10_000 }
  );

  if (!counts) return null;
  const shown = STATE_GROUPS.filter((group) => (counts[group.key] ?? 0) > 0);
  if (shown.length === 0) return <span className="text-11 text-placeholder">No work items</span>;

  return (
    <div className="flex items-center gap-3">
      {shown.map((group) => (
        <Tooltip key={group.key} tooltipContent={`${counts[group.key]} ${group.label}`}>
          <span className="flex cursor-default items-center gap-1 text-11 font-medium text-secondary">
            {counts[group.key]}
            <StateGroupIcon stateGroup={group.key} className="size-3 shrink-0" />
          </span>
        </Tooltip>
      ))}
    </div>
  );
});
