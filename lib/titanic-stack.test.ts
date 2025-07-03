import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Match } from "aws-cdk-lib/assertions";
import { TitanicStack } from "./titanic-stack";

// Test utilities
const setupEnvironment = (overrides: Record<string, string> = {}) => {
    process.env = {
        NODE_ENV: "test",
        ...overrides
    };
};

const createStackTemplate = (
    stackId: string,
    props: any,
    envOverrides: Record<string, string> = {}
) => {
    setupEnvironment(envOverrides);
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
    
    // Check for either a single action or an array containing the action
    const hasS3BucketLocationPermission = statements.some((statement: any) => 
        statement.Action === "s3:GetBucketLocation" || 
        (Array.isArray(statement.Action) && statement.Action.includes("s3:GetBucketLocation"))
    );
    
    expect(hasS3BucketLocationPermission).toBe(true);
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
        // Source database (where views are read from)
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([`:database/${expectedSourceDatabaseName}`])]
        }),
        expect.objectContaining({
            "Fn::Join": ["", expect.arrayContaining([`:table/${expectedSourceDatabaseName}/*`])]
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
        quiltDatabaseName: "test-database",
        quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
    };

    describe("Shared functionality (mode-independent)", () => {
        describe.each([
            { mode: "Glue", useS3Table: false, stackId: "SharedGlueStack", dbName: "test-database-env" },
            { mode: "S3 Tables", useS3Table: true, stackId: "SharedS3TablesStack", dbName: "test-database-env" }
        ])("$mode mode", ({ mode, useS3Table, stackId, dbName }) => {
            let template: Template;

            beforeAll(() => {
                const envOverrides: Record<string, string> = useS3Table 
                    ? { USE_S3_TABLE: "true", QUILT_DATABASE_NAME: "test-database-env" }
                    : { QUILT_DATABASE_NAME: "test-database-env" };
                    
                template = createStackTemplate(stackId, defaultStackProps, envOverrides);
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
                { ...defaultStackProps, lambdaTimeout: 10000 },
                { QUILT_DATABASE_NAME: "test-database-env" }
            );

            customTemplate.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        GLUE_DATABASE_NAME: "test-database-env",
                        LAMBDA_TIMEOUT: "10000",
                        USE_S3_TABLE: "false",
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
            template = createStackTemplate("GlueStack", defaultStackProps, { QUILT_DATABASE_NAME: "test-database" });
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
                        GLUE_DATABASE_NAME: "test-database",
                        USE_S3_TABLE: "false",
                        QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
                        GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                        S3_TABLES_BUCKET_ARN: Match.anyValue(),
                        ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                    },
                },
            });
        });

        describe("Database name usage", () => {
            it("should use the database name provided in QUILT_DATABASE_NAME environment variable", () => {
                const envTemplate = createStackTemplate(
                    "GlueEnvDbStack", 
                    { ...defaultStackProps, quiltDatabaseName: "env_var_db_name" },
                    { QUILT_DATABASE_NAME: "env_var_db_name" }
                );

                envTemplate.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            GLUE_DATABASE_NAME: "env_var_db_name",
                            USE_S3_TABLE: "false",
                            GLUE_TABLES_BUCKET_ARN: Match.anyValue(),
                            S3_TABLES_BUCKET_ARN: Match.anyValue(),
                            ATHENA_RESULTS_BUCKET_ARN: Match.anyValue(),
                        },
                    },
                });
            });

            it("should throw error if QUILT_DATABASE_NAME not set", () => {
                expect(() => {
                    createStackTemplate("GlueNoDbStack", defaultStackProps);
                }).toThrow("must set QUILT_DATABASE_NAME environment variable");
            });
        });
    });

    describe("S3 Tables mode", () => {
        let template: Template;

        beforeAll(() => {
            template = createStackTemplate("S3TablesStack", defaultStackProps, { USE_S3_TABLE: "true", QUILT_DATABASE_NAME: "test-database-env" });
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
                        GLUE_DATABASE_NAME: "test-database-env",
                        S3TABLE_DATABASE_NAME: "quilt_titanic", // This is the hardcoded constant
                        USE_S3_TABLE: "true",
                        QUILT_READ_POLICY_ARN: "arn:aws:iam::123456789012:policy/test-policy",
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
});
