import { StaticSiteStack, GithubDeploymentStack } from "@asdi/aws-infra";
import * as cdk from "aws-cdk-lib";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? "",
  region: "us-east-1", //default,
};

const site = new StaticSiteStack(app, "site", {
  ...env,
  secondLevelDomain: "example.com",
  subDomain: "www",
});

new GithubDeploymentStack(app, "deploy", {
  ...env,
  roleName: "MyAppGithubDeploy", // unique IAM role name per account
  github: {
    owner: "my-org", // github.com/<owner>
    ownerId: "123456", // api.github.com/orgs/<owner> -> id
    repo: "my-app",
    repoId: "789012", // api.github.com/repos/<owner>/<repo> -> id
    branch: "main", // plain name; omit when `environment` is set
    // environment: "prod"; switches trust to environment:<name>
  },
  // Grants the GitHub role S3 sync + CloudFront invalidation for this site.
  managedPolicies: [site.staticSite.managedPolicy],
});
