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
            await PackageRevisionTable.ensureExists(this.databaseName, this.targetBucket, packagesView, this.useS3Table);
            await PackageTagTable.ensureExists(this.databaseName, this.targetBucket, packagesView, this.useS3Table);
        }

        if (entriesView) {
            await PackageEntryTable.ensureExists(this.databaseName, this.targetBucket, entriesView, this.useS3Table);
        }
    }

    async executeInserts(sourceTables: Table[]): Promise<number> {
        let queryCount = 0;

        for (const table of sourceTables) {
            if (!table.Name) continue;

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
                await PackageRevisionTable.insert(context, table.Name);
                await PackageTagTable.insert(context, table.Name);
                queryCount += 2;
            } else if (table.Name.includes('objects-view')) {
                // Handle package entries
                await PackageEntryTable.insert(context, table.Name);
                queryCount += 1;
            }
        }

        return queryCount;
    }
}
