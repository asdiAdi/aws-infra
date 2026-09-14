import {
  GithubDeployRole,
  GithubDeployRoleProps,
} from "../constructs/github-deploy-role";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Stack props: standard {@link cdk.StackProps} (`env.account/region`) plus
 * {@link GithubDeployRoleProps} (`github`, `roleName`, ...).
 */
export interface GithubDeploymentStackProps
  extends cdk.StackProps, GithubDeployRoleProps {}

/**
 * @example
 * ```ts
 * new GithubDeploymentStack(app, "Deploy", {
 *   account: process.env.CDK_DEFAULT_ACCOUNT,
 *   region: "us-east-1",
 *   roleName: "MyAppGithubDeploy",
 *   github: { owner: "my-org", ownerId: "123456", repo: "my-app", repoId: "789012", branch: "main" },
 *   managedPolicies: [site.staticSite.managedPolicy],
 * });
 * ```
 *
 * @remarks
 * Requires the account's GitHub OIDC provider and the
 * `GithubCdkDeploy` managed policy to pre-exist (see
 * {@link GithubDeployRole}).
 */
export class GithubDeploymentStack extends cdk.Stack {
  /** The composed {@link GithubDeployRole} construct. */
  public readonly githubDeployRole: GithubDeployRole;
  /**
   * @param scope - Parent `App`.
   * @param id - Stack ID.
   * @param props - See {@link GithubDeploymentStackProps}.
   */
  constructor(scope: Construct, id: string, props: GithubDeploymentStackProps) {
    super(scope, id, props);

    this.githubDeployRole = new GithubDeployRole(this, "Deployment", props);
  }
}
