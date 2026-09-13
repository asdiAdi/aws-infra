import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfront_origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface StaticSiteProps {
  /** Subdomain for the site, e.g. "www" -> "www.example.com". */
  subDomain: string;
  /** Apex domain with an existing Route53 hosted zone, e.g. "example.com". */
  secondLevelDomain: string;
}

export class StaticSite extends Construct {
  public readonly domainName: string;
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.Certificate;
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly managedPolicy: iam.ManagedPolicy;
  public readonly aRecord: route53.ARecord;
  public readonly aaaaRecord: route53.AaaaRecord;

  constructor(scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id);

    this.domainName = `${props.subDomain}.${props.secondLevelDomain}`;

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

    this.bucket = new s3.Bucket(this, "StaticSiteBucket", {
      bucketName: this.domainName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

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
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      },
    );

    this.managedPolicy = new iam.ManagedPolicy(this, "StaticSitePolicy", {
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

    //create website arecord and aaaaRecord
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
