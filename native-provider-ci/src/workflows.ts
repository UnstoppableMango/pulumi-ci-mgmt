import { z } from "zod";
import { GithubWorkflow, NormalJob } from "./github-workflow";
import * as steps from "./steps";
import { Step } from "./steps";

const pythonVersion = "3.11";
const goVersion = "1.22.x";
const nodeVersion = "20.x";
const dotnetVersion = "6.0.x\n3.1.301\n";
const javaVersion = "11";

type WorkflowOpts = z.infer<typeof WorkflowOpts>;
export const WorkflowOpts = z.object({
  provider: z.string(),
  env: z.record(z.any()).optional(),
  docker: z.boolean().default(false),
  aws: z.boolean().default(false),
  gcp: z.boolean().default(false),
  submodules: z.boolean().default(false),
  lint: z.boolean().default(true),
  "setup-script": z.string().optional(),
  parallel: z.number().default(3),
  timeout: z.number().default(60),
  providerVersion: z.string().default(""),
  skipCodegen: z.boolean().default(false),
  skipWindowsArmBuild: z.boolean().default(false),
  pulumiCLIVersion: z.string().optional(),
  hasGenBinary: z.boolean().default(true),
  defaultBranch: z.string().default("main"),
});

const env = (opts: WorkflowOpts) =>
  Object.assign(
    {
      PROVIDER: opts.provider,
      PULUMI_ACCESS_TOKEN: "${{ secrets.PULUMI_ACCESS_TOKEN }}",
      PULUMI_LOCAL_NUGET: "${{ github.workspace }}/nuget",
      NPM_TOKEN: "${{ secrets.NPM_TOKEN }}",
      NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
      NUGET_PUBLISH_KEY: "${{ secrets.NUGET_PUBLISH_KEY }}",
      PYPI_USERNAME: "__token__",
      PYPI_PASSWORD: "${{ secrets.PYPI_API_TOKEN }}",
      PULUMI_GO_DEP_ROOT: "${{ github.workspace }}/..",
      GOVERSION: goVersion,
      NODEVERSION: nodeVersion,
      PYTHONVERSION: pythonVersion,
      DOTNETVERSION: dotnetVersion,
      JAVAVERSION: javaVersion,
    },
    opts.env
  );

// This section represents GHA files, sub-jobs are in a section below

// Creates command-dispatch.yml
export function CommandDispatchWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  return {
    name: name,

    on: {
      issue_comment: {
        types: ["created", "edited"],
      },
    },
    env: env(opts),

    jobs: {
      "command-dispatch-for-testing": new EmptyJob(
        "command-dispatch-for-testing"
      )
        .addConditional("${{ github.event.issue.pull_request }}")
        .addStep(steps.CheckoutRepoStep())
        .addStep(steps.CommandDispatchStep(`${opts.provider}`)),
    },
  };
}

// Creates pull-request.yml
export function PullRequestWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  return {
    name: name,
    on: {
      pull_request: {},
    },
    env: env(opts),
    jobs: {
      prerequisites: new PrerequisitesJob("prerequisites", opts),
      build_sdks: new BuildSdkJob("build_sdks", opts, false).addRunsOn(
        opts.provider
      ),
      test: new TestsJob(name, "test", opts),
    },
  };
}

