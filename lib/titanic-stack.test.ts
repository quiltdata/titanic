import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Match } from "aws-cdk-lib/assertions";
import { TitanicStack } from "./titanic-stack";
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

const findLambdaPolicyByKey = (template: Template, _keyPattern: string) => {
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
                "Fn::Join": [":", ["arn:aws:athena", { "Ref": "AWS::Region" }, { "Ref": "AWS::AccountId" }, "workgroup/primary"]]
            }
        })
    );
};

describe("TitanicStack", () => {
    const defaultStackProps = {
        parameterDefaults: {
            athenaDatabaseName: "test-database-env",
            quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
            useS3Table: false,
        },
    };

    describe("Shared functionality (mode-independent)", () => {
        describe.each([
            { mode: "Glue", useS3Table: false, stackId: "SharedGlueStack", dbName: "test-database-env" },
            { mode: "S3 Tables", useS3Table: true, stackId: "SharedS3TablesStack", dbName: "test-database-env" }
        ])("$mode mode", ({ mode: _mode, useS3Table, stackId, dbName }) => {
            let template: Template;

            beforeAll(() => {
                const stackProps = {
                    parameterDefaults: {
                        ...defaultStackProps.parameterDefaults,
                        useS3Table,
                        athenaDatabaseName: dbName
                    },
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



            it("should grant S3 bucket location permissions", () => {
                expectS3BucketLocationPermissions(template);
            });
        });

    });

    describe("Glue mode (default)", () => {
        let template: Template;

        beforeAll(() => {
            template = createStackTemplate("GlueStack", { 
                parameterDefaults: {
                    ...defaultStackProps.parameterDefaults,
                    athenaDatabaseName: "test-database"
                }
            });
        });

        it("should create regular S3 bucket, S3 Tables bucket, and assets bucket", () => {
            template.resourceCountIs("AWS::S3::Bucket", 2); // Glue tables bucket and assets bucket
            template.resourceCountIs("AWS::S3Tables::TableBucket", 1); // S3 Tables bucket created for internal deployment
        });

        it("should create all buckets with parametrized names", () => {
            // Test Glue tables bucket name generation
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

            // Test assets bucket name generation  
            template.hasResourceProperties("AWS::S3::Bucket", {
                BucketName: {
                    "Fn::Join": [
                        "",
                        [
                            "titanic-assets-",
                            { "Ref": "AWS::AccountId" },
                            "-",
                            { "Ref": "AWS::Region" }
                        ]
                    ]
                }
            });

            // Test S3 Tables bucket name generation
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

        it("should not create Glue database (assumes database already exists)", () => {
            template.resourceCountIs("AWS::Glue::Database", 0);
        });

        it("should configure Lambda function with Glue-specific settings", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        ATHENA_DATABASE_NAME: { "Ref": "AthenaDatabaseName" },
                        USE_S3_TABLE: { "Ref": "UseS3Table" },
                        QUILT_READ_POLICY_ARN: { "Ref": "QuiltReadPolicyArn" },
                        GLUE_TABLES_BUCKET_NAME: Match.anyValue(),
                        S3_TABLES_BUCKET_NAME: Match.anyValue(),
                        AWS_ACCOUNT_ID: Match.anyValue(),
                        S3TABLE_DATABASE_NAME: "quilt_titanic",
                        LAMBDA_TIMEOUT: "900",
                    },
                },
            });
        });


    });

    describe("S3 Tables mode", () => {
        let template: Template;

        beforeAll(() => {
            template = createStackTemplate("S3TablesStack", { 
                parameterDefaults: {
                    athenaDatabaseName: "test-database-env",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/test-policy",
                    useS3Table: true,
                }
            });
        });

        it("should create S3 TableBucket in addition to regular S3 bucket", () => {
            // Regular S3 buckets: one for Glue tables and one for assets
            template.resourceCountIs("AWS::S3::Bucket", 2);
            // S3 Tables bucket created for S3 Tables mode - uses generated name with CloudFormation references
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

        it("should create regular S3 buckets with parametrized names", () => {
            // Test Glue tables bucket name generation
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

            // Test assets bucket name generation  
            template.hasResourceProperties("AWS::S3::Bucket", {
                BucketName: {
                    "Fn::Join": [
                        "",
                        [
                            "titanic-assets-",
                            { "Ref": "AWS::AccountId" },
                            "-",
                            { "Ref": "AWS::Region" }
                        ]
                    ]
                }
            });
        });

        it("should configure Lambda function with S3 Tables-specific settings", () => {
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        ATHENA_DATABASE_NAME: { "Ref": "AthenaDatabaseName" },
                        S3TABLE_DATABASE_NAME: "quilt_titanic", // This is the hardcoded constant
                        USE_S3_TABLE: { "Ref": "UseS3Table" },
                        QUILT_READ_POLICY_ARN: { "Ref": "QuiltReadPolicyArn" },
                        GLUE_TABLES_BUCKET_NAME: Match.anyValue(),
                        S3_TABLES_BUCKET_NAME: Match.anyValue(),
                        AWS_ACCOUNT_ID: Match.anyValue(),
                        LAMBDA_TIMEOUT: "900",
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

    describe("CloudFormation Parameters", () => {
        describe("With parameter defaults", () => {
            let template: Template;

            beforeAll(() => {
                template = createStackTemplate("ParameterDefaultsStack", {
                    parameterDefaults: {
                        athenaDatabaseName: "test-athena-database",
                        quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/TestQuiltReadPolicy",
                        useS3Table: false,
                    }
                });
            });

            it("should create CloudFormation parameters with defaults", () => {
                template.hasParameter("AthenaDatabaseName", {
                    Type: "String",
                    Description: "Name of the Athena database containing the source views",
                    Default: "test-athena-database"
                });

                template.hasParameter("QuiltReadPolicyArn", {
                    Type: "String", 
                    Description: "ARN of the IAM policy for reading from Quilt buckets",
                    Default: "arn:aws:iam::123456789012:policy/TestQuiltReadPolicy"
                });

                template.hasParameter("UseS3Table", {
                    Type: "String",
                    Description: "Whether to use S3 Tables format (true/false)",
                    Default: "false",
                    AllowedValues: ["true", "false"]
                });
            });

            it("should create Lambda function with parameter references", () => {
                template.hasResourceProperties("AWS::Lambda::Function", {
                    Environment: {
                        Variables: {
                            ATHENA_DATABASE_NAME: { "Ref": "AthenaDatabaseName" },
                            S3TABLE_DATABASE_NAME: "quilt_titanic",
                            QUILT_READ_POLICY_ARN: { "Ref": "QuiltReadPolicyArn" },
                            USE_S3_TABLE: { "Ref": "UseS3Table" },
                            GLUE_TABLES_BUCKET_NAME: Match.anyValue(),
                            S3_TABLES_BUCKET_NAME: Match.anyValue(),
                            AWS_ACCOUNT_ID: Match.anyValue(),
                            LAMBDA_TIMEOUT: "900",
                        },
                    },
                    Timeout: 900,
                });
            });
        });

        describe("Without parameter defaults (external deployment)", () => {
            let template: Template;

            beforeAll(() => {
                template = createStackTemplate("NoParameterDefaultsStack", {
                    // No parameterDefaults - pure CloudFormation parameters
                });
            });

            it("should create CloudFormation parameters with empty defaults", () => {
                template.hasParameter("AthenaDatabaseName", {
                    Type: "String",
                    Description: "Name of the Athena database containing the source views",
                    Default: ""
                });

                template.hasParameter("QuiltReadPolicyArn", {
                    Type: "String",
                    Description: "ARN of the IAM policy for reading from Quilt buckets", 
                    Default: ""
                });

                template.hasParameter("UseS3Table", {
                    Type: "String",
                    Description: "Whether to use S3 Tables format (true/false)",
                    Default: "false",
                    AllowedValues: ["true", "false"]
                });
            });

            it("should NOT create bucket name parameters (buckets generated from account/region)", () => {
                // According to the refactoring plan, bucket names are generated deterministically
                // from AWS::AccountId and AWS::Region, so no bucket name parameters should exist
                const parameterNames = Object.keys(template.toJSON().Parameters);
                expect(parameterNames).not.toContain("PublicAssetsBucketName");
                expect(parameterNames).not.toContain("S3TablesBucketName");
                expect(parameterNames).not.toContain("GlueTablesBucketName");
                
                // Only these three parameters should exist (plus CDK's BootstrapVersion)
                expect(parameterNames).toContain("AthenaDatabaseName");
                expect(parameterNames).toContain("QuiltReadPolicyArn");
                expect(parameterNames).toContain("UseS3Table");
                expect(parameterNames).toContain("BootstrapVersion"); // CDK automatically adds this
                expect(parameterNames).toHaveLength(4);
            });
        });
    });

    describe("Edge cases and error handling", () => {
        it("should handle empty stack props (no parameter defaults)", () => {
            const app = new cdk.App();
            
            // This should work - it will create CFN parameters with empty defaults
            expect(() => {
                new TitanicStack(app, "EmptyPropsStack", {});
            }).not.toThrow();
        });

        it("should always create CloudFormation parameters", () => {
            const template = createStackTemplate("AlwaysParametersStack", {
                parameterDefaults: {
                    athenaDatabaseName: "test-db",
                    quiltReadPolicyArn: "arn:aws:iam::123456789012:policy/TestPolicy",
                }
            });

            // Should always have our custom parameters
            template.hasParameter("AthenaDatabaseName", {
                Type: "String",
                Default: "test-db"
            });
            
            template.hasParameter("QuiltReadPolicyArn", {
                Type: "String",
                Default: "arn:aws:iam::123456789012:policy/TestPolicy"
            });
            
            template.hasParameter("UseS3Table", {
                Type: "String",
                Default: "false"
            });

            // Should use parameter references in environment variables
            template.hasResourceProperties("AWS::Lambda::Function", {
                Environment: {
                    Variables: {
                        ATHENA_DATABASE_NAME: { "Ref": "AthenaDatabaseName" },
                        QUILT_READ_POLICY_ARN: { "Ref": "QuiltReadPolicyArn" },
                        USE_S3_TABLE: { "Ref": "UseS3Table" },
                        S3TABLE_DATABASE_NAME: "quilt_titanic",
                        GLUE_TABLES_BUCKET_NAME: Match.anyValue(),
                        S3_TABLES_BUCKET_NAME: Match.anyValue(),
                        AWS_ACCOUNT_ID: Match.anyValue(),
                        LAMBDA_TIMEOUT: "900",
                    },
                },
            });
        });
    });
});
