import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from 'dotenv';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

dotenv.config();

export interface TitanicStackProps extends cdk.StackProps {
    quiltDatabaseName: string;
    lambdaTimeout?: number;
    quiltReadPolicyArn: string;
    athenaBucket: string;
    serviceBucket: string;
}

export class TitanicStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TitanicStackProps) {
        super(scope, id, props);

        // Use the provided serviceBucket name instead of creating a new bucket
        const serviceBucket = s3.Bucket.fromBucketName(this, "serviceBucket", props.serviceBucket);

        // Create merge tables Lambda
        const mergeLambda = new lambda.NodejsFunction(this, "MergeTables", {
            entry: path.join(__dirname, "merge-tables.ts"),
            handler: "handler",
            runtime: Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(900),
            bundling: {
                externalModules: [
                    "@aws-sdk/client-glue",
                    "@aws-sdk/client-athena",
                ],
                platform: "linux/amd64",
            },
            environment: {
                DATABASE_NAME: props.quiltDatabaseName,
                TARGET_BUCKET: props.serviceBucket,
                LAMBDA_TIMEOUT: (props.lambdaTimeout || 15000).toString(),
                QUILT_READ_POLICY_ARN: props.quiltReadPolicyArn,
                ATHENA_BUCKET: props.athenaBucket,
            },
        });

        // Grant Lambda permissions
        mergeLambda.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["glue:GetTables", "glue:GetTable", "glue:GetPartitions", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable", "glue:UpdateTable"],
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
                resources: [serviceBucket.bucketArn],
            }),
        );

        serviceBucket.grantReadWrite(mergeLambda);

        // Grant read access to source buckets via the provided policy
        if (props.quiltReadPolicyArn) {
            mergeLambda.role?.addManagedPolicy(
                iam.ManagedPolicy.fromManagedPolicyArn(
                    this,
                    "QuiltReadPolicy",
                    props.quiltReadPolicyArn
                )
            );
        }

        // Create CloudWatch event rule to trigger the Lambda
        const packageRevisionRule = new events.Rule(this, "PackageRevisionRule", {
            description: "Trigger Lambda on package-revision event",
            eventPattern: {
                source: ["com.quiltdata"],
                detailType: ["package-revision"],
            },
        });

        packageRevisionRule.addTarget(new targets.LambdaFunction(mergeLambda));
    }
}
