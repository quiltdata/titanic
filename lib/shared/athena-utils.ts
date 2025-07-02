import { AthenaClient, GetQueryExecutionCommand, QueryExecutionState, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { GlueClient, GetTablesCommand, GetTablesCommandOutput } from "@aws-sdk/client-glue";
import { Config } from './config';

/**
 * Simplified AthenaUtils - just the essentials for running queries and checking tables
 */
export class AthenaUtils {
    private readonly athena: AthenaClient;
    private readonly _glue: GlueClient;
    private readonly config: Config;

    constructor(config: Config, athenaClient?: AthenaClient, glueClient?: GlueClient) {
        this.config = config;
        this.athena = athenaClient || new AthenaClient();
        this._glue = glueClient || new GlueClient();
    }

    /**
     * Create a test instance with injectable clients for mocking
     */
    static createTestInstance(config: Config, athenaClient?: AthenaClient, glueClient?: GlueClient): AthenaUtils {
        return new AthenaUtils(config, athenaClient, glueClient);
    }

    /**
     * Execute a query and wait for completion
     */
    async executeQuery(query: string): Promise<void> {
        const response = await this.athena.send(new StartQueryExecutionCommand({
            QueryString: query,
            QueryExecutionContext: { Database: this.config.getWriteDatabaseName() },
            ResultConfiguration: { OutputLocation: `s3://${this.config.getResultsBucket()}/athena-results/` }
        }));

        if (!response?.QueryExecutionId) {
            throw new Error("Failed to start query");
        }

        await this.waitForCompletion(response.QueryExecutionId);
    }

    /**
     * Check if a table exists
     */
    async tableExists(tableName: string): Promise<boolean> {
        const response = await this._glue.send(new GetTablesCommand({
            DatabaseName: this.config.getReadDatabaseName(),
            Expression: tableName
        }));
        
        if (!response?.TableList) {
            return false;
        }
        
        return response.TableList.some(table => table.Name === tableName);
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
    async dropAllTitanicTables(): Promise<void> {
        const tables = ['package_revision', 'package_tag', 'package_entry'];
        await this.dropTablesIfExist(tables);
    }

    /**
     * Drop specified tables if they exist
     * This method provides better separation of concerns for table cleanup
     */
    async dropTablesIfExist(tableNames: string[]): Promise<void> {
        for (const tableName of tableNames) {
            try {
                const exists = await this.tableExists(tableName);
                if (exists) {
                    console.log(`Dropping existing table: ${tableName}`);
                    await this.executeQuery(this.config.dropTableQuery(tableName));
                    console.log(`✅ Successfully dropped table: ${tableName}`);
                } else {
                    console.log(`⏭️ Table ${tableName} does not exist, skipping drop`);
                }
            } catch (error) {
                // Log error but don't fail the entire operation
                console.error(`❌ Failed to drop table ${tableName}:`, (error as Error).message);
            }
        }
    }
}


