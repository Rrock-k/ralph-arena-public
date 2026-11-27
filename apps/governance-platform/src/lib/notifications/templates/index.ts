/**
 * RA-224: Template registry — maps notification events to React Email renders.
 */

import * as React from "react";
import type { NotificationEvent } from "../types";
import { ProjectDeployedEmail } from "./ProjectDeployed";
import { ProjectFailedEmail } from "./ProjectFailed";
import { ProjectPausedBudgetEmail } from "./ProjectPausedBudget";
import { ProposalApprovedEmail } from "./ProposalApproved";

interface EmailRender {
  subject: string;
  react: React.ReactElement;
}

export function renderEmail(
  event: NotificationEvent,
  unsubscribeUrl: string,
): EmailRender {
  switch (event.type) {
    case "project.deployed":
      return {
        subject: `${event.projectName} is live!`,
        react: React.createElement(ProjectDeployedEmail, {
          projectName: event.projectName,
          projectId: event.projectId,
          previewUrl: event.previewUrl,
          unsubscribeUrl,
        }),
      };

    case "project.failed":
      return {
        subject: `${event.projectName} — build failed`,
        react: React.createElement(ProjectFailedEmail, {
          projectName: event.projectName,
          projectId: event.projectId,
          error: event.error,
          unsubscribeUrl,
        }),
      };

    case "project.paused_budget":
      return {
        subject: `${event.projectName} paused — budget exhausted`,
        react: React.createElement(ProjectPausedBudgetEmail, {
          projectName: event.projectName,
          projectId: event.projectId,
          unsubscribeUrl,
        }),
      };

    case "proposal.approved":
      return {
        subject: `Your proposal "${event.proposalTitle}" was approved!`,
        react: React.createElement(ProposalApprovedEmail, {
          proposalTitle: event.proposalTitle,
          proposalId: event.proposalId,
          unsubscribeUrl,
        }),
      };
  }
}
