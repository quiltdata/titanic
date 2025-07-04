import { mockClient } from "aws-sdk-client-mock";
import { GetTablesCommand, GlueClient } from "@aws-sdk/client-glue";
import {
    AthenaClient,
    GetQueryExecutionCommand,
    QueryExecutionState,
    StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { Config, S3Config } from "./config";
import { AthenaTest } from "./athena-test";

// Common mock clients
export const glueMock = mockClient(GlueClient);
export const athenaMock = mockClient(AthenaClient);

// Consolidated test setup for table classes
export interface TableTestSetup {
    mockConfig: Config;
    s3Config: S3Config;
    mockAthenaUtils: AthenaTest;
}

export function createTableTestSetup(): TableTestSetup {
    const mockConfig = Config.createTestInstance({
        glueTablesBucketArn: "arn:aws:s3:::test-bucket",
        glueDatabaseName: "test-db",
        s3TablesBucketArn: "arn:aws:s3tables:us-east-1:123456789012:bucket/test-s3-bucket",
        s3TableDatabaseName: "test-s3-db"
    });

    const s3Config = S3Config.createTestInstance({
        glueTablesBucketArn: "arn:aws:s3:::test-bucket",
        glueDatabaseName: "test-db",
        s3TablesBucketArn: "arn:aws:s3tables:us-east-1:123456789012:bucket/test-s3-bucket",
        s3TableDatabaseName: "test-s3-db"
    });

    const mockAthenaUtils = AthenaTest.createTestInstance(mockConfig);

    return { mockConfig, s3Config, mockAthenaUtils };
}
