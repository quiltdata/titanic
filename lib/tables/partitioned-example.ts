import { BaseTable } from "./base-table";
import { TableContext } from "../shared/types";

/**
 * Example table class that enables partitioning
 * Demonstrates how to configure partitioning for future optimization
 */
export class PartitionedExampleTable extends BaseTable {
    // Enable partitioning for this table class
    protected static readonly ENABLE_PARTITIONING = true;
    
    protected get tableName(): string {
        return "partitioned_example";
    }

    protected getCreateTableSchema(databaseName: string): string {
        return `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.tableName}" (
              id           STRING,   
              data         STRING,   
              created_at   TIMESTAMP
            )
        `;
    }

    protected getPartitioningClause(): string {
        return `PARTITIONED BY (
              bucket(16, id)
            )`;
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.tableName}" (id, data, created_at)
            SELECT DISTINCT
              s.id,
              s.data,
              s.created_at
            FROM "${context.databaseName}"."${sourceTableName}" s`;
    }
}
