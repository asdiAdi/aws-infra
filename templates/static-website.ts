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
  roleName: "",
  github: {
    owner: "",
    ownerId: "",
    repo: "",
    repoId: "",
    branch: "",
    environment: "",
  },
  managedPolicies: [site.staticSite.managedPolicy],
});