// Creates run-acceptance-tests.yml
export function RunAcceptanceTestsWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  const workflow: GithubWorkflow = {
    name: name,
    on: {
      repository_dispatch: {
        types: ["run-acceptance-tests-command"],
      },
      pull_request: {
        branches: ["main"],
        "paths-ignore": ["CHANGELOG.md"],
      },
      workflow_dispatch: {},
    },
    env: {
      ...env(opts),
      PR_COMMIT_SHA: "${{ github.event.client_payload.pull_request.head.sha }}",
    },
    jobs: {
      "comment-notification": new EmptyJob("comment-notification")
        .addConditional("github.event_name == 'repository_dispatch'")
        .addStep(steps.CreateCommentsUrlStep())
        .addStep(steps.UpdatePRWithResultsStep()),
      prerequisites: new PrerequisitesJob(
        "prerequisites",
        opts
      ).addDispatchConditional(true),
      build_sdks: new BuildSdkJob("build_sdks", opts, false)
        .addDispatchConditional(true)
        .addRunsOn(opts.provider),
      test: new TestsJob(name, "test", opts).addDispatchConditional(true),
      sentinel: new EmptyJob("sentinel")
        .addConditional(
          "github.event_name == 'repository_dispatch' || github.event.pull_request.head.repo.full_name == github.repository"
        )
        .addStep(steps.SentinelStep())
        .addNeeds(calculateSentinelNeeds(name, opts.lint, opts.provider)),
    },
  };
  if (opts.lint) {
    workflow.jobs = Object.assign(workflow.jobs, {
      lint: new LintJob("lint").addDispatchConditional(true),
    });
  }
  if (opts.provider === "kubernetes") {
    workflow.on = Object.assign(workflow.on, {
      pull_request: {
        branches: ["main", "v4"],
        "paths-ignore": ["CHANGELOG.md"],
      },
    });
  }
  return workflow;
}

function calculateSentinelNeeds(
  workflowName: string,
  requiresLint: boolean,
  provider: string
): string[] {
  const needs: string[] = ["test"];

  if (requiresLint) {
    needs.push("lint");
  }

  if (provider === "kubernetes" && workflowName !== "run-acceptance-tests") {
    needs.push("destroy-test-cluster");
  }

  return needs;
}

// Creates build.yml
export function BuildWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  const workflow: GithubWorkflow = {
    name: name,
    on: {
      push: {
        branches: ["main"],
        "paths-ignore": ["CHANGELOG.md"],
        "tags-ignore": ["v*", "sdk/*", "**"],
      },
      workflow_dispatch: {},
    },
    env: env(opts),
    jobs: {
      prerequisites: new PrerequisitesJob("prerequisites", opts),
      build_sdks: new BuildSdkJob("build_sdks", opts, false).addRunsOn(
        opts.provider
      ),
      test: new TestsJob(name, "test", opts),
      publish: new PublishPrereleaseJob("publish", opts),
      publish_sdk: new PublishSDKJob("publish_sdk"),
      // I don't understand java publishing
      // publish_java_sdk: new PublishJavaSDKJob("publish_java_sdk"),
    },
  };
  if (opts.lint) {
    workflow.jobs = Object.assign(workflow.jobs, {
      lint: new LintJob("lint").addDispatchConditional(true),
    });
  }
  if (opts.provider === "kubernetes") {
    workflow.jobs = Object.assign(workflow.jobs, {
      "build-test-cluster": new BuildTestClusterJob("build-test-cluster", opts),
    });
    workflow.jobs = Object.assign(workflow.jobs, {
      "destroy-test-cluster": new TeardownTestClusterJob(
        "teardown-test-cluster",
        opts
      ),
    });
  }
  return workflow;
}

// Creates prerelease.yml
export function PrereleaseWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  const workflow: GithubWorkflow = {
    name: name,
    on: {
      push: {
        tags: ["v*.*.*-**"],
      },
    },
    env: {
      ...env(opts),
      IS_PRERELEASE: true,
    },
    jobs: {
      prerequisites: new PrerequisitesJob("prerequisites", opts),
      build_sdks: new BuildSdkJob("build_sdks", opts, true),
      test: new TestsJob(name, "test", opts),
      publish: new PublishPrereleaseJob("publish", opts),
      publish_sdk: new PublishSDKJob("publish_sdk"),
      // I don't understand java publishing
      // publish_java_sdk: new PublishJavaSDKJob("publish_java_sdk"),
      publish_go_sdk: new PublishGoSdkJob(),
    },
  };
  if (opts.provider === "kubernetes") {
    workflow.jobs = Object.assign(workflow.jobs, {
      "build-test-cluster": new BuildTestClusterJob("build-test-cluster", opts),
    });
    workflow.jobs = Object.assign(workflow.jobs, {
      "destroy-test-cluster": new TeardownTestClusterJob(
        "teardown-test-cluster",
        opts
      ),
    });
  }
  return workflow;
}

