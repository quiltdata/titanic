import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { BaseTable } from "./base-table";
import { AthenaUtils } from "../shared/athena-utils";
import { Config } from "../shared/config";

export class TableManager {
    private athenaUtils: AthenaUtils;
    private targetTables: BaseTable[];

    constructor(
        private config: Config, // Pass config as parameter
        private glueDatabaseName: string,
        private targetDatabaseName: string,
        private targetBucket: string,
        athenaUtils?: AthenaUtils // Optional for testing
    ) {
        this.athenaUtils = athenaUtils || new AthenaUtils(config);
        
        // Create table instances
        this.targetTables = [
            new PackageRevisionTable(config),
            new PackageTagTable(config),
            new PackageEntryTable(config)
        ];
    }

    /**
     * Create a test instance with injectable AthenaUtils for mocking
     */
    static createTestInstance(
        config: Config,
        glueDatabaseName: string,
        targetDatabaseName: string,
        targetBucket: string,
        athenaUtils: AthenaUtils
    ): TableManager {
        return new TableManager(config, glueDatabaseName, targetDatabaseName, targetBucket, athenaUtils);
    }

    /**
     * Explicitly create tables based on source tables found
     * This method creates empty tables for S3 Tables mode, or prepares for lazy creation in Glue mode.
     */
    async createTables(): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        console.log(`📋 Creating tables in target database: ${this.targetDatabaseName}`);
        console.log(`📋 Config type: ${this.config.constructor.name}, Target bucket: ${this.targetBucket}`);

        const result = await this.execute('create');
        
        console.log(`📋 Table creation summary: ${result.successfulTables} successful, ${result.failedTables} failed out of ${result.totalQueries} total`);
        return result;
    }

    async executeInserts(packageView: string, objectsView: string): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        return await this.execute('insert', packageView, objectsView);
    }

    async executeDrops(): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        return await this.execute('drop');
    }

    /**
     * Execute a query type on all target tables
     */
    async execute(type: 'create' | 'insert' | 'drop', packagesView?: string, objectsView?: string): Promise<{ successfulTables: number; failedTables: number; totalQueries: number }> {
        let totalQueries = 0;
        let successfulTables = 0;
        let failedTables = 0;

        for (const table of this.targetTables) {
            try {
                const query = table.query(type, packagesView, objectsView);
                console.log(`Executing ${type} on ${table.tableName}:`, query);
                await this.athenaUtils.executeQuery(query);
                totalQueries++;
                successfulTables++;
                console.log(`✅ Successfully executed ${type} on ${table.tableName}`);
            } catch (error) {
                const err = error as Error;
                totalQueries++;
                failedTables++;
                console.error(`❌ Failed to execute ${type} on ${table.tableName}:`, {
                    error: err.message,
                    isS3AccessError: this.isS3AccessError(err),
                });
            }
        }

        console.log(`${type} operation summary:`, {
            successfulTables,
            failedTables,
            totalQueries,
        });

        return { successfulTables, failedTables, totalQueries };
    }

    /**
     * Check if an error is related to S3 access issues
     */
    private isS3AccessError(error: Error): boolean {
        const errorMessage = error.message.toLowerCase();
        return errorMessage.includes('access denied') ||
               errorMessage.includes('accessdenied') ||
               errorMessage.includes('no such bucket') ||
               errorMessage.includes('forbidden') ||
               errorMessage.includes('403') ||
               errorMessage.includes('bucket does not exist');
    }
}
