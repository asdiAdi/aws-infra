import { StaticSiteStack } from "@asdi/aws-infra";
import * as cdk from "aws-cdk-lib";

const app = new cdk.App();

new StaticSiteStack(app, "StaticSiteStack", {
  env: {
    account: "123456789012",
    region: "us-east-1", //default,
  },
  staticSite: {
    secondLevelDomain: "example.com",
    subDomain: "www",
    github: {
      owner: "owner",
      ownerId: "12345",
      repo: "repo",
      repoId: "12345",
    },
    // tableName: "dynamodb_table_name"
  },
});
