import {
  StaticSite,
  StaticSiteConstructProps,
} from "../constructs/static-site";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";

export type StaticSiteStackProps = cdk.StackProps & StaticSiteConstructProps;

export class StaticSiteStack extends cdk.Stack {
  public readonly staticSite: StaticSite;
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);
    this.staticSite = new StaticSite(this, "StaticSite", props);
  }
}
