/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { PageHead } from "@/components/core/page-title";
import { FastTriageRoot } from "@/components/inbox/fast-triage/root";
import type { Route } from "./+types/page";

export default function FastTriagePage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  return (
    <div className="flex h-full flex-col">
      <PageHead title="Fast triage" />
      <FastTriageRoot workspaceSlug={workspaceSlug} projectId={projectId} />
    </div>
  );
}
