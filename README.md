# @asdi/aws-infra

Reusable AWS CDK constructs for deployments.

## Install

```bash
npm install @asdi/aws-infra
npm i -g @asdi/aws-infra   # provides the `asdi` command
```

## Quickstart

From your website project root:

```bash
asdi init
asdi add static-website
asdi add sync
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
asdi <command>

Commands:
  list          List templates, workflows and tools.
  init          Scaffold cdk.json and install dependencies.
  add <name>    Add a template or workflow by name.
  param <push|pull|delete> [options]  Sync .env files with SSM Parameter Store.
  help          Show help.
```

Examples:

```bash
asdi list
asdi init
asdi add static-website
asdi add sync --force
asdi param push --file .env
asdi param pull --prefix /myapp --file .env --overwrite
```

One `.env` holds multiple SSM prefixes:

```bash
# path: /myapp/prod
# string
A=42
# secret
C=23
# path: /myapp/shared
# list
E=1,2,3
```

- `push` reads `# path:` sections from the file.
- `pull --prefix /myapp` recursively downloads everything under `/myapp`
  into `# path:` sections.
- `delete --prefix /myapp/prod` deletes everything under that prefix.

Tools (`tools/param`):

```bash
asdi param push --file .env
npx asdi param push --file .env
```

Background:

## Useful commands (this repo)

- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npx cdk synth`
- `npm run pack:dry`
