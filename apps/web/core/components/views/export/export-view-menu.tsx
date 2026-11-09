/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EIssuesStoreType } from "@plane/types";
import { CustomMenu } from "@plane/ui";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
// local
import type { TExportContext } from "./view-export";
import { buildCsv, buildZipEntries, fetchExportItems, fileSafe } from "./view-export";
import { createZip, downloadBlob } from "./zip";

type Props = {
  workspaceSlug: string;
  projectId: string;
  viewId: string;
  viewName: string;
};

type TExportKind = "csv" | "zip";

/** Exports every work item the current view shows, with its filters, as CSV or as a ZIP folder. */
export const ExportViewMenu = observer(function ExportViewMenu(props: Props) {
  const { workspaceSlug, projectId, viewId, viewName } = props;
  const [exporting, setExporting] = useState<TExportKind | null>(null);
  // store hooks
  const {
    issuesFilter: { getFilterParams },
  } = useIssues(EIssuesStoreType.PROJECT_VIEW);
  const { getProjectById } = useProject();
  const { getStateById } = useProjectState();
  const { getLabelById } = useLabel();
  const { getUserDetails } = useMember();

  const handleExport = async (kind: TExportKind) => {
    if (exporting) return;
    setExporting(kind);
    try {
      const identifier = getProjectById(projectId)?.identifier ?? "";
      const ctx: TExportContext = {
        workspaceSlug,
        projectId,
        identifier,
        origin: window.location.origin,
        getFilterParams: (cursor) =>
          getFilterParams({ canGroup: false, perPageCount: 100 }, viewId, cursor, undefined, undefined),
        stateName: (stateId) => getStateById(stateId)?.name,
        labelName: (labelId) => getLabelById(labelId)?.name,
        userName: (userId) => getUserDetails(userId)?.display_name,
      };
      const baseName = `${fileSafe(identifier, "project")}-${fileSafe(viewName, "view")}-${new Date().toISOString().slice(0, 10)}`;
      const items = await fetchExportItems(ctx);

      if (kind === "csv") {
        downloadBlob(new Blob([buildCsv(ctx, items)], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Exported CSV",
          message: `${items.length} work items. Attachment links need a Plane API key in the X-API-Key header.`,
        });
      } else {
        const { entries, failed } = await buildZipEntries(ctx, items, baseName);
        downloadBlob(createZip(entries), `${baseName}.zip`);
        setToast({
          type: failed ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
          title: "Exported ZIP",
          message: failed
            ? `${items.length} work items. ${failed} attachments couldn't be downloaded and are missing.`
            : `${items.length} work items with their attachments.`,
        });
      }
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Export failed", message: "Couldn't fetch the work items in this view." });
    } finally {
      setExporting(null);
    }
  };

  return (
    <CustomMenu
      customButton={
        <Button variant="secondary" size="lg" loading={!!exporting} disabled={!!exporting}>
          {exporting ? "Exporting..." : "Export"}
        </Button>
      }
      placement="bottom-end"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => handleExport("csv")} disabled={!!exporting}>
        <div>
          <h5>CSV with attachment links</h5>
          <p className="text-tertiary">Links need a Plane API key (X-API-Key header)</p>
        </div>
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => handleExport("zip")} disabled={!!exporting}>
        <div>
          <h5>ZIP with attachments</h5>
          <p className="text-tertiary">CSV plus a folder per work item with its screenshots and logs</p>
        </div>
      </CustomMenu.MenuItem>
    </CustomMenu>
  );
});
