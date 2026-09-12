import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfront_origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53_targets from "aws-cdk-lib/aws-route53-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

export interface StaticSiteProps {
  /** Subdomain for the site, e.g. "www" -> "www.example.com". */
  subDomain: string;
  /** Apex domain with an existing Route53 hosted zone, e.g. "example.com". */
  secondLevelDomain: string;
  /** Github repo credentials */
  github: {
    owner: string;
    ownerId: string;
    repo: string;
    repoId: string;
    branch: string;
    environment?: string;
  };
  /** Optional existing DynamoDB table name to register site outputs. Omit if unused. */
  tableName?: string;
}

export interface StaticSiteStackProps extends Omit<cdk.StackProps, "env"> {
  env: {
    account: string;
    region?: string;
  };
  staticSite: StaticSiteProps;
}

export class StaticSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StaticSiteStackProps) {
    super(scope, id, props);
    new StaticSiteConstruct(
      this,
      `${props.staticSite.subDomain}-${props.staticSite.secondLevelDomain}-StaticSiteConstruct`,
      { ...props.staticSite },
    );
  }
}

class StaticSiteConstruct extends Construct {
  constructor(scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const account = stack.account;
    const region = stack.region ?? "us-east-1";

    const domainName = `${props.subDomain}.${props.secondLevelDomain}`;
    const constructId = `${props.subDomain}-${props.secondLevelDomain}`;
    new cdk.CfnOutput(this, "DomainName", { value: "https://" + domainName });

    //get hostedzone name
    const hostedZone = route53.HostedZone.fromLookup(
      this,
      `${constructId}-HostedZone`,
      { domainName: props.secondLevelDomain },
    );

    //create website certification, bucket for storage, cloudfront for cdn
    const certificate = this.createCertificate(
      constructId,
      domainName,
      hostedZone,
    );
    const bucket = this.createBucket(constructId, domainName);
    const distribution = this.createDistribution(
      constructId,
      domainName,
      bucket,
      certificate,
    );

    //create website arecord and aaaaRecord
    const alias = new route53_targets.CloudFrontTarget(distribution);
    const aRecord = new route53.ARecord(this, `${constructId}-ARecord`, {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(alias),
      recordName: props.subDomain,
    });
    new cdk.CfnOutput(this, "Arecord", {
      value: aRecord.domainName,
    });
    const aaaaRecord = new route53.AaaaRecord(
      this,
      `${constructId}-AaaaRecord`,
      {
        zone: hostedZone,
        target: route53.RecordTarget.fromAlias(alias),
        recordName: props.subDomain,
      },
    );
    new cdk.CfnOutput(this, "AaaaRecord", {
      value: aaaaRecord.domainName,
    });

    const deployPolicy = this.createDeployPolicy(
      constructId,
      account,
      bucket,
      distribution,
    );

    // create github deploy role, its purpose is to allow github actions to sync to s3, invalidate cloudfront, and deploy cdk resources
    const deployRole = this.createGithubDeployRole(
      constructId,
      domainName,
      account,
      props.github,
      deployPolicy,
    );

    // add this to a personal dynamoTable for easy lookup of arns
    if (props.tableName) {
      this.registerSite(
        constructId,
        domainName,
        region,
        props.tableName,
        bucket,
        distribution,
        deployRole,
      );
    }
  }

  private createCertificate(
    constructId: string,
    domainName: string,
    hostedZone: route53.IHostedZone,
  ): acm.Certificate {
    const certificate = new acm.Certificate(
      this,
      `${constructId}-Certificate`,
      {
        domainName: domainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      },
    );
    new cdk.CfnOutput(this, "Certificate", {
      value: certificate.certificateArn,
    });

    return certificate;
  }

  private createBucket(constructId: string, domainName: string): s3.Bucket {
    const bucket = new s3.Bucket(this, `${constructId}-Bucket`, {
      bucketName: domainName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    new cdk.CfnOutput(this, "Bucket", { value: bucket.bucketName });
    return bucket;
  }

  private createDistribution(
    constructId: string,
    domainName: string,
    bucket: s3.Bucket,
    certificate: acm.Certificate,
  ): cloudfront.Distribution {
    const distribution = new cloudfront.Distribution(
      this,
      `${constructId}-Distribution`,
      {
        comment: `CDN for ${domainName}`,
        defaultBehavior: {
          origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
            bucket,
            {},
          ),
          compress: true,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        defaultRootObject: "index.html",
        domainNames: [domainName],
        certificate: certificate,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      },
    );
    new cdk.CfnOutput(this, "Distribution", {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
    });
    return distribution;
  }

  private registerSite(
    constructId: string,
    domainName: string,
    region: string,
    tableName: string,
    bucket: s3.Bucket,
    distribution: cloudfront.Distribution,
    deployRole: iam.Role,
  ): void {
    const table = dynamodb.Table.fromTableName(
      this,
      `${constructId}-SiteTable`,
      tableName,
    );

    const putItemParameters = {
      TableName: table.tableName,
      Item: {
        pk: { S: domainName },
        AWS_REGION: { S: region },
        AWS_ROLE_TO_ASSUME: { S: deployRole.roleArn },
        CLOUDFRONT_DISTRIBUTION_ID: { S: distribution.distributionId },
        S3_BUCKET: { S: bucket.bucketName },
      },
    };

    new custom.AwsCustomResource(this, `${constructId}-SiteData`, {
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        parameters: putItemParameters,
        physicalResourceId: custom.PhysicalResourceId.of(domainName),
      },
      onUpdate: {
        service: "DynamoDB",
        action: "putItem",
        parameters: putItemParameters,
        physicalResourceId: custom.PhysicalResourceId.of(domainName),
      },
      onDelete: {
        service: "DynamoDB",
        action: "deleteItem",
        parameters: {
          TableName: table.tableName,
          Key: { pk: { S: domainName } },
        },
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [table.tableArn],
      }),
    });
  }

