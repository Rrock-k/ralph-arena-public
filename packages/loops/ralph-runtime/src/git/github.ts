import { Octokit } from '@octokit/rest';
import { log } from '../utils/logger.js';

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export interface DeployStatus {
  status: 'pending' | 'in_progress' | 'success' | 'failure' | 'not_found';
  url?: string;
  logs?: string;
  run?: WorkflowRun;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  
  constructor(token: string, repoUrl: string) {
    this.octokit = new Octokit({ auth: token });
    
    // Parse owner/repo from URL
    const match = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    }
    this.owner = match[1];
    this.repo = match[2];
  }
  
  /**
   * Wait for deploy workflow to complete
   */
  async waitForDeploy(commitSha: string, timeoutMinutes: number = 15): Promise<DeployStatus> {
    const startTime = Date.now();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const pollInterval = 30000; // 30 seconds
    
    log.info(`Waiting for deploy workflow for commit ${commitSha.slice(0, 7)}...`);

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getDeployStatus(commitSha);
      
      if (status.status === 'not_found') {
        // Workflow may not have started yet, wait
        log.info('Workflow not found yet, waiting...');
        await this.sleep(pollInterval);
        continue;
      }
      
      if (status.status === 'success') {
        log.success('Deploy succeeded!');
        return status;
      }
      
      if (status.status === 'failure') {
        log.error('Deploy failed!');
        // Try to get logs
        if (status.run) {
          status.logs = await this.getWorkflowLogs(status.run.id);
        }
        return status;
      }
      
      log.info(`Deploy status: ${status.status}, waiting...`);
      await this.sleep(pollInterval);
    }
    
    log.warn('Deploy timeout reached');
    return { status: 'failure', logs: 'Timeout waiting for deploy' };
  }
  
  /**
   * Get current deploy status for a commit
   */
  async getDeployStatus(commitSha: string): Promise<DeployStatus> {
    try {
      // Get workflow runs for the commit
      const { data: runs } = await this.octokit.actions.listWorkflowRunsForRepo({
        owner: this.owner,
        repo: this.repo,
        head_sha: commitSha,
        per_page: 10,
      });
      
      if (runs.workflow_runs.length === 0) {
        return { status: 'not_found' };
      }
      
      // Find deploy workflow (common names)
      const deployRun = runs.workflow_runs.find(run => 
        run.name?.toLowerCase().includes('deploy') ||
        run.name?.toLowerCase().includes('ci') ||
        run.name?.toLowerCase().includes('build')
      ) || runs.workflow_runs[0];
      
      const run: WorkflowRun = {
        id: deployRun.id,
        status: deployRun.status || 'unknown',
        conclusion: deployRun.conclusion,
        html_url: deployRun.html_url,
      };
      
      if (deployRun.status === 'completed') {
        if (deployRun.conclusion === 'success') {
          // Try to get deployment URL
          const url = await this.getDeploymentUrl(commitSha);
          return { status: 'success', url, run };
        } else {
          return { status: 'failure', run };
        }
      }
      
      if (deployRun.status === 'in_progress' || deployRun.status === 'queued') {
        return { status: 'in_progress', run };
      }
      
      return { status: 'pending', run };
    } catch (error: any) {
      // 404 = token lacks Actions scope, or repo has no Actions enabled
      if (error.status === 404 || error.message?.includes('Not Found')) {
        log.warn(`GitHub Actions API not accessible (check token scopes). Skipping CI check.`);
        return { status: 'not_found' };
      }
      log.error(`Failed to get deploy status: ${error.message}`);
      return { status: 'failure', logs: error.message };
    }
  }
  
  /**
   * Get deployment URL from GitHub deployments
   */
  async getDeploymentUrl(commitSha: string): Promise<string | undefined> {
    try {
      const { data: deployments } = await this.octokit.repos.listDeployments({
        owner: this.owner,
        repo: this.repo,
        sha: commitSha,
        per_page: 1,
      });
      
      if (deployments.length > 0) {
        const { data: statuses } = await this.octokit.repos.listDeploymentStatuses({
          owner: this.owner,
          repo: this.repo,
          deployment_id: deployments[0].id,
          per_page: 1,
        });
        
        if (statuses.length > 0 && statuses[0].environment_url) {
          return statuses[0].environment_url;
        }
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Get workflow logs
   */
  async getWorkflowLogs(runId: number): Promise<string> {
    try {
      const { data: jobs } = await this.octokit.actions.listJobsForWorkflowRun({
        owner: this.owner,
        repo: this.repo,
        run_id: runId,
      });
      
      const failedJobs = jobs.jobs.filter(job => job.conclusion === 'failure');
      const logs: string[] = [];
      
      for (const job of failedJobs) {
        logs.push(`Job: ${job.name}`);
        
        // Get failed steps
        const failedSteps = job.steps?.filter(step => step.conclusion === 'failure') || [];
        for (const step of failedSteps) {
          logs.push(`  Step failed: ${step.name}`);
        }
      }
      
      return logs.join('\n') || 'No detailed logs available';
    } catch (error: any) {
      return `Failed to get logs: ${error.message}`;
    }
  }
  
  /**
   * Health check for deployed URL
   */
  async checkDeployHealth(url: string, preferredPath?: string): Promise<boolean> {
    const baseUrl = url.replace(/\/$/, '');
    const probeUrls: string[] = [];

    if (preferredPath) {
      if (/^https?:\/\//i.test(preferredPath)) {
        probeUrls.push(preferredPath);
      } else {
        probeUrls.push(`${baseUrl}${preferredPath.startsWith('/') ? '' : '/'}${preferredPath}`);
      }
    }

    for (const candidate of [`${baseUrl}/health`, baseUrl]) {
      if (!probeUrls.includes(candidate)) {
        probeUrls.push(candidate);
      }
    }

    for (const probeUrl of probeUrls) {
      try {
        const response = await fetch(probeUrl);
        if (response.ok) return true;
      } catch {
        // Try next probe URL
      }
    }

    return false;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
