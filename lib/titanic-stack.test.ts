import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Match } from "aws-cdk-lib/assertions";
import { TitanicStack } from "./titanic-stack";

// Test utilities
const createStackTemplate = (
    stackId: string,
    props: any
) => {
    const app = new cdk.App();
    const stack = new TitanicStack(app, stackId, props);
    return Template.fromStack(stack);
};

const findLambdaPolicy = (template: Template, actionToFind: string) => {
    const policies = template.findResources("AWS::IAM::Policy");
    return Object.values(policies).find((policy: any) =>
        policy.Properties.PolicyDocument.Statement.some((stmt: any) =>
            Array.isArray(stmt.Action) && stmt.Action.includes(actionToFind)
        )
    ) as any;
};

const findLambdaPolicyByKey = (template: Template, keyPattern: string) => {
    const policies = template.findResources("AWS::IAM::Policy");
    const lambdaPolicyEntry = Object.entries(policies).find(([key]) =>
        key.includes("MergeTables") && key.includes("ServiceRole")
    );
    return lambdaPolicyEntry ? lambdaPolicyEntry[1] : Object.values(policies)[0];
};

const expectS3BucketLocationPermissions = (template: Template) => {
    const policy = findLambdaPolicyByKey(template, "MergeTables");
    expect(policy).toBeDefined();
    const statements = policy.Properties.PolicyDocument.Statement;
    
    // Find all statements that grant s3:GetBucketLocation
    const s3BucketLocationStatements = statements.filter((statement: any) => 
        statement.Action === "s3:GetBucketLocation" || 
        (Array.isArray(statement.Action) && statement.Action.includes("s3:GetBucketLocation"))
    );
    
    expect(s3BucketLocationStatements.length).toBeGreaterThanOrEqual(2); // Should have at least 2 statements for both buckets
    
    // Check that we have permissions for both bucket types
    const allResources = s3BucketLocationStatements.flatMap((stmt: any) => 
        Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource]
    );
    
    // Should have bucket location permissions for both the Glue tables bucket and S3 tables bucket
    // The exact ARNs will be generated dynamically, but we should have at least 2 different bucket ARNs
    const uniqueBuckets = [...new Set(allResources)];
    expect(uniqueBuckets.length).toBeGreaterThanOrEqual(2);
};

const expectGluePermissions = (template: Template, expectedSourceDatabaseName: string) => {
    const policy = findLambdaPolicyByKey(template, "MergeTables");
    expect(policy).toBeDefined();
    const statements = policy.Properties.PolicyDocument.Statement;
    
    // Find the Glue statement
    const glueStatement = statements.find((statement: any) => 
        Array.isArray(statement.Action) && 
        statement.Action.includes("glue:GetTables")
    );
    
    expect(glueStatement).toBeDefined();
    expect(glueStatement.Effect).toBe("Allow");
    expect(glueStatement.Action).toEqual(["glue:GetTables", "glue:GetTable", "glue:GetPartitions", "glue:GetDatabase", "glue:CreateTable", "glue:DeleteTable", "glue:UpdateTable"]);
    
    // Check that the resources include both source and target databases
    const resources = glueStatement.Resource;
    expect(resources).toEqual(expect.arrayContaining([
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([":catalog"])]
        }),
        // Source database (where views are read from) - uses CloudFormation parameter reference
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([":database/", { "Ref": "GlueDatabaseName" }])]
        }),
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([":table/", { "Ref": "GlueDatabaseName" }, "/*"])]
        }),
        // Target database (where tables are written to) - always "quilt_titanic"
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([":database/quilt_titanic"])]
        }),
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([":table/quilt_titanic/*"])]
        })
    ]));
};

const expectAthenaPermissions = (template: Template) => {
    const policy = findLambdaPolicy(template, "athena:StartQueryExecution");
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
                "Fn::Join": ["", ["arn:aws:athena:", { "Ref": "AWS::Region" }, ":", { "Ref": "AWS::AccountId" }, ":workgroup/primary"]]
            }
        })
    );
};

