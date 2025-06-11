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

        // ... rest of the code ...
    }
}
