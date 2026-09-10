# @asdi/aws-infra

Reusable AWS CDK constructs for deployments.

## Install

```bash
npm install @asdi/aws-infra
```

## Quickstart

From your website project root:

```bash
npx @asdi/aws-infra static-site
```

This copies into your current directory (overwrites):

- `infra/index.ts` — starter stack with generic placeholders.
- `cdk.json` — contains `{ "app": "npx tsx infra/index.ts" }`.
- `.github/workflows/` — deploy workflow

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
  static-site   Scaffold static site.
  list          List templates.
  help          Show help.
```

Examples:

```bash
npx @asdi/aws-infra static-site
npx @asdi/aws-infra list
```

Background:

## Useful commands (this repo)

- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npx cdk synth`
- `npm run pack:dry`
