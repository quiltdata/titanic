import { BaseTable } from "./base-table";
import { TableContext } from "../shared/types";

export class PackageRevisionTable extends BaseTable {
    protected get tableName(): string {
        return "package_revision";
    }

    protected getCreateTableSchema(databaseName: string): string {
        return `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.tableName}" (
              registry     STRING,   
              pkg_name     STRING,   
              top_hash     STRING,   
              timestamp    TIMESTAMP, 
              message      STRING,   
              metadata    STRING       
            )
        `;
    }

    protected getPartitioningClause(): string {
        return `PARTITIONED BY (
              registry,
              bucket(8, pkg_name),
              bucket(8, top_hash)
            )`;
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.tableName}" (registry, pkg_name, top_hash, timestamp, message, metadata)
            SELECT DISTINCT
              '${context.registryName}' AS registry,
              s.pkg_name,
              s.top_hash,
              from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp,
              s.message,
              s.user_meta AS metadata
            FROM "${context.databaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.databaseName}"."${this.tableName}" t
              ON s.pkg_name = t.pkg_name
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.pkg_name IS NULL
              AND s.timestamp != 'latest'`;
    }
}
