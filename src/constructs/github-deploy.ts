import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * GitHub repository identity trusted by the OIDC federated role.
 *
 * @example
 * ```ts
 * github: {
 *   owner: "my-org",   // github.com/my-org
 *   ownerId: "123456", // org numeric ID: https://api.github.com/orgs/my-org -> `id`
 *   repo: "my-app",
 *   repoId: "789012",  // repo numeric ID: https://api.github.com/repos/my-org/my-app -> `id`
 *   branch: "main",
 * }
 * ```
 */
export interface GithubRepoIdentity {
  /** GitHub org or user login, e.g. `"my-org"`. */
  owner: string;
  /**
   * Numeric org/user ID as a string, e.g. `"123456"`.
   * Find via `https://api.github.com/orgs/<owner>` (`id` field).
   */
  ownerId: string;
  /** Repository name without owner, e.g. `"my-app"`. */
  repo: string;
  /**
   * Numeric repository ID as a string, e.g. `"789012"`.
   * Find via `https://api.github.com/repos/<owner>/<repo>` (`id` field).
   */
  repoId: string;
  /**
   * Branch name in plain form, e.g. `"main"`.
   * Ignored when `environment` is set.
   */
  branch: string;
  /**
   * Optional GitHub Environments name.
   */
  environment?: string;
}

/**
 * Input properties for {@link GithubDeploy}.
 *
 * @example
 * ```ts
 * new GithubDeploy(this, "Deploy", {
 *   roleName: "MyAppGithubDeploy",
 *   github: { owner: "my-org", ownerId: "123456", repo: "my-app", repoId: "789012", branch: "main" },
 *   managedPolicies: [site.managedPolicy],
 * });
 * ```
 */
export interface GithubDeployProps {
  /** Which GitHub repo (and branch or environment) may assume the role. */
  github: GithubRepoIdentity;
  /** Physical IAM role name, e.g. `"MyAppGithubDeploy"`. Must be unique per account. */
  roleName: string;
  /**
   * Extra AWS-managed or customer-managed policies to attach alongside the
   * built-in `GithubCdkDeploy` policy.
   *
   * @default []
   */
  managedPolicies?: iam.IManagedPolicy[];
  /**
   * Extra inline policy statements added via `role.addToPolicy()`.
   *
   * @default []
   */
  inlinePolicyStatements?: iam.PolicyStatement[];
  /**
   * SSM parameter path prefixes the role may read.
   *
   * Each entry must be an absolute parameter path, e.g. `"/myapp/prod"`.
   * Grants:
   * `ssm:GetParameter`, `ssm:GetParameters`, and
   * `ssm:GetParametersByPath` on
   * `arn:aws:ssm:{region}:{account}:parameter{prefix}` and
   * `arn:aws:ssm:{region}:{account}:parameter{prefix}/*`,
   * scoped to this stack's region and account.
   *
   * @example `["/myapp/prod"]`
   * @default []
   * @remarks
   * Reading `SecureString` parameters also requires `kms:Decrypt` on the
   * relevant KMS key. Pass that separately via `inlinePolicyStatements`.
   */
  ssmParameterPrefixes?: string[];
  /**
   * Maximum CLI/API session length for the assumed role.
   *
   * @default cdk.Duration.hours(2)
   */
  maxSessionDuration?: cdk.Duration;
}

/**
 * IAM role assumable by GitHub Actions via the account's OIDC provider.
 *
 * @example
 * ```ts
 * new GithubDeploy(this, "Deploy", {
 *   roleName: "MyAppGithubDeploy",
 *   github: { owner: "my-org", ownerId: "123456", repo: "my-app", repoId: "789012", branch: "main" },
 *   managedPolicies: [site.managedPolicy],
 * });
 * ```
 *
 * @remarks
 * Prerequisites (not created here, looked up by ARN):
 * - the `token.actions.githubusercontent.com` IAM OIDC provider,
 * - the `arn:aws:iam::<account>:policy/GithubCdkDeploy` managed policy.
 * Synth/deploy fails if either is missing.
 */
export class GithubDeploy extends Construct {
  /** The federated deploy role GitHub Actions assumes. */
  public readonly role: iam.Role;

  /**
   * @param scope - Parent construct, usually a `Stack`.
   * @param id - Construct ID unique within `scope`.
   * @param props - See {@link GithubDeployProps}.
   */
  constructor(scope: Construct, id: string, props: GithubDeployProps) {
    super(scope, id);
    const {
      github,
      roleName,
      managedPolicies,
      inlinePolicyStatements = [],
      ssmParameterPrefixes = [],
      maxSessionDuration = cdk.Duration.hours(2),
    } = props;

    const { owner, ownerId, repo, repoId, branch, environment } = github;
    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    const GITHUB_OIDC_PROVIDER_URL = "token.actions.githubusercontent.com";
    const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";
    const GITHUB_REFS = `ref:refs/heads/${branch}`;
    const GITHUB_ENVIRONMENT = `environment:${environment ?? ""}`;

    const suffix = environment ? GITHUB_ENVIRONMENT : GITHUB_REFS;
    const oldSub = `repo:${owner}/${repo}:${suffix}`;
    const sub = `repo:${owner}@${ownerId}/${repo}@${repoId}:${suffix}`; // july 15 update

    const deployPolicy = iam.ManagedPolicy.fromManagedPolicyArn(
      this,
      "GithubDeployPolicy",
      `arn:aws:iam::${account}:policy/GithubCdkDeploy`,
    );

    this.role = new iam.Role(this, "GithubDeploy", {
      roleName,
      description: `GitHub Actions deploy role for (${owner}/${repo})`,
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${account}:oidc-provider/${GITHUB_OIDC_PROVIDER_URL}`,
        {
          StringEquals: {
            [`${GITHUB_OIDC_PROVIDER_URL}:aud`]: GITHUB_OIDC_AUDIENCE,
            [`${GITHUB_OIDC_PROVIDER_URL}:sub`]: [oldSub, sub],
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      managedPolicies: [deployPolicy, ...(managedPolicies ?? [])],
      maxSessionDuration: maxSessionDuration,
    });

    const statements = [...inlinePolicyStatements];

    if (ssmParameterPrefixes.length > 0) {
      const ssmPolicy = new iam.PolicyStatement({
        sid: "AllowSsmParameterRead",
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ],
        resources: ssmParameterPrefixes.flatMap((p) => {
          const normalized = p.replace(/\/\*$/, "");
          return [
            `arn:aws:ssm:${region}:${account}:parameter${normalized}`,
            `arn:aws:ssm:${region}:${account}:parameter${normalized}/*`,
          ];
        }),
      });
      statements.push(ssmPolicy);
    }

    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i++) {
        this.role.addToPolicy(statements[i]);
      }
    }
  }
}
