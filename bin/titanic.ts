#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { TitanicStack } from "../lib/titanic-stack";

const app = new cdk.App();

// Ensure required environment variables are set
if (!process.env.ATHENA_DATABASE_NAME) {
    throw new Error("Environment variable ATHENA_DATABASE_NAME is not set");
}
if (!process.env.QUILT_READ_POLICY_ARN) {
    throw new Error("Environment variable QUILT_READ_POLICY_ARN is not set");
}

const useS3Table = process.env.USE_S3_TABLE === "true";
new TitanicStack(app, "TitanicStack", {
    athenaDatabaseName: process.env.ATHENA_DATABASE_NAME,
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN,
    useS3Table: useS3Table,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
// if (useS3Table), explain how to call npm run create-s3-tables to create the namespace and tables
if (useS3Table) {
    console.log("⚠️  USE_S3_TABLE is set to true. After deployment, run 'npm run create-s3-tables' to create the S3 Tables namespace and tables.");
    console.log("   Make sure AWS CLI is configured with appropriate permissions.");
}
