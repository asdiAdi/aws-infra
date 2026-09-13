import {
  GithubDeployRole,
  GithubDeployRoleProps,
} from "../constructs/github-deploy-role";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface GithubDeploymentStackProps
  extends cdk.StackProps, GithubDeployRoleProps {}

export class GithubDeploymentStack extends cdk.Stack {
  public readonly githubDeployRole: GithubDeployRole;
  constructor(scope: Construct, id: string, props: GithubDeploymentStackProps) {
    super(scope, id, props);

    this.githubDeployRole = new GithubDeployRole(this, "Deployment", props);
  }
}
