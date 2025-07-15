#!/usr/bin/env node
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

new TitanicStack(app, "TitanicStack", {
    athenaDatabaseName: process.env.ATHENA_DATABASE_NAME,
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN,
    useS3Table: process.env.USE_S3_TABLE === "true",
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
 