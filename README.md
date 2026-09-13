# @asdi/aws-infra

Reusable AWS CDK constructs for deployments.

## Install

```bash
npm install @asdi/aws-infra
```

## Quickstart

From your website project root:

```bash
npx @asdi/aws-infra init
npx @asdi/aws-infra add static-website
npx @asdi/aws-infra add sync
```

- `init` creates `cdk.json` (`{ "app": "npx tsx infra/index.ts" }`) and installs `@asdi/aws-infra`, `aws-cdk-lib`, `tsx`.
- `add static-website` copies `infra/static-website.ts` starter stack.
- `add sync` copies `.github/workflows/sync.yml` deploy workflow.

Then:

```bash
npx cdk synth
npx cdk diff
npx cdk deploy
```

### CLI reference

```bash
npx @asdi/aws-infra <command>

Commands:
  list          List templates and workflows.
  init          Scaffold cdk.json and install dependencies.
  add <name>    Add a template or workflow by name.
  help          Show help.
```

Examples:

```bash
npx @asdi/aws-infra list
npx @asdi/aws-infra init
npx @asdi/aws-infra add static-website
npx @asdi/aws-infra add sync --force
```

Background:

## Useful commands (this repo)

- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npx cdk synth`
- `npm run pack:dry`
