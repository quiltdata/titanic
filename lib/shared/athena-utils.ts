import { AthenaClient, GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { GlueClient, GetTablesCommand, GetTablesCommandOutput } from "@aws-sdk/client-glue";
import { Config } from './config';

/**
 * Simplified AthenaUtils - just the essentials for running queries and checking tables
 */
export class AthenaUtils {
    private readonly athena: AthenaClient;
    private readonly _glue: GlueClient;
    protected readonly config: Config;

    constructor(config: Config, athenaClient?: AthenaClient, glueClient?: GlueClient) {
        this.config = config;
        this.athena = athenaClient || new AthenaClient();
        this._glue = glueClient || new GlueClient();
        
        // Validate configuration on startup
        this.validateConfiguration();
    }

    /**
     * Validate the configuration has all required values
     */
    private validateConfiguration(): void {
        const issues: string[] = [];
        
        if (!this.config.getResultsBucket()) {
            issues.push('Results bucket is empty - check GLUE_TABLES_BUCKET environment variable');
        }
        
        if (!this.config.getWriteDatabaseName()) {
            issues.push('Write database name is empty - check GLUE_DATABASE_NAME or S3TABLE_DATABASE_NAME environment variables');
        }
        
        if (!this.config.getReadDatabaseName()) {
            issues.push('Read database name is empty - check GLUE_DATABASE_NAME environment variable');
        }
        
        if (issues.length > 0) {
            console.warn(`⚠️ Configuration issues detected:`, {
                issues,
                currentConfig: {
                    configType: this.config.constructor.name,
                    resultsBucket: this.config.getResultsBucket(),
                    writeDatabaseName: this.config.getWriteDatabaseName(),
                    readDatabaseName: this.config.getReadDatabaseName(),
                    useS3Table: this.config.useS3Table
                },
                environmentVariables: {
                    GLUE_TABLES_BUCKET: process.env.GLUE_TABLES_BUCKET,
                    GLUE_DATABASE_NAME: process.env.GLUE_DATABASE_NAME,
                    S3TABLE_DATABASE_NAME: process.env.S3TABLE_DATABASE_NAME,
                    S3_TABLES_BUCKET: process.env.S3_TABLES_BUCKET,
                    USE_S3_TABLE: process.env.USE_S3_TABLE
                }
            });
        }
    }

    /**
     * Test Athena + S3 connectivity with a simple query
     * This validates that both Athena and the results bucket are accessible
     */
    async validateAthenaAccess(): Promise<boolean> {
        try {
            console.log(`🔬 Testing Athena + S3 connectivity...`);
            // Use a simple SELECT 1 query to test Athena + S3 integration
            await this.executeQuery('SELECT 1 AS test_connection');
            console.log(`✅ Athena + S3 connectivity test passed`);
            return true;
        } catch (error) {
            console.error(`❌ Athena + S3 connectivity test failed:`, {
                error: error instanceof Error ? error.message : String(error),
                outputLocation: `s3://${this.config.getResultsBucket()}/athena-results/`,
                bucketName: this.config.getResultsBucket()
            });
            return false;
        }
    }

    /**
     * Execute a query and wait for completion
     */
    async executeQuery(query: string): Promise<void> {
        const database = this.config.getWriteDatabaseName();
        const outputLocation = `s3://${this.config.getResultsBucket()}/athena-results/`;
        
        console.log(`🔍 Executing query with context:`, {
            database,
            outputLocation,
            configType: this.config.constructor.name,
            queryPreview: query.substring(0, 100) + (query.length > 100 ? '...' : '')
        });

        // Log bucket information for diagnostics
        console.log(`📦 S3 Configuration:`, {
            resultsBucket: this.config.getResultsBucket(),
            tablesBucket: this.config.getTablesBucket(),
            bucketFromEnv: process.env.GLUE_TABLES_BUCKET,
            s3BucketFromEnv: process.env.S3_TABLES_BUCKET
        });

        try {
            const response = await this.athena.send(new StartQueryExecutionCommand({
                QueryString: query,
                QueryExecutionContext: this.config.getExecutionContext(),
                ResultConfiguration: { OutputLocation: outputLocation }
            }));

            if (!response?.QueryExecutionId) {
                throw new Error("Failed to start query");
            }

            console.log(`📝 Query started with ID: ${response.QueryExecutionId}`);
            await this.waitForCompletion(response.QueryExecutionId);
            console.log(`✅ Query completed successfully: ${response.QueryExecutionId}`);
        } catch (error) {
            // Enhanced error logging for S3 bucket issues
            if (error instanceof Error) {
                console.error(`❌ Query execution failed:`, {
                    errorMessage: error.message,
                    queryPreview: query.substring(0, 100),
                    outputLocation,
                    bucketName: this.config.getResultsBucket()
                });
                
                // Check for specific S3 bucket errors
                if (error.message.includes('Cannot find or access the specified bucket') || 
                    error.message.includes('Access Denied') ||
                    error.message.includes('NoSuchBucket')) {
                    
                    console.error(`🚨 S3 Bucket Access Problem Detected:`, {
                        issue: 'The Athena results bucket does not exist or is not accessible',
                        bucketName: this.config.getResultsBucket(),
                        suggestions: [
                            '1. Verify the CDK stack was deployed successfully',
                            '2. Check if the bucket exists in the AWS console',
                            '3. Verify Lambda has s3:PutObject permissions on the bucket',
                            '4. Check the GLUE_TABLES_BUCKET environment variable is set correctly'
                        ],
                        environmentVariables: {
                            GLUE_TABLES_BUCKET: process.env.GLUE_TABLES_BUCKET,
                            S3_TABLES_BUCKET: process.env.S3_TABLES_BUCKET,
                            USE_S3_TABLE: process.env.USE_S3_TABLE
                        }
                    });
                }
            }
            throw error;
        }
    }

    /**
     * Check if a table exists
     * NOTE: This uses Glue's GetTablesCommand, which works even if S3 buckets are inaccessible.
     * This is why table existence checks can succeed while DROP TABLE operations fail.
     * Use validateAthenaAccess() to test actual Athena + S3 connectivity.
     */
    async tableExists(tableName: string, databaseName?: string): Promise<boolean> {
        const dbName = databaseName || this.config.getReadDatabaseName();
        console.log(`🔍 Checking if table exists: ${tableName} in database: ${dbName}`);
        
        const response = await this._glue.send(new GetTablesCommand({
            DatabaseName: dbName,
            Expression: tableName
        }));
        
        if (!response?.TableList) {
            console.log(`📋 No tables found for ${tableName} in ${dbName}`);
            return false;
        }
        
        const exists = response.TableList.some(table => table.Name === tableName);
        console.log(`📋 Table ${tableName} ${exists ? 'EXISTS' : 'DOES NOT EXIST'} in database ${dbName}`);
        return exists;
    }

    /**
     * Get all tables in the database with pagination support
     */
    async getAllTables(databaseName?: string): Promise<any[]> {
        const dbName = databaseName || this.config.getReadDatabaseName();
        const allTables = [];
        let nextToken = undefined;

        do {
            const response: GetTablesCommandOutput = await this._glue.send(new GetTablesCommand({
                DatabaseName: dbName,
                NextToken: nextToken,
            }));
            
            if (!response?.TableList) {
                break; // No more tables or empty response
            }
            
            allTables.push(...response.TableList);
            nextToken = response.NextToken;
        } while (nextToken);

        return allTables;
    }

    /**
     * Wait for query to complete
     */
    async waitForQueryCompletion(queryId: string, maxAttempts: number = 30): Promise<void> {
        return this.waitForCompletion(queryId, maxAttempts);
    }

    private async waitForCompletion(queryId: string, maxAttempts: number = 30): Promise<void> {
        for (let i = 0; i < maxAttempts; i++) {
            const response = await this.athena.send(new GetQueryExecutionCommand({ QueryExecutionId: queryId }));
            const state = response.QueryExecution?.Status?.State;

            if (state === QueryExecutionState.SUCCEEDED) return;
            
            if (state === QueryExecutionState.FAILED || state === QueryExecutionState.CANCELLED) {
                throw new Error(response.QueryExecution?.Status?.StateChangeReason || "Query failed");
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        throw new Error(`Query timed out after ${maxAttempts} attempts`);
    }

    /**
     * Drop all Titanic tables for clean deployment
     */
    async dropAllTitanicTables(databaseName?: string): Promise<void> {
        const tables = ['package_revision', 'package_tag', 'package_entry'];
        const targetDatabase = databaseName || this.config.getWriteDatabaseName();
        console.log(`🗑️ Dropping Titanic tables in target database: ${targetDatabase}`);
        await this.dropTablesIfExist(tables, targetDatabase);
    }

    /**
     * Drop specified tables if they exist
     * This method provides better separation of concerns for table cleanup
     */
    async dropTablesIfExist(tableNames: string[], databaseName?: string): Promise<void> {
        const targetDatabase = databaseName || this.config.getWriteDatabaseName();
        console.log(`🗑️ Checking tables to drop in database: ${targetDatabase}`);
        
        // Validate Athena + S3 access before attempting any drops
        const athenaAccessValid = await this.validateAthenaAccess();
        if (!athenaAccessValid) {
            console.error(`🚨 Skipping table drops due to Athena + S3 connectivity issues`);
            console.error(`💡 This usually means the S3 bucket for Athena results doesn't exist or isn't accessible`);
            console.error(`🔧 Check: 1) CDK deployment success, 2) S3 bucket existence, 3) Lambda permissions`);
            return;
        }
        
        for (const tableName of tableNames) {
            try {
                // Note: tableExists uses Glue API (works even if S3 bucket is broken)
                // but executeQuery uses Athena API (requires S3 bucket access)
                const exists = await this.tableExists(tableName, targetDatabase);
                if (exists) {
                    console.log(`🗑️ Dropping existing table: ${tableName} from database ${targetDatabase}`);
                    await this.executeQuery(`DROP TABLE IF EXISTS ${tableName}`);
                    console.log(`✅ Successfully dropped table: ${tableName}`);
                } else {
                    console.log(`⏭️ Table ${tableName} does not exist in ${targetDatabase}, skipping drop`);
                }
            } catch (error) {
                // Log error but don't fail the entire operation
                console.error(`❌ Failed to drop table ${tableName} from database ${targetDatabase}:`, (error as Error).message);
            }
        }
    }
}


