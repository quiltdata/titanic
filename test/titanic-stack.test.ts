import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { TitanicStack } from "../lib/titanic-stack";

describe("TitanicStack", () => {
    const app = new cdk.App();
    const stack = new TitanicStack(app, "TestStack", {
        quiltDatabaseName: "test-database",
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
                },
            },
        });
    });

    it("creates required IAM policies", () => {
        const policyProps = template.findResources("AWS::IAM::Policy");
        const policy = Object.values(policyProps)[0];

        expect(policy.Properties.PolicyDocument).toEqual({
            Version: "2012-10-17",
            Statement: expect.arrayContaining([
                expect.objectContaining({
                    Effect: "Allow",
                    Action: ["glue:GetTables", "glue:GetTable"],
                    Resource: expect.any(Array),
                }),
            ]),
        });
    });

    it("should pass environment variables to Lambda when provided", () => {
        const debugApp = new cdk.App();
        const debugStack = new TitanicStack(debugApp, "DebugStack", {
            quiltDatabaseName: "test-database",
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

    it("creates Iceberg tables", () => {
        // Test packages table
        template.hasResourceProperties("AWS::Glue::Table", {
            DatabaseName: "test-database",
            CatalogId: {
                Ref: "AWS::AccountId",
            },
            TableInput: {
                Name: "titanic_merged_packages",
                TableType: "ICEBERG",
                Parameters: {
                    "table_type": "ICEBERG",
                    "format": "parquet",
                    "write_target_data_file_size_bytes": "536870912",
                    "write_compression": "SNAPPY"
                },
                PartitionKeys: [
                    { Name: "source_bucket", Type: "string" }
                ],
                StorageDescriptor: {
                    Location: {
                        "Fn::Join": [
                            "",
                            [
                                "s3://",
                                {
                                    Ref: "TitanicBucketBD9D9364",
                                },
                                "/merged/packages/",
                            ],
                        ],
                    },
                    InputFormat: "org.apache.iceberg.mr.hive.HiveIcebergInputFormat",
                    OutputFormat: "org.apache.iceberg.mr.hive.HiveIcebergOutputFormat",
                    SerdeInfo: {
                        SerializationLibrary: "org.apache.iceberg.mr.hive.HiveIcebergSerDe"
                    },
                    Columns: [
                        { Name: "pkg_name", Type: "string" },
                        { Name: "top_hash", Type: "string" },
                        { Name: "timestamp", Type: "string" },
                        { Name: "message", Type: "string" },
                        { Name: "user_meta", Type: "string" },
                        { Name: "source_bucket", Type: "string" }
                    ]
                }
            }
        });

        // Test objects table
        template.hasResourceProperties("AWS::Glue::Table", {
            DatabaseName: "test-database",
            CatalogId: {
                Ref: "AWS::AccountId",
            },
            TableInput: {
                Name: "titanic_merged_objects",
                TableType: "ICEBERG",
                Parameters: {
                    "table_type": "ICEBERG",
                    "format": "parquet",
                    "write_target_data_file_size_bytes": "536870912",
                    "write_compression": "SNAPPY"
                },
                StorageDescriptor: {
                    Location: {
                        "Fn::Join": [
                            "",
                            [
                                "s3://",
                                {
                                    Ref: "TitanicBucketBD9D9364",
                                },
                                "/merged/objects/",
                            ],
                        ],
                    },
                    InputFormat: "org.apache.iceberg.mr.hive.HiveIcebergInputFormat",
                    OutputFormat: "org.apache.iceberg.mr.hive.HiveIcebergOutputFormat",
                    SerdeInfo: {
                        SerializationLibrary: "org.apache.iceberg.mr.hive.HiveIcebergSerDe"
                    },
                    Columns: [
                        { Name: "pkg_name", Type: "string" },
                        { Name: "top_hash", Type: "string" },
                        { Name: "timestamp", Type: "string" },
                        { Name: "logical_key", Type: "string" },
                        { Name: "physical_key", Type: "string" },
                        { Name: "size", Type: "bigint" },
                        { Name: "hash", Type: "struct<type:string,value:string>" },
                        { Name: "meta", Type: "string" },
                        { Name: "source_bucket", Type: "string" }
                    ]
                }
            }
        });
    });
});
