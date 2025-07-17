import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3tables from "@aws-cdk/aws-s3tables-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Config } from "./shared/config";

export interface TitanicStackProps extends cdk.StackProps {
    athenaDatabaseName?: string;
    quiltReadPolicyArn?: string;
    useS3Table?: boolean;
    externalDeployment?: boolean;  // Flag for third-party deployments (uses parameters and pre-built assets)
}

interface TitanicStackParameters {
    athenaDatabaseName: cdk.CfnParameter;
    quiltReadPolicyArn: cdk.CfnParameter;
    useS3Table: cdk.CfnParameter;
    publicAssetsBucketName: cdk.CfnParameter;  // For external deployments
    s3TablesBucketName: cdk.CfnParameter;      // For external deployments
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps = {}) {
        super(scope, id, props);

        const isExternalDeployment = props.externalDeployment ?? false;

        // Create config instance that knows about account and region
        const configProps = this.resolveConfiguration(props);
        const config = Config.createFromStack(this.account, this.region, configProps);
        
        console.log("TitanicStack configuration:", {
            account: this.account,
            region: this.region,
            athenaDatabaseName: configProps.athenaDatabaseName,
            useS3Table: configProps.useS3Table,
            externalDeployment: isExternalDeployment
        });

        // Get standardized names using Config class
        const s3DatabaseName = config.s3TableDatabaseName;

        // For external deployments, we create minimal infrastructure
        // Third-party users should NOT create public or S3 table buckets
        let glueTablesBucket: s3.Bucket;
        let s3TablesBucketName: string;
        let assetsBucketName: string;

        if (isExternalDeployment) {
            // External deployment: only create Glue tables bucket for Athena results
            glueTablesBucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
                bucketName: config.generateGlueTablesBucketName(),
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                autoDeleteObjects: true,
            });

            // Reference external buckets by name (these should exist already)
            s3TablesBucketName = configProps.s3TablesBucketName || config.generateS3TablesBucketName();
            assetsBucketName = configProps.publicAssetsBucketName || config.generateAssetsBucketName();
            
        } else {
            // Internal deployment: create all buckets
            glueTablesBucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
                bucketName: config.generateGlueTablesBucketName(),
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                autoDeleteObjects: true,
            });
            // Create an S3 Tables bucket for internal use
            const s3TablesBucket = new s3tables.TableBucket(this, "TitanicS3TablesBucket", {
                tableBucketName: config.generateS3TablesBucketName(),
            });
            s3TablesBucketName = s3TablesBucket.tableBucketName;
            // Create an assets bucket for deployment assets and Lambda code
            const assetsBucket = new s3.Bucket(this, "TitanicAssetsBucket", {
                bucketName: config.generateAssetsBucketName(),
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                autoDeleteObjects: true,
                publicReadAccess: true, // Make bucket objects publicly readable
                blockPublicAccess: new s3.BlockPublicAccess({
                    blockPublicAcls: false,
                    blockPublicPolicy: false,
                    ignorePublicAcls: false,
                    restrictPublicBuckets: false,
                }), // Allow completely open public access
            });
            assetsBucketName = assetsBucket.bucketName;
        }

        // Create Lambda environment configuration
        const lambdaEnvironment = {
            // Source database to read from (always the same, where views are)
            ATHENA_DATABASE_NAME: config.athenaDatabaseName,

            // Target database to write to (changes based on USE_S3_TABLE)
            S3TABLE_DATABASE_NAME: s3DatabaseName,

            // Target buckets - Pass bucket names instead of ARNs
            GLUE_TABLES_BUCKET_NAME: glueTablesBucket.bucketName,
            S3_TABLES_BUCKET_NAME: s3TablesBucketName,

            // AWS context for ARN generation
            AWS_ACCOUNT_ID: this.account,
            CDK_DEFAULT_REGION: this.region,

            // Configuration
            LAMBDA_TIMEOUT: "900",
            QUILT_READ_POLICY_ARN: config.quiltReadPolicyArn,
            USE_S3_TABLE: config.useS3Table.toString(),
        };

        // Create merge tables Lambda - use different approaches based on deployment mode
        const mergeLambda = isExternalDeployment 
            ? new lambda.Function(this, "TitanicMergeTables", {
                runtime: Runtime.NODEJS_18_X,
                handler: "index.handler",
                timeout: cdk.Duration.seconds(900),
                code: lambda.Code.fromBucket(
                    s3.Bucket.fromBucketName(this, "PublicAssetsBucket", assetsBucketName),
                    "lambda/merge-tables.zip" // Always uses latest version from public bucket
                ),
                environment: lambdaEnvironment,
            })
            : new lambdaNodejs.NodejsFunction(this, "TitanicMergeTables", {
                entry: path.join(__dirname, "merge-tables.ts"),
                handler: "handler",
                runtime: Runtime.NODEJS_18_X,
                timeout: cdk.Duration.seconds(900),
                bundling: {
                    externalModules: [
                        "@aws-sdk/client-glue",
                        "@aws-sdk/client-athena",
                    ],
                },
                environment: lambdaEnvironment,
            });

        // Create EventBridge rule to route package events to Lambda
        const packageEventRule = new events.Rule(this, "TitanicUpdateEventRule", {
            description: "Route package revision events to merge tables Lambda",
            eventPattern: {
                source: ["com.quiltdata"],
                detailType: ["package-revision", "package-tag", "package-entry"],
                detail: {
                    type: ["created", "updated"],
                }
            },
        });

        // Add Lambda as target for EventBridge rule
        packageEventRule.addTarget(new targets.LambdaFunction(mergeLambda));

        // Grant Lambda permissions
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "glue:CreateDatabase",
                    "glue:CreateTable",
                    "glue:DeleteTable",
                    "glue:GetDatabase",
                    "glue:GetDatabases",
                    "glue:GetPartitions",
                    "glue:GetTable",
                    "glue:GetTables",
                    "glue:UpdateTable",
                ],
                resources: [
                    `arn:aws:glue:${this.region}:${this.account}:catalog`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${config.athenaDatabaseName}`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${s3DatabaseName}`,
                    `arn:aws:glue:${this.region}:${this.account}:table/${config.athenaDatabaseName}/*`,
                    `arn:aws:glue:${this.region}:${this.account}:table/${s3DatabaseName}/*`,
                ],
            }),
        );

        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetWorkGroup",
                    "athena:BatchGetQueryExecution"
                ],
                resources: [
                    `arn:aws:athena:${this.region}:${this.account}:workgroup/primary`,
                ],
            }),
        );

        // Always grant permissions to both buckets since Lambda decides which to use

        // Regular S3 bucket permissions (always used for Athena results, also for Glue tables)
        glueTablesBucket.grantReadWrite(mergeLambda);
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [glueTablesBucket.bucketArn],
            }),
        );

        // S3 Tables bucket permissions (used when USE_S3_TABLE=true)
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3tables:GetTable",
                    "s3tables:CreateTable",
                    "s3tables:PutTableData",
                    "s3tables:GetTableData",
                    "s3tables:UpdateTable",
                    "s3tables:DeleteTable",
                    "s3tables:ListTables",
                ],
                resources: [
                    `arn:aws:s3tables:${this.region}:${this.account}:bucket/${s3TablesBucketName}`,
                    `arn:aws:s3tables:${this.region}:${this.account}:bucket/${s3TablesBucketName}/*`,
                ],
            }),
        );

        // Grant S3 bucket location permission for S3 Tables bucket separately
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [`arn:aws:s3:::${s3TablesBucketName}`],
            }),
        );

        // Grant read access to source buckets via the provided policy
        mergeLambda.role?.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "TitanicGrantQuiltReadPolicy",
                config.quiltReadPolicyArn
            )
        );

        // Add stack outputs for easy access
        new cdk.CfnOutput(this, "LambdaFunctionName", {
            value: mergeLambda.functionName,
            description: "Name of the Titanic merge tables Lambda function"
        });

        new cdk.CfnOutput(this, "LambdaLogGroupName", {
            value: `/aws/lambda/${mergeLambda.functionName}`,
            description: "CloudWatch log group name for the Titanic merge tables Lambda"
        });

        new cdk.CfnOutput(this, "GlueTablesBucket", {
            value: glueTablesBucket.bucketName,
            description: "S3 bucket for Glue tables and Athena results"
        });

        new cdk.CfnOutput(this, "S3TablesBucket", {
            value: s3TablesBucketName,
            description: "S3 Tables bucket name"
        });

        new cdk.CfnOutput(this, "AssetsBucket", {
            value: assetsBucketName,
            description: isExternalDeployment 
                ? "S3 bucket hosting pre-built deployment assets and Lambda code (external)"
                : "S3 bucket hosting deployment assets and Lambda code (local)"
        });

        new cdk.CfnOutput(this, "AssetsBucketUrl", {
            value: `https://${assetsBucketName}.s3.amazonaws.com`,
            description: isExternalDeployment 
                ? "URL for the external assets bucket with pre-built assets"
                : "URL for the local assets bucket"
        });

        new cdk.CfnOutput(this, "SourceDatabaseName", {
            value: config.athenaDatabaseName,
            description: "Source Glue database name (where views are read from)"
        });

        new cdk.CfnOutput(this, "TargetDatabaseName", {
            value: config.useS3Table ? config.s3TableDatabaseName : config.athenaDatabaseName,
            description: "Target database name (where tables are written to)"
        });

    }

    private resolveConfiguration(props: TitanicStackProps) {
        const isExternalDeployment = props.externalDeployment ?? false;
        if (isExternalDeployment) {
            const parameters = this.createParameters();
            return {
                athenaDatabaseName: parameters.athenaDatabaseName.valueAsString,
                quiltReadPolicyArn: parameters.quiltReadPolicyArn.valueAsString,
                useS3Table: parameters.useS3Table.valueAsString === "true",
                s3TablesBucketName: parameters.s3TablesBucketName.valueAsString,
                publicAssetsBucketName: parameters.publicAssetsBucketName.valueAsString,
            };
        } else {
            // Validate required props when not using external deployment
            if (!props.athenaDatabaseName) {
                throw new Error("athenaDatabaseName is required when externalDeployment is false");
            }
            if (!props.quiltReadPolicyArn) {
                throw new Error("quiltReadPolicyArn is required when externalDeployment is false");
            }
            
            return {
                athenaDatabaseName: props.athenaDatabaseName,
                quiltReadPolicyArn: props.quiltReadPolicyArn,
                useS3Table: props.useS3Table ?? false,
            };
        }
    }

    private createParameters(): TitanicStackParameters {
        return {
            athenaDatabaseName: new cdk.CfnParameter(this, "AthenaDatabaseName", {
                type: "String",
                description: "Name of the Athena database containing the source views",
                default: process.env.ATHENA_DATABASE_NAME || "",
            }),

            quiltReadPolicyArn: new cdk.CfnParameter(this, "QuiltReadPolicyArn", {
                type: "String",
                description: "ARN of the IAM policy for reading from Quilt buckets",
                default: process.env.QUILT_READ_POLICY_ARN || "",
            }),

            useS3Table: new cdk.CfnParameter(this, "UseS3Table", {
                type: "String",
                description: "Whether to use S3 Tables format (true/false)",
                default: process.env.USE_S3_TABLE || "false",
                allowedValues: ["true", "false"],
            }),

            publicAssetsBucketName: new cdk.CfnParameter(this, "PublicAssetsBucketName", {
                type: "String",
                description: "Name of the S3 bucket containing pre-built deployment assets",
                default: process.env.PUBLIC_ASSETS_BUCKET_NAME || "",
            }),

            s3TablesBucketName: new cdk.CfnParameter(this, "S3TablesBucketName", {
                type: "String",
                description: "Name of the S3 Tables bucket (must exist already)",
                default: process.env.S3_TABLES_BUCKET_NAME || "",
            }),
        };
    }
}
