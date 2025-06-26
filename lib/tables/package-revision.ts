import { BaseTable } from "./base-table";
import { TableContext } from "../shared/types";

export class PackageRevisionTable extends BaseTable {
    protected get tableName(): string {
        return "package_revision";
    }

    protected getCreateTableSchema(databaseName: string): string {
        return `
            CREATE TABLE "${databaseName}"."${this.tableName}" (
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

    protected generateSelectClause(registryName: string, sourceAlias: string): string {
        return `'${registryName}' AS registry,
              ${sourceAlias}.pkg_name,
              ${sourceAlias}.top_hash,
              from_unixtime(CAST(${sourceAlias}.timestamp AS bigint)) AS timestamp,
              ${sourceAlias}.message,
              ${sourceAlias}.user_meta AS metadata`;
    }

    protected generateWhereClauseForCtas(sourceAlias: string): string {
        return `${sourceAlias}.timestamp != 'latest'`;
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        const selectClause = this.generateSelectClause(context.registryName, 's');
        
        return `
            INSERT INTO "${context.databaseName}"."${this.tableName}" (registry, pkg_name, top_hash, timestamp, message, metadata)
            SELECT DISTINCT
              ${selectClause}
            FROM "${context.databaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.databaseName}"."${this.tableName}" t
              ON s.pkg_name = t.pkg_name
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.pkg_name IS NULL
              AND s.timestamp != 'latest'`;
    }
}
