import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from 'dotenv';
import * as s3 from "aws-cdk-lib/aws-s3";
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
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps) {
        super(scope, id, props);

        // Create the Titanic bucket
        const titanicBucket = new s3.Bucket(this, "TitanicBucket", {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Create SQS queue
        const mergeQueue = new sqs.Queue(this, "MergeQueue", {
            visibilityTimeout: cdk.Duration.seconds(900),
            retentionPeriod: cdk.Duration.days(14),
        });

        // Create merge tables Lambda
        const mergeLambda = new lambda.NodejsFunction(this, "MergeTables", {
            events: [
                new SqsEventSource(mergeQueue, {
                    batchSize: 1,
                }),
            ],
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
                DATABASE_NAME: props.quiltDatabaseName,
                TARGET_BUCKET: titanicBucket.bucketName,
                LAMBDA_TIMEOUT: (props.lambdaTimeout || 5000).toString(),
                QUEUE_URL: mergeQueue.queueUrl,
                QUILT_READ_POLICY_ARN: props.quiltReadPolicyArn,
            },
        });

        // Grant Lambda permissions
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["glue:GetTables", "glue:GetTable", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable", "glue:UpdateTable"],
                resources: [
                    `arn:aws:glue:${this.region}:${this.account}:catalog`,
                    `arn:aws:glue:${this.region}:${this.account}:database/${props.quiltDatabaseName}`,
                    `arn:aws:glue:${this.region}:${this.account}:table/${props.quiltDatabaseName}/*`,
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

        // Add explicit S3 bucket location permission
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetBucketLocation"],
                resources: [titanicBucket.bucketArn],
            }),
        );

        titanicBucket.grantReadWrite(mergeLambda);
        mergeQueue.grantConsumeMessages(mergeLambda);

        // Grant read access to source buckets via the provided policy
        mergeLambda.role?.addManagedPolicy(
            iam.ManagedPolicy.fromManagedPolicyArn(
                this,
                "QuiltReadPolicy",
                props.quiltReadPolicyArn
            )
        );


    }
}