// Creates release.yml
export function ReleaseWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  const workflow: GithubWorkflow = {
    name: name,
    on: {
      push: {
        tags: ["v*.*.*", "!v*.*.*-**"],
      },
    },
    env: env(opts),
    jobs: {
      prerequisites: new PrerequisitesJob("prerequisites", opts),
      build_sdks: new BuildSdkJob("build_sdks", opts, true),
      test: new TestsJob(name, "test", opts),
      publish: new PublishJob("publish", opts),
      publish_sdk: new PublishSDKJob("publish_sdks"),
      // I don't understand java publishing
      // publish_java_sdk: new PublishJavaSDKJob("publish_java_sdk"),
      publish_go_sdk: new PublishGoSdkJob(),
      dispatch_docs_build: new DocsBuildDispatchJob("dispatch_docs_build"),
    },
  };
  if (opts.provider === "kubernetes") {
    workflow.jobs = Object.assign(workflow.jobs, {
      "build-test-cluster": new BuildTestClusterJob("build-test-cluster", opts),
    });
    workflow.jobs = Object.assign(workflow.jobs, {
      "destroy-test-cluster": new TeardownTestClusterJob(
        "teardown-test-cluster",
        opts
      ),
    });
  }
  return workflow;
}

// Creates weekly-pulumi-update.yml
export function WeeklyPulumiUpdateWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  const workflow: GithubWorkflow = {
    name: name,
    on: {
      schedule: [
        {
          cron: "35 12 * * 4",
        },
      ],
      workflow_dispatch: {},
    },
    env: env(opts),
    jobs: {
      "weekly-pulumi-update": new WeeklyPulumiUpdate(
        "weekly-pulumi-update",
        opts
      ),
    },
  };
  return workflow;
}

// creates nightly-sdk-generation.yml
export function NightlySdkGenerationWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  return {
    name: name,
    on: {
      schedule: [
        {
          cron: "35 4 * * 1-5",
        },
      ],
      workflow_dispatch: {},
    },
    env: env(opts),
    jobs: {
      "generate-sdk": new NightlySdkGeneration("generate-sdk", opts),
    },
  };
}

// creates cf2pulumi-release.yml
export function Cf2PulumiReleaseWorkflow(
  name: string,
  opts: WorkflowOpts
): GithubWorkflow {
  return {
    name: name,
    on: {
      push: {
        tags: ["v*.*.*", "!v*.*.*-**"],
      },
    },
    env: env(opts),
    jobs: {
      release: new Cf2PulumiRelease("release"),
    },
  };
}

// This section represents sub-jobs that may be used in more than one workflow

export class BuildSdkJob implements NormalJob {
  needs = "prerequisites";

  "runs-on" = "ubuntu-latest"; // not sure how I plan to resolve the issue with go builds

  strategy = {
    "fail-fast": true,
    matrix: {
      language: ["nodejs", "python", "dotnet", "go", "java"],
    },
  };
  steps: NormalJob["steps"];
  name: string;
  if: NormalJob["if"];

