import { Table } from "@aws-sdk/client-glue";
import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { TableContext, createTableContext } from "../shared/types";
import { sourceBucketFromTableName } from "../shared/athena-utils";

export class TableManager {
    private databaseName: string;
    private targetBucket: string;
    private useS3Table: boolean;

    constructor(databaseName: string, targetBucket: string, useS3Table: boolean = false) {
        this.databaseName = databaseName;
        this.targetBucket = targetBucket;
        this.useS3Table = useS3Table;
    }

    async ensureTablesExist(sourceTables: Table[]): Promise<void> {
        // Find representative views for each table type
        const packagesView = sourceTables.find(t => t.Name?.includes('packages-view'))?.Name;
        const entriesView = sourceTables.find(t => t.Name?.includes('objects-view'))?.Name;

        // Create tables if needed
        if (packagesView) {
            try {
                await PackageRevisionTable.ensureExists(this.databaseName, this.targetBucket, packagesView, this.useS3Table);
                await PackageTagTable.ensureExists(this.databaseName, this.targetBucket, packagesView, this.useS3Table);
            } catch (error) {
                const err = error as Error;
                console.error(`Failed to ensure package tables exist for view ${packagesView}:`, {
                    error: err.message,
                    stack: err.stack,
                });
                // Don't rethrow - continue with other tables
            }
        }

        if (entriesView) {
            try {
                await PackageEntryTable.ensureExists(this.databaseName, this.targetBucket, entriesView, this.useS3Table);
            } catch (error) {
                const err = error as Error;
                console.error(`Failed to ensure entry table exists for view ${entriesView}:`, {
                    error: err.message,
                    stack: err.stack,
                });
                // Don't rethrow - continue with other tables
            }
        }
    }

    async executeInserts(sourceTables: Table[]): Promise<number> {
        let queryCount = 0;
        let successfulTables = 0;
        let failedTables = 0;

        for (const table of sourceTables) {
            if (!table.Name) continue;

            try {
                const registryName = sourceBucketFromTableName(table.Name);
                const context = createTableContext(
                    this.databaseName,
                    this.targetBucket,
                    registryName,
                    this.useS3Table
                );

                const isPackagesView = table.Name.includes('packages-view');

                if (isPackagesView) {
                    // Handle package revisions and tags
                    try {
                        await PackageRevisionTable.insert(context, table.Name);
                        queryCount++;
                    } catch (error) {
                        const err = error as Error;
                        console.error(`Failed to insert package revisions from ${table.Name}:`, {
                            error: err.message,
                            registryName,
                            isS3AccessError: this.isS3AccessError(err),
                        });
                    }

                    try {
                        await PackageTagTable.insert(context, table.Name);
                        queryCount++;
                    } catch (error) {
                        const err = error as Error;
                        console.error(`Failed to insert package tags from ${table.Name}:`, {
                            error: err.message,
                            registryName,
                            isS3AccessError: this.isS3AccessError(err),
                        });
                    }
                } else if (table.Name.includes('objects-view')) {
                    // Handle package entries
                    try {
                        await PackageEntryTable.insert(context, table.Name);
                        queryCount++;
                    } catch (error) {
                        const err = error as Error;
                        console.error(`Failed to insert package entries from ${table.Name}:`, {
                            error: err.message,
                            registryName,
                            isS3AccessError: this.isS3AccessError(err),
                        });
                    }
                }

                successfulTables++;
            } catch (error) {
                const err = error as Error;
                const registryName = sourceBucketFromTableName(table.Name);
                console.error(`Failed to process table ${table.Name}:`, {
                    error: err.message,
                    registryName,
                    isS3AccessError: this.isS3AccessError(err),
                    stack: err.stack,
                });
                failedTables++;
                // Continue processing other tables
            }
        }

        console.log(`Table processing summary:`, {
            totalTables: sourceTables.length,
            successfulTables,
            failedTables,
            totalQueries: queryCount,
        });

        return queryCount;
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
