import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfront_origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Input properties for {@link StaticSite} when the construct creates the
 * hosted-zone lookup and ACM certificate for you.
 *
 * @example
 * ```ts
 * new StaticSite(this, "Site", {
 *   secondLevelDomain: "example.com",
 *   subDomain: "www", // -> https://www.example.com
 * });
 * ```
 */
export interface StaticSiteProps {
  /**
   * Subdomain label prepended to {@link StaticSiteProps.secondLevelDomain}.
   *
   * @example `"www"`, `"app"`, `"docs"`
   */
  subDomain: string;
  /**
   * Apex domain of an existing Route53 hosted zone in this account/region.
   *
   * The zone must already exist because the construct uses
   * `HostedZone.fromLookup`, which resolves at synth time from AWS context.
   *
   * @example `"example.com"`
   * @see {@link StaticSite.hostedZone}
   */
  secondLevelDomain: string;

  /**
   * Serve `/index.html` for S3 403/404 errors.
   * Enable for SPAs with client-side routing.
   *
   * @default false
   */
  spaFallback?: boolean;
}

/**
 * Input properties for {@link StaticSite} when you bring your own hosted
 * zone and ACM certificate.
 *
 * Use this to deploy the stack outside `us-east-1`, to reuse a
 * centrally-provisioned certificate.
 *
 * @example
 * ```ts
 * new StaticSite(this, "Site", {
 *   secondLevelDomain: "example.com",
 *   subDomain: "www",
 *   hostedZone,
 *   certificate,
 * });
 * ```
 */
export interface StaticSiteWithCertProps extends StaticSiteProps {
  /**
   * Pre-existing hosted zone for `secondLevelDomain`. Passed through as
   * {@link StaticSite.hostedZone} and used for the alias records.
   */
  hostedZone: route53.IHostedZone;
  /**
   * Pre-existing certificate covering {@link StaticSite.domainName}.
   * Must live in `us-east-1` for CloudFront. Passed through as
   * {@link StaticSite.certificate}.
   */
  certificate: acm.ICertificate;
}

/**
 * Accepted props for {@link StaticSite}
 * {@link StaticSiteProps}
 * {@link StaticSiteWithCertProps}
 *
 * @example Auto-provisioned (stack must be in `us-east-1`).
 * ```ts
 * new StaticSite(this, "Site", {
 *   secondLevelDomain: "example.com",
 *   subDomain: "www",
 * });
 * ```
 *
 * @example Bring-your-own (any region).
 * ```ts
 * new StaticSite(this, "Site", {
 *   secondLevelDomain: "example.com",
 *   subDomain: "www",
 *   hostedZone,
 *   certificate,
 * });
 * ```
 */
export type StaticSiteConstructProps =
  StaticSiteProps | StaticSiteWithCertProps;

/**
 * Narrows {@link StaticSiteConstructProps} to {@link StaticSiteWithCertProps}
 * when both `hostedZone` and `certificate` are present.
 */
function hasCert(
  props: StaticSiteConstructProps,
): props is StaticSiteWithCertProps {
  return "hostedZone" in props && "certificate" in props;
}

/**
 * HTTPS static website: Route53 + ACM + private S3 + CloudFront + scoped
 * deploy permissions.
 *
 * @example
 * ```ts
 * const site = new StaticSite(this, "Site", {
 *   secondLevelDomain: "example.com",
 *   subDomain: "www",
 * });
 * ```
 */
export class StaticSite extends Construct {
  /** Fully qualified domain name (`subDomain.secondLevelDomain`). */
  public readonly domainName: string;
  /** Hosted zone for the site */
  public readonly hostedZone: route53.IHostedZone;
  /** Certificate for {@link StaticSite.domainName} */
  public readonly certificate: acm.ICertificate;
  /** Private origin bucket named after {@link StaticSite.domainName}. */
  public readonly bucket: s3.Bucket;
  /** CloudFront CDN fronting {@link StaticSite.bucket}. */
  public readonly distribution: cloudfront.Distribution;
  /**
   * Scoped deploy policy for CI: S3 sync on this bucket + CloudFront
   * invalidation on this distribution.
   */
  public readonly managedPolicy: iam.ManagedPolicy;
  /** IPv4 alias record pointing the subdomain at CloudFront. */
  public readonly aRecord: route53.ARecord;
  /** IPv6 alias record pointing the subdomain at CloudFront. */
  public readonly aaaaRecord: route53.AaaaRecord;

