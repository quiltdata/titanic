import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "../lib/titanic-stack";

describe("TitanicStack", () => {
    const app = new cdk.App();
    const stack = new TitanicStack(app, "TestStack", {
        quiltDatabaseName: "test-database",
        quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
    });
    const template = Template.fromStack(stack);

    it("creates an S3 bucket", () => {
        template.hasResource("AWS::S3::Bucket", {
            DeletionPolicy: "Delete",
            UpdateReplacePolicy: "Delete",
        });
    });

    it("creates a Lambda function", () => {
        template.hasResourceProperties("AWS::Lambda::Function", {
            Environment: {
                Variables: {
                    DATABASE_NAME: "test-database",
                    QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                },
            },
        });
    });

    it("creates required IAM policies", () => {
        const policyProps = template.findResources("AWS::IAM::Policy");
        const policy = Object.values(policyProps)[0];

        const policyDoc = policy.Properties.PolicyDocument;
        expect(policyDoc.Version).toBe("2012-10-17");
        expect(policyDoc.Statement).toContainEqual(
            expect.objectContaining({
                Effect: "Allow",
                Action: ["glue:GetTables", "glue:GetTable", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable"],
                Resource: expect.arrayContaining([
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":catalog"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":database/test-database"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":table/test-database/*"])]
                    })
                ])
            })
        );
    });

    it("should pass environment variables to Lambda when provided", () => {
        const debugApp = new cdk.App();
        const debugStack = new TitanicStack(debugApp, "DebugStack", {
            quiltDatabaseName: "test-database",
            quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
            lambdaTimeout: 10000,
        });
        const debugTemplate = Template.fromStack(debugStack);

        debugTemplate.hasResourceProperties("AWS::Lambda::Function", {
            Environment: {
                Variables: {
                    DATABASE_NAME: "test-database",
                    LAMBDA_TIMEOUT: "10000",
                },
            },
        });
    });

});
