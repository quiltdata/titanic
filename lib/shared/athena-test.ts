import { AthenaClient, GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { GlueClient, GetTablesCommand } from "@aws-sdk/client-glue";
import { mockClient, AwsStub } from "aws-sdk-client-mock";
import { AthenaUtils } from './athena-utils';
import { Config } from './config';

/**
 * Test-specific subclass of AthenaUtils with mocking capabilities
 * This separates test concerns from production code to help slim the Lambda bundle
 */
export class AthenaTest extends AthenaUtils {
    public readonly athenaMock: AwsStub<AthenaClient>;
    public readonly glueMock: AwsStub<GlueClient>;

    private constructor(config: Config, athenaMock: AwsStub<AthenaClient>, glueMock: AwsStub<GlueClient>) {
        super(config, athenaMock as unknown as AthenaClient, glueMock as unknown as GlueClient);
        this.athenaMock = athenaMock;
        this.glueMock = glueMock;
    }

    /**
     * Create a test instance with pre-configured mocks
     */
    static createTestInstance(config: Config): AthenaTest {
        const glueMock = mockClient(GlueClient);
        const athenaMock = mockClient(AthenaClient);
        
        // Set up default mock behaviors
        const instance = new AthenaTest(config, athenaMock, glueMock);
        instance.setupDefaultMocks();
        
        return instance;
    }

    /**
     * Set up default mock behaviors that work for most tests
     */
    private setupDefaultMocks(): void {
        // Default Athena mock - successful query execution
        this.athenaMock.on(StartQueryExecutionCommand).resolves({
            QueryExecutionId: 'test-execution-id'
        });

        this.athenaMock.on(GetQueryExecutionCommand).resolves({
            QueryExecution: {
                Status: {
                    State: QueryExecutionState.SUCCEEDED
                }
            }
        });

        // Default Glue mock - no tables found (can be overridden in tests)
        this.glueMock.on(GetTablesCommand).resolves({
            TableList: []
        });
    }

    /**
     * Mock table existence for specific tables
     */
    mockTableExists(tableName: string, exists: boolean, databaseName?: string): void {
        const dbName = databaseName || this.config.getReadDatabaseName();
        
        this.glueMock.on(GetTablesCommand, {
            DatabaseName: dbName,
            Expression: tableName
        }).resolves({
            TableList: exists ? [{ Name: tableName }] : []
        });
    }

    /**
     * Mock multiple tables in a database
     */
    mockTablesInDatabase(tables: Array<{ Name: string }>, databaseName?: string): void {
        const dbName = databaseName || this.config.getReadDatabaseName();
        
        this.glueMock.on(GetTablesCommand, {
            DatabaseName: dbName
        }).resolves({
            TableList: tables
        });
    }

    /**
     * Mock query execution failure
     */
    mockQueryFailure(errorMessage: string = "Athena error"): void {
        this.athenaMock.on(StartQueryExecutionCommand).rejects(new Error(errorMessage));
    }

    /**
     * Mock query execution success/failure returning boolean
     */
    mockQueryResult(success: boolean, executionId: string = "test-execution-id"): void {
        if (success) {
            this.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: executionId
            });

            this.athenaMock.on(GetQueryExecutionCommand, {
                QueryExecutionId: executionId
            }).resolves({
                QueryExecution: {
                    Status: {
                        State: QueryExecutionState.SUCCEEDED
                    }
                }
            });
        } else {
            // Mock a failed query execution that returns false instead of throwing
            this.athenaMock.on(StartQueryExecutionCommand).resolves({
                QueryExecutionId: executionId
            });

            this.athenaMock.on(GetQueryExecutionCommand, {
                QueryExecutionId: executionId
            }).resolves({
                QueryExecution: {
                    Status: {
                        State: QueryExecutionState.FAILED,
                        StateChangeReason: "Query failed"
                    }
                }
            });
        }
    }

    /**
     * Mock query execution with custom execution ID
     */
    mockQueryExecution(executionId: string = "test-execution-id"): void {
        this.athenaMock.on(StartQueryExecutionCommand).resolves({
            QueryExecutionId: executionId
        });

        this.athenaMock.on(GetQueryExecutionCommand, {
            QueryExecutionId: executionId
        }).resolves({
            QueryExecution: {
                Status: {
                    State: QueryExecutionState.SUCCEEDED
                }
            }
        });
    }

    /**
     * Reset all mocks to their default state
     */
    resetMocks(): void {
        this.athenaMock.reset();
        this.glueMock.reset();
        this.setupDefaultMocks();
    }

    /**
     * Get call history for debugging
     */
    getAthenaCalls(): any[] {
        return this.athenaMock.calls();
    }

    getGlueCalls(): any[] {
        return this.glueMock.calls();
    }
}