  /**
   * @param scope - Parent construct, usually a `Stack`.
   * @param id - Construct ID unique within `scope`.
   * @param props - See {@link StaticSiteConstructProps}.
   */
  constructor(scope: Construct, id: string, props: StaticSiteConstructProps) {
    super(scope, id);

    this.domainName = `${props.subDomain}.${props.secondLevelDomain}`;

    if (hasCert(props)) {
      this.hostedZone = props.hostedZone;
      this.certificate = props.certificate;
    } else {
      const region = cdk.Stack.of(this).region;
      if (region !== "us-east-1" && cdk.Token.isResolved(region)) {
        throw new Error(
          `StaticSite must be deployed to us-east-1 when no certificate is provided (got "${region}"). ` +
            `CloudFront requires ACM certificates in us-east-1. Either move this stack to us-east-1, ` +
            `or pass a pre-created certificate + hostedZone via StaticSiteWithCertProps.`,
        );
      }
      this.hostedZone = route53.HostedZone.fromLookup(
        this,
        "StaticSiteHostedZone",
        {
          domainName: props.secondLevelDomain,
        },
      );

      this.certificate = new acm.Certificate(this, "StaticSiteCertificate", {
        domainName: this.domainName,
        validation: acm.CertificateValidation.fromDns(this.hostedZone),
      });
    }

    this.bucket = new s3.Bucket(this, "StaticSiteBucket", {
      bucketName: this.domainName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // SPA routes don't map to S3 objects, so serve index.html instead of 403/404.
    const errorResponses: cloudfront.ErrorResponse[] | undefined =
      props.spaFallback
        ? [
            {
              httpStatus: 403,
              responseHttpStatus: 200,
              responsePagePath: "/index.html",
              ttl: cdk.Duration.seconds(0),
            },
            {
              httpStatus: 404,
              responseHttpStatus: 200,
              responsePagePath: "/index.html",
              ttl: cdk.Duration.seconds(0),
            },
          ]
        : undefined;

    this.distribution = new cloudfront.Distribution(
      this,
      "StaticSiteDistribution",
      {
        comment: `CDN for ${this.domainName}`,
        defaultBehavior: {
          origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
            this.bucket,
            {},
          ),
          compress: true,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        defaultRootObject: "index.html",
        domainNames: [this.domainName],
        certificate: this.certificate,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        errorResponses,
      },
    );

    this.managedPolicy = new iam.ManagedPolicy(this, "StaticSitePolicy", {
      managedPolicyName: `${this.domainName}-SyncPolicy`,
      description:
        "Scoped deployment permissions for s3 sync and cloudfront cache invalidation",
      statements: [
        new iam.PolicyStatement({
          sid: "S3BucketPermissions",
          effect: iam.Effect.ALLOW,
          actions: ["s3:ListBucket"],
          resources: [this.bucket.bucketArn],
        }),
        new iam.PolicyStatement({
          sid: "S3ObjectPermissions",
          effect: iam.Effect.ALLOW,
          actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
          resources: [this.bucket.arnForObjects("*")],
        }),
        new iam.PolicyStatement({
          sid: "CloudFrontInvalidationPermissions",
          effect: iam.Effect.ALLOW,
          actions: [
            "cloudfront:CreateInvalidation",
            "cloudfront:GetInvalidation",
          ],
          resources: [this.distribution.distributionArn],
        }),
      ],
    });

    const alias = new route53_targets.CloudFrontTarget(this.distribution);
    this.aRecord = new route53.ARecord(this, "StaticSiteARecord", {
      zone: this.hostedZone,
      target: route53.RecordTarget.fromAlias(alias),
      recordName: props.subDomain,
    });
    this.aaaaRecord = new route53.AaaaRecord(this, "StaticSiteAaaaRecord", {
      zone: this.hostedZone,
      target: route53.RecordTarget.fromAlias(alias),
      recordName: props.subDomain,
    });
  }
}
