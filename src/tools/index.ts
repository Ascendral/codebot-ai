import { Tool, ToolSchema } from '../types';
import { ReadFileTool } from './read';
import { WriteFileTool } from './write';
import { EditFileTool } from './edit';
import { ExecuteTool } from './execute';
import { GlobTool } from './glob';
import { GrepTool } from './grep';
import { ThinkTool } from './think';
import { MemoryTool } from './memory';
import { WebFetchTool } from './web-fetch';
import { WebSearchTool } from './web-search';
import { BrowserTool } from './browser';
import { BatchEditTool } from './batch-edit';
import { RoutineTool } from './routine';
// v1.4.0 — 15 new tools
import { GitTool } from './git';
import { CodeAnalysisTool } from './code-analysis';
import { MultiSearchTool } from './multi-search';
import { TaskPlannerTool } from './task-planner';
import { DiffViewerTool } from './diff-viewer';
import { DockerTool } from './docker';
import { DatabaseTool } from './database';
import { TestRunnerTool } from './test-runner';
import { HttpClientTool } from './http-client';
import { ImageInfoTool } from './image-info';
import { SshRemoteTool } from './ssh-remote';
import { NotificationTool } from './notification';
import { PdfExtractTool } from './pdf-extract';
import { PackageManagerTool } from './package-manager';
import { CodeReviewTool } from './code-review';
import { PolicyEnforcer } from '../policy';

export { EditFileTool } from './edit';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor(projectRoot?: string, policyEnforcer?: PolicyEnforcer) {
    // Core file tools — policy-enforced tools receive the enforcer
    this.register(new ReadFileTool());
    this.register(new WriteFileTool(policyEnforcer));
    this.register(new EditFileTool(policyEnforcer));
    this.register(new BatchEditTool(policyEnforcer));
    this.register(new ExecuteTool());
    this.register(new GlobTool());
    this.register(new GrepTool());
    this.register(new ThinkTool());
    this.register(new MemoryTool(projectRoot));
    // Web & browser
    this.register(new WebFetchTool());
    this.register(new WebSearchTool());
    this.register(new BrowserTool());
    this.register(new RoutineTool());
    // v1.4.0 — intelligence & dev tools
    this.register(new GitTool(policyEnforcer));
    this.register(new CodeAnalysisTool());
    this.register(new MultiSearchTool());
    this.register(new TaskPlannerTool());
    this.register(new DiffViewerTool());
    this.register(new DockerTool());
    this.register(new DatabaseTool());
    this.register(new TestRunnerTool());
    this.register(new HttpClientTool());
    this.register(new ImageInfoTool());
    this.register(new SshRemoteTool());
    this.register(new NotificationTool());
    this.register(new PdfExtractTool());
    this.register(new PackageManagerTool());
    this.register(new CodeReviewTool());
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  all(): Tool[] {
    return Array.from(this.tools.values());
  }
}
