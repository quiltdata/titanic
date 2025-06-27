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
                // Find the Lambda role policy (not the custom resource policy)
                const lambdaPolicy = Object.values(policies).find((policy: any) => 
                    policy.Properties.PolicyDocument.Statement.some((stmt: any) => 
                        Array.isArray(stmt.Action) && stmt.Action.includes("athena:StartQueryExecution")
                    )
                ) as any;
                const statements = lambdaPolicy.Properties.PolicyDocument.Statement;
                
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
                // Find the Lambda's IAM policy (not the custom resource policy)
                const lambdaPolicyEntry = Object.entries(policies).find(([key, policy]: [string, any]) => 
                    key.includes("MergeTables") && key.includes("ServiceRole")
                );
                const policy = lambdaPolicyEntry ? lambdaPolicyEntry[1] : Object.values(policies).find((p: any) => 
                    p.Properties.PolicyDocument.Statement.some((stmt: any) => 
                        stmt.Action && stmt.Action.includes("glue:GetTables")
                    )
                );
                
                expect(policy).toBeDefined();
                const statements = policy!.Properties.PolicyDocument.Statement;
                
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

        it("should not create Glue database (assumes database already exists)", () => {
            template.resourceCountIs("AWS::Glue::Database", 0);
            // For Iceberg mode, we assume the database already exists and just reference it
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

        describe("Database name usage", () => {
            it("should use the database name provided in props", () => {
                process.env = { ...originalEnv };
                delete process.env.USE_S3_TABLE;
                delete process.env.QUILT_DATABASE_NAME;
                
                const stackPropsWithCustomDb = {
                    quiltDatabaseName: "custom_test_db",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                };
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, "IcebergCustomDbStack", stackPropsWithCustomDb);
                const template = Template.fromStack(stack);

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            DATABASE_NAME: "custom_test_db",
                        },
                    },
                });
            });

            it("should use props.quiltDatabaseName regardless of QUILT_DATABASE_NAME environment variable", () => {
                process.env = { ...originalEnv };
                delete process.env.USE_S3_TABLE;
                process.env.QUILT_DATABASE_NAME = "env_var_should_be_ignored";
                
                const stackPropsWithCustomDb = {
                    quiltDatabaseName: "props_database_name",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                };
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, "IcebergPropsDbStack", stackPropsWithCustomDb);
                const template = Template.fromStack(stack);

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            DATABASE_NAME: "props_database_name",
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

        it("should create Glue database for S3 Tables using custom resource", () => {
            // Check for the custom resource that creates the Glue database
            const customResources = template.findResources("Custom::AWS");
            const customResourceKeys = Object.keys(customResources);
            expect(customResourceKeys.length).toBeGreaterThan(0);
            
            // Find the database creation custom resource
            const dbResource = Object.values(customResources).find(resource => {
                const createAction = resource.Properties?.Create;
                if (typeof createAction === 'string') return false;
                
                // Check if this is a Glue database creation action
                return createAction && 
                       createAction["Fn::Join"] && 
                       JSON.stringify(createAction).includes("Glue") &&
                       JSON.stringify(createAction).includes("createDatabase") &&
                       JSON.stringify(createAction).includes("test-database");
            });
            
            expect(dbResource).toBeDefined();
        });

        it("should grant required S3 Tables permissions", () => {
            const policies = template.findResources("AWS::IAM::Policy");
            // Find the Lambda's IAM policy (not the custom resource policy)
            const lambdaPolicyEntry = Object.entries(policies).find(([key, policy]: [string, any]) => 
                key.includes("MergeTables") && key.includes("ServiceRole")
            );
            const policy = lambdaPolicyEntry ? lambdaPolicyEntry[1] : Object.values(policies).find((p: any) => 
                p.Properties.PolicyDocument.Statement.some((stmt: any) => 
                    stmt.Action && stmt.Action.includes("s3tables:GetTable")
                )
            );
            
            expect(policy).toBeDefined();
            const statements = policy!.Properties.PolicyDocument.Statement;
            
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
            // Find the Lambda's IAM policy (not the custom resource policy)
            const lambdaPolicyEntry = Object.entries(policies).find(([key, policy]: [string, any]) => 
                key.includes("MergeTables") && key.includes("ServiceRole")
            );
            const policy = lambdaPolicyEntry ? lambdaPolicyEntry[1] : Object.values(policies).find((p: any) => 
                p.Properties.PolicyDocument.Statement.some((stmt: any) => 
                    stmt.Action && stmt.Action.includes("s3:GetBucketLocation")
                )
            );
            
            expect(policy).toBeDefined();
            const statements = policy!.Properties.PolicyDocument.Statement;
            
            expect(statements).toContainEqual(
                expect.objectContaining({
                    Action: expect.arrayContaining(["s3:GetBucketLocation"]),
                    Effect: "Allow"
                })
            );
        });

        describe("Database name usage", () => {
            it("should use the database name provided in props", () => {
                process.env = { ...originalEnv };
                process.env.USE_S3_TABLE = "true";
                process.env.QUILT_DATABASE_NAME = "env_var_should_be_ignored";
                
                const stackPropsWithCustomDb = {
                    quiltDatabaseName: "s3_tables_db",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                };
                
                const app = new cdk.App();
                const stack = new TitanicStack(app, "S3TablesCustomDbStack", stackPropsWithCustomDb);
                const template = Template.fromStack(stack);

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            DATABASE_NAME: "s3_tables_db",
                        },
                    },
                });

                // Verify the custom resource for database creation uses the correct name
                const customResources = template.findResources("Custom::AWS");
                const dbResource = Object.values(customResources).find(resource => {
                    const createAction = resource.Properties?.Create;
                    if (typeof createAction === 'string') return false;
                    
                    // Check if this is a Glue database creation action with the correct name
                    return createAction && 
                           createAction["Fn::Join"] && 
                           JSON.stringify(createAction).includes("Glue") &&
                           JSON.stringify(createAction).includes("createDatabase") &&
                           JSON.stringify(createAction).includes("s3_tables_db");
                });
                
                expect(dbResource).toBeDefined();
            });
        });
    });
});