  constructor(name: string, opts: WorkflowOpts, tag: boolean) {
    if (opts.provider === "azure-native") {
      this["runs-on"] =
        "${{ matrix.language == 'dotnet' && 'macos-11' || 'ubuntu-latest' }}";
    } else if (opts.provider === "command") {
      this["runs-on"] = "ubuntu-latest";
    }
    this.name = name;
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.InstallNodeJS(),
      steps.InstallDotNet(),
      steps.InstallPython(),
      steps.InstallJava(),
      steps.InstallGradle("7.6"),
      steps.DownloadProviderBinaries(opts.provider, name),
      steps.UnTarProviderBinaries(opts.provider, name),
      steps.RestoreBinaryPerms(opts.provider, name),
      steps.CodegenDuringSDKBuild(opts.provider),
      steps.InitializeSubModules(opts.submodules),
      steps.GenerateSDKs(opts.provider),
      steps.BuildSDKs(opts.provider),
      steps.CheckCleanWorkTree(),
      steps.Porcelain(),
      steps.ZipSDKsStep(),
      steps.UploadSDKs(tag),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name });
  }

  addDispatchConditional(isWorkflowDispatch: boolean) {
    if (isWorkflowDispatch) {
      this.if =
        "github.event_name == 'repository_dispatch' || github.event.pull_request.head.repo.full_name == github.repository";

      this.steps = this.steps?.filter((step) => step.name !== "Checkout Repo");
      this.steps?.unshift(steps.CheckoutRepoStepAtPR());
    }
    return this;
  }

  addRunsOn(provider: string) {
    if (provider === "azure-native") {
      this["runs-on"] =
        "${{ matrix.language == 'dotnet' && 'macos-11' || 'ubuntu-latest' }}";
    }
    return this;
  }
}

export class PrerequisitesJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  steps: NormalJob["steps"];
  name: string;
  if: NormalJob["if"];

  constructor(name: string, opts: WorkflowOpts) {
    this.name = name;
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.InstallSchemaChecker(opts.provider),
      steps.BuildK8sgen(opts.provider),
      steps.PrepareOpenAPIFile(opts.provider),
      steps.InitializeSubModules(opts.submodules),
      steps.BuildCodegenBinaries(opts.provider),
      steps.BuildSchema(opts.provider),
      steps.MakeKubernetesProvider(opts.provider),
      steps.CheckSchemaChanges(opts.provider),
      steps.CommentSchemaChangesOnPR(opts.provider),
      steps.BuildProvider(opts.provider),
      steps.CheckCleanWorkTree(),
      steps.Porcelain(),
      steps.TarProviderBinaries(opts.hasGenBinary),
      steps.UploadProviderBinaries(),
      // Maybe later
      // steps.TestProviderLibrary(),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name });
  }

  addDispatchConditional(isWorkflowDispatch: boolean) {
    if (isWorkflowDispatch) {
      this.if =
        "github.event_name == 'repository_dispatch' || github.event.pull_request.head.repo.full_name == github.repository";

      this.steps = this.steps?.filter((step) => step.name !== "Checkout Repo");
      this.steps?.unshift(steps.CheckoutRepoStepAtPR());
    }
    return this;
  }
}

export class TestsJob implements NormalJob {
  "runs-on" = "ubuntu-latest"; // not sure how I plan to resolve the issue with go builds, if its only k8s we're good

  needs = ["build_sdks"];
  strategy = {
    "fail-fast": true,
    matrix: {
      language: ["nodejs", "python", "dotnet", "go", "java"],
    },
  };
  permissions: NormalJob["permissions"];
  steps: NormalJob["steps"];
  name: string;
  if: NormalJob["if"];

  constructor(workflowName: string, jobName: string, opts: WorkflowOpts) {
    if (
      opts.provider === "kubernetes" &&
      workflowName !== "run-acceptance-tests"
    ) {
      this.needs = ["build_sdks", "build-test-cluster"];
    } else if (opts.provider === "command") {
      this["runs-on"] = "ubuntu-latest";
    }

    if (
      opts.provider === "kubernetes" &&
      workflowName === "run-acceptance-tests"
    ) {
      this.strategy["fail-fast"] = false;
    }

    this.name = jobName;
    this.permissions = {
      contents: "read",
      "id-token": "write",
    };
    const testSteps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.InstallNodeJS(),
      steps.InstallDotNet(),
      steps.InstallPython(),
      steps.InstallJava(),
      steps.InstallGradle("7.6"),
      steps.DownloadProviderBinaries(opts.provider, jobName),
      steps.UnTarProviderBinaries(opts.provider, jobName),
      steps.RestoreBinaryPerms(opts.provider, jobName),
      steps.DownloadSDKs(),
      steps.UnzipSDKs(),
      steps.UpdatePath(),
      steps.InstallNodeDeps(),
      steps.SetNugetSource(),
      steps.InstallPythonDeps(),
      steps.InstallSDKDeps(),
      steps.MakeKubeDir(opts.provider, workflowName),
      steps.DownloadKubeconfig(opts.provider, workflowName),
      steps.GoogleAuth(opts.gcp),
      steps.SetupGCloud(opts.gcp),
      steps.InstallKubectl(opts.provider),
      steps.InstallandConfigureHelm(opts.provider),
      steps.SetupGotestfmt(),
      steps.CreateKindCluster(opts.provider, workflowName),
    ];

