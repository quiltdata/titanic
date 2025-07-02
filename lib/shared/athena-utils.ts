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

        const response = await this.athena.send(new StartQueryExecutionCommand({
            QueryString: query,
            QueryExecutionContext: { Database: database },
            ResultConfiguration: { OutputLocation: outputLocation }
        }));

        if (!response?.QueryExecutionId) {
            throw new Error("Failed to start query");
        }

        console.log(`📝 Query started with ID: ${response.QueryExecutionId}`);
        await this.waitForCompletion(response.QueryExecutionId);
        console.log(`✅ Query completed successfully: ${response.QueryExecutionId}`);
    }

    /**
     * Check if a table exists
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
        
        for (const tableName of tableNames) {
            try {
                const exists = await this.tableExists(tableName, targetDatabase);
                if (exists) {
                    const qualifiedTableName = `${targetDatabase}.${tableName}`;
                    console.log(`🗑️ Dropping existing table: ${qualifiedTableName}`);
                    await this.executeQuery(`DROP TABLE IF EXISTS ${qualifiedTableName}`);
                    console.log(`✅ Successfully dropped table: ${qualifiedTableName}`);
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


