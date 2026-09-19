import {
  StaticSite,
  StaticSiteConstructProps,
} from "../constructs/static-site";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";

/**
 * Stack props: standard {@link cdk.StackProps} (`env.account/region`) plus
 * {@link StaticSiteConstructProps}.
 */
export type StaticSiteStackProps = cdk.StackProps & StaticSiteConstructProps;

/**
 * @example Auto-provisioned (stack in `us-east-1`).
 * ```ts
 * const site = new StaticSiteStack(app, "Site", {
 *   env: {
 *     account: process.env.CDK_DEFAULT_ACCOUNT,
 *     region: "us-east-1", // CloudFront ACM certs must live in us-east-1
 *   }
 *   secondLevelDomain: "example.com",
 *   subDomain: "www",
 * });
 * ```
 *
 * @example Bring-your-own zone + certificate (any region).
 * ```ts
 * const site = new StaticSiteStack(app, "Site", {
 *   env: {
 *      account: process.env.CDK_DEFAULT_ACCOUNT,
 *      region: "eu-central-1",
 *   }
 *   secondLevelDomain: "example.com",
 *   subDomain: "www",
 *   hostedZone,
 *   certificate, // must cover www.example.com, issued in us-east-1
 * });
 * ```
 */
export class StaticSiteStack extends cdk.Stack {
  /** The composed {@link StaticSite} construct. */
  public readonly staticSite: StaticSite;
  /**
   * @param scope - Parent `App`.
   * @param id - Stack ID.
   * @param props - See {@link StaticSiteStackProps}.
   */
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);
    this.staticSite = new StaticSite(this, "StaticSite", props);
  }
}