    if (opts.provider === "commandx") {
      testSteps.push(steps.BuildTestImage());
    }

    testSteps.push(steps.RunTests(opts.provider, workflowName));
    this.steps = testSteps.filter(
      (step: Step) => step.uses !== undefined || step.run !== undefined
    );
    Object.assign(this, { name: jobName });
  }

  addDispatchConditional(isWorkflowDispatch: boolean) {
    if (isWorkflowDispatch) {
      this.if =
        "github.event_name == 'repository_dispatch' || github.event.pull_request.head.repo.full_name == github.repository";

      this.steps = this.steps?.filter((step) => step.name !== "Checkout Repo");
      this.steps?.unshift(steps.CheckoutRepoStepAtPR());
    }
    return this;
  }
}

export class BuildTestClusterJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  steps: NormalJob["steps"];
  name: string;
  if: NormalJob["if"];
  outputs: NormalJob["outputs"];
  permissions: NormalJob["permissions"];

  constructor(name: string, opts: WorkflowOpts) {
    this.name = name;
    this.outputs = {
      "stack-name": "${{ steps.stackname.outputs.stack-name }}",
    };
    this.permissions = {
      contents: "read",
      "id-token": "write",
    };
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.InstallGo(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.InstallNodeJS(),
      steps.GoogleAuth(opts.gcp),
      steps.SetupGCloud(opts.gcp),
      steps.InstallKubectl(opts.provider),
      steps.LoginGoogleCloudRegistry(opts.provider),
      steps.SetStackName(opts.provider),
      steps.CreateTestCluster(opts.provider),
      steps.UploadKubernetesArtifacts(opts.provider),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name });
  }

  addDispatchConditional(isWorkflowDispatch: boolean) {
    if (isWorkflowDispatch) {
      this.if =
        "github.event_name == 'repository_dispatch' || github.event.pull_request.head.repo.full_name == github.repository";

      this.steps = this.steps?.filter((step) => step.name !== "Checkout Repo");
      this.steps?.unshift(steps.CheckoutRepoStepAtPR());
    }
    return this;
  }
}

export class TeardownTestClusterJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  steps: NormalJob["steps"];
  name: string;
  if: NormalJob["if"];
  needs: NormalJob["needs"];
  permissions: NormalJob["permissions"];

  constructor(name: string, opts: WorkflowOpts) {
    this.name = name;
    this.needs = ["build-test-cluster", "test"];
    this.if =
      "${{ always() }} && github.event.pull_request.head.repo.full_name == github.repository";
    this.permissions = {
      contents: "read",
      "id-token": "write",
    };
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.InstallGo(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.InstallNodeJS(),
      steps.GoogleAuth(opts.gcp),
      steps.SetupGCloud(opts.gcp),
      steps.InstallKubectl(opts.provider),
      steps.LoginGoogleCloudRegistry(opts.provider),
      steps.DestroyTestCluster(opts.provider),
      steps.DeleteArtifact(opts.provider),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name: name });
  }

  addDispatchConditional(isWorkflowDispatch: boolean) {
    if (isWorkflowDispatch) {
      this.steps = this.steps?.filter((step) => step.name !== "Checkout Repo");
      this.steps?.unshift(steps.CheckoutRepoStepAtPR());
    }
    return this;
  }
}