describe("TitanicStack", () => {
    const defaultStackProps = {
        glueDatabaseName: "test-database-env",
        quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
        useS3Table: false,
        useCloudFormationParameters: true, // Enable CF parameters for tests that expect them
    };

    describe("Shared functionality (mode-independent)", () => {
        describe.each([
            { mode: "Glue", useS3Table: false, stackId: "SharedGlueStack", dbName: "test-database-env" },
            { mode: "S3 Tables", useS3Table: true, stackId: "SharedS3TablesStack", dbName: "test-database-env" }
        ])("$mode mode", ({ mode, useS3Table, stackId, dbName }) => {
            let template: Template;

            beforeAll(() => {
                const stackProps = {
                    ...defaultStackProps,
                    useS3Table,
                    glueDatabaseName: dbName
                };
                    
                template = createStackTemplate(stackId, stackProps);
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
                expectAthenaPermissions(template);
            });

            it("should grant required Glue permissions", () => {
                expectGluePermissions(template, dbName);
            });

            it("should grant S3 bucket location permissions", () => {
                expectS3BucketLocationPermissions(template);
            });
        });

        it("should support custom Lambda timeout configuration", () => {
            const customTemplate = createStackTemplate(
                "CustomTimeoutStack", 
                { ...defaultStackProps, lambdaTimeout: 10000 }
            );

            customTemplate.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        GLUE_DATABASE_NAME: { Ref: "GlueDatabaseName" },
                        LAMBDA_TIMEOUT: { Ref: "LambdaTimeout" },
                        USE_S3_TABLE: { Ref: "UseS3Table" },
                        QUILT_READ_POLICY_ARN: { Ref: "QuiltReadPolicyArn" },
                        GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                        S3_TABLES_BUCKET_ARN: Match.anyValue(),
                        ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                    },
                },
            });
        });
    });

    describe("Glue mode (default)", () => {
        let template: Template;

        beforeAll(() => {
            template = createStackTemplate("GlueStack", { ...defaultStackProps, glueDatabaseName: "test-database" });
        });

        it("should create both regular S3 bucket and S3 Tables bucket", () => {
            template.resourceCountIs("AWS::S3::Bucket", 1); // Regular bucket
            template.resourceCountIs("AWS::S3Tables::TableBucket", 1); // S3 Tables bucket
        });

        it("should not create Glue database (assumes database already exists)", () => {
            template.resourceCountIs("AWS::Glue::Database", 0);
        });

        it("should configure Lambda function with Glue-specific settings", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        GLUE_DATABASE_NAME: { Ref: "GlueDatabaseName" },
                        USE_S3_TABLE: { Ref: "UseS3Table" },
                        QUILT_READ_POLICY_ARN: { Ref: "QuiltReadPolicyArn" },
                        GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                        S3_TABLES_BUCKET_ARN: Match.anyValue(),
                        ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                    },
                },
            });
        });

        describe("Database name usage", () => {
            it("should use the database name provided in glueDatabaseName prop", () => {
                const envTemplate = createStackTemplate(
                    "GlueEnvDbStack", 
                    { ...defaultStackProps, glueDatabaseName: "env_var_db_name" }
                );

                envTemplate.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            GLUE_DATABASE_NAME: { Ref: "GlueDatabaseName" },
                            USE_S3_TABLE: { Ref: "UseS3Table" },
                            QUILT_READ_POLICY_ARN: { Ref: "QuiltReadPolicyArn" },
                            GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                            S3_TABLES_BUCKET_ARN: Match.anyValue(),
                            ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                        },
                    },
                });
            });
        });
    });

    describe("S3 Tables mode", () => {
        let template: Template;

        beforeAll(() => {
            template = createStackTemplate("S3TablesStack", { ...defaultStackProps, useS3Table: true });
        });

        it("should create S3 TableBucket in addition to regular S3 bucket", () => {
            template.hasResourceProperties("AWS::S3Tables::TableBucket", {
                TableBucketName: {
                    "Fn::Join": ["", ["titanic-s3-tables-", { "Ref": "AWS::AccountId" }, "-", { "Ref": "AWS::Region" }]]
                }
            });
        });

        it("should configure Lambda function with S3 Tables-specific settings", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        GLUE_DATABASE_NAME: { Ref: "GlueDatabaseName" },
                        S3TABLE_DATABASE_NAME: "quilt_titanic", // This is the hardcoded constant
                        USE_S3_TABLE: { Ref: "UseS3Table" },
                        QUILT_READ_POLICY_ARN: { Ref: "QuiltReadPolicyArn" },
                        GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                        S3_TABLES_BUCKET_ARN: Match.anyValue(),
                        ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                    },
                },
            });
        });

        it("should grant required S3 Tables permissions", () => {
            const policy = findLambdaPolicyByKey(template, "MergeTables");
            expect(policy).toBeDefined();
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

    describe("Props mode (useCloudFormationParameters: false)", () => {
        const propsMode = {
            glueDatabaseName: "test-glue-database",
            quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/TestQuiltReadPolicy",
            useS3Table: false,
            lambdaTimeout: 600,
            useCloudFormationParameters: false
        };

        describe("Basic configuration", () => {
            let template: Template;

            beforeAll(() => {
                template = createStackTemplate("PropsBasicStack", propsMode);
            });

            it("should not create CloudFormation parameters", () => {
                // Should only have CDK bootstrap parameter, not our custom parameters
                const parameters = template.toJSON().Parameters;
                expect(parameters).not.toHaveProperty("GlueDatabaseName");
                expect(parameters).not.toHaveProperty("QuiltReadPolicyArn");
                expect(parameters).not.toHaveProperty("UseS3Table");
                expect(parameters).not.toHaveProperty("LambdaTimeout");
            });

            it("should create both S3 bucket types", () => {
                template.hasResourceProperties("AWS::S3::Bucket", {
                    BucketName: {
                        "Fn::Join": [
                            "",
                            [
                                "titanic-glue-tables-",
                                { "Ref": "AWS::AccountId" },
                                "-",
                                { "Ref": "AWS::Region" }
                            ]
                        ]
                    }
                });

                template.hasResourceProperties("AWS::S3Tables::TableBucket", {
                    TableBucketName: {
                        "Fn::Join": [
                            "",
                            [
                                "titanic-s3-tables-",
                                { "Ref": "AWS::AccountId" },
                                "-",
                                { "Ref": "AWS::Region" }
                            ]
                        ]
                    }
                });
            });

            it("should create Lambda function with correct configuration from props", () => {
                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            GLUE_DATABASE_NAME: "test-glue-database",
                            S3TABLE_DATABASE_NAME: "quilt_titanic",
                            LAMBDA_TIMEOUT: "600",
                            QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/TestQuiltReadPolicy",
                            USE_S3_TABLE: "false",
                            GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                            S3_TABLES_BUCKET_ARN: Match.anyValue(),
                            ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                        },
                    },
                    Timeout: 600,
                });
            });

            it("should create EventBridge rule with correct pattern", () => {
                template.hasResourceProperties("AWS::Events::Rule", {
                    EventPattern: {
                        source: ["com.quiltdata"],
                        "detail-type": ["package-revision", "package-tag", "package-entry"],
                        detail: {
                            type: ["created", "updated"],
                        }
                    },
                });
            });

            it("should grant Glue permissions for source and target databases", () => {
                const policy = findLambdaPolicyByKey(template, "MergeTables");
                expect(policy).toBeDefined();
                const statements = policy.Properties.PolicyDocument.Statement;
                
                const glueStatement = statements.find((statement: any) => 
                    Array.isArray(statement.Action) && 
                    statement.Action.includes("glue:GetTables")
                );
                
                expect(glueStatement).toBeDefined();
                expect(glueStatement.Effect).toBe("Allow");
                
                // Check that the resources include both source and target databases (direct values, not refs)
                const resources = glueStatement.Resource;
                expect(resources).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":catalog"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":database/test-glue-database"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":table/test-glue-database/*"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":database/quilt_titanic"])]
                    }),
                    expect.objectContaining({
                        "Fn::Join": ["", expect.arrayContaining([":table/quilt_titanic/*"])]
                    })
                ]));
            });

            it("should grant Athena permissions", () => {
                expectAthenaPermissions(template);
            });

            it("should grant S3 bucket location permissions for both buckets", () => {
                expectS3BucketLocationPermissions(template);
            });

            it("should attach the Quilt read policy to Lambda role", () => {
                template.hasResourceProperties("AWS::IAM::Role", {
                    ManagedPolicyArns: [
                        {
                            "Fn::Join": [
                                "",
                                [
                                    "arn:",
                                    { "Ref": "AWS::Partition" },
                                    ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
                                ]
                            ]
                        },
                        "arn:aws:iam::123456789012:policy/TestQuiltReadPolicy"
                    ]
                });
            });

            it("should create stack outputs", () => {
                const outputs = template.toJSON().Outputs;
                expect(outputs).toHaveProperty("LambdaFunctionName");
                expect(outputs).toHaveProperty("LambdaLogGroupName");
                expect(outputs).toHaveProperty("GlueTablesBucket");
                expect(outputs).toHaveProperty("S3TablesBucket");
                expect(outputs).toHaveProperty("SourceDatabaseName");
                expect(outputs).toHaveProperty("TargetDatabaseName");
            });
        });

        describe("With S3 Tables enabled", () => {
            let template: Template;

            beforeAll(() => {
                template = createStackTemplate("PropsS3TablesStack", {
                    ...propsMode,
                    useS3Table: true
                });
            });

            it("should configure Lambda for S3 Tables mode", () => {
                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            USE_S3_TABLE: "true",
                            GLUE_DATABASE_NAME: "test-glue-database",
                            S3TABLE_DATABASE_NAME: "quilt_titanic",
                        },
                    },
                });
            });

            it("should grant S3 Tables permissions", () => {
                const policy = findLambdaPolicyByKey(template, "MergeTables");
                expect(policy).toBeDefined();
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

        describe("Custom timeout configuration", () => {
            it("should support custom Lambda timeout in props mode", () => {
                const customTemplate = createStackTemplate("PropsCustomTimeoutStack", {
                    ...propsMode,
                    lambdaTimeout: 300
                });

                customTemplate.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            LAMBDA_TIMEOUT: "300",
                        },
                    },
                    Timeout: 300,
                });
            });

            it("should default to 900 seconds when lambdaTimeout not specified", () => {
                const { lambdaTimeout, ...propsWithoutTimeout } = propsMode;
                const defaultTemplate = createStackTemplate("PropsDefaultTimeoutStack", propsWithoutTimeout);

                defaultTemplate.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            LAMBDA_TIMEOUT: "900",
                        },
                    },
                    Timeout: 900,
                });
            });
        });

        describe("Default values", () => {
            it("should handle minimal props configuration", () => {
                const minimalTemplate = createStackTemplate("PropsMinimalStack", {
                    glueDatabaseName: "minimal-db",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/MinimalPolicy",
                    useCloudFormationParameters: false
                });

                minimalTemplate.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            GLUE_DATABASE_NAME: "minimal-db",
                            QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/MinimalPolicy",
                            USE_S3_TABLE: "false",
                            LAMBDA_TIMEOUT: "900",
                        },
                    },
                    Timeout: 900,
                });
            });

            it("should default useS3Table to false when not specified", () => {
                const template = createStackTemplate("PropsDefaultS3TableStack", {
                    glueDatabaseName: "test-db",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/TestPolicy",
                    useCloudFormationParameters: false
                });

                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            USE_S3_TABLE: "false",
                        },
                    },
                });
            });
        });

        describe("Stack props inheritance", () => {
            it("should inherit standard CDK stack properties", () => {
                const app = new cdk.App();
                const stack = new TitanicStack(app, "InheritanceTestStack", {
                    ...propsMode,
                    env: {
                        account: "123456789012",
                        region: "us-east-1"
                    },
                    description: "Test stack description"
                });

                expect(stack.account).toBe("123456789012");
                expect(stack.region).toBe("us-east-1");
                
                const template = Template.fromStack(stack);
                const templateJson = template.toJSON();
                expect(templateJson.Description).toBe("Test stack description");
            });
        });
    });

    describe("Edge cases and error handling", () => {
        it("should handle empty stack props", () => {
            const app = new cdk.App();
            
            // This should work because useCloudFormationParameters defaults to false
            // and the non-CloudFormation path requires the props to be set
            expect(() => {
                new TitanicStack(app, "EmptyPropsStack", {});
            }).toThrow(); // Should throw because required props are missing
        });

        it("should default useCloudFormationParameters to false", () => {
            const template = createStackTemplate("DefaultCFParamsStack", {
                glueDatabaseName: "test-db",
                quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/TestPolicy",
                // useCloudFormationParameters not specified - should default to false
            });

            // Should not have our custom parameters (indicates CF params mode is disabled)
            const parameters = template.toJSON().Parameters;
            expect(parameters).not.toHaveProperty("GlueDatabaseName");
            expect(parameters).not.toHaveProperty("QuiltReadPolicyArn");
            expect(parameters).not.toHaveProperty("UseS3Table");
            expect(parameters).not.toHaveProperty("LambdaTimeout");

            // Should use props directly in environment variables
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        GLUE_DATABASE_NAME: "test-db",
                        QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/TestPolicy",
                    },
                },
            });
        });
    });
});
