#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TitanicStack } from "../lib/titanic-stack";

const app = new cdk.App();

// Ensure required environment variables are set
if (!process.env.QUILT_DATABASE_NAME) {
    throw new Error("must set QUILT_DATABASE_NAME environment variable");
}
if (!process.env.QUILT_READ_POLICY_ARN) {
    throw new Error("must set QUILT_READ_POLICY_ARN environment variable");
}

new TitanicStack(app, "TitanicStack", {
    quiltDatabaseName: process.env.QUILT_DATABASE_NAME,
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
 