export class LintJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  steps = [steps.CheckoutRepoStep(), steps.InstallGo(), steps.GolangciLint()];
  name: string;
  if: NormalJob["if"];

  constructor(name: string) {
    this.name = name;
    Object.assign(this, { name });
  }

  addDispatchConditional(isWorkflowDispatch: boolean) {
    if (isWorkflowDispatch) {
      this.if =
        "github.event_name == 'repository_dispatch' || github.event.pull_request.head.repo.full_name == github.repository";

      this.steps = this.steps.filter(
        (step: Step) => step.name !== "Checkout Repo"
      );
      this.steps.unshift(steps.CheckoutRepoStepAtPR());
    }
    return this;
  }
}

export class PublishPrereleaseJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  needs = "test";
  steps: NormalJob["steps"];
  name: string;
  constructor(name: string, opts: WorkflowOpts) {
    if (opts.provider === "azure-native" || opts.provider === "aws-native") {
      this["runs-on"] = "macos-11";
    }
    this.name = name;
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.FreeDiskSpace(this["runs-on"]),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.RunGoReleaserWithArgs(
        `-p ${opts.parallel} -f .goreleaser.prerelease.yml --clean --skip=validate --timeout ${opts.timeout}m0s`
      ),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name });
  }
}

export class PublishJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  needs = "test";
  name: string;
  steps: NormalJob["steps"];

  constructor(name: string, opts: WorkflowOpts) {
    this.name = name;
    Object.assign(this, { name });
    if (opts.provider === "azure-native" || opts.provider === "aws-native") {
      this["runs-on"] = "macos-11";
    }
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.FreeDiskSpace(this["runs-on"]),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.RunGoReleaserWithArgs(
        `-p ${opts.parallel} release --clean --timeout ${opts.timeout}m0s`
      ),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
  }
}

export class PublishSDKJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  needs = "publish";
  name: string;
  steps: NormalJob["steps"];

  constructor(name: string) {
    this.name = name;
    Object.assign(this, { name });
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      ...steps.CheckoutScriptsRepoSteps(), // Required for RunPublishSDK
      steps.InstallGo(),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(),
      steps.InstallNodeJS(),
      steps.InstallDotNet(),
      steps.InstallPython(),
      steps.DownloadSpecificSDKStep("python"),
      steps.UnzipSpecificSDKStep("python"),
      steps.DownloadSpecificSDKStep("dotnet"),
      steps.UnzipSpecificSDKStep("dotnet"),
      steps.DownloadSpecificSDKStep("nodejs"),
      steps.UnzipSpecificSDKStep("nodejs"),
      steps.InstallTwine(),
      steps.RunPublishSDK(),
    ];
  }
}

export class PublishJavaSDKJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  "continue-on-error" = true;
  needs = "publish";
  name: string;
  steps: NormalJob["steps"];

  constructor(name: string) {
    this.name = name;
    Object.assign(this, { name });
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(),
      steps.InstallJava(),
      steps.InstallGradle("7.6"),
      steps.DownloadSpecificSDKStep("java"),
      steps.UnzipSpecificSDKStep("java"),
      steps.RunPublishJavaSDK(),
    ];
  }
}

export class PublishGoSdkJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  name = "publish-go-sdk";
  needs = "publish_sdk";
  steps = [
    steps.CheckoutRepoStep(),
    steps.SetProviderVersionStep(),
    steps.DownloadSpecificSDKStep("go"),
    steps.UnzipSpecificSDKStep("go"),
    steps.PublishGoSdk(),
  ];
}

export class DocsBuildDispatchJob implements NormalJob {
  "runs-on" = "ubuntu-latest";
  needs = "publish_go_sdk";
  steps = [steps.InstallPulumiCtl(), steps.DispatchDocsBuildEvent()];
  name: string;

  constructor(name: string) {
    this.name = name;
    Object.assign(this, { name });
  }
}

