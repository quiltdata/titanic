import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from 'dotenv';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3tables from "@aws-cdk/aws-s3tables-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

dotenv.config();

const s3DatabaseName = "quilt_titanic";

export interface TitanicStackProps extends cdk.StackProps {
    quiltDatabaseName: string;
    lambdaTimeout?: number;
    quiltReadPolicyArn: string;
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps) {
        super(scope, id, props);

        // Check if we should use S3 Tables
        const useS3Table = process.env.USE_S3_TABLE === "true";
        
        // Source database (where views are) - always from QUILT_DATABASE_NAME
        const glueDatabaseName = process.env.QUILT_DATABASE_NAME || (() => { throw new Error("must set QUILT_DATABASE_NAME environment variable"); })();
        

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
            timeout: cdk.Duration.seconds(900),
            bundling: {
                externalModules: [
                    "@aws-sdk/client-glue",
                    "@aws-sdk/client-athena",
                ],
            },
            environment: {
                // Source database to read from (always the same, where views are)
                GLUE_DATABASE_NAME: glueDatabaseName,
                
                // Target database to write to (changes based on USE_S3_TABLE)
                S3TABLE_DATABASE_NAME: s3DatabaseName,
                
                // Target buckets - Always pass ARNs for consistency
                GLUE_TABLES_BUCKET_ARN: glueTablesBucket.bucketArn,
                S3_TABLES_BUCKET_ARN: s3TablesBucket.tableBucketArn,
                
                // Always use regular bucket for Athena results (ARN format)
                ATHENA_RESULTS_BUCKET_ARN: glueTablesBucket.bucketArn,
                
                // Configuration
                LAMBDA_TIMEOUT: (props.lambdaTimeout || 15000).toString(),
                QUILT_READ_POLICY_ARN: props.quiltReadPolicyArn,
                USE_S3_TABLE: useS3Table.toString(),
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
                    "s3:GetBucketLocation",
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

        // Grant read access to source buckets via the provided policy
        mergeLambda.role?.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "TitanicGrantQuiltReadPolicy",
                props.quiltReadPolicyArn
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
