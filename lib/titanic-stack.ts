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
import { ConfigStack, TitanicStackProps } from "./shared/config-stack";

export type { TitanicStackProps } from "./shared/config-stack";

export class TitanicStack extends cdk.Stack {
    protected config: ConfigStack;

    constructor(scope: Construct, id: string, props: TitanicStackProps = {}) {
        super(scope, id, props);

        // Create ConfigStack which handles parameters internally
        this.config = ConfigStack.createForStack(this, props);

        console.log("TitanicStack configuration:", {
            account: this.account,
            region: this.region,
            athenaDatabaseName: this.config.athenaDatabaseName,
            useS3Table: this.config.useS3Table,
            externalDeployment: props.externalDeployment ?? false
        });

        // Get standardized names using ConfigStack class
        const s3DatabaseName = this.config.s3TableDatabaseName;

        // Create Lambda role first to make dependencies explicit
        const lambdaRole = this.createLambdaRole();

        // Create buckets and grant permissions immediately (passing role explicitly)
        const { glueTablesBucket, s3TablesBucketName, assetsBucketName } = this.createBuckets(lambdaRole);

        // Generate Lambda environment configuration using ConfigStack
        const lambdaEnvironment = this.config.generateLambdaEnvironment(
            glueTablesBucket.bucketName,
            s3TablesBucketName
        );

        // Create Lambda function with existing role (passing role explicitly)
        const mergeLambda = this.createLambdaFunction(assetsBucketName, lambdaEnvironment, lambdaRole);

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

        // Grant non-bucket Lambda permissions (bucket permissions handled during bucket creation)
        this.grantNonBucketLambdaPermissions(lambdaRole, this.config, s3DatabaseName);

        // Add stack outputs
        this.addStackOutputs(mergeLambda, glueTablesBucket, s3TablesBucketName, assetsBucketName, this.config);
    }

    protected createLambdaRole(): iam.Role {
        return new iam.Role(this, "TitanicLambdaRole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
            ],
        });
    }

    protected createBuckets(lambdaRole: iam.IRole): { 
        glueTablesBucket: s3.Bucket; 
        s3TablesBucketName: string; 
        assetsBucketName: string; 
    } {
        const glueTablesBucket = this.createGlueTablesBucket(lambdaRole);
        const s3TablesBucketName = this.config.useS3Table
            ? this.createS3TablesBucket(lambdaRole)
            : this.referenceS3TablesBucket(lambdaRole);
        const assetsBucketName = this.createOrReferenceAssetsBucket();

        return { glueTablesBucket, s3TablesBucketName, assetsBucketName };
    }

    protected createGlueTablesBucket(lambdaRole: iam.IRole): s3.Bucket {
        const bucketName = this.config.generateGlueTablesBucketNameRef() as string;
        const bucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
            bucketName,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: false,
        });

        // Grant bucket permissions immediately
        bucket.grantReadWrite(lambdaRole);
        lambdaRole.addToPrincipalPolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [bucket.bucketArn],
            }),
        );

        return bucket;
    }

    protected referenceS3TablesBucket(_lambdaRole: iam.IRole): string {
        // External deployment: only generate bucket name reference (don't create bucket)
        const bucketName = this.config.generateS3TablesBucketNameRef() as string;
        return bucketName;
    }

    protected createS3TablesBucket(lambdaRole: iam.IRole): string {
        const bucketName = this.config.generateS3TablesBucketNameRef() as string;
        
        // Create an S3 Tables bucket for internal use
        const _s3TablesBucket = new s3tables.TableBucket(this, "TitanicS3TablesBucket", {
            tableBucketName: bucketName,
        });

        // Grant S3 Tables permissions immediately
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
                    this.localPolicy("s3tables", `bucket/${bucketName}`),
                    this.localPolicy("s3tables", `bucket/${bucketName}/*`),
                ],
            }),
        );

        // Grant S3 bucket location permission for S3 Tables bucket
        lambdaRole.addToPrincipalPolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [`arn:aws:s3:::${bucketName}`],
            }),
        );
        
        return bucketName;
    }

    protected createOrReferenceAssetsBucket(): string {
        const bucketName = this.config.generateAssetsBucketNameRef() as string;
        
        // Create an assets bucket for deployment assets and Lambda code
        const _assetsBucket = new s3.Bucket(this, "TitanicAssetsBucket", {
            bucketName,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: false,
            publicReadAccess: true, // Make bucket objects publicly readable
            blockPublicAccess: new s3.BlockPublicAccess({
                blockPublicAcls: false,
                blockPublicPolicy: false,
                ignorePublicAcls: false,
                restrictPublicBuckets: false,
            }), // Allow completely open public access
        });

        return bucketName;
    }

    protected createLambdaFunction(
        assetsBucketName: string, 
        lambdaEnvironment: Record<string, string>,
        lambdaRole: iam.IRole
    ): lambda.IFunction {
        // Internal deployment uses NodejsFunction with explicit role
        return new lambdaNodejs.NodejsFunction(this, "TitanicMergeTables", {
            entry: path.join(__dirname, "merge-tables.ts"),
            handler: "handler",
            runtime: Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(900),
            role: lambdaRole, // Use the explicitly passed role
            bundling: {
                externalModules: [
                    "@aws-sdk/client-glue",
                    "@aws-sdk/client-athena",
                ],
            },
            environment: lambdaEnvironment,
        });
    }

    protected localPolicy(prefix: string, suffix: string): string {
        return cdk.Fn.join(":", [
            "arn:aws",
            prefix,
            cdk.Aws.REGION,
            cdk.Aws.ACCOUNT_ID,
            suffix
        ]);
    }

    private grantNonBucketLambdaPermissions(
        lambdaRole: iam.IRole, 
        config: ConfigStack, 
        s3DatabaseName: string
    ) {
        // Grant Glue permissions
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
                    this.localPolicy("glue", "catalog"),
                    this.localPolicy("glue", `database/${config.athenaDatabaseName}`),
                    this.localPolicy("glue", `database/${s3DatabaseName}`),
                    this.localPolicy("glue", `table/${config.athenaDatabaseName}/*`),
                    this.localPolicy("glue", `table/${s3DatabaseName}/*`),
                ],
            }),
        );

        // Grant Athena permissions
        lambdaRole.addToPrincipalPolicy(
            new iam.PolicyStatement({
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetWorkGroup",
                    "athena:BatchGetQueryExecution"
                ],
                resources: [
                    this.localPolicy("athena", "workgroup/primary"),
                ],
            }),
        );

        // Grant read access to source buckets via the provided policy
        lambdaRole.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "TitanicGrantQuiltReadPolicy",
                config.getQuiltReadPolicyArn()
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
        config: ConfigStack
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
}
