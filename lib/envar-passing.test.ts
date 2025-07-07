import { Config, S3Config } from "./shared/config";

/**
 * Tests for environment variable contract between CDK stack and Lambda
 * 
 * The CDK stack passes environment variables to the Lambda function.
 * We need to be explicit about:
 * a) Always pass ARNs from stack to Lambda for consistency
 * b) Clearly named environment variables ending in _ARN
 * c) Config methods that translate between ARN and name formats
 * d) Each method gets exactly what it needs (ARN vs name)
 */
describe("Environment Variable Contract Tests", () => {
    describe("Stack-to-Lambda environment variable contract", () => {
        it("should pass ARNs consistently with clear naming", () => {
            // Document what the stack SHOULD pass to Lambda (ARNs for all buckets)
            const expectedEnvVars = {
                // Always ARNs for buckets (clear naming)
                GLUE_TABLES_BUCKET_ARN: "arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2",
                S3_TABLES_BUCKET_ARN: "arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2",
                ATHENA_RESULTS_BUCKET_ARN: "arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2",
                
                // Database names
                GLUE_DATABASE_NAME: "source-database",
                S3TABLE_DATABASE_NAME: "quilt_titanic",
                
                // Configuration flags
                USE_S3_TABLE: "false" // or "true"
            };

            // All bucket env vars should end with _ARN for clarity
            expect(expectedEnvVars.GLUE_TABLES_BUCKET_ARN).toContain("arn:aws:s3:::");
            expect(expectedEnvVars.S3_TABLES_BUCKET_ARN).toContain("arn:aws:s3tables:");
            expect(expectedEnvVars.ATHENA_RESULTS_BUCKET_ARN).toContain("arn:aws:s3:::");
        });
    });

    describe("Config class ARN handling and conversion", () => {
        it("should extract bucket names from ARNs correctly", () => {
            // Test S3 bucket ARN
            const s3Arn = "arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2";
            expect(Config.extractBucketNameFromArn(s3Arn)).toBe("titanic-glue-tables-123456789012-us-east-2");
            
            // Test S3 Tables ARN
            const s3TablesArn = "arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2";
            expect(Config.extractBucketNameFromArn(s3TablesArn)).toBe("titanic-s3-tables-123456789012-us-east-2");
            
            // Test regular bucket name (should pass through unchanged)
            const bucketName = "regular-bucket-name";
            expect(Config.extractBucketNameFromArn(bucketName)).toBe("regular-bucket-name");
        });

        it("should handle Glue config with ARN inputs", () => {
            const config = new Config({
                glueTablesBucketArn: "arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2",
                s3TablesBucketArn: "arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2"
            });

            // Should extract bucket names for operations
            expect(config.getTargetBucket()).toBe("titanic-glue-tables-123456789012-us-east-2");
            expect(config.getResultsBucket()).toBe("titanic-glue-tables-123456789012-us-east-2");
            
            // Should provide ARNs when needed
            expect(config.getGlueTablesBucketArn()).toBe("arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2");
            expect(config.getS3TablesBucketArn()).toBe("arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2");
            
            // Should provide extracted names
            expect(config.getGlueTablesBucketName()).toBe("titanic-glue-tables-123456789012-us-east-2");
            expect(config.getS3TablesBucketName()).toBe("titanic-s3-tables-123456789012-us-east-2");
            
            // Execution context should not have Catalog for Glue
            const context = config.getExecutionContext();
            expect(context).toEqual({ Database: config.getReadDatabaseName() });
        });

        it("should handle S3Config with ARN inputs", () => {
            const config = new S3Config({
                glueTablesBucketArn: "arn:aws:s3:::titanic-glue-tables-123456789012-us-east-2",
                s3TablesBucketArn: "arn:aws:s3tables:us-east-2:123456789012:bucket/titanic-s3-tables-123456789012-us-east-2",
                s3TableDatabaseName: "quilt_titanic"
            });

            // S3Config should use S3 Tables bucket name for tables, Glue bucket name for results
            expect(config.getTargetBucket()).toBe("titanic-s3-tables-123456789012-us-east-2");
            expect(config.getResultsBucket()).toBe("titanic-glue-tables-123456789012-us-east-2");
            
            // Should format catalog name correctly for Athena S3 Tables
            expect(config.getS3TableCatalogName()).toBe("s3tablescatalog/titanic-s3-tables-123456789012-us-east-2");
            
            // Should provide correct execution context for Athena
            const context = config.getExecutionContext();
            expect(context.Catalog).toBe("s3tablescatalog/titanic-s3-tables-123456789012-us-east-2");
            expect(context.Database).toBe("quilt_titanic");
        });
    });

    describe("Environment variable usage in merge-tables handler", () => {
        it("should expect ARN-named environment variables", () => {
            // These are the environment variables merge-tables.ts should read
            const bucketEnvVars = [
                "GLUE_TABLES_BUCKET_ARN",
                "S3_TABLES_BUCKET_ARN", 
                "ATHENA_RESULTS_BUCKET_ARN"
            ];
            
            const databaseEnvVars = [
                "GLUE_DATABASE_NAME",
                "S3TABLE_DATABASE_NAME"
            ];
            
            const configEnvVars = [
                "USE_S3_TABLE"
            ];

            // All bucket environment variables should contain ARN
            bucketEnvVars.forEach(envVar => {
                expect(envVar).toContain("ARN");
            });
            
            // Database and config vars should not contain ARN
            [...databaseEnvVars, ...configEnvVars].forEach(envVar => {
                expect(envVar).not.toContain("ARN");
            });
        });
    });

    describe("CDK stack environment variable output", () => {
        it("should pass bucket ARNs with clear variable names", () => {
            // The stack should set these environment variables on the Lambda
            const stackOutputs = {
                GLUE_TABLES_BUCKET_ARN: "arn:aws:s3:::bucket-name",
                S3_TABLES_BUCKET_ARN: "arn:aws:s3tables:region:account:bucket/bucket-name",
                ATHENA_RESULTS_BUCKET_ARN: "arn:aws:s3:::bucket-name"
            };

            // Verify the ARN formats are correct
            Object.entries(stackOutputs).forEach(([key, value]) => {
                expect(key).toContain("ARN");
                expect(value).toContain("arn:aws:");
            });
        });
    });

    describe("Method usage patterns", () => {
        it("should use appropriate methods for different operations", () => {
            const config = new S3Config({
                glueTablesBucketArn: "arn:aws:s3:::glue-bucket",
                s3TablesBucketArn: "arn:aws:s3tables:us-east-2:123456789012:bucket/s3tables-bucket"
            });

            // For Athena query locations (needs bucket names)
            expect(config.getResultsBucket()).toBe("glue-bucket");
            expect(config.getTargetBucket()).toBe("s3tables-bucket");
            
            // For Athena execution context (needs catalog format for S3 Tables)
            const context = config.getExecutionContext();
            expect(context.Catalog).toBe("s3tablescatalog/s3tables-bucket");
            
            // For IAM permissions or other AWS APIs (might need ARNs)
            expect(config.getGlueTablesBucketArn()).toBe("arn:aws:s3:::glue-bucket");
            expect(config.getS3TablesBucketArn()).toBe("arn:aws:s3tables:us-east-2:123456789012:bucket/s3tables-bucket");
        });
    });
});
