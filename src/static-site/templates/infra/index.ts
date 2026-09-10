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
    githubName: "my-org",
    githubRepo: "my-repo",
    // tableName: "dynamodb_table_name"
  },
});
