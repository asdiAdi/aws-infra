import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface GithubRepositoryIdentity {
  owner: string;
  ownerId: string;
  repo: string;
  repoId: string;
  branch: string;
  environment?: string;
}

export interface GithubDeployRoleProps {
  github: GithubRepositoryIdentity;
  roleName: string;
  managedPolicies?: iam.IManagedPolicy[];
  inlinePolicyStatements?: iam.PolicyStatement[];
  maxSessionDuration?: cdk.Duration;
}

export class GithubDeployRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubDeployRoleProps) {
    super(scope, id);
    const {
      github,
      roleName,
      managedPolicies,
      inlinePolicyStatements,
      maxSessionDuration,
    } = props;

    const { owner, ownerId, repo, repoId, branch, environment } = github;
    const account = cdk.Stack.of(this).account;

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

    this.role = new iam.Role(this, "GithubDeployRole", {
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
      maxSessionDuration: maxSessionDuration ?? cdk.Duration.hours(2),
    });

    if (inlinePolicyStatements && inlinePolicyStatements.length > 0) {
      for (let i = 0; i < inlinePolicyStatements.length; i++) {
        this.role.addToPolicy(inlinePolicyStatements[i]);
      }
    }
  }
}
