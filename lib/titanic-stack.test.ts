import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "./titanic-stack";

describe("TitanicStack", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        // Reset environment variables
        process.env = { ...originalEnv };
        delete process.env.USE_S3_TABLE;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe("Iceberg mode (default)", () => {
        const app = new cdk.App();
        const stack = new TitanicStack(app, "TestStack", {
            quiltDatabaseName: "test-database",
            quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
        });
        const template = Template.fromStack(stack);

        it("creates a single S3 bucket for Iceberg mode", () => {
            template.hasResource("AWS::S3::Bucket", {
                DeletionPolicy: "Delete",
                UpdateReplacePolicy: "Delete",
            });
            
            // Should not create S3 Tables bucket
            template.resourceCountIs("AWS::S3Tables::TableBucket", 0);
        });

        it("creates Lambda with USE_S3_TABLE=false", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        DATABASE_NAME: "test-database",
                        USE_S3_TABLE: "false",
                        QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                    },
                },
            });
        });
    });

    describe("S3 Tables mode", () => {
        const app = new cdk.App();
        
        // Set environment variable for S3 Tables mode
        process.env.USE_S3_TABLE = "true";
        
        const stack = new TitanicStack(app, "S3TablesStack", {
            quiltDatabaseName: "test-database",
            quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
        });
        const template = Template.fromStack(stack);

        it("creates both S3 TableBucket and regular S3 bucket", () => {
            // Should create regular S3 bucket
            template.hasResource("AWS::S3::Bucket", {
                DeletionPolicy: "Delete",
                UpdateReplacePolicy: "Delete",
            });
            
            // Should create S3 Tables bucket
            template.hasResourceProperties("AWS::S3Tables::TableBucket", {
                TableBucketName: {
                    "Fn::Join": ["", ["titanic-tables-", {"Ref": "AWS::AccountId"}, "-", {"Ref": "AWS::Region"}]]
                }
            });
        });

        it("creates Lambda with USE_S3_TABLE=true and S3 Tables permissions", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        DATABASE_NAME: "test-database",
                        USE_S3_TABLE: "true",
                        QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                    },
                },
            });

            // Check for S3 Tables permissions
            const policies = template.findResources("AWS::IAM::Policy");
            const policy = Object.values(policies)[0];
            const statements = policy.Properties.PolicyDocument.Statement;
            
            expect(statements).toContainEqual(
                expect.objectContaining({
                    Action: expect.arrayContaining([
                        "s3tables:GetTable",
                        "s3tables:CreateTable", 
                        "s3tables:PutTableData",
                        "s3tables:GetTableData",
                        "s3tables:UpdateTable",
                        "s3tables:DeleteTable",
                        "s3tables:ListTables",
                    ]),
                    Effect: "Allow"
                })
            );
        });
    });

    describe("shared tests", () => {
        const app = new cdk.App();
        const stack = new TitanicStack(app, "TestStack", {
            quiltDatabaseName: "test-database",
            quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
        });
        const template = Template.fromStack(stack);

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
            const ruleProps = Object.values(rules)[0].Properties as any;
            
            expect(ruleProps.Targets).toHaveLength(1);
            expect(ruleProps.Targets[0]).toHaveProperty("Arn");
            expect(ruleProps.Targets[0].Arn).toHaveProperty("Fn::GetAtt");
            expect(ruleProps.Targets[0].Arn["Fn::GetAtt"][1]).toBe("Arn");
        });

        it("creates required IAM policies", () => {
            const policyProps = template.findResources("AWS::IAM::Policy");
            const policy = Object.values(policyProps)[0] as any;

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
            const policy = Object.values(policies)[0] as any;
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

            // Check S3 bucket location permission (it's now combined with S3 Tables permissions)
            expect(statements).toContainEqual(
                expect.objectContaining({
                    Action: expect.arrayContaining(["s3:GetBucketLocation"]),
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
});
