import { StaticSite, StaticSiteProps } from "../constructs/static-site";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";

export interface StaticSiteStackProps extends cdk.StackProps, StaticSiteProps {}

export class StaticSiteStack extends cdk.Stack {
  public readonly staticSite: StaticSite;
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);
    this.staticSite = new StaticSite(this, "StaticSite", props);
  }
}
