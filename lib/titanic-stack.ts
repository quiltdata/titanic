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
    parameterDefaults?: {
        athenaDatabaseName?: string;
        quiltReadPolicyArn?: string;
        useS3Table?: boolean;
        publicAssetsBucketName?: string;
        s3TablesBucketName?: string;
        glueTablesBucketName?: string;
    };
    externalDeployment?: boolean;  // Flag for third-party deployments (uses parameters and pre-built assets)
}

interface TitanicStackParameters {
    athenaDatabaseName: cdk.CfnParameter;
    quiltReadPolicyArn: cdk.CfnParameter;
    useS3Table: cdk.CfnParameter;
    publicAssetsBucketName: cdk.CfnParameter;
    s3TablesBucketName: cdk.CfnParameter;
    glueTablesBucketName: cdk.CfnParameter;
}

export class TitanicStack extends cdk.Stack {
    protected parameters: TitanicStackParameters;

    constructor(scope: Construct, id: string, props: TitanicStackProps = {}) {
        super(scope, id, props);

        // Always create CloudFormation parameters
        this.parameters = this.createParameters(props.parameterDefaults);

        // Create config instance using parameter values
        const config = Config.createFromStack(this.account, this.region, {
            athenaDatabaseName: this.parameters.athenaDatabaseName.valueAsString,
            quiltReadPolicyArn: this.parameters.quiltReadPolicyArn.valueAsString,
            useS3Table: this.parameters.useS3Table.valueAsString === "true",
        });
        
        console.log("TitanicStack configuration:", {
            account: this.account,
            region: this.region,
            athenaDatabaseName: config.athenaDatabaseName,
            useS3Table: config.useS3Table,
            externalDeployment: props.externalDeployment ?? false
        });

        // Get standardized names using Config class
        const s3DatabaseName = config.s3TableDatabaseName;

        // Create buckets using overridable method
        const { glueTablesBucket, s3TablesBucketName, assetsBucketName } = this.createBuckets(config);

        // Create Lambda environment configuration
        const lambdaEnvironment = {
            // Source database to read from (always the same, where views are)
            ATHENA_DATABASE_NAME: this.parameters.athenaDatabaseName.valueAsString,

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
            QUILT_READ_POLICY_ARN: this.parameters.quiltReadPolicyArn.valueAsString,
            USE_S3_TABLE: this.parameters.useS3Table.valueAsString,
        };

        // Create Lambda using overridable method
        const { mergeLambda, lambdaRole } = this.createLambda(assetsBucketName, lambdaEnvironment);

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
        this.grantLambdaPermissions(lambdaRole, config, s3DatabaseName, glueTablesBucket, s3TablesBucketName);

        // Add stack outputs
        this.addStackOutputs(mergeLambda, glueTablesBucket, s3TablesBucketName, assetsBucketName, config);
    }

