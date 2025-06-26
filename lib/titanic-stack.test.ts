import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "./titanic-stack";

describe("TitanicStack", () => {
    const originalEnv = process.env;
    const defaultStackProps = {
        quiltDatabaseName: "test-database",
        quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
    };

    afterAll(() => {
        process.env = originalEnv;
    });

    describe("Shared functionality (mode-independent)", () => {
        describe.each([
            { mode: "Iceberg", useS3Table: false, stackId: "SharedIcebergStack" },
            { mode: "S3 Tables", useS3Table: true, stackId: "SharedS3TablesStack" }
        ])("$mode mode", ({ mode, useS3Table, stackId }) => {
            let template: Template;

            beforeAll(() => {
                process.env = { ...originalEnv };
                if (useS3Table) {
                    process.env.USE_S3_TABLE = "true";
                } else {
                    delete process.env.USE_S3_TABLE;
                }
                delete process.env.QUILT_DATABASE_NAME; // Clear this to ensure clean test
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, stackId, defaultStackProps);
                template = Template.fromStack(stack);
            });

            it("should create regular S3 bucket with correct properties", () => {
                template.hasResource("AWS::S3::Bucket", {
                    DeletionPolicy: "Delete",
                    UpdateReplacePolicy: "Delete",
                });
            });

            it("should create EventBridge rule with correct event pattern", () => {
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

            it("should grant required Athena permissions", () => {
                const policies = template.findResources("AWS::IAM::Policy");
                const policy = Object.values(policies)[0] as any;
                const statements = policy.Properties.PolicyDocument.Statement;
                
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
            });

            it("should grant required Glue permissions", () => {
                const policies = template.findResources("AWS::IAM::Policy");
                const policy = Object.values(policies)[0] as any;
                const statements = policy.Properties.PolicyDocument.Statement;
                
                expect(statements).toContainEqual(
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
        });

        it("should support custom Lambda timeout configuration", () => {
            // Test with Iceberg mode (default)
            process.env = { ...originalEnv };
            delete process.env.USE_S3_TABLE;
            delete process.env.QUILT_DATABASE_NAME; // Clear this to ensure clean test
            
            const app = new cdk.App();
            const stack = new TitanicStack(app, "CustomTimeoutStack", {
                ...defaultStackProps,
                lambdaTimeout: 10000,
            });
            const customTemplate = Template.fromStack(stack);

            customTemplate.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        DATABASE_NAME: "test-database",
                        LAMBDA_TIMEOUT: "10000",
                    },
                },
            });
        });
    });

    describe("Iceberg mode (default)", () => {
        let template: Template;

        beforeAll(() => {
            // Reset environment variables for Iceberg mode
            process.env = { ...originalEnv };
            delete process.env.USE_S3_TABLE;
            delete process.env.QUILT_DATABASE_NAME; // Clear this to ensure clean test
            
            const app = new cdk.App();
            const stack = new TitanicStack(app, "IcebergStack", defaultStackProps);
            template = Template.fromStack(stack);
        });

        it("should not create S3 Tables resources", () => {
            template.resourceCountIs("AWS::S3Tables::TableBucket", 0);
        });

        it("should configure Lambda function with Iceberg-specific settings", () => {
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

        it("should grant S3 bucket location permissions (standalone)", () => {
            const policies = template.findResources("AWS::IAM::Policy");
            const policy = Object.values(policies)[0] as any;
            const statements = policy.Properties.PolicyDocument.Statement;
            
            expect(statements).toContainEqual(
                expect.objectContaining({
                    Action: "s3:GetBucketLocation",
                    Effect: "Allow"
                })
            );
        });

        describe("Database name override behavior", () => {
            const stackPropsWithDefaultDb = {
                quiltDatabaseName: "quilt_titanic",
                quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
            };

            it("should use props.quiltDatabaseName when QUILT_DATABASE_NAME is not set", () => {
                process.env = { ...originalEnv };
                delete process.env.USE_S3_TABLE;
                delete process.env.QUILT_DATABASE_NAME;
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, "IcebergDefaultDbStack", stackPropsWithDefaultDb);
                const template = Template.fromStack(stack);

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            DATABASE_NAME: "quilt_titanic",
                        },
                    },
                });
            });

            it("should override with QUILT_DATABASE_NAME environment variable when set", () => {
                process.env = { ...originalEnv };
                delete process.env.USE_S3_TABLE;
                process.env.QUILT_DATABASE_NAME = "custom_iceberg_db";
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, "IcebergOverrideDbStack", stackPropsWithDefaultDb);
                const template = Template.fromStack(stack);

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            DATABASE_NAME: "custom_iceberg_db",
                        },
                    },
                });
            });
        });
    });

    describe("S3 Tables mode", () => {
        let template: Template;

        beforeAll(() => {
            // Set environment variable for S3 Tables mode
            process.env = { ...originalEnv };
            process.env.USE_S3_TABLE = "true";
            
            const app = new cdk.App();
            const stack = new TitanicStack(app, "S3TablesStack", defaultStackProps);
            template = Template.fromStack(stack);
        });

        it("should create S3 TableBucket in addition to regular S3 bucket", () => {
            template.hasResourceProperties("AWS::S3Tables::TableBucket", {
                TableBucketName: {
                    "Fn::Join": ["", ["titanic-tables-", {"Ref": "AWS::AccountId"}, "-", {"Ref": "AWS::Region"}]]
                }
            });
        });

        it("should configure Lambda function with S3 Tables-specific settings", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        DATABASE_NAME: "test-database",
                        USE_S3_TABLE: "true",
                        QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                    },
                },
            });
        });

        it("should create Glue database for S3 Tables", () => {
            template.hasResourceProperties("AWS::Glue::Database", {
                CatalogId: {
                    Ref: "AWS::AccountId"
                },
                DatabaseInput: {
                    Name: "test-database",
                    Description: "Database for Quilt Titanic S3 Tables"
                }
            });
        });

        it("should grant required S3 Tables permissions", () => {
            const policies = template.findResources("AWS::IAM::Policy");
            const policy = Object.values(policies)[0] as any;
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

        it("should grant S3 bucket location permissions (within S3 Tables permissions)", () => {
            const policies = template.findResources("AWS::IAM::Policy");
            const policy = Object.values(policies)[0] as any;
            const statements = policy.Properties.PolicyDocument.Statement;
            
            expect(statements).toContainEqual(
                expect.objectContaining({
                    Action: expect.arrayContaining(["s3:GetBucketLocation"]),
                    Effect: "Allow"
                })
            );
        });

        describe("Database name override behavior", () => {
            it("should use props.quiltDatabaseName and ignore QUILT_DATABASE_NAME override", () => {
                process.env = { ...originalEnv };
                process.env.USE_S3_TABLE = "true";
                process.env.QUILT_DATABASE_NAME = "should_be_ignored";
                
                const stackPropsWithDefaultDb = {
                    quiltDatabaseName: "quilt_titanic",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                };
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, "S3TablesIgnoreOverrideStack", stackPropsWithDefaultDb);
                const template = Template.fromStack(stack);

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            DATABASE_NAME: "quilt_titanic",
                        },
                    },
                });

                // Also verify the Glue database is created with the correct name
                template.hasResourceProperties("AWS::Glue::Database", {
                    DatabaseInput: {
                        Name: "quilt_titanic",
                    }
                });
            });
        });
    });
});
