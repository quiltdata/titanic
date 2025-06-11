import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from 'dotenv';
import * as s3tables from '@aws-cdk/aws-s3tables-alpha';
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";

dotenv.config();

export interface TitanicStackProps extends cdk.StackProps {
    quiltDatabaseName: string;
    lambdaTimeout?: number;
    quiltReadPolicyArn: string;
    availabilityZone?: string;
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps) {
        super(scope, id, props);

        // Create the Titanic bucket as an S3 Table bucket
        const titanicBucket = new s3tables.TableBucket(this, "TitanicBucket", {
            tableBucketName: "your-bucket-name", // Provide a bucket name here
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create an SQS queue
        const mergeQueue = new sqs.Queue(this, "MergeQueue", {
            visibilityTimeout: cdk.Duration.minutes(15),
            queueName: "titanic-merge-queue",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create a Lambda function
        const mergeLambda = new lambda.NodejsFunction(this, "MergeLambda", {
            entry: path.join(__dirname, "merge-tables.ts"),
            handler: "handler",
            runtime: Runtime.NODEJS_18_X,
            timeout: props.lambdaTimeout
                ? cdk.Duration.seconds(props.lambdaTimeout)
                : cdk.Duration.seconds(15),
            environment: {
                DATABASE_NAME: props.quiltDatabaseName,
                TARGET_BUCKET: titanicBucket.tableBucketName,
                QUILT_READ_POLICY_ARN: props.quiltReadPolicyArn,
            },
        });

        // Add SQS event source to Lambda
        mergeLambda.addEventSource(new SqsEventSource(mergeQueue, { batchSize: 1 }));

        // Grant Lambda permissions
        const gluePolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "glue:GetTables",
                "glue:GetTable",
                "glue:GetPartitions",
                "glue:GetDatabase",
                "glue:CreateTable",
                "glue:DeleteTable",
                "glue:UpdateTable",
            ],
            resources: [
                `arn:aws:glue:${this.region}:${this.account}:catalog`,
                `arn:aws:glue:${this.region}:${this.account}:database/${props.quiltDatabaseName}`,
                `arn:aws:glue:${this.region}:${this.account}:table/${props.quiltDatabaseName}/*`,
            ],
        });

        const athenaPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "athena:StartQueryExecution",
                "athena:GetQueryExecution",
                "athena:GetWorkGroup",
                "athena:BatchGetQueryExecution",
            ],
            resources: [
                `arn:aws:athena:${this.region}:${this.account}:workgroup/primary`,
            ],
        });

        const s3Policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["s3:GetBucketLocation"],
            resources: ["*"],
        });

        const sqsPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage"],
            resources: [mergeQueue.queueArn],
        });

        mergeLambda.role?.attachInlinePolicy(
            new iam.Policy(this, "MergeLambdaPolicy", {
                statements: [gluePolicy, athenaPolicy, s3Policy, sqsPolicy],
            })
        );
    }
}
