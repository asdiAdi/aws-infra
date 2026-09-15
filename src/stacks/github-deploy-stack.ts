import { GithubDeploy, GithubDeployProps } from "../constructs/github-deploy";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Stack props: standard {@link cdk.StackProps} (`env.account/region`) plus
 * {@link GithubDeployProps} (`github`, `roleName`, ...).
 */
export interface GithubDeployStackProps
  extends cdk.StackProps, GithubDeployProps {}

/**
 * @example
 * ```ts
 * new GithubDeployStack(app, "Deploy", {
 *   env: {
 *      account: process.env.CDK_DEFAULT_ACCOUNT,
 *      region: "us-east-1",
 *   },
 *   roleName: "MyAppGithubDeploy",
 *   github: { owner: "my-org", ownerId: "123456", repo: "my-app", repoId: "789012", branch: "main" },
 *   managedPolicies: [site.staticSite.managedPolicy],
 * });
 * ```
 *
 * @remarks
 * Requires the account's GitHub OIDC provider and the
 * `GithubCdkDeploy` managed policy to pre-exist (see
 * {@link GithubDeploy}).
 */
export class GithubDeployStack extends cdk.Stack {
  /** The composed {@link GithubDeploy} construct. */
  public readonly role: iam.Role;
  /**
   * @param scope - Parent `App`.
   * @param id - Stack ID.
   * @param props - See {@link GithubDeployProps}.
   */
  constructor(scope: Construct, id: string, props: GithubDeployStackProps) {
    super(scope, id, props);

    this.role = new GithubDeploy(this, "GithubDeploy", props).role;
  }
}
