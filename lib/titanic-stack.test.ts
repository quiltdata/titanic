import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "./titanic-stack";

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

    it("creates EventBridge rule with correct event pattern", () => {
        template.hasResourceProperties("AWS::Events::Rule", {
            Description: "Route package revision events to merge tables Lambda",
            EventPattern: {
                source: ["com.quiltdata"],
                "detail-type": ["package-revision", "package-tag", "package-entry"],
                detail: {
                    type: ["created", "updated"],
                }
            },
        });
    });

    it("creates Lambda function with EventBridge trigger", () => {
        template.hasResourceProperties("AWS::Lambda::Function", {
            Environment: {
                Variables: {
                    DATABASE_NAME: "test-database",
                    LAMBDA_TIMEOUT: "15000",
                    QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                },
            },
        });

        // Check that EventBridge rule exists and has Lambda targets
        const rules = template.findResources("AWS::Events::Rule");
        const ruleProps = Object.values(rules)[0].Properties;
        
        expect(ruleProps.Targets).toHaveLength(1);
        expect(ruleProps.Targets[0]).toHaveProperty("Arn");
        expect(ruleProps.Targets[0].Arn).toHaveProperty("Fn::GetAtt");
        expect(ruleProps.Targets[0].Arn["Fn::GetAtt"][1]).toBe("Arn");
    });

    it("creates required IAM policies", () => {
        const policyProps = template.findResources("AWS::IAM::Policy");
        const policy = Object.values(policyProps)[0];

        const policyDoc = policy.Properties.PolicyDocument;
        expect(policyDoc.Version).toBe("2012-10-17");
        expect(policyDoc.Statement).toContainEqual(
            expect.objectContaining({
                Effect: "Allow",
                Action: ["glue:GetTables", "glue:GetTable", "glue:GetPartitions", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable", "glue:UpdateTable"],
                Resource: [
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":catalog"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":database/test-database"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":table/test-database/*"])]
                    })
                ]
            })
        );
    });

    it("creates Lambda with required Athena permissions", () => {
        const policies = template.findResources("AWS::IAM::Policy");
        const policy = Object.values(policies)[0];
        const statements = policy.Properties.PolicyDocument.Statement;
        
        // Check Athena permissions
        expect(statements).toContainEqual(
            expect.objectContaining({
                Action: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetWorkGroup",
                    "athena:BatchGetQueryExecution"
                ],
                Effect: "Allow",
                Resource: {
                    "Fn::Join": ["", ["arn:aws:athena:", {"Ref": "AWS::Region"}, ":", {"Ref": "AWS::AccountId"}, ":workgroup/primary"]]
                }
            })
        );

        // Check S3 bucket location permission
        expect(statements).toContainEqual(
            expect.objectContaining({
                Action: "s3:GetBucketLocation",
                Effect: "Allow"
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
