import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3tables from "@aws-cdk/aws-s3tables-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

const s3DatabaseName = "quilt_titanic";

export interface TitanicStackProps extends cdk.StackProps {
    glueDatabaseName?: string;
    quiltReadPolicyArn?: string;
    useS3Table?: boolean;
    lambdaTimeout?: number;
    useCloudFormationParameters?: boolean;  // Flag to enable parameter mode
}

interface TitanicStackParameters {
    glueDatabaseName: cdk.CfnParameter;
    quiltReadPolicyArn: cdk.CfnParameter;
    useS3Table: cdk.CfnParameter;
    lambdaTimeout: cdk.CfnParameter;
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps = {}) {
        super(scope, id, props);

        const useCloudFormationParameters = props.useCloudFormationParameters ?? false;

        // Create CloudFormation parameters if needed
        let parameters: TitanicStackParameters | undefined;
        
        if (useCloudFormationParameters) {
            parameters = {
                glueDatabaseName: new cdk.CfnParameter(this, "GlueDatabaseName", {
                    type: "String",
                    description: "Name of the Glue database containing the source views",
                    default: process.env.QUILT_DATABASE_NAME || "",
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
                
                lambdaTimeout: new cdk.CfnParameter(this, "LambdaTimeout", {
                    type: "Number",
                    description: "Lambda function timeout in seconds",
                    default: parseInt(process.env.LAMBDA_TIMEOUT || "900"),
                    minValue: 1,
                    maxValue: 900,
                }),
            };
        }

        // Get values from either props or parameters
        const glueDatabaseName = useCloudFormationParameters 
            ? parameters!.glueDatabaseName.valueAsString 
            : props.glueDatabaseName!;
        
        const quiltReadPolicyArn = useCloudFormationParameters 
            ? parameters!.quiltReadPolicyArn.valueAsString 
            : props.quiltReadPolicyArn!;
        
        const useS3Table = useCloudFormationParameters 
            ? parameters!.useS3Table.valueAsString === "true" 
            : (props.useS3Table ?? false);
        
        const lambdaTimeout = useCloudFormationParameters 
            ? parameters!.lambdaTimeout.valueAsNumber 
            : (props.lambdaTimeout || 900);
        

        // Always create both buckets for maximum flexibility
        
        // Regular S3 bucket for Athena results and Glue tables
        const glueTablesBucket = new s3.Bucket(this, "TitanicGlueTablesBucket", {
            bucketName: `titanic-glue-tables-${this.account}-${this.region}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // S3 Tables bucket for S3 Tables format
        const s3TablesBucket = new s3tables.TableBucket(this, "TitanicS3TablesBucket", {
            tableBucketName: `titanic-s3-tables-${this.account}-${this.region}`,
        });

        // Create merge tables Lambda
        const mergeLambda = new lambda.NodejsFunction(this, "TitanicMergeTables", {
            entry: path.join(__dirname, "merge-tables.ts"),
            handler: "handler",
            runtime: Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(lambdaTimeout),
            bundling: {
                externalModules: [
                    "@aws-sdk/client-glue",
                    "@aws-sdk/client-athena",
                ],
            },
            environment: {
                // Source database to read from (always the same, where views are)
                GLUE_DATABASE_NAME: useCloudFormationParameters 
                    ? parameters!.glueDatabaseName.valueAsString 
                    : glueDatabaseName,
                
                // Target database to write to (changes based on USE_S3_TABLE)
                S3TABLE_DATABASE_NAME: s3DatabaseName,
                
                // Target buckets - Always pass ARNs for consistency
                GLUE_TABLES_BUCKET_ARN: glueTablesBucket.bucketArn,
                S3_TABLES_BUCKET_ARN: s3TablesBucket.tableBucketArn,
                
                // Always use regular bucket for Athena results (ARN format)
                ATHENA_RESULTS_BUCKET_ARN: glueTablesBucket.bucketArn,
                
                // Configuration
                LAMBDA_TIMEOUT: useCloudFormationParameters 
                    ? parameters!.lambdaTimeout.valueAsString 
                    : lambdaTimeout.toString(),
                QUILT_READ_POLICY_ARN: useCloudFormationParameters 
                    ? parameters!.quiltReadPolicyArn.valueAsString 
                    : quiltReadPolicyArn,
                USE_S3_TABLE: useCloudFormationParameters 
                    ? parameters!.useS3Table.valueAsString 
                    : useS3Table.toString(),
            },
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
                actions: ["glue:GetTables", "glue:GetTable", "glue:GetPartitions", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable", "glue:UpdateTable"],
                resources: [
                    `arn:aws:glue:${this.region}:${this.account}:catalog`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${glueDatabaseName}`,
                    `arn:aws:glue:${this.region}:${this.account}:table/${glueDatabaseName}/*`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${s3DatabaseName}`,
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
                    s3TablesBucket.tableBucketArn,
                    `${s3TablesBucket.tableBucketArn}/*`,
                ],
            }),
        );

        // Grant S3 bucket location permission for S3 Tables bucket separately
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [s3TablesBucket.tableBucketArn],
            }),
        );

        // Grant read access to source buckets via the provided policy
        mergeLambda.role?.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "TitanicGrantQuiltReadPolicy",
                quiltReadPolicyArn
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
            value: s3TablesBucket.tableBucketName,
            description: "S3 Tables bucket name"
        });

        new cdk.CfnOutput(this, "SourceDatabaseName", {
            value: glueDatabaseName,
            description: "Source Glue database name (where views are read from)"
        });

        new cdk.CfnOutput(this, "TargetDatabaseName", {
            value: useS3Table ? s3DatabaseName : glueDatabaseName,
            description: "Target database name (where tables are written to)"
        });

    }
}