export class Cf2PulumiRelease implements NormalJob {
  "runs-on" = "macos-11";
  steps = [
    steps.CheckoutRepoStep(),
    steps.SetProviderVersionStep(),
    steps.InstallPulumiCtl(),
    steps.InstallGo(goVersion),
    steps.RunGoReleaserWithArgs(
      "-p 1 -f .goreleaser.cf2pulumi.yml release --clean --timeout 60m0s"
    ),
    steps.ChocolateyPackageDeployment(),
  ];
  name: string;

  constructor(name: string) {
    this.name = name;
    Object.assign(this, { name });
  }
}

export class Arm2PulumiRelease implements NormalJob {
  "runs-on" = "macos-11";
  steps = [
    steps.CheckoutRepoStep(),
    steps.SetProviderVersionStep(),
    steps.InstallPulumiCtl(),
    steps.InstallGo(goVersion),
    steps.RunGoReleaserWithArgs(
      "-p 1 -f .goreleaser.arm2pulumi.yml release --clean --timeout 60m0s"
    ),
  ];
  name: string;

  constructor(name: string) {
    this.name = name;
    Object.assign(this, { name });
  }
}

export class WeeklyPulumiUpdate implements NormalJob {
  "runs-on" = "ubuntu-latest";
  steps: NormalJob["steps"];
  if: NormalJob["if"];
  constructor(name: string, opts: WorkflowOpts) {
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      steps.InstallGo(),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.InstallDotNet(),
      steps.InstallNodeJS(),
      steps.InstallPython(),
      steps.UpdatePulumi(),
      steps.InitializeSubModules(opts.submodules),
      steps.ProviderWithPulumiUpgrade(opts.provider),
      steps.CreateUpdatePulumiPR(opts.defaultBranch),
      // steps.SetPRAutoMerge(opts.provider),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name });
  }
}

export class NightlySdkGeneration implements NormalJob {
  "runs-on" = "ubuntu-latest";
  steps: NormalJob["steps"];
  name: string;
  if: NormalJob["if"];

  constructor(name: string, opts: WorkflowOpts) {
    this.name = name;
    this.steps = [
      steps.CheckoutRepoStep(),
      steps.SetProviderVersionStep(),
      // Pass the provider here as an option so that it can be skipped if not needed
      steps.InstallGo(goVersion),
      steps.InstallPulumiCtl(),
      steps.InstallPulumiCli(opts.pulumiCLIVersion),
      steps.AzureLogin(opts.provider),
      steps.MakeClean(),
      steps.PrepareGitBranchForSdkGeneration(),
      steps.CommitEmptySDK(),
      steps.UpdateSubmodules(opts.provider),
      steps.MakeDiscovery(opts.provider),
      steps.BuildCodegenBinaries(opts.provider),
      steps.MakeLocalGenerate(),
      steps.SetGitSubmoduleCommitHash(opts.provider),
      steps.CommitAutomatedSDKUpdates(opts.provider),
      steps.PullRequestSdkGeneration(opts.provider, opts.defaultBranch),
      // steps.SetPRAutoMerge(opts.provider),
    ].filter((step: Step) => step.uses !== undefined || step.run !== undefined);
    Object.assign(this, { name });
  }
}

export class EmptyJob implements NormalJob {
  steps: Step[];
  "runs-on" = "ubuntu-latest";
  strategy: NormalJob["strategy"];
  name: string;
  if?: string;
  needs?: string[];

  constructor(name: string, params?: Partial<NormalJob>) {
    this.name = name;
    this.steps = [];
    Object.assign(this, { name }, params);
  }

  addStep(step: Step) {
    this.steps.push(step);
    return this;
  }

  addStrategy(strategy: NormalJob["strategy"]) {
    this.strategy = strategy;
    return this;
  }

  addConditional(conditional: string) {
    this.if = conditional;
    return this;
  }

  addNeeds(name: string[]) {
    this.needs = name;
    return this;
  }
}