    protected createBuckets(config: Config): { 
        glueTablesBucket: s3.Bucket; 
        s3TablesBucketName: string; 
        assetsBucketName: string; 
    } {
        // Use parameter value for bucket name if provided, otherwise generate dynamically
        const glueTablesBucketName = this.parameters.glueTablesBucketName.valueAsString || 
                                   config.generateGlueTablesBucketNameRef();
        
        // Internal deployment: create all buckets
        const glueTablesBucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
            bucketName: glueTablesBucketName,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        
        // Use parameter value for S3 Tables bucket name if provided, otherwise generate dynamically
        const s3TablesBucketName = this.parameters.s3TablesBucketName.valueAsString || 
                                 config.generateS3TablesBucketNameRef();
        
        // Create an S3 Tables bucket for internal use
        const _s3TablesBucket = new s3tables.TableBucket(this, "TitanicS3TablesBucket", {
            tableBucketName: s3TablesBucketName,
        });
        
        // Use parameter value for assets bucket name if provided, otherwise generate dynamically
        const assetsBucketName = this.parameters.publicAssetsBucketName.valueAsString || 
                               config.generateAssetsBucketNameRef();
        
        // Create an assets bucket for deployment assets and Lambda code
        const _assetsBucket = new s3.Bucket(this, "TitanicAssetsBucket", {
            bucketName: assetsBucketName,
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

        return { glueTablesBucket, s3TablesBucketName, assetsBucketName };
    }

    protected createLambda(
        assetsBucketName: string, 
        lambdaEnvironment: Record<string, string>
    ): { mergeLambda: lambda.IFunction; lambdaRole: iam.IRole } {
        // Internal deployment uses NodejsFunction
        const nodejsLambda = new lambdaNodejs.NodejsFunction(this, "TitanicMergeTables", {
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
        
        return { mergeLambda: nodejsLambda, lambdaRole: nodejsLambda.role! };
    }

    private grantLambdaPermissions(
        lambdaRole: iam.IRole, 
        config: Config, 
        s3DatabaseName: string, 
        glueTablesBucket: s3.Bucket, 
        s3TablesBucketName: string
    ) {
        lambdaRole.addToPrincipalPolicy(
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

        lambdaRole.addToPrincipalPolicy(
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
        glueTablesBucket.grantReadWrite(lambdaRole);
        lambdaRole.addToPrincipalPolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [glueTablesBucket.bucketArn],
            }),
        );

        // S3 Tables bucket permissions (used when USE_S3_TABLE=true)
        lambdaRole.addToPrincipalPolicy(
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
        lambdaRole.addToPrincipalPolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [`arn:aws:s3:::${s3TablesBucketName}`],
            }),
        );

        // Grant read access to source buckets via the provided policy
        lambdaRole.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "TitanicGrantQuiltReadPolicy",
                config.quiltReadPolicyArn
            )
        );
    }

    protected getAssetsBucketDescription(): string {
        return "S3 bucket hosting deployment assets and Lambda code (local)";
    }

    protected getAssetsBucketUrlDescription(): string {
        return "URL for the local assets bucket";
    }

    private addStackOutputs(
        mergeLambda: lambda.IFunction, 
        glueTablesBucket: s3.Bucket, 
        s3TablesBucketName: string, 
        assetsBucketName: string, 
        config: Config
    ) {
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
            description: this.getAssetsBucketDescription()
        });

        new cdk.CfnOutput(this, "AssetsBucketUrl", {
            value: `https://${assetsBucketName}.s3.amazonaws.com`,
            description: this.getAssetsBucketUrlDescription()
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

    private createParameters(parameterDefaults?: TitanicStackProps['parameterDefaults']): TitanicStackParameters {
        return {
            athenaDatabaseName: new cdk.CfnParameter(this, "AthenaDatabaseName", {
                type: "String",
                description: "Name of the Athena database containing the source views",
                default: parameterDefaults?.athenaDatabaseName || "",
            }),

            quiltReadPolicyArn: new cdk.CfnParameter(this, "QuiltReadPolicyArn", {
                type: "String",
                description: "ARN of the IAM policy for reading from Quilt buckets",
                default: parameterDefaults?.quiltReadPolicyArn || "",
            }),

            useS3Table: new cdk.CfnParameter(this, "UseS3Table", {
                type: "String",
                description: "Whether to use S3 Tables format (true/false)",
                default: (parameterDefaults?.useS3Table ?? false).toString(),
                allowedValues: ["true", "false"],
            }),

            publicAssetsBucketName: new cdk.CfnParameter(this, "PublicAssetsBucketName", {
                type: "String",
                description: "Name of the S3 bucket containing pre-built deployment assets",
                default: parameterDefaults?.publicAssetsBucketName || "",
            }),

            s3TablesBucketName: new cdk.CfnParameter(this, "S3TablesBucketName", {
                type: "String",
                description: "Name of the S3 Tables bucket (must exist already)",
                default: parameterDefaults?.s3TablesBucketName || "",
            }),

            glueTablesBucketName: new cdk.CfnParameter(this, "GlueTablesBucketName", {
                type: "String",
                description: "Name of the Glue tables bucket (will be created if not specified)",
                default: parameterDefaults?.glueTablesBucketName || "",
            }),
        };
    }
}
