#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TitanicStack } from "../lib/titanic-stack";

const app = new cdk.App();

const athenaBucket = process.env.ATHENA_BUCKET;
const serviceBucket = process.env.SERVICE_BUCKET;

if (!athenaBucket) {
    throw new Error("ATHENA_BUCKET environment variable is not defined");
}
if (!serviceBucket) {
    throw new Error("SERVICE_BUCKET environment variable is not defined");
}

new TitanicStack(app, "TitanicStack", {
    quiltDatabaseName: process.env.QUILT_DATABASE_NAME || "userathenadatabase",
    quiltReadPolicyArn: process.env.QUILT_READ_POLICY_ARN || "",
    athenaBucket: athenaBucket,
    serviceBucket: serviceBucket,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