  private createDeployPolicy(
    constructId: string,
    account: string,
    bucket: s3.Bucket,
    distribution: cloudfront.Distribution,
  ): iam.ManagedPolicy {
    const policy = new iam.ManagedPolicy(
      this,
      `${constructId}-s3CloudFrontdeployPolicy`,
      {
        description:
          "Scoped deployment permissions for s3 sync and cloudfront cache invalidation",
        statements: [
          new iam.PolicyStatement({
            sid: "S3BucketPermissions",
            effect: iam.Effect.ALLOW,
            actions: ["s3:ListBucket"],
            resources: [bucket.bucketArn],
          }),
          new iam.PolicyStatement({
            sid: "S3ObjectPermissions",
            effect: iam.Effect.ALLOW,
            actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
            resources: [bucket.arnForObjects("*")],
          }),
          new iam.PolicyStatement({
            sid: "CloudFrontInvalidationPermissions",
            effect: iam.Effect.ALLOW,
            actions: [
              "cloudfront:CreateInvalidation",
              "cloudfront:GetInvalidation",
            ],
            resources: [distribution.distributionArn],
          }),
          new iam.PolicyStatement({
            sid: "AllowCDKBootstrap",
            effect: iam.Effect.ALLOW,
            actions: ["sts:AssumeRole"],
            resources: [`arn:aws:iam::${account}:role/cdk-*`],
            conditions: {
              StringEquals: {
                "iam:ResourceTag/aws-cdk:bootstrap-role": [
                  "file-publishing",
                  "deploy",
                ],
              },
            },
          }),
        ],
      },
    );
    new cdk.CfnOutput(this, "S3CloudFrontDeployPolicy", {
      value: policy.managedPolicyArn,
    });
    return policy;
  }

  private createGithubDeployRole(
    constructId: string,
    domainName: string,
    awsId: string,
    github: {
      owner: string;
      ownerId: string;
      repo: string;
      repoId: string;
      branch: string;
      environment?: string;
    },
    deployPolicy: iam.ManagedPolicy,
  ): iam.Role {
    const GITHUB_OIDC_PROVIDER_URL = "token.actions.githubusercontent.com";
    const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";
    const GITHUB_REFS = `ref:refs/heads/${github.branch}`;
    const GITHUB_ENVIRONMENT = `environment:${github.environment}`;

    const suffix = github.environment ? GITHUB_ENVIRONMENT : GITHUB_REFS;
    const oldSub = `repo:${github.owner}/${github.repo}:${suffix}`;
    const sub = `repo:${github.owner}@${github.ownerId}/${github.repo}@${github.repoId}:${suffix}`; // july 15 update

    const oidcProviderArn = `arn:aws:iam::${awsId}:oidc-provider/token.actions.githubusercontent.com`;
    const roleName = `github-deploy-${constructId
      .toLowerCase()
      .replace(/\./g, "-")
      .replace(/[^a-z0-9+=,.@_-]/g, "-")}`.slice(0, 64);

    const role = new iam.Role(this, `${constructId}-GithubDeployRole`, {
      roleName,
      description: `GitHub Actions deploy role for ${domainName} (${github.owner}/${github.repo})`,
      assumedBy: new iam.FederatedPrincipal(
        oidcProviderArn,
        {
          StringEquals: {
            [`${GITHUB_OIDC_PROVIDER_URL}:aud`]: GITHUB_OIDC_AUDIENCE,
          },
          StringLike: {
            [`${GITHUB_OIDC_PROVIDER_URL}:sub`]: [oldSub, sub],
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      managedPolicies: [deployPolicy],
    });
    new cdk.CfnOutput(this, "RoleToAssume", {
      description: "AWS_ROLE_TO_ASSUME",
      value: role.roleArn,
    });
    return role;
  }
}
